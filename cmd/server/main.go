// Command server boots the Assistant Caller web app.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"assistant-caller/internal/api"
	"assistant-caller/internal/auth"
	"assistant-caller/internal/config"
	"assistant-caller/internal/models"
	"assistant-caller/internal/push"
	"assistant-caller/internal/store"
	"assistant-caller/internal/ws"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	cfg := config.Load()

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer db.Close()

	if err := db.SeedAdmin(cfg.AdminUsername, cfg.AdminPassword); err != nil {
		log.Fatalf("seed admin: %v", err)
	}

	hub := ws.NewHub()
	if err := hub.LoadAssistants(db); err != nil {
		log.Fatalf("load assistants: %v", err)
	}

	iss := auth.NewIssuer(cfg.JWTSecret, 30*24*time.Hour) // 30 дней — чтобы PWA открывалась уже залогиненной

	// Web push: уведомление о вызове в трее/на телефоне даже при закрытом приложении.
	pcfg := push.Config{Public: cfg.VapidPublic, Private: cfg.VapidPrivate, Subject: cfg.VapidSubject}
	if pcfg.Enabled() {
		sendToSubs := func(subs []store.PushSubscription, title, body, url string) {
			if len(subs) == 0 {
				return
			}
			payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": url})
			for _, s := range subs {
				gone, serr := push.Send(pcfg, s, payload)
				if gone {
					_ = db.DeletePushSubscription(s.Endpoint)
				} else if serr != nil {
					log.Printf("[WARN] push send: %v", serr)
				}
			}
		}
		hub.PushNotifier = func(uid, title, body string) {
			subs, err := db.ListPushSubsForAssistantUID(uid)
			if err != nil {
				return
			}
			sendToSubs(subs, title, body, "/assistant")
		}
		hub.PushToDoctor = func(doctorID int64, title, body string) {
			subs, err := db.ListPushSubsByUser("doctor", doctorID)
			if err != nil {
				return
			}
			sendToSubs(subs, title, body, "/doctor")
		}
		hub.PushBroadcast = func(title, body string) {
			subs, err := db.ListAllPushSubs()
			if err != nil {
				return
			}
			sendToSubs(subs, title, body, "/")
		}
		hub.PushToAdmins = func(title, body string) {
			subs, err := db.ListPushSubsByRole("admin")
			if err != nil {
				return
			}
			sendToSubs(subs, title, body, "/admin")
		}
		log.Println("[INFO] web push ENABLED (VAPID configured)")
	} else {
		log.Println("[WARN] web push DISABLED — set VAPID_PUBLIC/VAPID_PRIVATE in .env")
	}

	r := setupRouter(cfg, db, hub, iss)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("[INFO] listening on %s (db=%s)", srv.Addr, filepath.Clean(cfg.DBPath))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Println("[INFO] shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("[INFO] bye")
}

func setupRouter(cfg *config.Config, db *store.DB, hub *ws.Hub, iss *auth.Issuer) *gin.Engine {
	// Правильный Content-Type для манифеста PWA (иначе Go отдаёт text/plain).
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	if cfg.LogLevel != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	// Disable caching for static + HTML during development so changes show up on refresh.
	r.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
		c.Next()
	})

	// Static and templates
	staticDir := "./web/static"
	if v := os.Getenv("WEB_DIR"); v != "" {
		staticDir = v
	}
	r.Static("/static", staticDir)
	r.Static("/download", "/app/downloads") // скачивание десктоп-обёртки (NN_Vyzov.zip)
	r.GET("/healthz", api.NewPageHandler().Health)

	pages := api.NewPageHandler()
	authH := api.NewAuthHandler(db, iss, hub)
	adminH := api.NewAdminHandler(db, iss, hub)
	doctorH := api.NewDoctorHandler(db, hub)
	wsH := api.NewWSHandler(hub, db, iss)
	pushH := api.NewPushHandler(db, cfg.VapidPublic)

	// Auth endpoints
	r.POST("/auth/doctor/register", authH.DoctorRegister)
	r.POST("/auth/doctor/login", authH.DoctorLogin)
	r.POST("/auth/assistant/register", authH.AssistantRegister)
	r.POST("/auth/assistant/login", authH.AssistantLogin)
	r.POST("/admin/login", adminH.Login)
	// Публичные эндпоинты для врача «на модерации»: публичный VAPID-ключ + подписка
	// на push об одобрении заявки (токен до подтверждения не выдаём).
	r.GET("/auth/vapid-public", pushH.GetVapidPublic)
	r.POST("/auth/doctor/pending-subscribe", pushH.PendingDoctorSubscribe)

	// Admin JSON endpoints
	admin := r.Group("/admin", auth.Require(iss, models.RoleAdmin))
	{
		admin.GET("/whitelist", adminH.ListWhitelist)
		admin.POST("/whitelist", adminH.AddWhitelist)
		admin.DELETE("/whitelist/:id", adminH.RemoveWhitelist)
		admin.GET("/doctors", adminH.ListDoctors)
		admin.GET("/doctors/pending", adminH.ListDoctorsPending)
		admin.POST("/doctors/:id/approve", adminH.ApproveDoctor)
		admin.POST("/doctors/:id/reject", adminH.RejectDoctor)
		admin.DELETE("/doctors/:id", adminH.DeleteDoctor)
		admin.GET("/assistants", adminH.ListAssistants)
		admin.DELETE("/assistants/:id", adminH.DeleteAssistant)
		admin.GET("/online", adminH.Online)
		admin.POST("/assistants/reload", adminH.ReloadAssistants)
		admin.GET("/admins", adminH.ListAdminUsers)
		admin.POST("/admins", adminH.CreateAdmin)
		admin.DELETE("/admins/:id", adminH.DeleteAdmin)
		admin.POST("/test-call", adminH.TestCall)
		admin.POST("/broadcast", adminH.Broadcast)
	}

	// Doctor endpoints (lookup assistant by ID with auto-FIO).
	doctorAPI := r.Group("/api", auth.Require(iss, models.RoleDoctor))
	{
		doctorAPI.GET("/assistant/lookup", adminH.LookupAssistantByID)
		doctorAPI.GET("/doctor/assistants", doctorH.ListAssistants)
		doctorAPI.GET("/doctor/all-assistants", doctorH.AllAssistants)
		doctorAPI.POST("/doctor/assistants", doctorH.AddAssistant)
		doctorAPI.DELETE("/doctor/assistants/:id", doctorH.RemoveAssistant)
	}

	// Shared endpoints (any authenticated user)
	userAPI := r.Group("/api", auth.Require(iss, models.RoleDoctor, models.RoleAssistant, models.RoleAdmin))
	{
		userAPI.GET("/me", doctorH.Me)
		userAPI.GET("/assistant/my-doctors", doctorH.MyDoctors)
		userAPI.GET("/push/vapid-public", pushH.GetVapidPublic)
		userAPI.POST("/push/subscribe", pushH.Subscribe)
		userAPI.POST("/push/unsubscribe", pushH.Unsubscribe)
		userAPI.GET("/push/holders", pushH.Holders)
	}

	// WebSocket
	r.GET("/ws", auth.Require(iss, models.RoleDoctor, models.RoleAssistant), wsH.Handle)

	// SPA: serve the React app for any non-API GET, with index.html fallback.
	spaDir := filepath.Join(staticDir, "app")
	spaFS := spaFileSystem{root: http.Dir(spaDir), indexPath: "/index.html"}
	r.NoRoute(func(c *gin.Context) {
		// Only handle GET; other methods get 404
		if c.Request.Method != http.MethodGet {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		// Don't serve SPA for actual API / WebSocket / health endpoints.
		// Note: /admin and /doctor and /assistant are React SPA paths and
		// MUST fall through to the SPA fallback so refresh works.
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api") || strings.HasPrefix(p, "/ws") ||
			strings.HasPrefix(p, "/static") || strings.HasPrefix(p, "/healthz") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		// Try the file; if missing, serve index.html (SPA fallback)
		f, err := spaFS.Open(c.Request.URL.Path)
		if err != nil {
			c.File(filepath.Join(spaDir, "index.html"))
			return
		}
		defer f.Close()
		stat, err := f.Stat()
		if err != nil || stat.IsDir() {
			c.File(filepath.Join(spaDir, "index.html"))
			return
		}
		// Use http.ServeContent to stream the file
		http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), f.(readSeeker))
	})

	_ = pages
	return r
}

// readSeeker is satisfied by *os.File
type readSeeker interface {
	Read(p []byte) (n int, err error)
	Seek(offset int64, whence int) (int64, error)
}

// spaFileSystem implements http.FileSystem with an index fallback.
type spaFileSystem struct {
	root      http.FileSystem
	indexPath string
}

func (s spaFileSystem) Open(name string) (http.File, error) {
	return s.root.Open(name)
}
