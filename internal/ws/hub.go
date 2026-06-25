package ws

import (
	"sync"
	"time"

	"github.com/google/uuid"

	"assistant-caller/internal/store"
)

// Hub manages connected WS clients and routes messages.
type Hub struct {
	mu sync.RWMutex

	// All clients indexed by pointer for fast unregister.
	all map[*Client]struct{}

	// Clients keyed by user_id (regardless of role).
	byUserID map[int64]*Client

	// Assistants currently online (uid -> client).
	onlineByUID map[string]*Client

	// All known assistants (registered in DB) for presence broadcast.
	knownAssistants []AssistantView

	// In-memory pending calls awaiting acceptance: call_id -> info.
	pending map[string]PendingCallMeta

	// PushNotifier (необязательно) шлёт web-push ассистенту по unique_id.
	// Устанавливается из main.go; nil — если VAPID не настроен.
	PushNotifier func(uid, title, body string)
	// PushToDoctor шлёт web-push врачу по его user_id (когда приложение закрыто).
	PushToDoctor func(doctorID int64, title, body string)
	// PushBroadcast шлёт web-push ВСЕМ подписанным (рассылка администрации).
	PushBroadcast func(title, body string)
	// PushToAdmins шлёт web-push всем админам (например, о новой заявке врача).
	PushToAdmins func(title, body string)
}

type PendingCallMeta struct {
	FromDoctor  int64
	DoctorName  string
	ToUID       string
	Message     string
	SentAt      time.Time
	DoctorClient *Client
}

func NewHub() *Hub {
	return &Hub{
		all:           map[*Client]struct{}{},
		byUserID:      map[int64]*Client{},
		onlineByUID:   map[string]*Client{},
		pending:       map[string]PendingCallMeta{},
	}
}

// SetKnownAssistants replaces the cached list (called on admin changes / startup).
func (h *Hub) SetKnownAssistants(list []AssistantView) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.knownAssistants = list
}

func (h *Hub) PresenceSnapshot() []AssistantView {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]AssistantView, len(h.knownAssistants))
	copy(out, h.knownAssistants)
	for i := range out {
		_, out[i].Online = h.onlineByUID[out[i].UniqueID]
	}
	return out
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	h.all[c] = struct{}{}
	h.byUserID[c.UserID] = c
	var resendIDs []string
	var resendMeta []PendingCallMeta
	if c.Role == "assistant" && c.UniqueID != "" {
		h.onlineByUID[c.UniqueID] = c
		// Self-heal: гарантируем, что ассистент есть в кэше knownAssistants,
		// иначе presence не покажет его онлайн (например, если он только что
		// зарегистрировался и кэш не успел обновиться).
		found := false
		for _, a := range h.knownAssistants {
			if a.UniqueID == c.UniqueID {
				found = true
				break
			}
		}
		if !found {
			h.knownAssistants = append(h.knownAssistants, AssistantView{UniqueID: c.UniqueID, FullName: c.FullName})
		}
		// Переотправляем вызовы, которые ждут этого ассистента (например, врач
		// позвонил, пока приложение было закрыто; ассистент получил push,
		// открыл приложение — и сразу видит входящий).
		for id, m := range h.pending {
			if m.ToUID == c.UniqueID {
				resendIDs = append(resendIDs, id)
				resendMeta = append(resendMeta, m)
			}
		}
	}
	h.mu.Unlock()

	for i, m := range resendMeta {
		inc, _ := NewEnvelope("incoming", IncomingPayload{
			CallID:     resendIDs[i],
			FromDoctor: m.DoctorName,
			Message:    m.Message,
			SentAt:     m.SentAt,
		})
		c.Enqueue(inc)
	}
	h.broadcastPresence()
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	if _, ok := h.all[c]; !ok {
		h.mu.Unlock()
		return
	}
	delete(h.all, c)
	if existing, ok := h.byUserID[c.UserID]; ok && existing == c {
		delete(h.byUserID, c.UserID)
	}
	if c.Role == "assistant" {
		if existing, ok := h.onlineByUID[c.UniqueID]; ok && existing == c {
			delete(h.onlineByUID, c.UniqueID)
		}
		// Drop pending calls addressed to this assistant that weren't accepted.
		for id, p := range h.pending {
			if p.ToUID == c.UniqueID {
				delete(h.pending, id)
			}
		}
	}
	if c.Role == "doctor" {
		// If the disconnected doctor had pending calls, drop them.
		for id, p := range h.pending {
			if p.FromDoctor == c.UserID {
				delete(h.pending, id)
			}
		}
	}
	h.mu.Unlock()
	h.broadcastPresence()
}

func (h *Hub) broadcastPresence() {
	snap := h.PresenceSnapshot()
	raw, err := NewEnvelope("presence", PresencePayload{Assistants: snap})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.all {
		// Only doctors care about presence.
		if c.Role == "doctor" {
			c.Enqueue(raw)
		}
	}
}

// SendToUser delivers a raw payload to a specific user_id if connected.
func (h *Hub) SendToUser(uid int64, raw []byte) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c, ok := h.byUserID[uid]
	if !ok {
		return false
	}
	c.Enqueue(raw)
	return true
}

// SendToAssistantUID delivers to the assistant with given unique_id.
func (h *Hub) SendToAssistantUID(uid string, raw []byte) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	c, ok := h.onlineByUID[uid]
	if !ok {
		return false
	}
	c.Enqueue(raw)
	return true
}

// CreatePendingCall records an in-flight call (call_id is server-generated).
func (h *Hub) CreatePendingCall(meta PendingCallMeta) string {
	id := uuid.NewString()
	meta.SentAt = time.Now()
	h.mu.Lock()
	h.pending[id] = meta
	h.mu.Unlock()
	return id
}

// AcceptPendingCall returns the meta and removes it from the pending set.
// Returns nil if not found (already accepted, expired, or cancelled).
func (h *Hub) AcceptPendingCall(callID string) *PendingCallMeta {
	h.mu.Lock()
	defer h.mu.Unlock()
	meta, ok := h.pending[callID]
	if !ok {
		return nil
	}
	delete(h.pending, callID)
	return &meta
}

// DoctorForCall is a helper for handlers: returns the doctor client if still connected.
func (h *Hub) DoctorForCall(callID string) *Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	meta, ok := h.pending[callID]
	if !ok {
		return nil
	}
	if meta.DoctorClient == nil {
		return nil
	}
	return meta.DoctorClient
}

// IsUserOnline сообщает, подключён ли пользователь (врач/ассистент) по user_id.
func (h *Hub) IsUserOnline(uid int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.byUserID[uid]
	return ok
}

// handleNotifyDoctor: ассистент шлёт короткое сообщение врачу.
func (h *Hub) handleNotifyDoctor(asst *Client, p NotifyDoctorPayload) {
	if p.To == 0 {
		asst.sendError("bad_request", "не указан врач")
		return
	}
	alert, _ := NewEnvelope("doctor_alert", DoctorAlertPayload{
		FromAssistant: asst.FullName,
		FromUID:       asst.UniqueID,
		Message:       p.Message,
		SentAt:        time.Now().UTC(),
	})
	if h.SendToUser(p.To, alert) {
		okEnv, _ := NewEnvelope("notify_sent", AckPayload{CallID: ""})
		asst.Enqueue(okEnv)
		return
	}
	// Врач офлайн — пробуем доставить web-push (если приложение установлено).
	if h.PushToDoctor != nil {
		title := "Сообщение от ассистента"
		if asst.FullName != "" {
			title = "Ассистент: " + asst.FullName
		}
		go h.PushToDoctor(p.To, title, p.Message)
		okEnv, _ := NewEnvelope("notify_sent", AckPayload{CallID: ""})
		asst.Enqueue(okEnv)
		return
	}
	asst.sendError("doctor_offline", "врач сейчас не в сети")
}

// handleDecline: ассистент отклонил вызов с причиной → уведомляем врача.
func (h *Hub) handleDecline(asst *Client, p DeclinePayload) {
	meta := h.AcceptPendingCall(p.CallID) // удаляем из pending
	if meta == nil {
		return // вызов уже не активен — ничего не делаем
	}
	declined, _ := NewEnvelope("declined", DeclinedPayload{
		CallID: p.CallID,
		By:     asst.FullName,
		Reason: p.Reason,
	})
	if meta.DoctorClient != nil {
		meta.DoctorClient.Enqueue(declined)
	}
}

// BroadcastToAll рассылает уведомление всем подключённым клиентам (врачам и
// ассистентам). Возвращает число получателей.
func (h *Hub) BroadcastToAll(message, from string) int {
	env, err := NewEnvelope("broadcast", BroadcastPayload{
		Message: message, From: from, SentAt: time.Now().UTC(),
	})
	if err != nil {
		return 0
	}
	h.mu.RLock()
	n := 0
	for c := range h.all {
		c.Enqueue(env)
		n++
	}
	h.mu.RUnlock()
	// Доставляем и тем, у кого приложение закрыто, через web-push.
	if h.PushBroadcast != nil {
		go h.PushBroadcast("📢 "+from, message)
	}
	return n
}

// OnlineCount is exported for the admin panel.
func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.onlineByUID)
}

// IsDoctorOnline is exported for the admin panel.
func (h *Hub) IsAssistantOnline(uid string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.onlineByUID[uid]
	return ok
}

// OnlineDoctorIDs returns user IDs of currently connected doctors (deduplicated).
func (h *Hub) OnlineDoctorIDs() []int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := make(map[int64]bool)
	ids := make([]int64, 0)
	for c := range h.all {
		if c.Role == "doctor" && !seen[c.UserID] {
			seen[c.UserID] = true
			ids = append(ids, c.UserID)
		}
	}
	return ids
}

// IsPending сообщает, активен ли ещё вызов (не принят/не отклонён/не отменён,
// ассистент не отключился). Используется циклом повторных push.
func (h *Hub) IsPending(callID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.pending[callID]
	return ok
}

// startCallPushLoop повторяет web-push ассистенту каждые 5с, пока вызов активен,
// с защитным капом (~2.5 мин). Останавливается, как только вызов уходит из pending
// (принят/отклонён/отменён/ассистент отключился) — иначе это вечный спам.
func (h *Hub) startCallPushLoop(callID, uid, title, body string) {
	if h.PushNotifier == nil {
		return
	}
	go func() {
		const interval = 5 * time.Second
		const maxAttempts = 30 // ~2.5 мин; дальше врач всё равно снимает вызов
		t := time.NewTicker(interval)
		defer t.Stop()
		for i := 0; i < maxAttempts; i++ {
			<-t.C
			if !h.IsPending(callID) {
				return
			}
			h.PushNotifier(uid, title, body)
		}
	}()
}

// LoadAssistants hydrates the cached assistant list from DB.
func (h *Hub) LoadAssistants(db *store.DB) error {
	as, err := db.ListAssistants()
	if err != nil {
		return err
	}
	views := make([]AssistantView, 0, len(as))
	for _, a := range as {
		views = append(views, AssistantView{UniqueID: a.UniqueID, FullName: a.FullName})
	}
	h.SetKnownAssistants(views)
	return nil
}

// ReloadAssistants is a convenience for admin actions that change the assistant roster.
func (h *Hub) ReloadAssistants(db *store.DB) error {
	if err := h.LoadAssistants(db); err != nil {
		return err
	}
	h.broadcastPresence()
	return nil
}

// handleCall is invoked by a doctor client.
func (h *Hub) handleCall(doctor *Client, p CallPayload) {
	if p.To == "" {
		doctor.sendError("bad_request", "missing 'to' field")
		return
	}

	// Check the addressee is a registered assistant (presence online will be re-checked).
	h.mu.RLock()
	known := false
	for _, a := range h.knownAssistants {
		if a.UniqueID == p.To {
			known = true
			break
		}
	}
	h.mu.RUnlock()
	if !known {
		doctor.sendError("unknown_assistant", "assistant with that id is not registered")
		return
	}

	callID := h.CreatePendingCall(PendingCallMeta{
		FromDoctor:   doctor.UserID,
		DoctorName:   doctor.FullName,
		ToUID:        p.To,
		Message:      p.Message,
		DoctorClient: doctor,
	})

	incoming, _ := NewEnvelope("incoming", IncomingPayload{
		CallID:     callID,
		FromDoctor: doctor.FullName,
		Message:    p.Message,
		SentAt:     time.Now().UTC(),
	})
	delivered := h.SendToAssistantUID(p.To, incoming)

	// Web push — уведомление в трее/на телефоне, даже если приложение закрыто
	// или свёрнуто. Service worker сам не покажет дубль, если приложение открыто.
	if h.PushNotifier != nil {
		title := "Вызов"
		if doctor.FullName != "" {
			title = "Вызов: " + doctor.FullName
		}
		go h.PushNotifier(p.To, title, p.Message)
		// Повтор push каждые 5с, пока вызов активен — чтобы точно не пропустили.
		h.startCallPushLoop(callID, p.To, title, p.Message)
	}

	if !delivered && h.PushNotifier == nil {
		// Ассистент офлайн и web-push не настроен — отклоняем вызов (старое поведение).
		h.AcceptPendingCall(callID) // discard
		errEnv, _ := NewEnvelope("error", ErrorPayload{Code: "assistant_offline", Message: "ассистент не в сети"})
		doctor.Enqueue(errEnv)
		return
	}
	// Онлайн ИЛИ есть web-push: оставляем вызов в ожидании. Если ассистент был
	// офлайн — он получит push, откроет приложение, и pending переотправится при connect.
	ack, _ := NewEnvelope("ack", AckPayload{CallID: callID})
	doctor.Enqueue(ack)
}

// handleAccept is invoked by an assistant client.
func (h *Hub) handleAccept(asst *Client, p AcceptPayload) {
	meta := h.AcceptPendingCall(p.CallID)
	if meta == nil {
		asst.sendError("call_not_found", "call is no longer pending")
		return
	}
	// Defensive: ensure this assistant is the addressee.
	if meta.ToUID != asst.UniqueID {
		asst.sendError("forbidden", "call was not addressed to you")
		return
	}

	now := time.Now().UTC()
	accepted, _ := NewEnvelope("accepted", AcceptedPayload{
		CallID:     p.CallID,
		By:         asst.FullName,
		AcceptedAt: now,
	})
	if meta.DoctorClient != nil {
		meta.DoctorClient.Enqueue(accepted)
	}
	// Echo back to the accepting assistant for symmetry (UI can stop the sound).
	asst.Enqueue(accepted)
}

// handleCancel is invoked by a doctor client to cancel a pending call.
func (h *Hub) handleCancel(doc *Client, p CancelPayload) {
	meta := h.AcceptPendingCall(p.CallID) // removes from pending
	if meta == nil {
		doc.sendError("call_not_found", "call is no longer pending (already accepted/cancelled)")
		return
	}
	// Defensive: only the originating doctor may cancel.
	if meta.FromDoctor != doc.UserID {
		doc.sendError("forbidden", "call was not initiated by you")
		return
	}
	// Notify the addressed assistant (if still online) that the call was cancelled.
	cancelled, _ := NewEnvelope("cancelled", CancelledPayload{
		CallID: p.CallID,
		Reason: "doctor_cancelled",
	})
	if !h.SendToAssistantUID(meta.ToUID, cancelled) {
		// assistant already gone — that's fine
	}
	// Confirm cancellation to the doctor.
	doc.Enqueue(cancelled)
}

// TestCall lets the admin panel ring an assistant directly over HTTP, without
// needing an admin WebSocket / doctor account. Mirrors handleCall but with no
// originating doctor client. Returns the call id and whether it was delivered
// (assistant online). The assistant can accept it normally (accept just skips
// notifying the nil doctor client).
func (h *Hub) TestCall(toUID, fromName, message string) (callID string, delivered bool) {
	callID = h.CreatePendingCall(PendingCallMeta{
		FromDoctor:   0,
		DoctorName:   fromName,
		ToUID:        toUID,
		Message:      message,
		DoctorClient: nil,
	})
	incoming, _ := NewEnvelope("incoming", IncomingPayload{
		CallID:     callID,
		FromDoctor: fromName,
		Message:    message,
		SentAt:     time.Now().UTC(),
	})
	delivered = h.SendToAssistantUID(toUID, incoming)
	if h.PushNotifier != nil {
		go h.PushNotifier(toUID, fromName, message)
	}
	if !delivered && h.PushNotifier == nil {
		// assistant offline and no web push — discard the pending call we just created
		h.AcceptPendingCall(callID)
	}
	return callID, delivered
}
