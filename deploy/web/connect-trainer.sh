#!/usr/bin/env bash
# Runner only. Passwords come from Actions environment; Gemini never enters a file on the runner.
set -euo pipefail
set +x
MODE=${MODE:-probe}
[[ "$MODE" == probe || "$MODE" == connect ]]
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
for target in site bot; do
  echo "Server: $target"
  "$target" 'bash -s' < deploy/web/probe.sh
done
[ "$MODE" = connect ] || exit 0

# Create only our release paths. The existing Telegram source and token remain in place.
tar -czf "$work/api.tgz" server core integrations/gemini
tar -czf "$work/web.tgz" web
SSHPASS="$BOT_PASSWORD" sshpass -e scp -F "$work/config" -q "$work/api.tgz" bot:/tmp/investor-shared-api.tgz
SSHPASS="$SITE_PASSWORD" sshpass -e scp -F "$work/config" -q "$work/web.tgz" site:/tmp/investor-shared-web.tgz
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

# The tunnel private key is generated and retained on the site server only.
site "bash -s -- prepare '$RELEASE_ID' '$BOT_HOST' '$BOT_PORT'" < deploy/web/remote-site.sh
site 'cat /etc/fightinvestor-tunnel/id_ed25519.pub' |
  bot 'umask 077; cat > /etc/investor-api/site-tunnel.pub'
bot "bash -s -- authorize '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
cat "$work/bot.known_hosts" | site 'umask 077; cat > /etc/fightinvestor-tunnel/known_hosts; chown root:investortunnel /etc/fightinvestor-tunnel/known_hosts; chmod 640 /etc/fightinvestor-tunnel/known_hosts'
site "bash -s -- activate '$RELEASE_ID' '$BOT_HOST' '$BOT_PORT'" < deploy/web/remote-site.sh
# Change only TRAINER_API_URL, and only after both the API and web gateway are healthy.
bot "bash -s -- attach-bot '$RELEASE_ID' '$SITE_HOST'" < deploy/web/remote-bot.sh
echo 'Connected: website gateway and existing Telegram bot use the same live API.'
