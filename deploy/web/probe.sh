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
