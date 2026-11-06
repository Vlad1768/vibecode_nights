#!/usr/bin/env bash
set -eu
. /etc/os-release
printf 'OS: %s\n' "$PRETTY_NAME"
printf 'Node: '; (node --version 2>/dev/null || /opt/fightinvestor-node/bin/node --version 2>/dev/null || true)
for service in nginx investor-bot investor-api fightinvestor fightinvestor-tunnel; do
  printf '%s: ' "$service"; systemctl is-active "$service" 2>/dev/null || true
done
ss -lntp | grep -E ':(22|80|443|8080|8081|8787|18080) ' || true
for endpoint in http://127.0.0.1:8080/api/health http://127.0.0.1:8081/health http://127.0.0.1:8787/api/health; do
  printf '%s ' "$endpoint"; curl --max-time 3 -sS "$endpoint" || true; printf '\n'
done
python3 - <<'PY'
from pathlib import Path
import subprocess,re
for service in ['investor-api','investor-bot']:
    props=subprocess.run(['systemctl','show',service,'--property=FragmentPath,WorkingDirectory,User,Group,EnvironmentFiles,DropInPaths'],capture_output=True,text=True).stdout
    print(service+' unit metadata: '+props.replace('\n','; '))
    raw=subprocess.run(['systemctl','show',service,'--property=ExecStart','--value'],capture_output=True,text=True).stdout
    executable=re.search(r'\bpath=([^ ;]+)',raw)
    scripts=re.findall(r'(?:^|\s)([/A-Za-z0-9_.-]+\.mjs)(?=\s|;|$)',raw)
    print(service+' executable:',executable.group(1) if executable else 'unknown','scripts:',scripts)
for filename in ['/etc/investor-bot/bot.env','/etc/investor-api/api.env','/etc/fightinvestor.env']:
    path=Path(filename)
    if not path.exists():
        print(filename+': absent'); continue
    values={}
    for line in path.read_text().splitlines():
        if '=' in line:
            name,value=line.split('=',1); values[name.strip()]=value.strip()
    # Print only explicitly safe configuration values, never secrets or their fragments.
    safe={k:values[k] for k in ['TRAINER_API_URL','GEMINI_MODEL','HOST','PORT','AI_FALLBACK','DEMO_MODE'] if k in values}
    print(filename, safe)
    print(filename+' configured secrets:',{k:bool(values.get(k)) for k in ['GEMINI_API_KEY','BOT_TELEGRAM_TOKEN','WEB_COOKIE_SECRET']})
PY
python3 - <<'PY'
from pathlib import Path
import re, subprocess
# Only routing/security directives are allowed in logs. Never dump arbitrary
# nginx configuration: it can contain Authorization headers or credentials.
result = subprocess.run(['nginx', '-T'], capture_output=True, text=True)
print('nginx configuration check:', 'ok' if result.returncode == 0 else 'failed')
filename = ''
allowed = {'listen', 'server_name', 'root', 'location', 'try_files', 'include',
           'client_max_body_size', 'client_body_timeout', 'send_timeout',
           'proxy_connect_timeout', 'proxy_read_timeout', 'proxy_send_timeout',
           'ssl_certificate', 'ssl_certificate_key', 'ssl_protocols',
           'ssl_session_cache', 'ssl_session_timeout', 'limit_req', 'limit_conn'}
safe_headers = {'Host', 'X-Real-IP', 'X-Forwarded-For', 'X-Forwarded-Proto'}
safe_response_headers = {'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy',
                         'Cache-Control', 'Content-Security-Policy', 'Strict-Transport-Security'}
for line in result.stdout.splitlines():
    match = re.fullmatch(r'# configuration file ([^\r\n]+):', line)
    if match:
        filename = match[1]
        continue
    text = line.strip()
    parts = text.split()
    if not parts:
        continue
    directive = parts[0]
    safe = directive in allowed
    if directive == 'proxy_pass':
        safe = bool(re.fullmatch(r'proxy_pass\s+http://127\.0\.0\.1:[0-9]+/?;', text))
    elif directive == 'proxy_set_header' and len(parts) >= 3:
        safe = parts[1] in safe_headers and bool(re.fullmatch(r'\$[a-z_]+;', parts[2]))
    elif directive == 'add_header' and len(parts) >= 3:
        safe = parts[1] in safe_response_headers
    elif directive == 'return':
        safe = bool(re.fullmatch(r'return\s+(?:30[1278]|40[034]|444)(?:\s+https?://[a-zA-Z0-9.$_/-]+)?;', text))
    if safe:
        print('nginx', filename + ':', text[:1000])
cert = Path('/etc/letsencrypt/live/fightinvestor.ru/fullchain.pem')
print('Domain certificate present:', cert.is_file())
if cert.is_file():
    data = subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-subject', '-dates'], capture_output=True, text=True)
    if data.returncode == 0:
        print(data.stdout.strip())
PY
printf 'Certbot: '; command -v certbot || true
printf 'Certbot renewal timer: '; systemctl is-enabled certbot.timer 2>/dev/null || true
if command -v ufw >/dev/null 2>&1; then
  ufw status | awk '/^Status:|(^|[^0-9])(80|443)\/tcp/'
fi
