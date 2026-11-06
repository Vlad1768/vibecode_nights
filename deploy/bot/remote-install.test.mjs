import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const installer = readFileSync(join(repository, 'deploy/bot/remote-install.sh'), 'utf8').replaceAll('\r\n', '\n');
const connector = readFileSync(join(repository, 'deploy/web/remote-bot.sh'), 'utf8').replaceAll('\r\n', '\n');
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const functions = (source, name) => {
  const found = source.match(new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n[\\s\\S]*?^\\}`, 'm'));
  assert.ok(found, `Missing shell function: ${name}`);
  return found[0];
};
const shellPath = (path) => path.replaceAll('\\', '/');
function fixture(t) {
  const scratch = join(repository, 'work');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'deployment-config-test-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(scratch) + (process.platform === 'win32' ? '\\' : '/')));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function run(source, args = []) {
  const python = process.platform === 'win32' ? 'python3() { command python "$@"; }\n' : '';
  return spawnSync(bash, ['--noprofile', '--norc', '-c', python + source, 'deployment-test', ...args.map(shellPath)], { encoding: 'utf8' });
}

test('deployment keeps server-only settings and keys when incoming values are empty', (t) => {
  const root = fixture(t), old = join(root, 'old.env'), incoming = join(root, 'incoming.env');
  writeFileSync(old, '# preserved comment\nAI_PROVIDER=openai\nDEMO_MODE=0\nAI_FALLBACK=off\nOPENAI_API_KEY=dummy-old-key\nOPENAI_MODEL=gpt-6.1-sol\nCONTENT_FILE=custom/content.json\nDATA_DIR=/var/lib/custom\nOTHER="custom setting"\n');
  writeFileSync(incoming, 'NODE_ENV=production\nOPENAI_API_KEY=\nOPENAI_MODEL=\nGEMINI_API_KEY=dummy-media-key\n');
  const result = run(`set -euo pipefail\n${functions(installer, 'merge_env')}\nmerge_env "$1" "$2"`, [old, incoming]);
  assert.equal(result.status, 0, result.stderr);
  const merged = readFileSync(incoming, 'utf8');
  for (const line of readFileSync(old, 'utf8').trimEnd().split('\n')) assert.ok(merged.includes(line + '\n'), line);
  assert.ok(merged.includes('NODE_ENV=production\n'));
  assert.ok(merged.includes('GEMINI_API_KEY=dummy-media-key\n'));
  assert.equal(result.stdout, '');
});

test('deployment preserves the bot media key instead of copying a different API key', (t) => {
  const root = fixture(t), old = join(root, 'bot.env'), incoming = join(root, 'incoming.env'), api = join(root, 'api.env');
  writeFileSync(old, 'GEMINI_API_KEY=dummy-bot-media-key\nBOT_TELEGRAM_TOKEN=dummy-bot-token\n');
  writeFileSync(api, 'GEMINI_API_KEY=dummy-other-api-key\n');
  writeFileSync(incoming, 'GEMINI_API_KEY=\nBOT_TELEGRAM_TOKEN=\n');
  const helpers = ['merge_env', 'env_value', 'fill_key'].map((name) => functions(installer, name)).join('\n')
    .replaceAll('/etc/investor-api/api.env', '"$API_FALLBACK_ENV"');
  const result = run(`set -euo pipefail\nAPI_FALLBACK_ENV="$3"\n${helpers}\nmerge_env "$1" "$2"\nfill_key "$2"`, [old, incoming, api]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(incoming, 'utf8'), readFileSync(old, 'utf8'));
  assert.equal(result.stdout, '');
});

for (const external of [0, 1]) test(`failed deployment restores code, env and actual units (external API=${external})`, (t) => {
  const root = fixture(t), etc = join(root, 'etc'), app = join(root, 'app'), backup = join(root, 'backup');
  mkdirSync(join(etc, 'investor-bot'), { recursive: true });
  mkdirSync(join(etc, 'investor-api'), { recursive: true });
  mkdirSync(join(etc, 'systemd/system'), { recursive: true });
  mkdirSync(backup);
  mkdirSync(app); mkdirSync(app + '.prev');
  writeFileSync(join(app, 'version'), 'new code'); writeFileSync(join(app + '.prev', 'version'), 'old code');
  const entries = [
    ['investor-bot/bot.env', 'bot.env'], ['systemd/system/investor-bot.service', 'bot.service'],
    ['investor-api/api.env', 'api.env'], ['systemd/system/investor-api.service', 'api.service'],
  ];
  for (const [file, name] of entries) {
    writeFileSync(join(etc, file), 'new ' + name);
    writeFileSync(join(backup, name), 'old ' + name);
  }
  const rollback = functions(installer, 'rollback')
    .replaceAll('/etc/investor-bot/bot.env', '"$TEST_ROOT/etc/investor-bot/bot.env"')
    .replaceAll('/etc/systemd/system/investor-bot.service', '"$TEST_ROOT/etc/systemd/system/investor-bot.service"')
    .replaceAll('/etc/investor-api/api.env', '"$TEST_ROOT/etc/investor-api/api.env"');
  const strictMode = installer.match(/^set -[A-Za-z]+ pipefail$/m)?.[0];
  assert.match(strictMode, /-[A-Za-z]*E/, 'ERR traps must be inherited by functions');
  const source = `${strictMode}\nTEST_ROOT="$1"\nAPP_DIR="$1/app"\nCONFIG_BACKUP="$1/backup"\nAPI_UNIT="$1/etc/systemd/system/investor-api.service"\nEXTERNAL_API=${external}\nCODE_CHANGED=1\nlog() { :; }\nsystemctl() { printf '%s\\n' "$*" >> "$TEST_ROOT/services.log"; }\n${functions(installer, 'restore_config')}\n${rollback}\ntrap rollback ERR\ninstall_units() { false; }\ninstall_units`;
  const result = run(source, [root]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(readFileSync(join(app, 'version'), 'utf8'), 'old code');
  for (const [file, name] of entries) {
    const isApi = name.startsWith('api.');
    assert.equal(readFileSync(join(etc, file), 'utf8'), (external && isApi ? 'new ' : 'old ') + name);
  }
  assert.ok(existsSync(join(app + '.failed', 'version')));
  assert.equal(readFileSync(join(root, 'services.log'), 'utf8').includes('restart investor-api'), !external);
});

test('Gemini-only connect stops before replacing selected OpenAI configuration', (t) => {
  const root = fixture(t), env = join(root, 'api.env');
  for (const content of ['LLM_PROVIDER=openai\n', 'AI_PROVIDER=openai\n', 'OPENAI_API_KEY=dummy-secret-not-for-output\n']) {
    writeFileSync(env, content);
    const result = run(`set -euo pipefail\nenv_file="$1"\n${functions(connector, 'require_gemini_install')}\nrequire_gemini_install`, [env]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /OpenAI is already configured/);
    assert.ok(!result.stderr.includes('dummy-secret'));
    assert.equal(readFileSync(env, 'utf8'), content);
  }
  writeFileSync(env, 'GEMINI_API_KEY=dummy-key\n');
  const result = run(`set -euo pipefail\nenv_file="$1"\n${functions(connector, 'require_gemini_install')}\nrequire_gemini_install`, [env]);
  assert.equal(result.status, 0, result.stderr);
});
