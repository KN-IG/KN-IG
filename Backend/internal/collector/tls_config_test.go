package collector

import (
	"crypto/x509"
	"crypto/x509/pkix"
	"net/url"
	"testing"
)

func TestPeerIdentityFromCertRequiresSPIFFEAgentIdentity(t *testing.T) {
	spiffe, err := url.Parse("spiffe://kn-ig/agent/3343830432")
	if err != nil {
		t.Fatal(err)
	}
	otherURI, err := url.Parse("https://example.invalid/agent/3343830432")
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		cert    *x509.Certificate
		want    string
		wantErr bool
	}{
		{
			name: "spiffe san uri",
			cert: &x509.Certificate{URIs: []*url.URL{spiffe}},
			want: "spiffe://kn-ig/agent/3343830432",
		},
		{
			name: "spiffe cn fallback",
			cert: &x509.Certificate{Subject: pkix.Name{CommonName: "spiffe://kn-ig/agent/3343830432"}},
			want: "spiffe://kn-ig/agent/3343830432",
		},
		{
			name:    "non spiffe san uri",
			cert:    &x509.Certificate{URIs: []*url.URL{otherURI}, Subject: pkix.Name{CommonName: "spiffe://kn-ig/agent/3343830432"}},
			wantErr: true,
		},
		{
			name:    "non spiffe cn",
			cert:    &x509.Certificate{Subject: pkix.Name{CommonName: "legacy-agent"}},
			wantErr: true,
		},
		{
			name:    "empty spiffe suffix",
			cert:    &x509.Certificate{Subject: pkix.Name{CommonName: agentIdentityPrefix}},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := peerIdentityFromCert(tt.cert)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("peerIdentityFromCert() = %q, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("peerIdentityFromCert() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("peerIdentityFromCert() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCertificateIdentityMatchesAgentFailsClosed(t *testing.T) {
	tests := []struct {
		name        string
		agentID     string
		certSubject string
		want        bool
	}{
		{name: "matching spiffe", agentID: "3343830432", certSubject: "spiffe://kn-ig/agent/3343830432", want: true},
		{name: "mismatched spiffe", agentID: "3343830432", certSubject: "spiffe://kn-ig/agent/111", want: false},
		{name: "non spiffe", agentID: "3343830432", certSubject: "legacy-agent", want: false},
		{name: "empty", agentID: "3343830432", certSubject: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			session := &AgentSession{AgentID: tt.agentID, certSubject: tt.certSubject}
			if got := session.certificateIdentityMatchesAgent(); got != tt.want {
				t.Fatalf("certificateIdentityMatchesAgent() = %v, want %v", got, tt.want)
			}
		})
	}
}
