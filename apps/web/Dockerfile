# Mark It Down web service — one image serving the Go API + the built SPA.
#
# Both artifacts are built on the host and copied in, so the image build needs
# NO network (no go/npm/apk downloads) — deploys keep working through proxy or
# CDN outages, and the build is fast even on a 9P-mounted context:
#   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/web-linux ./cmd/api
#   GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/migrate-linux ./cmd/migrate
#   (cd web && VITE_API_ORIGIN= npm run build)
#   docker build -t markitdown:latest .
# The CA bundle + zoneinfo come from the golang image already present locally;
# busybox provides adduser/wget.

FROM golang:1.27 AS certs

FROM alpine:3.20
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=certs /usr/share/zoneinfo /usr/share/zoneinfo
RUN adduser -D -u 10001 app && mkdir -p /app/data /app/storage && chown -R app /app
WORKDIR /app
COPY --chown=app bin/web-linux /app/web-api
COPY --chown=app bin/migrate-linux /app/migrate
COPY --chown=app internal/db/schema /app/internal/db/schema
COPY --chown=app start.sh /app/start.sh
COPY --chown=app web/dist /app/web/dist
COPY --chown=app lang /app/lang
USER app
ENV ADDR=:8080
ENV APP_ENV=production
ENV WEB_DIST=/app/web/dist
ENV STORAGE_DIR=/app/storage
ENV DB_DRIVER=sqlite
ENV DATABASE_URL="file:/app/data/togo.db?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_time_format=sqlite"
EXPOSE 8080
VOLUME ["/app/data", "/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/app/start.sh"]
