#!/usr/bin/env bash
# Runner only. Passwords come from Actions environment; Gemini never enters a file on the runner.
set -euo pipefail
set +x
MODE=${MODE:-probe}
[[ "$MODE" == probe || "$MODE" == attach || "$MODE" == connect ]]
for name in SITE_HOST SITE_USER SITE_PORT SITE_PASSWORD BOT_HOST BOT_USER BOT_PORT BOT_PASSWORD RELEASE_ID; do
  [ -n "${!name:-}" ] || { echo "Missing setting: $name" >&2; exit 1; }
done
[[ "$RELEASE_ID" =~ ^[a-f0-9]{40}$ ]]
[[ "$SITE_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$BOT_HOST" =~ ^[a-zA-Z0-9.-]+$ ]]
[[ "$SITE_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$BOT_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$SITE_PORT" =~ ^[0-9]+$ && "$BOT_PORT" =~ ^[0-9]+$ ]]
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
chmod 700 "$work"
# These fingerprints were observed on the site SSH login and deploy-bot probe 42251580842.
pin_host() {
  local name=$1 host=$2 port=$3 expected=$4
  ssh-keyscan -T 15 -p "$port" -t ed25519 "$host" > "$work/$name.known_hosts" 2>/dev/null
  [ "$(ssh-keygen -lf "$work/$name.known_hosts" | awk '{print $2}')" = "$expected" ] || {
    echo "Host key does not match the previously verified $name server" >&2; exit 1;
  }
}
pin_host site "$SITE_HOST" "$SITE_PORT" 'SHA256:LHJB97Gy5ZnELZe6TafiilTJnFhAC03lJQJ5ppF//Ek'
pin_host bot "$BOT_HOST" "$BOT_PORT" 'SHA256:8Hwg4ixNBEg10mwxst4jg7fe4u/s/3mJvyXQM6vRlBo'
for name in site bot; do
  if [ "$name" = site ]; then host=$SITE_HOST user=$SITE_USER port=$SITE_PORT; else host=$BOT_HOST user=$BOT_USER port=$BOT_PORT; fi
  cat >> "$work/config" <<EOF
Host $name
  HostName $host
  User $user
  Port $port
  UserKnownHostsFile $work/$name.known_hosts
  StrictHostKeyChecking yes
  PreferredAuthentications password
  PubkeyAuthentication no
  ConnectTimeout 20
  ServerAliveInterval 15
EOF
done
site() { SSHPASS="$SITE_PASSWORD" sshpass -e ssh -F "$work/config" site "$@"; }
bot() { SSHPASS="$BOT_PASSWORD" sshpass -e ssh -F "$work/config" bot "$@"; }
if [ "$MODE" != probe ] && [ -f deploy/API_KEYS_DISABLED ]; then
  # Credential retirement takes priority over every ordinary deployment change.
  for target in bot site; do
    "$target" 'install -d -m 0700 /etc/investor-api; umask 077; cat > /etc/investor-api/revoke-api-keys.sh' < deploy/revoke-api-keys.sh
    "$target" 'bash /etc/investor-api/revoke-api-keys.sh'
  done
  site 'curl -fsS --max-time 5 http://127.0.0.1:8787/api/health' |
    python3 -c 'import json,sys; assert json.load(sys.stdin).get("mode")=="demo"'
  echo 'Credential retirement completed; normal attach/connect was skipped.'
  exit 0
fi
for target in site bot; do
  echo "Server: $target"
  "$target" 'bash -s' < deploy/web/probe.sh
done
[ "$MODE" != probe ] || exit 0

# Create only our release paths. The existing Telegram source and token remain in place.
tar -czf "$work/web.tgz" web
SSHPASS="$SITE_PASSWORD" sshpass -e scp -F "$work/config" -q "$work/web.tgz" site:/tmp/investor-shared-web.tgz
if [ "$MODE" = connect ]; then
tar -czf "$work/api.tgz" server core integrations
SSHPASS="$BOT_PASSWORD" sshpass -e scp -F "$work/config" -q "$work/api.tgz" bot:/tmp/investor-shared-api.tgz
bot "bash -s -- prepare '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh

# The Gemini key crosses encrypted SSH streams; it is not printed or saved on the runner.
site 'python3 -c '\''from pathlib import Path
values={}
for line in Path("/etc/fightinvestor.env").read_text().splitlines():
    if "=" in line:
        name,value=line.split("=",1); values[name.strip()]=value.strip().strip(chr(34)).strip(chr(39))
key=values.get("GEMINI_API_KEY","")
if not key or any(c.isspace() for c in key): raise SystemExit("Missing valid Gemini key on website server")
print("GEMINI_API_KEY="+key)
print("GEMINI_MODEL=gemini-4-argon\nHOST=127.0.0.1\nPORT=8080\nAI_FALLBACK=off\nDEMO_MODE=0\nDATA_DIR=/var/lib/investor-api\nNODE_ENV=production")'\''' |
  bot 'umask 077; cat > /etc/investor-api/api.env.next'
bot "bash -s -- activate '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
else
  # Reuse Ivan's working API (including its explicit demo/live mode) without replacing it.
  bot "bash -s -- verify-existing '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
fi

# The tunnel private key is generated and retained on the site server only.
site "bash -s -- prepare '$RELEASE_ID' '$BOT_HOST' '$BOT_PORT'" < deploy/web/remote-site.sh
bot 'install -d -m 0700 -o root -g root /run/fightinvestor-connect'
site 'cat /etc/fightinvestor-tunnel/id_ed25519.pub' |
  bot 'umask 077; cat > /run/fightinvestor-connect/site-tunnel.pub'
bot "bash -s -- authorize '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
cat "$work/bot.known_hosts" | site 'umask 077; cat > /etc/fightinvestor-tunnel/known_hosts; chown root:investortunnel /etc/fightinvestor-tunnel/known_hosts; chmod 640 /etc/fightinvestor-tunnel/known_hosts'
site "bash -s -- activate '$RELEASE_ID' '$BOT_HOST' '$BOT_PORT'" < deploy/web/remote-site.sh
# Domain, DNS and the known nginx layout are checked remotely before TLS changes.
site 'bash -s' < deploy/web/secure-site.sh
# Change only TRAINER_API_URL, and only after both the API and web gateway are healthy.
if [ "$MODE" = connect ]; then
  bot "bash -s -- attach-bot '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
fi
site 'curl -fsS --max-time 5 http://127.0.0.1:8787/api/health'
echo 'Connected: website gateway and existing Telegram bot use the same shared API. See health for demo/live mode.'
