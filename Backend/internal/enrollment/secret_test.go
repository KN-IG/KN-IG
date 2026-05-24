package enrollment

import (
	"strings"
	"testing"
)

func TestValidateSecretValue(t *testing.T) {
	if err := ValidateSecretValue("ENROLL_SECRET_PEPPER", strings.Repeat("x", 32), 32); err != nil {
		t.Fatalf("ValidateSecretValue(valid) error = %v", err)
	}

	tests := []struct {
		name  string
		value string
	}{
		{name: "empty", value: ""},
		{name: "short", value: "short-secret"},
		{name: "placeholder", value: "change-me"},
		{name: "angle placeholder", value: "<local-pepper>"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := ValidateSecretValue("ENROLL_SECRET_PEPPER", tt.value, 32); err == nil {
				t.Fatal("ValidateSecretValue succeeded, want error")
			}
		})
	}
}
