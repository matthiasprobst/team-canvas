package jose

import (
	"math/big"
	"strings"
	"testing"
)

func TestOversizedRSAJWKRejectedBeforeValidation(t *testing.T) {
	huge := new(big.Int).Lsh(big.NewInt(1), MaxRSAModulusBits)
	key := rawJSONWebKey{
		N: newBuffer(huge.Bytes()), E: newBuffer(big.NewInt(65537).Bytes()),
		D: newBuffer([]byte{3}), P: newBuffer([]byte{3}), Q: newBuffer([]byte{3}),
	}
	if _, err := key.rsaPrivateKey(); err == nil || !strings.Contains(err.Error(), "modulus too large") {
		t.Fatalf("expected modulus limit, got %v", err)
	}
	if _, err := key.rsaPublicKey(); err == nil || !strings.Contains(err.Error(), "modulus too large") {
		t.Fatalf("expected public modulus limit, got %v", err)
	}
}

func TestInvalidRSAPrimesRejectedBeforeValidation(t *testing.T) {
	key := rawJSONWebKey{
		N: newBuffer([]byte{21}), E: newBuffer([]byte{3}),
		D: newBuffer([]byte{3}), P: newBuffer([]byte{3}), Q: newBuffer([]byte{5}),
	}
	if _, err := key.rsaPrivateKey(); err == nil || !strings.Contains(err.Error(), "p * q != n") {
		t.Fatalf("expected prime product check, got %v", err)
	}
}
