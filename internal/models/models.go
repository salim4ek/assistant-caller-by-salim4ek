// Package models holds shared domain types.
package models

import "time"

const (
	RoleDoctor    = "doctor"
	RoleAssistant = "assistant"
	RoleAdmin     = "admin"
)

type Doctor struct {
	ID        int64     `json:"id"`
	FullName  string    `json:"full_name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type Assistant struct {
	ID        int64     `json:"id"`
	UniqueID  string    `json:"unique_id"`
	FullName  string    `json:"full_name"`
	CreatedAt time.Time `json:"created_at"`
}

type Admin struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

type WhitelistEntry struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

type DoctorAssistant struct {
	ID          int64
	DoctorID    int64
	AssistantID int64
	Nickname    string
}

type DoctorAssistantView struct {
	ID          int64     `json:"id"`
	AssistantID int64     `json:"assistant_id"`
	UniqueID    string    `json:"unique_id"`
	FullName    string    `json:"full_name"`
	Nickname    *string   `json:"nickname,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// PendingCall is kept in memory only — no DB persistence for call events.
type PendingCall struct {
	ID         string
	FromDoctor int64
	DoctorName string
	ToUID      string
	Message    string
	SentAt     time.Time
}
