# Placeholder Dockerfile for Engineer A's Go relay/storage node service.
# Expects backend/go.mod and backend/cmd/node once implemented.

FROM golang:1.24.2-alpine AS builder

WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/node ./cmd/node

FROM alpine:3.21.3 AS runtime

RUN adduser -D -u 10001 urguard && apk add --no-cache ca-certificates wget
USER urguard

WORKDIR /app
COPY --from=builder /out/node /usr/local/bin/node

EXPOSE 8081

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/node"]
