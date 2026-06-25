// Package config loads application configuration from environment variables.
package config

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port          string
	JWTSecret     []byte
	DBPath        string
	AdminUsername string
	AdminPassword string
	LogLevel      string
	VapidPublic   string
	VapidPrivate  string
	VapidSubject  string
}

func Load() *Config {
	loadDotEnv(".env")
	cfg := &Config{
		Port:          getenv("APP_PORT", "8080"),
		DBPath:        getenv("DB_PATH", "./data/app.db"),
		AdminUsername: getenv("ADMIN_USERNAME", "admin"),
		AdminPassword: getenv("ADMIN_PASSWORD", ""),
		LogLevel:      getenv("LOG_LEVEL", "info"),
		VapidPublic:   getenv("VAPID_PUBLIC", ""),
		VapidPrivate:  getenv("VAPID_PRIVATE", ""),
		VapidSubject:  getenv("VAPID_SUBJECT", "mailto:admin@nn-clinic.local"),
	}

	secret := getenv("JWT_SECRET", "")
	if secret == "" {
		// Auto-generate a secret for dev convenience; warn loudly.
		buf := make([]byte, 32)
		_, _ = rand.Read(buf)
		cfg.JWTSecret = []byte(base64.StdEncoding.EncodeToString(buf))
		log.Println("[WARN] JWT_SECRET is not set; generated a random one. Sessions will be invalidated on restart.")
	} else {
		cfg.JWTSecret = []byte(secret)
	}

	// Quick sanity check.
	if _, err := strconv.Atoi(cfg.Port); err != nil {
		log.Printf("[WARN] APP_PORT=%q is not a number; falling back to 8080\n", cfg.Port)
		cfg.Port = "8080"
	}

	return cfg
}

func getenv(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

// loadDotEnv reads KEY=VALUE lines from the given file and sets them
// in the process environment unless the variable is already set.
// Comments (#) and blank lines are ignored. Quotes are trimmed.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	count := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		v := strings.TrimSpace(line[eq+1:])
		v = strings.Trim(v, `"'`)
		if _, exists := os.LookupEnv(k); exists {
			continue
		}
		_ = os.Setenv(k, v)
		count++
	}
	if count > 0 {
		log.Printf("[INFO] loaded %d vars from %s", count, path)
	}
}
