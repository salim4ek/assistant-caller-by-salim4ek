package store

import "golang.org/x/crypto/bcrypt"

func bcryptCompareHash(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}
