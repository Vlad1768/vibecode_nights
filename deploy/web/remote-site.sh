#!/usr/bin/env bash
set -euo pipefail
set +x
action=${1:?}; release=${2:?}; bot_host=${3:?}; bot_port=${4:?}
[[ "$release" =~ ^[a-f0-9]{40}$ && "$bot_host" =~ ^[a-zA-Z0-9.-]+$ && "$bot_port" =~ ^[0-9]+$ ]]
release_dir="/opt/fightinvestor/releases/$release"
public_dir=/var/www/fightinvestor
public_files=(
  index.html styles.css app.mjs demo.mjs motion.css motion.mjs
  entrance.css entrance.mjs assets/investor-fight.jpg
  investor-art.css investor-art.mjs
  assets/investors/burgundy-investor.jpg
  assets/investors/corporate-investor.jpg
  assets/investors/green-coat-investor.jpg
)
tunnel_env=/etc/fightinvestor-tunnel
case "$action" in
prepare)
  [ "$(id -u)" = 0 ]
  [ -x /opt/fightinvestor-node/bin/node ]
  id investortunnel >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin investortunnel
  install -d -m 0750 -o root -g investortunnel "$tunnel_env"
  if [ ! -f "$tunnel_env/id_ed25519" ]; then
    ssh-keygen -q -t ed25519 -N '' -C fightinvestor-api-tunnel -f "$tunnel_env/id_ed25519"
  fi
  chown root:investortunnel "$tunnel_env/id_ed25519"
  chmod 0640 "$tunnel_env/id_ed25519"
  install -d -m 0755 "$release_dir"
  tar --no-same-owner -xzf /tmp/investor-shared-web.tgz -C "$release_dir"
  chmod -R a+rX,go-w "$release_dir"
  /opt/fightinvestor-node/bin/node --check "$release_dir/web/gateway.mjs"
  for file in "${public_files[@]}"; do [ -s "$release_dir/web/$file" ]; done
  ;;
activate)
  [ -s "$tunnel_env/known_hosts" ]
  cat > /etc/systemd/system/fightinvestor-tunnel.service <<EOF
# Managed by connect-trainer
[Unit]
Description=Private SSH tunnel to the shared investor API
After=network-online.target
Wants=network-online.target
[Service]
User=investortunnel
Group=investortunnel
ExecStart=/usr/bin/ssh -N -T -i $tunnel_env/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$tunnel_env/known_hosts -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18080:127.0.0.1:8080 -p $bot_port investor-tunnel@$bot_host
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl restart fightinvestor-tunnel
  success=0
  for attempt in $(seq 1 15); do
    if curl -fsS --max-time 3 http://127.0.0.1:18080/api/health | python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("mode") in ("demo","live")'; then success=1; break; fi
    sleep 1
  done
  [ "$success" = 1 ] || { echo 'Private tunnel failed; existing website remains active'; exit 1; }
  systemctl enable fightinvestor-tunnel >/dev/null

  install -d -m 0700 /var/backups/fightinvestor
  # A repeated activation of the same commit needs its own absence/file snapshot.
  backup=$(mktemp -d "/var/backups/fightinvestor/$release.XXXXXX")
  install -d -m 0700 "$backup/public"
  cp -p /etc/systemd/system/fightinvestor.service "$backup/site.service"
  : > "$backup/public.absent"
  for file in "${public_files[@]}"; do
    if [ -f "$public_dir/$file" ]; then
      case "$file" in */*) install -d -m 0700 "$backup/public/${file%/*}" ;; esac
      cp -p "$public_dir/$file" "$backup/public/$file"
    else
      printf '%s\n' "$file" >> "$backup/public.absent"
    fi
  done
  [ ! -f /etc/fightinvestor-gateway.env ] || cp -p /etc/fightinvestor-gateway.env "$backup/gateway.env"
  python3 - <<'PY'
from pathlib import Path
import os,secrets
p=Path('/etc/fightinvestor-gateway.env')
values={}
if p.exists():
    for line in p.read_text().splitlines():
        if '=' in line:
            k,v=line.split('=',1); values[k]=v
key=values.get('WEB_COOKIE_SECRET') or secrets.token_urlsafe(48)
if len(key)<32: raise SystemExit('Existing cookie secret too short')
fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:
    f.write('NODE_ENV=production\nHOST=127.0.0.1\nPORT=8787\nTRAINER_API_URL=http://127.0.0.1:18080\nWEB_COOKIE_SECRET='+key+'\n')
os.chmod(p,0o600)
PY
  rollback() {
    cp -p "$backup/site.service" /etc/systemd/system/fightinvestor.service
    [ ! -f "$backup/gateway.env" ] || cp -p "$backup/gateway.env" /etc/fightinvestor-gateway.env
    for file in "${public_files[@]}"; do
      if [ -f "$backup/public/$file" ]; then
        cp -p "$backup/public/$file" "$public_dir/$file"
      elif grep -Fxq -- "$file" "$backup/public.absent"; then
        # Remove only the allowlisted file that did not exist before activation.
        rm -f -- "$public_dir/$file"
      fi
    done
    systemctl daemon-reload; systemctl restart fightinvestor || true
    echo 'Website restored to the previous service and static release' >&2
  }
  trap rollback ERR
  cat > /etc/systemd/system/fightinvestor.service <<EOF
# Managed by connect-trainer
[Unit]
Description=Investor website gateway to the shared API
After=network-online.target fightinvestor-tunnel.service
Wants=network-online.target fightinvestor-tunnel.service
[Service]
User=fightinvestor
Group=fightinvestor
WorkingDirectory=$release_dir
EnvironmentFile=/etc/fightinvestor-gateway.env
ExecStart=/opt/fightinvestor-node/bin/node $release_dir/web/gateway.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl restart fightinvestor
  success=0
  for attempt in $(seq 1 15); do
    if curl -fsS --max-time 5 http://127.0.0.1:8787/api/health | python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("mode") in ("demo","live")'; then success=1; break; fi
    sleep 1
  done
  [ "$success" = 1 ]
  for file in "${public_files[@]}"; do
    case "$file" in */*) install -d -m 0755 "$public_dir/${file%/*}" ;; esac
    install -m 0644 "$release_dir/web/$file" "$public_dir/$file"
  done
  nginx -t
  curl -fsS --max-time 5 http://127.0.0.1/api/health -H 'Host: fightinvestor.ru' |
    python3 -c 'import sys,json; j=json.load(sys.stdin); assert j.get("ok") is True and j.get("mode") in ("demo","live")'
  trap - ERR
  rm -- /tmp/investor-shared-web.tgz
  echo 'Website gateway and public files switched to shared API; health passed.'
  ;;
*) echo "Unknown action: $action" >&2; exit 1 ;;
esac
