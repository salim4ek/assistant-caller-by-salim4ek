package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	ctxClaimsKey = "claims"
)

// Require returns a Gin middleware that requires a JWT in Authorization header
// (Bearer ...) OR in the ?token=... query string. The latter is used for WebSocket
// handshakes because browsers cannot set headers on WS upgrade.
func Require(iss *Issuer, allowedRoles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := bearerFromHeader(c.GetHeader("Authorization"))
		if raw == "" {
			raw = c.Query("token")
		}
		if raw == "" {
			// If the client looks like a browser (Accept: text/html), send it to login
			// instead of a JSON 401 — friendlier UX.
			if strings.Contains(c.GetHeader("Accept"), "text/html") {
				c.Redirect(http.StatusFound, "/")
				c.Abort()
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		claims, err := iss.Parse(raw)
		if err != nil {
			if strings.Contains(c.GetHeader("Accept"), "text/html") {
				c.Redirect(http.StatusFound, "/")
				c.Abort()
				return
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token: " + err.Error()})
			return
		}
		if len(allowedRoles) > 0 {
			ok := false
			for _, r := range allowedRoles {
				if claims.Role == r {
					ok = true
					break
				}
			}
			if !ok {
				if strings.Contains(c.GetHeader("Accept"), "text/html") {
					c.Redirect(http.StatusFound, "/")
					c.Abort()
					return
				}
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden for role " + claims.Role})
				return
			}
		}
		c.Set(ctxClaimsKey, claims)
		c.Next()
	}
}

func ClaimsFrom(c *gin.Context) *Claims {
	v, ok := c.Get(ctxClaimsKey)
	if !ok {
		return nil
	}
	cl, _ := v.(*Claims)
	return cl
}

func bearerFromHeader(h string) string {
	if h == "" {
		return ""
	}
	const p = "Bearer "
	if strings.HasPrefix(h, p) {
		return strings.TrimSpace(h[len(p):])
	}
	return ""
}
