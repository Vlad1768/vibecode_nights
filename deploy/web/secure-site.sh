#!/usr/bin/env bash
# Root on the website host only. No model keys, gateway env, SSH or API changes.
set -Eeuo pipefail
set +x
domain=fightinvestor.ru
expected_ip=194.67.88.222
webroot=/var/www/fightinvestor
enabled=/etc/nginx/sites-enabled/fightinvestor
cert=/etc/letsencrypt/live/fightinvestor.ru
hook=/etc/letsencrypt/renewal-hooks/deploy/fightinvestor-nginx
[ "$(id -u)" = 0 ]
[ -f "$enabled" ] && [ -d "$webroot" ]
site_file=$(readlink -f "$enabled")
[[ "$site_file" == /etc/nginx/* && "$site_file" != *$'\n'* ]]
nginx -t >/dev/null 2>&1
grep -qE 'server_name[^;]*[[:space:]]fightinvestor\.ru([[:space:];])' "$site_file"
grep -qE 'root[[:space:]]+/var/www/fightinvestor[[:space:]]*;' "$site_file"
grep -qE 'proxy_pass[[:space:]]+http://127\.0\.0\.1:8787[[:space:]]*;' "$site_file"
python3 - "$domain" "$expected_ip" <<'PY'
import socket, sys
domain, expected = sys.argv[1:]
addresses = {item[4][0] for item in socket.getaddrinfo(domain, 80, socket.AF_INET)}
if addresses != {expected}:
    raise SystemExit('Domain A records do not match the verified website server; TLS was not changed.')
try:
    addresses6 = socket.getaddrinfo(domain, 80, socket.AF_INET6)
except socket.gaierror:
    addresses6 = []
if addresses6:
    raise SystemExit('Unexpected AAAA record; verify IPv6 routing before issuing this certificate.')
PY
curl -fsS --max-time 5 http://127.0.0.1:8787/api/health >/dev/null
install -d -m 0700 /var/backups/fightinvestor-tls
backup=$(mktemp -d /var/backups/fightinvestor-tls/transaction.XXXXXX)
cp -p "$site_file" "$backup/site.conf"
if [ -f "$hook" ]; then cp -p "$hook" "$backup/renew-hook"; fi
timer_was_enabled=0
systemctl is-enabled --quiet certbot.timer 2>/dev/null && timer_was_enabled=1
timer_changed=0
config_changed=0
hook_changed=0
candidate=''
challenge=''
cleanup() {
  [ -z "$candidate" ] || rm -f -- "$candidate"
  [ -z "$challenge" ] || rm -f -- "$challenge"
}
rollback() {
  trap - ERR INT TERM
  set +e
  if [ "$config_changed" = 1 ]; then
    cp -p "$backup/site.conf" "$site_file"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
  fi
  if [ "$hook_changed" = 1 ]; then
    if [ -f "$backup/renew-hook" ]; then cp -p "$backup/renew-hook" "$hook"; else rm -f -- "$hook"; fi
  fi
  if [ "$timer_changed" = 1 ] && [ "$timer_was_enabled" = 0 ]; then systemctl disable --now certbot.timer >/dev/null 2>&1; fi
  echo "TLS setup failed; previous nginx configuration restored. Root-only backup: $backup" >&2
  exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM

# The existing host was inspected by connect-trainer probe: one website vhost,
# static root above and /api routed through the identity-checking gateway.
write_routes() {
  cat <<'NGINX'
    root /var/www/fightinvestor;
    index index.html;
    client_max_body_size 24k;
    client_body_timeout 15s;
    client_header_timeout 15s;
    send_timeout 30s;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_next_upstream off;
        # The edge owns one copy of each security header. API no-store survives.
        proxy_hide_header X-Content-Type-Options;
        proxy_hide_header X-Frame-Options;
        proxy_hide_header Referrer-Policy;
        proxy_hide_header Content-Security-Policy;
        proxy_hide_header Strict-Transport-Security;
        proxy_hide_header Permissions-Policy;
    }
    location ~ \.mjs$ {
        types { application/javascript mjs; }
        default_type application/javascript;
        try_files $uri =404;
        expires -1;
    }
    location ~ /\. { deny all; }
    location / { try_files $uri $uri/ =404; expires -1; }
NGINX
}
render_config() { # bootstrap keeps HTTP working while HTTP-01 is validated.
  cat <<'NGINX'
# Managed by deploy/web/secure-site.sh
server {
    listen 80;
    listen [::]:80;
    server_name 194.67.88.222 fightinvestor.ru www.fightinvestor.ru;
NGINX
  if [ "$1" = bootstrap ]; then
    write_routes
  else
    cat <<'NGINX'
    root /var/www/fightinvestor;
    location ^~ /.well-known/acme-challenge/ { try_files $uri =404; }
    location / { return 308 https://fightinvestor.ru$request_uri; }
NGINX
  fi
  printf '}\n'
  if [ "$1" = tls ]; then
    cat <<'NGINX'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name fightinvestor.ru;
    if ($host != fightinvestor.ru) { return 444; }
    ssl_certificate /etc/letsencrypt/live/fightinvestor.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fightinvestor.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_session_cache shared:FightInvestorSSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    add_header Strict-Transport-Security "max-age=86400" always;
NGINX
    write_routes
    printf '}\n'
  fi
}
activate_config() {
  candidate=$(mktemp "$(dirname "$site_file")/.fightinvestor-security.XXXXXX")
  render_config "$1" > "$candidate"
  chmod 0644 "$candidate"
  mv -f -- "$candidate" "$site_file"
  candidate=''
  config_changed=1
  nginx -t > "$backup/nginx-check.log" 2>&1
  systemctl reload nginx
}

if ! command -v certbot >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq certbot >/dev/null
  timer_changed=1
fi
# A healthy existing HTTPS listener stays online during repeat attaches.
valid_certificate=0
if [ -s "$cert/fullchain.pem" ] && [ -s "$cert/privkey.pem" ] &&
   openssl x509 -in "$cert/fullchain.pem" -noout -checkhost "$domain" >/dev/null 2>&1 &&
   openssl x509 -in "$cert/fullchain.pem" -noout -checkend 604800 >/dev/null 2>&1; then
  valid_certificate=1
fi
tls_online=0
if [ "$valid_certificate" = 1 ] && curl --noproxy '*' --resolve "$domain:443:127.0.0.1" \
  -fsS --connect-timeout 2 --max-time 5 "https://$domain/api/health" >/dev/null 2>&1; then tls_online=1; fi
# A prior failed attempt can leave a valid PEM behind a restored HTTP-only
# config. In both cases install the permanent ACME route before requesting it.
if [ "$tls_online" = 1 ]; then activate_config tls; else activate_config bootstrap; fi
install -d -m 0755 "$webroot/.well-known/acme-challenge"
token="fightinvestor-check-$(openssl rand -hex 16)"
challenge="$webroot/.well-known/acme-challenge/$token"
printf '%s' "$token" > "$challenge"
chmod 0644 "$challenge"
[ "$(curl -fsS --max-time 10 "http://$domain/.well-known/acme-challenge/$token")" = "$token" ]
timeout 180 certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot --webroot-path "$webroot" --cert-name "$domain" --domain "$domain" --keep-until-expiring \
  > "$backup/certbot.log" 2>&1
openssl x509 -in "$cert/fullchain.pem" -noout -checkhost "$domain" >/dev/null
openssl x509 -in "$cert/fullchain.pem" -noout -checkend 604800 >/dev/null
activate_config tls

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
hook_changed=1
cat > "$hook" <<'HOOK'
#!/bin/sh
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *" fightinvestor.ru "*) /usr/sbin/nginx -t >/dev/null 2>&1 && /bin/systemctl reload nginx ;;
esac
HOOK
chmod 0755 "$hook"
timer_changed=1
systemctl enable --now certbot.timer >/dev/null

# No model request: validate TLS/SNI, redirect, public headers and API health.
curl --noproxy '*' --resolve "$domain:443:127.0.0.1" --retry 3 --retry-connrefused --retry-delay 1 \
  --head -fsS --max-time 10 "https://$domain/" > "$backup/https-headers"
curl --noproxy '*' --resolve "$domain:443:127.0.0.1" -fsS --max-time 10 \
  "https://$domain/api/health" > "$backup/health.json"
curl --noproxy '*' --resolve "$domain:80:127.0.0.1" --head -sS --max-time 10 \
  "http://$domain/" > "$backup/http-headers"
python3 - "$backup" <<'PY'
from pathlib import Path
import json, sys
p = Path(sys.argv[1])
headers = p.joinpath('https-headers').read_text().lower()
for key in ['content-security-policy:', 'strict-transport-security:', 'x-frame-options:', 'x-content-type-options:', 'permissions-policy:']:
    if sum(line.startswith(key) for line in headers.splitlines()) != 1:
        raise SystemExit('Missing or duplicate public security header')
if 'max-age=86400' not in headers or 'includesubdomains' in headers:
    raise SystemExit('Unexpected initial HSTS policy')
redirect = p.joinpath('http-headers').read_text().lower()
if ' 308 ' not in redirect or 'location: https://fightinvestor.ru/' not in redirect:
    raise SystemExit('HTTP to HTTPS redirect failed')
if json.loads(p.joinpath('health.json').read_text()).get('ok') is not True:
    raise SystemExit('Gateway health failed after TLS activation')
PY
trap - ERR INT TERM
echo "HTTPS configured for fightinvestor.ru; renewal timer active. Root-only nginx backup: $backup"
