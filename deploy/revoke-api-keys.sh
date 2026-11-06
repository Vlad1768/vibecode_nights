#!/usr/bin/env bash
# Explicit project credential removal. Does not revoke keys at their providers.
set -Eeuo pipefail
set +x
test_root=''
if [ "$#" != 0 ]; then
  [ "$#" = 2 ] && [ "$1" = --test-root ] && [ "${API_KEY_PURGE_TEST:-}" = 1 ] || exit 2
  test_root=$2
  [[ "$test_root" == /* || "$test_root" =~ ^[A-Za-z]:/ ]]
  [[ "${test_root##*/}" == purge-test-* ]]
else
  [ "$(id -u)" = 0 ]
  # Stop model calls and clear in-process credentials before touching files.
  for service in investor-bot investor-api fightinvestor; do
    if [ "$(systemctl show "$service" -p LoadState --value 2>/dev/null)" != not-found ]; then
      systemctl stop "$service"
    fi
  done
  systemctl disable investor-bot >/dev/null 2>&1 || true
  if systemctl is-active --quiet investor-bot; then echo 'Bot did not stop; purge aborted.' >&2; exit 1; fi
  install -d -m 0700 /etc/investor-api
  if [ "$(readlink -f "$0")" != /etc/investor-api/revoke-api-keys.sh ]; then
    install -m 0700 "$0" /etc/investor-api/revoke-api-keys.sh
  else
    chmod 0700 /etc/investor-api/revoke-api-keys.sh
  fi
fi
python3 - "$test_root" <<'PY'
from pathlib import Path
import glob, io, json, os, re, shlex, stat, sys, tarfile, zipfile

prefix = Path(sys.argv[1]).resolve() if sys.argv[1] else None
def local(path):
    return prefix / str(path).replace('\\', '/').lstrip('/') if prefix else Path(path)

def config_file(path):
    name = path.name.lower()
    if any(word in name for word in ['example', 'sample', 'template', '.test.']):
        return False
    return '.env' in name or name.endswith(('.service', '.conf')) or (name.endswith(('.json', '.toml', '.ini', '.yaml', '.yml')) and any(word in name for word in ['credential', 'secret', 'config', 'settings', 'auth']))

def actual_value(value):
    value = value.strip()
    return len(value) >= 6 and not value.startswith(('$', '{', 'process.', 'settings.', 'env.')) and not re.search(r'(?i)(dummy|placeholder|example|your[_ -]?|replace|change.?me|fake|(?:^|[-_])test(?:[-_]|$))', value) and value.lower() not in {'null', 'none', 'undefined', '[revoked]'}

def secret_name(name):
    name = re.sub(r'[^A-Za-z0-9]', '', name).upper()
    return name.endswith(('APIKEY', 'APITOKEN', 'APISECRET')) or name in {
        'APIKEY', 'APITOKEN', 'OPENAIKEY', 'CHATGPTKEY', 'CHATGPTAPIKEY',
        'GEMINIKEY', 'GOOGLEKEY', 'DEEPSEEKKEY', 'ANTHROPICKEY', 'CLAUDEKEY',
        'LLMKEY', 'MODELKEY', 'BOTTOKEN', 'TELEGRAMTOKEN', 'TELEGRAMBOTTOKEN', 'BOTTELEGRAMTOKEN'}

def protected_name(name):
    name = name.upper()
    return name.startswith('SSH') or name in {'SSHPASS', 'SITE_PASSWORD', 'BOT_PASSWORD',
        'SITE_SERVER_PASSWORD', 'BOT_SERVER_PASSWORD', 'WEB_COOKIE_SECRET', 'COOKIE_SECRET'}

raw_patterns = [re.compile(r'sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}'),
    re.compile(r'AIza[A-Za-z0-9_-]{25,}'), re.compile(r'(?<![0-9])[0-9]{5,15}:[A-Za-z0-9_-]{20,}')]
assignment = re.compile(r'''["']?(?P<name>[A-Za-z][A-Za-z0-9_.-]{1,80})["']?\s*[:=]\s*(?P<quote>["'])(?P<value>[^"'\r\n]*)["']''')
env_assignment = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')
provider_names = {'LLM_PROVIDER', 'AI_PROVIDER'}
known = set()
names = set()
counts = {'scanned_files': 0, 'changed_files': 0, 'removed_archives': 0, 'removed_temp_env': 0, 'skipped_symlinks': 0}

roots = ['/etc/investor-api', '/etc/investor-bot', '/etc/fightinvestor.env',
    '/etc/fightinvestor-gateway.env', '/opt/fightinvestor', '/opt/investor-bot',
    '/opt/investor-bot.prev', '/opt/investor-bot.failed', '/opt/investor-bot.new', '/opt/investor-api',
    '/tmp/investor-api.env', '/tmp/investor-bot.env', '/tmp/investor-shared-api.tgz', '/tmp/investor-bot.tgz']
for pattern in ['/var/backups/fightinvestor*', '/var/log/fightinvestor*', '/var/log/investor-api*', '/var/log/investor-bot*']:
    roots.extend(str(p if prefix is None else Path('/') / Path(p).relative_to(prefix)) for p in glob.glob(str(local(pattern))))
for base in ['/etc/systemd/system', '/run/systemd/system', '/lib/systemd/system']:
    for service in ['investor-api', 'investor-bot', 'fightinvestor']:
        roots.extend([f'{base}/{service}.service', f'{base}/{service}.service.d'])

files = []
seen = set()
for root in roots:
    p = local(root)
    if p.is_symlink():
        counts['skipped_symlinks'] += 1
        continue
    candidates = [p] if p.is_file() else []
    if p.is_dir():
        for directory, dirs, filenames in os.walk(p, followlinks=False):
            dirs[:] = [d for d in dirs if d != '.ssh' and not (Path(directory) / d).is_symlink()]
            candidates.extend(Path(directory) / name for name in filenames)
    for path in candidates:
        if path.is_symlink():
            counts['skipped_symlinks'] += 1
            continue
        if not path.is_file() or path in seen or path.name in {'revoke-api-keys.sh', 'API_KEYS_DISABLED', 'authorized_keys', 'known_hosts'} or path.name.startswith('id_ed25519'):
            continue
        seen.add(path)
        files.append(path)

def text_of(data):
    if b'\0' in data[:8192]:
        return None
    return data.decode('utf-8', errors='surrogateescape')

def literals(text, config=False):
    for line in text.splitlines():
        match = env_assignment.match(line)
        if config and match and secret_name(match[1]):
            value = match[2].strip().strip('"').strip("'")
            if actual_value(value):
                names.add(match[1]); yield value
        if line.lstrip().startswith('Environment='):
            try:
                for item in shlex.split(line.split('=', 1)[1]):
                    name, sep, value = item.partition('=')
                    if sep and secret_name(name) and actual_value(value):
                        names.add(name); yield value
            except ValueError:
                raise RuntimeError('Malformed project systemd Environment directive')
        for match in assignment.finditer(line) if config else []:
            if secret_name(match['name']) and actual_value(match['value']):
                names.add(match['name']); yield match['value']
        for pattern in raw_patterns:
            yield from (match[0] for match in pattern.finditer(line) if actual_value(match[0]))

texts = {}
archives = []
for path in files:
    if path.stat().st_size > 64 * 1024 * 1024:
        raise RuntimeError('Oversized project file requires explicit review; bot remains stopped')
    data = path.read_bytes()
    if path.name.endswith(('.tgz', '.tar.gz', '.tar', '.zip', '.gz')):
        archives.append(path)
        continue
    text = text_of(data)
    if text is not None:
        texts[path] = text
        known.update(literals(text, config_file(path)))
    counts['scanned_files'] += 1

def redact(text, config=False):
    output = []
    for line in text.splitlines(keepends=True):
        match = env_assignment.match(line.rstrip('\r\n'))
        if config and match and protected_name(match[1]):
            output.append(line); continue
        if line.lstrip().startswith('Environment='):
            items = shlex.split(line.split('=', 1)[1])
            keep = [item for item in items if not secret_name(item.partition('=')[0]) and item.partition('=')[0] not in provider_names]
            if len(keep) != len(items):
                output.append('Environment=' + ' '.join(json.dumps(item, ensure_ascii=False) for item in keep) + '\n' if keep else '')
                continue
        if config and match and (secret_name(match[1]) or match[1] in provider_names):
            names.add(match[1]); continue
        if config:
            line = assignment.sub(lambda m: m[0].replace(m['value'], '', 1) if secret_name(m['name']) else m[0], line)
        for value in sorted(known, key=len, reverse=True):
            line = line.replace(value, '[REVOKED]')
        for pattern in raw_patterns:
            line = pattern.sub(lambda m: '[REVOKED]' if actual_value(m[0]) else m[0], line)
        output.append(line)
    return ''.join(output)

for path, text in texts.items():
    cleaned = redact(text, config_file(path))
    if cleaned != text:
        # Existing file permissions/ownership stay intact; no secret backup is made.
        path.write_bytes(cleaned.encode('utf-8', errors='surrogateescape'))
        counts['changed_files'] += 1

def unsafe_archive(path):
    if path.name.endswith('.gz') and not path.name.endswith(('.tar.gz', '.tgz')):
        import gzip
        chunks = [(path.name[:-3], gzip.open(path, 'rb').read(64 * 1024 * 1024 + 1))]
    elif path.name.endswith('.zip'):
        with zipfile.ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > 64 * 1024 * 1024:
                raise RuntimeError('Oversized project archive requires explicit review')
            chunks = [(info.filename, archive.read(info)) for info in archive.infolist() if not info.is_dir()]
    else:
        with tarfile.open(path) as archive:
            members = [info for info in archive.getmembers() if info.isfile()]
            if sum(info.size for info in members) > 64 * 1024 * 1024:
                raise RuntimeError('Oversized project archive requires explicit review')
            chunks = [(info.name, archive.extractfile(info).read()) for info in members]
    for filename, data in chunks:
        if len(data) > 64 * 1024 * 1024:
            raise RuntimeError('Oversized project archive requires explicit review')
        text = text_of(data)
        if text is not None and (any(value in text for value in known) or any(literals(text, config_file(Path(filename))))):
            return True
    return False

for path in archives:
    if unsafe_archive(path):
        path.unlink(); counts['removed_archives'] += 1
for filename in ['/tmp/investor-api.env', '/tmp/investor-bot.env']:
    p = local(filename)
    if p.is_file() and not p.is_symlink():
        p.unlink(); counts['removed_temp_env'] += 1

api = local('/etc/investor-api')
api.mkdir(parents=True, exist_ok=True)
os.chmod(api, 0o700)
marker = api / 'API_KEYS_DISABLED'
marker.write_text('All project API keys and Telegram token disabled.\n')
os.chmod(marker, 0o600)
env_file = api / 'api.env'
text = env_file.read_text() if env_file.exists() else ''
text = ''.join(line for line in text.splitlines(keepends=True) if not re.match(r'^\s*DEMO_MODE\s*=', line))
env_file.write_text(text.rstrip('\n') + '\nDEMO_MODE=1\n')
os.chmod(env_file, 0o600)
dropin = local('/etc/systemd/system/investor-api.service.d/90-api-keys-disabled.conf')
dropin.parent.mkdir(parents=True, exist_ok=True)
unset = sorted(names | {'OPENAI_API_KEY', 'OPENAI_KEY', 'CHATGPT_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'BOT_TELEGRAM_TOKEN', 'TELEGRAM_BOT_TOKEN', 'BOT_TOKEN', 'LLM_PROVIDER', 'AI_PROVIDER'})
dropin.write_text('[Service]\nEnvironment=DEMO_MODE=1\nUnsetEnvironment=' + ' '.join(name for name in unset if re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', name)) + '\n')
os.chmod(dropin, 0o644)
# Verify current text files after redaction, without displaying their content.
for path in texts:
    if path.exists() and any(literals(path.read_bytes().decode('utf-8', errors='surrogateescape'), config_file(path))):
        raise RuntimeError('Project credential verification failed; bot remains disabled')
print(json.dumps({'credential_names_removed': sorted(names), **counts}, ensure_ascii=False))
PY
if [ -n "$test_root" ]; then exit 0; fi
systemctl daemon-reload
if [ "$(systemctl show investor-api -p LoadState --value 2>/dev/null)" != not-found ]; then
  systemctl restart investor-api
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 http://127.0.0.1:8080/api/health | python3 -c 'import json,sys; assert json.load(sys.stdin).get("mode")=="demo"'; then break; fi
    [ "$attempt" != 20 ] || exit 1
    sleep 1
  done
fi
if [ "$(systemctl show fightinvestor -p LoadState --value 2>/dev/null)" != not-found ]; then systemctl restart fightinvestor; fi
if systemctl is-active --quiet investor-bot; then echo 'Bot is unexpectedly active after purge.' >&2; exit 1; fi
echo 'Project credentials removed from scoped server files; bot disabled; API uses demo. Provider revocation is separate.'
