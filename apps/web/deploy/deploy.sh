#!/bin/bash
set -u
CTX=~/services/markitdown/ctx
rm -rf "$CTX"; mkdir -p "$CTX/bin" "$CTX/web"
cd /mnt/e/Sites/mark-it-down/apps/web
cp Dockerfile "$CTX/"; [ -f start.sh ] && cp start.sh "$CTX/"
cp bin/web-linux bin/migrate-linux "$CTX/bin/"
cp -r web/dist "$CTX/web/dist"; cp -r lang "$CTX/lang"
[ -d internal/db ] && mkdir -p "$CTX/internal" && cp -r internal/db "$CTX/internal/db"
APK=/mnt/e/Sites/mark-it-down/apps/mobile/build/app/outputs/flutter-apk/app-release.apk
[ -f "$APK" ] && cp "$APK" "$CTX/web/dist/mark-it-down-v0.3.0.apk" && echo "APK staged"
GOT=$(sha256sum "$CTX/bin/web-linux" | cut -d' ' -f1)
echo "staged hash: $GOT (want bb932ebdd0ebd8b03ea4caf9e3ca0432c0c0dac872fd1b67a85801267e238a88)"
[ "$GOT" = "bb932ebdd0ebd8b03ea4caf9e3ca0432c0c0dac872fd1b67a85801267e238a88" ] || { echo HASH-MISMATCH; exit 1; }
cd ~/services/markitdown
docker compose build 2>&1 | grep -E 'ERROR|naming' | tail -1
docker compose up -d 2>&1 | tail -1
for i in $(seq 1 15); do st=$(docker inspect markitdown --format '{{.State.Health.Status}}' 2>/dev/null); [ "$st" = healthy ] && break; sleep 3; done
echo "health: ${st:-none}"
docker exec markitdown sha256sum /app/web-api | cut -d' ' -f1
