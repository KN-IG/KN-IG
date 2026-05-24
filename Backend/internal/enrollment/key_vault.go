package enrollment

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

// KeyVault encrypts physically delivered XOR keys before DB persistence.
type KeyVault struct {
	key [32]byte
}

func NewKeyVaultFromEnv(envName string) (*KeyVault, error) {
	raw := strings.TrimSpace(os.Getenv(envName))
	if raw == "" {
		return nil, fmt.Errorf("%s 환경변수가 필요합니다", envName)
	}
	if err := ValidateSecretValue(envName, raw, 0); err != nil {
		return nil, err
	}
	return NewKeyVault([]byte(raw))
}

func NewKeyVault(raw []byte) (*KeyVault, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("empty key encryption key")
	}
	kek := strings.TrimSpace(string(raw))
	if err := ValidateSecretValue("ENROLL_KEY_KEK", kek, 0); err != nil {
		return nil, err
	}
	material, err := base64.StdEncoding.Strict().DecodeString(kek)
	if err != nil {
		return nil, fmt.Errorf("ENROLL_KEY_KEK must be standard base64 encoded 32 bytes: %w", err)
	}
	if len(material) != 32 {
		ZeroBytes(material)
		return nil, fmt.Errorf("ENROLL_KEY_KEK must decode to exactly 32 bytes")
	}

	v := &KeyVault{}
	copy(v.key[:], material)
	ZeroBytes(material)
	return v, nil
}

func (v *KeyVault) Encrypt(plaintext []byte) (ciphertext []byte, nonce []byte, err error) {
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = gcm.Seal(nil, nonce, plaintext, nil)
	return ciphertext, nonce, nil
}

func (v *KeyVault) Decrypt(ciphertext, nonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(v.key[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(nonce) != gcm.NonceSize() {
		return nil, fmt.Errorf("invalid enrollment key nonce size")
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func (v *KeyVault) Close() {
	if v != nil {
		ZeroBytes(v.key[:])
	}
}
