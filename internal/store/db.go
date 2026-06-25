// Package store wraps SQLite access for the app's persistent entities.
package store

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

var (
	ErrNotFound = fmt.Errorf("not found")
	ErrConflict = fmt.Errorf("conflict")
)

func isUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	// modernc.org/sqlite returns errors containing "UNIQUE constraint failed"
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}

type DB struct {
	*sql.DB
}

func Open(dbPath string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}
	d, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := d.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	db := &DB{d}
	if err := db.migrate(); err != nil {
		return nil, err
	}
	return db, nil
}

func (db *DB) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS admins (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS whitelist (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS doctors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE COLLATE NOCASE,
			full_name TEXT NOT NULL,
			password_hash TEXT,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS assistants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			unique_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
			full_name TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS doctor_assistants (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			doctor_id INTEGER NOT NULL,
			assistant_id INTEGER NOT NULL,
			nickname TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(doctor_id, assistant_id),
			FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
			FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS push_subscriptions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			assistant_id INTEGER NOT NULL,
			endpoint TEXT NOT NULL UNIQUE,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_push_asst ON push_subscriptions(assistant_id)`,
		`CREATE TABLE IF NOT EXISTS push_subs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			role TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			endpoint TEXT NOT NULL UNIQUE,
			p256dh TEXT NOT NULL,
			auth TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subs(role, user_id)`,
		`INSERT OR IGNORE INTO push_subs(role, user_id, endpoint, p256dh, auth)
			SELECT 'assistant', assistant_id, endpoint, p256dh, auth FROM push_subscriptions`,
		`CREATE INDEX IF NOT EXISTS idx_whitelist_email ON whitelist(email COLLATE NOCASE)`,
		`CREATE INDEX IF NOT EXISTS idx_doctors_name ON doctors(full_name)`,
		`CREATE INDEX IF NOT EXISTS idx_doctors_status ON doctors(status)`,
		`CREATE INDEX IF NOT EXISTS idx_assistants_uid ON assistants(unique_id COLLATE NOCASE)`,
		`CREATE INDEX IF NOT EXISTS idx_doc_asst ON doctor_assistants(doctor_id, assistant_id)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("migrate: %w (sql=%s)", err, s)
		}
	}

	// Idempotent column additions for legacy DBs.
	// SQLite ALTER TABLE ADD COLUMN with NOT NULL requires a default.
	addCols := []string{
		`ALTER TABLE doctors ADD COLUMN password_hash TEXT`,
		`ALTER TABLE doctors ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`,
	}
	for _, q := range addCols {
		// "duplicate column name" is the expected failure on second run; ignore.
		if _, err := db.Exec(q); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return fmt.Errorf("alter: %w (sql=%s)", err, q)
		}
	}
	log.Println("[INFO] db migrations applied")
	return nil
}

// SeedAdmin creates the initial admin if none exists AND both
// ADMIN_USERNAME and ADMIN_PASSWORD are non-empty.
func (db *DB) SeedAdmin(username, password string) error {
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM admins`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if username == "" || password == "" {
		log.Println("[WARN] no admins exist and ADMIN_USERNAME/ADMIN_PASSWORD are not set; admin panel will be inaccessible until you create one manually")
		return nil
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO admins(username, password_hash) VALUES (?, ?)`, username, hash); err != nil {
		return err
	}
	log.Printf("[INFO] seeded initial admin user %q\n", username)
	return nil
}
