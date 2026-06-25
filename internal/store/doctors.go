package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"assistant-caller/internal/models"
)

const (
	DoctorStatusPending  = "pending"
	DoctorStatusApproved = "approved"
	DoctorStatusRejected = "rejected"
)

// ---------- Whitelist (kept for compatibility) ----------

func (db *DB) AddToWhitelist(email string) (*models.WhitelistEntry, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return nil, fmt.Errorf("empty email")
	}
	res, err := db.Exec(`INSERT INTO whitelist(email) VALUES (?)`, email)
	if err != nil {
		if isUniqueErr(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.WhitelistEntry{ID: id, Email: email}, nil
}

func (db *DB) ListWhitelist() ([]models.WhitelistEntry, error) {
	rows, err := db.Query(`SELECT id, email, created_at FROM whitelist ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.WhitelistEntry
	for rows.Next() {
		var w models.WhitelistEntry
		if err := rows.Scan(&w.ID, &w.Email, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (db *DB) RemoveFromWhitelist(id int64) error {
	res, err := db.Exec(`DELETE FROM whitelist WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- Doctors ----------

// CreateDoctorPending inserts a new doctor with status='pending'. Password is hashed.
// full_name is required and must be unique (case-insensitive).
func (db *DB) CreateDoctorPending(fullName, password string) (*models.Doctor, error) {
	fullName = strings.TrimSpace(fullName)
	if fullName == "" {
		return nil, fmt.Errorf("ФИО обязательно")
	}
	if len(password) < 4 {
		return nil, fmt.Errorf("пароль должен быть не короче 4 символов")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(
		`INSERT INTO doctors(full_name, password_hash, status) VALUES (?, ?, ?)`,
		fullName, hash, DoctorStatusPending,
	)
	if err != nil {
		if isUniqueErr(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.Doctor{ID: id, FullName: fullName, Status: DoctorStatusPending}, nil
}

// FindDoctorByNameAndPassword looks up a doctor by ФИО + password and returns it
// ONLY if status='approved'. Returns ErrNotFound on miss (and on wrong password —
// we don't leak which).
func (db *DB) FindDoctorByNameAndPassword(fullName, password string) (*models.Doctor, error) {
	fullName = strings.TrimSpace(fullName)
	if fullName == "" || password == "" {
		return nil, ErrNotFound
	}
	var d models.Doctor
	var hash sql.NullString
	err := db.QueryRow(
		`SELECT id, full_name, password_hash, status, created_at FROM doctors WHERE LOWER(full_name) = LOWER(?)`,
		fullName,
	).Scan(&d.ID, &d.FullName, &hash, &d.Status, &d.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if d.Status != DoctorStatusApproved {
		return nil, ErrNotFound
	}
	if !hash.Valid {
		return nil, ErrNotFound
	}
	if err := bcryptCompare(hash.String, password); err != nil {
		return nil, ErrNotFound
	}
	return &d, nil
}

// FindDoctorByNameAndPasswordAnyStatus returns the doctor (любой статус), если пароль верный.
// Нужно для подписки врача «на модерации» на push об одобрении — токен до подтверждения
// НЕ выдаём, поэтому авторизуем по ФИО+паролю прямо здесь.
func (db *DB) FindDoctorByNameAndPasswordAnyStatus(fullName, password string) (*models.Doctor, error) {
	fullName = strings.TrimSpace(fullName)
	if fullName == "" || password == "" {
		return nil, ErrNotFound
	}
	var d models.Doctor
	var hash sql.NullString
	err := db.QueryRow(
		`SELECT id, full_name, password_hash, status, created_at FROM doctors WHERE LOWER(full_name) = LOWER(?)`,
		fullName,
	).Scan(&d.ID, &d.FullName, &hash, &d.Status, &d.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !hash.Valid {
		return nil, ErrNotFound
	}
	if err := bcryptCompare(hash.String, password); err != nil {
		return nil, ErrNotFound
	}
	return &d, nil
}

// ApproveDoctor sets status to 'approved' and returns the row.
func (db *DB) ApproveDoctor(id int64) (*models.Doctor, error) {
	res, err := db.Exec(`UPDATE doctors SET status = ? WHERE id = ?`, DoctorStatusApproved, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return db.FindDoctorByID(id)
}

// RejectDoctor sets status to 'rejected'.
func (db *DB) RejectDoctor(id int64) (*models.Doctor, error) {
	res, err := db.Exec(`UPDATE doctors SET status = ? WHERE id = ?`, DoctorStatusRejected, id)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, ErrNotFound
	}
	return db.FindDoctorByID(id)
}

// DeleteDoctor removes a doctor by ID.
func (db *DB) DeleteDoctor(id int64) error {
	res, err := db.Exec(`DELETE FROM doctors WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAssistant removes an assistant by ID.
func (db *DB) DeleteAssistant(id int64) error {
	res, err := db.Exec(`DELETE FROM assistants WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (db *DB) FindDoctorByID(id int64) (*models.Doctor, error) {
	var d models.Doctor
	err := db.QueryRow(
		`SELECT id, full_name, status, created_at FROM doctors WHERE id = ?`, id,
	).Scan(&d.ID, &d.FullName, &d.Status, &d.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// ListDoctors returns all doctors regardless of status.
func (db *DB) ListDoctors() ([]models.Doctor, error) {
	rows, err := db.Query(`SELECT id, full_name, status, created_at FROM doctors ORDER BY full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Doctor
	for rows.Next() {
		var d models.Doctor
		if err := rows.Scan(&d.ID, &d.FullName, &d.Status, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListDoctorsByStatus returns doctors with given status.
func (db *DB) ListDoctorsByStatus(status string) ([]models.Doctor, error) {
	rows, err := db.Query(`SELECT id, full_name, status, created_at FROM doctors WHERE status = ? ORDER BY created_at`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Doctor
	for rows.Next() {
		var d models.Doctor
		if err := rows.Scan(&d.ID, &d.FullName, &d.Status, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (db *DB) IsWhitelisted(email string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM whitelist WHERE email = ?`, strings.ToLower(email)).Scan(&n)
	return n > 0, err
}

// bcryptCompare is split out to keep imports tidy.
func bcryptCompare(hash, password string) error {
	return bcryptCompareHash(hash, password)
}
