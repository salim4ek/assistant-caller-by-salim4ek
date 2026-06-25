package store

// PushSubscription — данные Web Push подписки браузера.
type PushSubscription struct {
	ID       int64
	Endpoint string
	P256dh   string
	Auth     string
}

// SavePushSub сохраняет (или обновляет) подписку пользователя любой роли.
func (db *DB) SavePushSub(role string, userID int64, endpoint, p256dh, auth string) error {
	_, err := db.Exec(`
		INSERT INTO push_subs (role, user_id, endpoint, p256dh, auth)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(endpoint) DO UPDATE SET
			role = excluded.role,
			user_id = excluded.user_id,
			p256dh = excluded.p256dh,
			auth = excluded.auth`,
		role, userID, endpoint, p256dh, auth)
	return err
}

func scanSubs(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close() error
}) ([]PushSubscription, error) {
	defer rows.Close()
	var out []PushSubscription
	for rows.Next() {
		var s PushSubscription
		if err := rows.Scan(&s.ID, &s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ListPushSubsByUser — подписки конкретного пользователя (роль + id).
func (db *DB) ListPushSubsByUser(role string, userID int64) ([]PushSubscription, error) {
	rows, err := db.Query(`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE role = ? AND user_id = ?`, role, userID)
	if err != nil {
		return nil, err
	}
	return scanSubs(rows)
}

// ListPushSubsForAssistantUID — подписки ассистента по его unique_id.
func (db *DB) ListPushSubsForAssistantUID(uid string) ([]PushSubscription, error) {
	rows, err := db.Query(`
		SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
		FROM push_subs ps
		JOIN assistants a ON a.id = ps.user_id
		WHERE ps.role = 'assistant' AND a.unique_id = ? COLLATE NOCASE`, uid)
	if err != nil {
		return nil, err
	}
	return scanSubs(rows)
}

// ListAllPushSubs — все подписки (для рассылки администрации).
func (db *DB) ListAllPushSubs() ([]PushSubscription, error) {
	rows, err := db.Query(`SELECT id, endpoint, p256dh, auth FROM push_subs`)
	if err != nil {
		return nil, err
	}
	return scanSubs(rows)
}

// ListPushSubsByRole — все подписки заданной роли (например, всех админов).
func (db *DB) ListPushSubsByRole(role string) ([]PushSubscription, error) {
	rows, err := db.Query(`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE role = ?`, role)
	if err != nil {
		return nil, err
	}
	return scanSubs(rows)
}

// DeletePushSubscription удаляет подписку по endpoint (протухла: 404/410).
func (db *DB) DeletePushSubscription(endpoint string) error {
	_, err := db.Exec(`DELETE FROM push_subs WHERE endpoint = ?`, endpoint)
	return err
}

// AssistantUIDsWithPush — unique_id ассистентов, у кого есть push-подписка
// (установлено приложение → получит уведомление даже офлайн).
func (db *DB) AssistantUIDsWithPush() ([]string, error) {
	rows, err := db.Query(`
		SELECT DISTINCT a.unique_id
		FROM push_subs ps JOIN assistants a ON a.id = ps.user_id
		WHERE ps.role = 'assistant'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// DoctorIDsWithPush — id врачей, у кого есть push-подписка.
func (db *DB) DoctorIDsWithPush() ([]int64, error) {
	rows, err := db.Query(`SELECT DISTINCT user_id FROM push_subs WHERE role = 'doctor'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
