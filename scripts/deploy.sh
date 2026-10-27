#!/usr/bin/env bash
# deploy/ klasörünü hazırlar, sunucuya gönderir ve botu yeniden derleyip başlatır.
# Kullanım: ./scripts/deploy.sh
# Bu klasörde deploy-sunucu-bilgileri.txt varsa sorular oradan otomatik doldurulur
# (biçim: soruların aynısı, "soru: cevap"). Yoksa sorulur; son girilenler
# .deploy.local dosyasında hatırlanır. İkisi de git'e girmez. Şifre hiçbir yerde tutulmaz.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_CFG="$ROOT/.deploy.local"
INFO_FILE="$ROOT/scripts/deploy-sunucu-bilgileri.txt"

DEPLOY_HOST=""
DEPLOY_PORT="22"
DEPLOY_DIR=""
# shellcheck disable=SC1090
[ -f "$LOCAL_CFG" ] && source "$LOCAL_CFG"

FILE_HOST="" FILE_PORT="" FILE_DIR="" FILE_DEL=""
if [ -f "$INFO_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in *:*) ;; *) continue ;; esac
    val="${line#*:}"
    val="$(echo "$val" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    case "$line" in
      "SSH (kullanici@sunucu)"*) FILE_HOST="$val" ;;
      "SSH portu"*) FILE_PORT="${val:-22}" ;;
      "Sunucudaki bot klasörü"*) FILE_DIR="$val" ;;
      *silinsin*) FILE_DEL="$val" ;;
    esac
  done < "$INFO_FILE"
  echo "Bilgiler dosyadan okunuyor: scripts/deploy-sunucu-bilgileri.txt"
fi

ask() {
  local prompt="$1" default="$2" answer
  if [ -n "$default" ]; then
    read -rp "$prompt [$default]: " answer
    echo "${answer:-$default}"
  else
    read -rp "$prompt: " answer
    echo "$answer"
  fi
}

# Dosyada değer varsa onu kullanır, yoksa sorar.
pick() {
  local prompt="$1" from_file="$2" default="$3"
  if [ -n "$from_file" ]; then
    echo "$prompt: $from_file" >&2
    echo "$from_file"
  else
    ask "$prompt" "$default"
  fi
}

DEPLOY_HOST="$(pick "SSH (kullanici@sunucu)" "$FILE_HOST" "$DEPLOY_HOST")"
DEPLOY_PORT="$(pick "SSH portu" "$FILE_PORT" "$DEPLOY_PORT")"
DEPLOY_DIR="$(pick "Sunucudaki bot klasörü" "$FILE_DIR" "$DEPLOY_DIR")"

if [ -z "$DEPLOY_HOST" ] || [ -z "$DEPLOY_DIR" ]; then
  echo "HATA: sunucu ve klasör boş olamaz." >&2
  exit 1
fi

printf 'DEPLOY_HOST=%q\nDEPLOY_PORT=%q\nDEPLOY_DIR=%q\n' \
  "$DEPLOY_HOST" "$DEPLOY_PORT" "$DEPLOY_DIR" > "$LOCAL_CFG"

DELETE_ARGS=()
DEL_PROMPT="Sunucuda deploy/ içinde olmayan eski dosyalar silinsin mi? (.env korunur) [e/H]"
if [ -n "$FILE_DEL" ]; then
  del="$FILE_DEL"
  echo "$DEL_PROMPT: $del"
else
  read -rp "$DEL_PROMPT: " del
fi
if [[ "$del" =~ ^[eEyY]$ ]]; then
  DELETE_ARGS=(--delete --exclude .env)
fi

# Tek SSH bağlantısı açıp tüm adımlarda onu kullan (şifre bir kez sorulur).
# macOS'un uzun TMPDIR yolu soket yolu sınırını (104 karakter) aşabildiği için /tmp.
SOCK="$(mktemp -u /tmp/cyberbot-ssh.XXXXXX)"
SSH_OPTS=(-p "$DEPLOY_PORT" -o ControlMaster=auto -o "ControlPath=$SOCK" -o ControlPersist=120)
cleanup() { ssh "${SSH_OPTS[@]}" -O exit "$DEPLOY_HOST" 2>/dev/null || true; }
trap cleanup EXIT

remote() { ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "$@"; }

echo
echo "==> 1/4 deploy/ klasörü hazırlanıyor"
"$ROOT/scripts/deploy-hazirla.sh" > /dev/null
VERSION="$(node -p "require('$ROOT/deploy/package.json').version" 2>/dev/null || echo "?")"
echo "    sürüm: v$VERSION"

echo "==> 2/4 Sunucu kontrol ediliyor ($DEPLOY_HOST)"
remote "mkdir -p '$DEPLOY_DIR' && command -v docker >/dev/null" \
  || { echo "HATA: bağlanılamadı ya da sunucuda docker yok." >&2; exit 1; }
if ! remote "test -f '$DEPLOY_DIR/.env'"; then
  echo "HATA: $DEPLOY_DIR/.env yok. Önce sunucuda .env dosyasını oluşturun (.env.example'a bakın)." >&2
  exit 1
fi

echo "==> 3/4 Dosyalar gönderiliyor"
rsync -az --itemize-changes ${DELETE_ARGS[@]+"${DELETE_ARGS[@]}"} -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT/deploy/" "$DEPLOY_HOST:$DEPLOY_DIR/"

echo "==> 4/4 Derleniyor ve başlatılıyor"
remote "cd '$DEPLOY_DIR' && docker compose up -d --build && docker compose ps"

echo
echo "==> Son loglar (çıkmak için Ctrl+C, bot çalışmaya devam eder)"
remote "cd '$DEPLOY_DIR' && timeout 20 docker compose logs -f --tail 30" || true

echo
echo "Tamam: v$VERSION gönderildi. Logda 'Bot online: ... v$VERSION' görünmeli."
