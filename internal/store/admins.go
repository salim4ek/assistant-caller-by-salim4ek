package store

import (
	"database/sql"
	"errors"

	"golang.org/x/crypto/bcrypt"

	"assistant-caller/internal/models"
)

func hashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (db *DB) FindAdminByUsername(username string) (*models.Admin, string, error) {
	var a models.Admin
	var hash string
	err := db.QueryRow(`SELECT id, username, password_hash, created_at FROM admins WHERE username = ?`, username).
		Scan(&a.ID, &a.Username, &hash, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return &a, hash, nil
}

func (db *DB) VerifyAdminPassword(username, password string) (*models.Admin, error) {
	a, hash, err := db.FindAdminByUsername(username)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, ErrNotFound // do not disclose whether user exists
	}
	return a, nil
}

func (db *DB) ListAdmins() ([]models.Admin, error) {
	rows, err := db.Query(`SELECT id, username, created_at FROM admins ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Admin
	for rows.Next() {
		var a models.Admin
		if err := rows.Scan(&a.ID, &a.Username, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// CreateAdmin inserts a new admin with a bcrypt-hashed password.
// Returns ErrConflict if the username is already taken.
func (db *DB) CreateAdmin(username, password string) (*models.Admin, error) {
	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(`INSERT INTO admins(username, password_hash) VALUES (?, ?)`, username, hash)
	if err != nil {
		if isUniqueErr(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.Admin{ID: id, Username: username}, nil
}

// DeleteAdmin removes an admin by ID. Returns ErrNotFound if no row was deleted.
func (db *DB) DeleteAdmin(id int64) error {
	res, err := db.Exec(`DELETE FROM admins WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
