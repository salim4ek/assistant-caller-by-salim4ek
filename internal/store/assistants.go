package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"assistant-caller/internal/models"
)

func (db *DB) CreateAssistant(uniqueID, fullName string) (*models.Assistant, error) {
	uniqueID = strings.TrimSpace(uniqueID)
	fullName = strings.TrimSpace(fullName)
	if uniqueID == "" || fullName == "" {
		return nil, fmt.Errorf("unique_id and full_name are required")
	}
	res, err := db.Exec(`INSERT INTO assistants(unique_id, full_name) VALUES (?, ?)`, uniqueID, fullName)
	if err != nil {
		if isUniqueErr(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &models.Assistant{ID: id, UniqueID: uniqueID, FullName: fullName}, nil
}

func (db *DB) FindAssistant(uniqueID string) (*models.Assistant, error) {
	var a models.Assistant
	err := db.QueryRow(`SELECT id, unique_id, full_name, created_at FROM assistants WHERE unique_id = ?`, uniqueID).
		Scan(&a.ID, &a.UniqueID, &a.FullName, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// FindAssistantByName ищет ассистента по ФИО/кабинету (без учёта регистра).
// Нет совпадений → ErrNotFound; несколько → ErrConflict (просим войти по ID).
func (db *DB) FindAssistantByName(fullName string) (*models.Assistant, error) {
	rows, err := db.Query(
		`SELECT id, unique_id, full_name, created_at FROM assistants WHERE full_name = ? COLLATE NOCASE`,
		strings.TrimSpace(fullName))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var found []models.Assistant
	for rows.Next() {
		var a models.Assistant
		if err := rows.Scan(&a.ID, &a.UniqueID, &a.FullName, &a.CreatedAt); err != nil {
			return nil, err
		}
		found = append(found, a)
	}
	if len(found) == 0 {
		return nil, ErrNotFound
	}
	if len(found) > 1 {
		return nil, ErrConflict
	}
	return &found[0], nil
}

func (db *DB) ListAssistants() ([]models.Assistant, error) {
	rows, err := db.Query(`SELECT id, unique_id, full_name, created_at FROM assistants ORDER BY full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Assistant
	for rows.Next() {
		var a models.Assistant
		if err := rows.Scan(&a.ID, &a.UniqueID, &a.FullName, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (db *DB) FindAssistantByID(id int64) (*models.Assistant, error) {
	var a models.Assistant
	err := db.QueryRow(`SELECT id, unique_id, full_name, created_at FROM assistants WHERE id = ?`, id).
		Scan(&a.ID, &a.UniqueID, &a.FullName, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
