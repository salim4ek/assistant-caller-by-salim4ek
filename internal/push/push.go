// Package push отправляет Web Push уведомления подписанным ассистентам.
package push

import (
	"io"

	webpush "github.com/SherClockHolmes/webpush-go"

	"assistant-caller/internal/store"
)

type Config struct {
	Public  string
	Private string
	Subject string
}

func (c Config) Enabled() bool { return c.Public != "" && c.Private != "" }

// Send отправляет одно web-push уведомление.
// gone=true означает, что подписка протухла (404/410) и её надо удалить.
func Send(cfg Config, sub store.PushSubscription, payload []byte) (gone bool, err error) {
	s := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}
	resp, err := webpush.SendNotification(payload, s, &webpush.Options{
		Subscriber:      cfg.Subject,
		VAPIDPublicKey:  cfg.Public,
		VAPIDPrivateKey: cfg.Private,
		TTL:             600, // 10 мин: вызов не отбрасывается, если телефон ненадолго недоступен (важно для iOS)
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return true, nil
	}
	return false, nil
}
