package enrollment

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func TestNewKeyVaultRequiresBase64Encoded32ByteKey(t *testing.T) {
	valid := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	vault, err := NewKeyVault([]byte(valid))
	if err != nil {
		t.Fatalf("NewKeyVault(valid) error = %v", err)
	}
	defer vault.Close()

	ciphertext, nonce, err := vault.Encrypt([]byte("xor secret"))
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	plaintext, err := vault.Decrypt(ciphertext, nonce)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}
	if string(plaintext) != "xor secret" {
		t.Fatalf("Decrypt plaintext = %q", plaintext)
	}
}

func TestNewKeyVaultRejectsRawAndPlaceholderKeys(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "raw string", raw: strings.Repeat("a", 32)},
		{name: "placeholder", raw: "change-me-at-least-32-bytes-for-local-dev"},
		{name: "short decoded", raw: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x11}, 31))},
		{name: "long decoded", raw: base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x22}, 33))},
		{name: "base64url", raw: base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x33}, 32))},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := NewKeyVault([]byte(tt.raw)); err == nil {
				t.Fatal("NewKeyVault succeeded, want error")
			}
		})
	}
}
