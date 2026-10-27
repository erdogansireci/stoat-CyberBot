#!/usr/bin/env bash
# Sunucuya gönderilecek dosyaları deploy/ klasörüne toplar.
# Kullanım: ./scripts/deploy-hazirla.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deploy"

FILES=(
  Dockerfile
  compose.yml
  .dockerignore
  package.json
  package-lock.json
  .env.example
  src
)

rm -rf "$OUT"
mkdir -p "$OUT"

for f in "${FILES[@]}"; do
  if [ ! -e "$ROOT/$f" ]; then
    echo "HATA: $f bulunamadı" >&2
    exit 1
  fi
  cp -R "$ROOT/$f" "$OUT/"
done

find "$OUT" -name .DS_Store -delete

echo "Hazır: $OUT"
find "$OUT" -type f | sed "s|$OUT/|  |" | sort
