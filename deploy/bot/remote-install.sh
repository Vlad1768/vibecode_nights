#!/usr/bin/env bash
# Выполняется на сервере от root (через ssh из workflow deploy-bot).
# Ожидает: /tmp/investor-bot.tgz (код) и /tmp/investor-bot.env (настройки, 0600).
# Повторный запуск безопасен: прошлая версия сохраняется и возвращается, если новая не прошла health-check.
set -euo pipefail

APP_DIR=/opt/investor-bot
ENV_DIR=/etc/investor-bot
SERVICE=investor-bot
HEALTH_PORT=8081
BUNDLE=/tmp/investor-bot.tgz
ENV_NEW=/tmp/investor-bot.env

log() { echo "[remote] $*"; }

# 1. Node.js 22+
node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }
if [ "$(node_major)" -lt 22 ]; then
  . /etc/os-release
  case " ${ID:-} ${ID_LIKE:-} " in
    *" debian "*|*" ubuntu "*)
      log "ставлю Node.js 22 (NodeSource)"
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq
      apt-get install -y -qq ca-certificates curl gnupg >/dev/null
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
      apt-get install -y -qq nodejs >/dev/null
      ;;
    *)
      log "ОС ${PRETTY_NAME:-unknown} не поддержана скриптом: поставьте Node.js 22+ вручную"
      exit 1
      ;;
  esac
fi
log "node $(node -v)"

# 2. Системный пользователь без входа
id investorbot >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin investorbot

# 3. Настройки (токен) — только из файла, переданного через stdin ssh
install -d -m 0750 -o root -g investorbot "$ENV_DIR"
install -m 0640 -o root -g investorbot "$ENV_NEW" "$ENV_DIR/bot.env"
rm -f "$ENV_NEW"

# 4. Код: новая версия рядом, прошлая — в .prev для отката
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
tar -xzf "$BUNDLE" -C "$APP_DIR.new"
rm -f "$BUNDLE"
chown -R root:root "$APP_DIR.new"
chmod -R a+rX,go-w "$APP_DIR.new"
rm -rf "$APP_DIR.prev"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.prev"
mv "$APP_DIR.new" "$APP_DIR"

install -m 0644 "$APP_DIR/deploy/bot/investor-bot.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"

# 5. Health-check
healthy() {
  node -e "fetch('http://127.0.0.1:$HEALTH_PORT/health').then(r=>r.json().then(j=>{console.log(JSON.stringify(j));process.exit(r.ok?0:1)}),()=>process.exit(1))"
}
for _ in $(seq 1 20); do
  if healthy; then
    log "сервис работает"
    systemctl --no-pager --lines=0 status "$SERVICE" | head -5
    exit 0
  fi
  sleep 3
done

log "health-check не прошёл, журнал:"
journalctl -u "$SERVICE" -n 40 --no-pager || true
if [ -d "$APP_DIR.prev" ]; then
  log "откатываюсь на прошлую версию"
  rm -rf "$APP_DIR.failed"
  mv "$APP_DIR" "$APP_DIR.failed"
  mv "$APP_DIR.prev" "$APP_DIR"
  install -m 0644 "$APP_DIR/deploy/bot/investor-bot.service" "/etc/systemd/system/$SERVICE.service" 2>/dev/null || true
  systemctl daemon-reload
  systemctl restart "$SERVICE"
fi
exit 1
