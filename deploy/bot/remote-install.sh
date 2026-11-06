#!/usr/bin/env bash
# Выполняется на сервере от root (через ssh из workflow deploy-bot).
# Ставит две службы из одного кода: investor-api (T28, 127.0.0.1:8080) и investor-bot (T27).
# Ожидает: /tmp/investor-bot.tgz (код), /tmp/investor-bot.env и /tmp/investor-api.env (настройки, 0600).
# Повторный запуск безопасен: прошлая версия сохраняется и возвращается, если новая не прошла health-check.
set -Eeuo pipefail
set +x

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

# 3. Настройки — только из файлов, переданных через stdin ssh.
# Если API уже ведёт workflow connect-trainer (Герман, deploy/web/), его службу и ключ не трогаем.
API_UNIT=/etc/systemd/system/investor-api.service
EXTERNAL_API=0
if [ -f "$API_UNIT" ] && grep -q '^# Managed by connect-trainer' "$API_UNIT"; then
  EXTERNAL_API=1
  log "API ведёт connect-trainer — оставляю его службу и ключ как есть"
fi

env_value() { # $1 — файл, $2 — имя
  [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -1 | tr -d "\"'"
}
# Keep server-only settings (provider, mode, content and storage) and ignore empty
# incoming values. The staging file is already private and is never printed.
merge_env() { # $1 — existing env-file, $2 — incoming env-file
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import os, re, sys
existing, incoming = map(Path, sys.argv[1:])
lines = existing.read_text(encoding='utf-8').splitlines() if existing.exists() else []
updates = {}
for line in incoming.read_text(encoding='utf-8').splitlines():
    match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
    if match and match[2].strip().strip('"').strip("'"):
        updates[match[1]] = line
lines = [line for line in lines if line.partition('=')[0].strip() not in updates]
lines.extend(updates.values())
with incoming.open('w', encoding='utf-8', newline='\n') as stream:
    stream.write('\n'.join(lines) + '\n')
os.chmod(incoming, 0o600)
PY
}
# A media key already present in bot.env takes precedence over an API fallback.
fill_key() { # $1 — новый env-файл
  for name in OPENAI_API_KEY GEMINI_API_KEY; do
    on_server=$(env_value /etc/investor-api/api.env "$name" || true)
    if [ -z "$(env_value "$1" "$name")" ] && [ -n "$on_server" ]; then
      sed -i "/^$name=/d" "$1"
      printf '%s=%s\n' "$name" "$on_server" >> "$1"
    fi
  done
}

merge_env /etc/investor-bot/bot.env /tmp/investor-bot.env
fill_key /tmp/investor-bot.env
install -d -m 0750 -o root -g investorbot /etc/investor-bot
if [ "$EXTERNAL_API" = 0 ]; then
  merge_env /etc/investor-api/api.env /tmp/investor-api.env
  fill_key /tmp/investor-api.env
  install -d -m 0750 -o root -g investorapi /etc/investor-api
fi

# Back up the actual configuration, not just the units bundled with old code.
CONFIG_BACKUP=$(mktemp -d /etc/investor-bot/deploy-backup.XXXXXX)
chmod 0700 "$CONFIG_BACKUP"
backup_config() { [ ! -f "$1" ] || cp -p "$1" "$CONFIG_BACKUP/$2"; }
restore_config() {
  if [ -f "$CONFIG_BACKUP/$2" ]; then cp -p "$CONFIG_BACKUP/$2" "$1"; else rm -f -- "$1"; fi
}
backup_config /etc/investor-bot/bot.env bot.env
backup_config /etc/systemd/system/investor-bot.service bot.service
if [ "$EXTERNAL_API" = 0 ]; then
  backup_config /etc/investor-api/api.env api.env
  backup_config "$API_UNIT" api.service
fi
CODE_CHANGED=0
rollback() {
  trap - ERR
  set +e
  log "откатываю код и прежнее окружение"
  if [ "$CODE_CHANGED" = 1 ]; then
    rm -rf "$APP_DIR.failed"
    [ ! -d "$APP_DIR" ] || mv "$APP_DIR" "$APP_DIR.failed"
    [ ! -d "$APP_DIR.prev" ] || mv "$APP_DIR.prev" "$APP_DIR"
  fi
  restore_config /etc/investor-bot/bot.env bot.env
  restore_config /etc/systemd/system/investor-bot.service bot.service
  if [ "$EXTERNAL_API" = 0 ]; then
    restore_config /etc/investor-api/api.env api.env
    restore_config "$API_UNIT" api.service
  fi
  systemctl daemon-reload
  if [ "$EXTERNAL_API" = 0 ]; then
    if [ -f "$API_UNIT" ]; then systemctl restart investor-api; else systemctl disable --now investor-api; fi
  fi
  if [ -f /etc/systemd/system/investor-bot.service ]; then systemctl restart investor-bot; else systemctl disable --now investor-bot; fi
  log "прежняя конфигурация восстановлена; резервная копия доступна только root"
  exit 1
}
trap rollback ERR

# 4. Код: новая версия рядом, прошлая — в .prev для отката
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
tar -xzf "$BUNDLE" -C "$APP_DIR.new"
rm -f "$BUNDLE"
chown -R root:root "$APP_DIR.new"
chmod -R a+rX,go-w "$APP_DIR.new"
rm -rf "$APP_DIR.prev"
if [ -d "$APP_DIR" ]; then mv "$APP_DIR" "$APP_DIR.prev"; CODE_CHANGED=1; fi
mv "$APP_DIR.new" "$APP_DIR"
CODE_CHANGED=1

install -m 0640 -o root -g investorbot /tmp/investor-bot.env /etc/investor-bot/bot.env
if [ "$EXTERNAL_API" = 0 ]; then
  install -m 0640 -o root -g investorapi /tmp/investor-api.env /etc/investor-api/api.env
fi
rm -f /tmp/investor-bot.env /tmp/investor-api.env

install_units() {
  if [ "$EXTERNAL_API" = 0 ]; then
    install -m 0644 "$APP_DIR/deploy/api/investor-api.service" "$API_UNIT"
  fi
  install -m 0644 "$APP_DIR/deploy/bot/investor-bot.service" /etc/systemd/system/investor-bot.service
  systemctl daemon-reload
  systemctl enable investor-api investor-bot >/dev/null 2>&1 || true
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

install_units

# 5. Сначала API, потом бот (бот ходит в API на 127.0.0.1:8080)
if [ "$EXTERNAL_API" = 0 ]; then
  systemctl restart investor-api
fi
wait_healthy investor-api http://127.0.0.1:8080/api/health || rollback
systemctl restart investor-bot
wait_healthy investor-bot http://127.0.0.1:8081/health || rollback

systemctl --no-pager --lines=0 status investor-api investor-bot | grep -E '●|Active:' || true
trap - ERR
