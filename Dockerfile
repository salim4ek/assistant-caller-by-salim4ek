# syntax=docker/dockerfile:1.6

# ─────────────────────────────────────────────────────────────────
# Stage 1: Build the React frontend (Vite → static files)
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS web-build

# Use project root as CWD so Vite's relative outDir (`../web/static/app`)
# resolves correctly in BOTH dev and Docker.
WORKDIR /src

# Cache npm install
COPY web-react/package.json web-react/package-lock.json* ./web-react/
RUN cd web-react && npm install --no-audit --no-fund

COPY web-react/ ./web-react/
RUN cd web-react && npm run build   # → /src/web/static/app

# ─────────────────────────────────────────────────────────────────
# Stage 2: Build the Go server (static binary)
# ─────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS go-build

WORKDIR /src

RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=web-build /src/web/static/app ./web/static/app

RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -o /out/server ./cmd/server

# ─────────────────────────────────────────────────────────────────
# Stage 3: Final image
# ─────────────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata wget \
    && adduser -D -u 1000 app

WORKDIR /app

COPY --from=go-build /out/server /app/server
COPY --from=go-build /src/web/static /app/web/static

RUN mkdir -p /app/data && chown -R app:app /app

USER app
ENV DB_PATH=/app/data/app.db \
    APP_PORT=8080 \
    WEB_DIR=/app/web/static

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["/app/server"]
