#!/usr/bin/env bash
# Выполняется на сервере от root (через ssh из workflow deploy-bot).
# Ставит две службы из одного кода: investor-api (T28, 127.0.0.1:8080) и investor-bot (T27).
# Ожидает: /tmp/investor-bot.tgz (код), /tmp/investor-bot.env и /tmp/investor-api.env (настройки, 0600).
# Повторный запуск безопасен: прошлая версия сохраняется и возвращается, если новая не прошла health-check.
set -euo pipefail

APP_DIR=/opt/investor-bot
BUNDLE=/tmp/investor-bot.tgz

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

# 2. Системные пользователи без входа
for u in investorbot investorapi; do
  id "$u" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$u"
done

# 3. Настройки — только из файлов, переданных через stdin ssh
install -d -m 0750 -o root -g investorbot /etc/investor-bot
install -m 0640 -o root -g investorbot /tmp/investor-bot.env /etc/investor-bot/bot.env
install -d -m 0750 -o root -g investorapi /etc/investor-api
install -m 0640 -o root -g investorapi /tmp/investor-api.env /etc/investor-api/api.env
rm -f /tmp/investor-bot.env /tmp/investor-api.env

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

install_units() {
  install -m 0644 "$APP_DIR/deploy/api/investor-api.service" /etc/systemd/system/investor-api.service
  install -m 0644 "$APP_DIR/deploy/bot/investor-bot.service" /etc/systemd/system/investor-bot.service
  systemctl daemon-reload
  systemctl enable investor-api investor-bot >/dev/null 2>&1
}

healthy() { # $1 — URL
  node -e "fetch(process.argv[1]).then(r=>r.json().then(j=>{console.log(JSON.stringify(j));process.exit(r.ok?0:1)}),()=>process.exit(1))" "$1"
}

wait_healthy() { # $1 — служба, $2 — URL
  for _ in $(seq 1 20); do
    if healthy "$2"; then log "$1 работает"; return 0; fi
    sleep 3
  done
  log "$1: health-check не прошёл, журнал:"
  journalctl -u "$1" -n 40 --no-pager || true
  return 1
}

rollback() {
  [ -d "$APP_DIR.prev" ] || exit 1
  log "откатываюсь на прошлую версию"
  rm -rf "$APP_DIR.failed"
  mv "$APP_DIR" "$APP_DIR.failed"
  mv "$APP_DIR.prev" "$APP_DIR"
  if [ -f "$APP_DIR/deploy/api/investor-api.service" ]; then
    install_units
    systemctl restart investor-api
  else
    # прошлая версия была без API: возвращаем только бота
    systemctl disable --now investor-api >/dev/null 2>&1 || true
    install -m 0644 "$APP_DIR/deploy/bot/investor-bot.service" /etc/systemd/system/investor-bot.service
    systemctl daemon-reload
  fi
  systemctl restart investor-bot
  exit 1
}

install_units

# 5. Сначала API, потом бот (бот ходит в API на 127.0.0.1:8080)
systemctl restart investor-api
wait_healthy investor-api http://127.0.0.1:8080/api/health || rollback
systemctl restart investor-bot
wait_healthy investor-bot http://127.0.0.1:8081/health || rollback

systemctl --no-pager --lines=0 status investor-api investor-bot | grep -E '●|Active:' || true
