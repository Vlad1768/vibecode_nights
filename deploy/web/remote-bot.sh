#!/usr/bin/env bash
# Run as root on Ivan's host. Does not deploy or replace the Telegram bot source/token.
set -euo pipefail
set +x
action=${1:?}; release=${2:?}; site_host=${3:?}
[[ "$release" =~ ^[a-f0-9]{40}$ && "$site_host" =~ ^[a-zA-Z0-9.-]+$ ]]
root=/opt/investor-api
release_dir="$root/releases/$release"
env_file=/etc/investor-api/api.env
unit=/etc/systemd/system/investor-api.service
healthy() {
  curl -fsS --max-time 5 http://127.0.0.1:8080/api/health |
    python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("mode")=="live"'
}
healthy_any() {
  curl -fsS --max-time 5 http://127.0.0.1:8080/api/health |
    python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("mode") in ("demo","live"); print("Existing API mode: "+j["mode"])'
}
case "$action" in
verify-existing)
  systemctl is-active --quiet investor-api
  systemctl is-active --quiet investor-bot
  healthy_any
  python3 - <<'PY'
from pathlib import Path
p=Path('/etc/investor-bot/bot.env')
values={}
for line in p.read_text().splitlines():
    if '=' in line:
        k,v=line.split('=',1); values[k.strip()]=v.strip().strip(chr(34)).strip(chr(39))
if values.get('TRAINER_API_URL') != 'http://127.0.0.1:8080':
    raise SystemExit('Existing bot is not connected to the expected API; attach will not change it')
print('Existing bot already uses shared API; its code, token, environment and service are preserved.')
PY
  curl -fsS --max-time 5 http://127.0.0.1:8081/health | python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("api")=="http"'
  ;;
prepare)
  [ "$(id -u)" = 0 ]
  [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]
  systemctl is-active --quiet investor-bot || { echo 'Existing bot must be active before connecting'; exit 1; }
  if [ -f "$unit" ] && ! grep -qE '^# Managed by (connect-trainer|deploy-bot)' "$unit"; then
    echo 'Existing API service is not managed by this workflow; inspect before replacing'; exit 1
  fi
  if ss -lnt | grep -qE ':8080[[:space:]]' && ! systemctl is-active --quiet investor-api; then
    echo 'Port 8080 is already occupied by another service'; exit 1
  fi
  id investorapi >/dev/null 2>&1 || useradd --system --no-create-home --home-dir "$root" --shell /usr/sbin/nologin investorapi
  install -d -m 0755 "$release_dir"
  install -d -m 0700 /etc/investor-api
  install -d -o investorapi -g investorapi -m 0750 /var/lib/investor-api
  tar --no-same-owner -xzf /tmp/investor-shared-api.tgz -C "$release_dir"
  chmod -R a+rX,go-w "$release_dir"
  node --check "$release_dir/server/index.mjs"
  ;;
activate)
  [ -s /etc/investor-api/api.env.next ]
  [ -d "$release_dir" ]
  backup="/etc/investor-api/backup-$release"
  install -d -m 0700 "$backup"
  [ ! -f "$env_file" ] || cp -p "$env_file" "$backup/api.env"
  [ ! -f "$unit" ] || cp -p "$unit" "$backup/api.service"
  rollback() {
    systemctl stop investor-api || true
    if [ -f "$backup/api.env" ]; then cp -p "$backup/api.env" "$env_file"; fi
    if [ -f "$backup/api.service" ]; then
      cp -p "$backup/api.service" "$unit"; systemctl daemon-reload; systemctl start investor-api || true
    fi
  }
  trap rollback ERR
  install -m 0600 -o root -g root /etc/investor-api/api.env.next "$env_file"
  cat > "$unit" <<EOF
# Managed by connect-trainer
[Unit]
Description=Shared investor training API
After=network-online.target
Wants=network-online.target
[Service]
User=investorapi
Group=investorapi
WorkingDirectory=$release_dir
EnvironmentFile=$env_file
ExecStart=$(command -v node) $release_dir/server/index.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/investor-api
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl restart investor-api
  success=0
  for attempt in $(seq 1 15); do if healthy; then success=1; break; fi; sleep 1; done
  [ "$success" = 1 ]
  curl -fsS --max-time 5 http://127.0.0.1:8080/api/persona | python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("id") and j.get("name")'
  systemctl enable investor-api >/dev/null
  trap - ERR
  rm -- /etc/investor-api/api.env.next /tmp/investor-shared-api.tgz
  echo 'Shared API health verified in live mode; no generation request was made.'
  ;;
authorize)
  healthy_any
  pubkey=/run/fightinvestor-connect/site-tunnel.pub
  ssh-keygen -lf "$pubkey" >/dev/null
  grep -q '^ssh-ed25519 ' "$pubkey"
  [ "$(wc -l < "$pubkey")" -le 1 ]
  id investor-tunnel >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/investor-tunnel --shell /usr/sbin/nologin investor-tunnel
  # An impossible password hash permits public-key forwarding without password login.
  usermod -p '*' investor-tunnel
  install -d -m 0700 -o investor-tunnel -g investor-tunnel /var/lib/investor-tunnel/.ssh
  { printf 'from="%s",restrict,port-forwarding,permitopen="127.0.0.1:8080",command="/bin/false" ' "$site_host"; cat "$pubkey"; } > /var/lib/investor-tunnel/.ssh/authorized_keys
  chown investor-tunnel:investor-tunnel /var/lib/investor-tunnel/.ssh/authorized_keys
  chmod 0600 /var/lib/investor-tunnel/.ssh/authorized_keys
  cat > /etc/ssh/sshd_config.d/60-investor-tunnel.conf <<'EOF'
Match User investor-tunnel
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding local
    PermitOpen 127.0.0.1:8080
    PermitListen none
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    ForceCommand /bin/false
Match all
EOF
  /usr/sbin/sshd -t
  systemctl reload ssh
  rm -- "$pubkey"
  echo 'Restricted tunnel key authorized; root SSH settings unchanged.'
  ;;
attach-bot)
  healthy
  [ -f /etc/investor-bot/bot.env ]
  backup="/etc/investor-api/bot.env.before-$release"
  cp -p /etc/investor-bot/bot.env "$backup"
  chmod 0600 "$backup"
  python3 - <<'PY'
from pathlib import Path
import os
p=Path('/etc/investor-bot/bot.env'); stat=p.stat()
lines=p.read_text().splitlines()
lines=[line for line in lines if not line.strip().startswith('TRAINER_API_URL=')]
lines.append('TRAINER_API_URL=http://127.0.0.1:8080')
next_path=p.with_suffix('.env.next')
fd=os.open(next_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f: f.write('\n'.join(lines)+'\n')
os.chown(next_path,stat.st_uid,stat.st_gid); os.chmod(next_path,stat.st_mode & 0o777)
os.replace(next_path,p)
PY
  systemctl restart investor-bot
  success=0
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 http://127.0.0.1:8081/health >/dev/null; then success=1; break; fi
    sleep 2
  done
  if [ "$success" != 1 ]; then
    install -m 0640 -o root -g investorbot "$backup" /etc/investor-bot/bot.env
    systemctl restart investor-bot
    echo 'Bot health failed; original environment restored' >&2; exit 1
  fi
  echo 'Existing bot connected to local shared API; bot health passed.'
  ;;
*) echo "Unknown action: $action" >&2; exit 1 ;;
esac
