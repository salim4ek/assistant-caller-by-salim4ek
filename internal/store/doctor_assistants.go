package store

import (
	"database/sql"
	"errors"

	"assistant-caller/internal/models"
)

// AddAssistantToDoctor links an assistant (looked up by unique_id) to a doctor's
// personal list. Returns ErrConflict if already linked.
func (db *DB) AddAssistantToDoctor(doctorID int64, assistantUID string) (*models.DoctorAssistant, error) {
	a, err := db.FindAssistant(assistantUID)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(
		`INSERT INTO doctor_assistants(doctor_id, assistant_id) VALUES (?, ?)
		 ON CONFLICT(doctor_id, assistant_id) DO NOTHING`,
		doctorID, a.ID,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if id == 0 {
		// Already existed — fetch the existing row
		var existingID int64
		err := db.QueryRow(`SELECT id FROM doctor_assistants WHERE doctor_id = ? AND assistant_id = ?`,
			doctorID, a.ID).Scan(&existingID)
		if err != nil {
			return nil, err
		}
		id = existingID
	}
	return &models.DoctorAssistant{
		ID:          id,
		DoctorID:    doctorID,
		AssistantID: a.ID,
	}, nil
}

// ListDoctorAssistants returns the doctor's personal list with assistant info.
func (db *DB) ListDoctorAssistants(doctorID int64) ([]models.DoctorAssistantView, error) {
	rows, err := db.Query(`
		SELECT da.id, da.assistant_id, a.unique_id, a.full_name, da.nickname, da.created_at
		FROM doctor_assistants da
		JOIN assistants a ON a.id = da.assistant_id
		WHERE da.doctor_id = ?
		ORDER BY a.full_name`, doctorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.DoctorAssistantView
	for rows.Next() {
		var v models.DoctorAssistantView
		if err := rows.Scan(&v.ID, &v.AssistantID, &v.UniqueID, &v.FullName, &v.Nickname, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// DoctorBrief — краткая инфа о враче (для списка у ассистента).
type DoctorBrief struct {
	ID       int64  `json:"id"`
	FullName string `json:"full_name"`
}

// ListDoctorsForAssistant возвращает врачей, которые добавили этого ассистента
// в свой список (assistant_id). Только подтверждённые врачи.
func (db *DB) ListDoctorsForAssistant(assistantID int64) ([]DoctorBrief, error) {
	rows, err := db.Query(`
		SELECT d.id, d.full_name
		FROM doctor_assistants da
		JOIN doctors d ON d.id = da.doctor_id
		WHERE da.assistant_id = ? AND d.status = 'approved'
		ORDER BY d.full_name`, assistantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DoctorBrief
	for rows.Next() {
		var b DoctorBrief
		if err := rows.Scan(&b.ID, &b.FullName); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// RemoveDoctorAssistant unlinks an assistant from a doctor's list by doctor_assistants.id.
func (db *DB) RemoveDoctorAssistant(doctorID int64, id int64) error {
	res, err := db.Exec(`DELETE FROM doctor_assistants WHERE id = ? AND doctor_id = ?`, id, doctorID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// AssistantExistsByUID is a small helper used by handlers that already have a UID.
// It returns the assistant's ID, or ErrNotFound.
func (db *DB) AssistantExistsByUID(uid string) (int64, error) {
	var id int64
	err := db.QueryRow(`SELECT id FROM assistants WHERE unique_id = ?`, uid).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return id, nil
}
