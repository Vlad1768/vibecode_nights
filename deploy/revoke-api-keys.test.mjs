import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('bounded purge clears synthetic credentials and keeps source placeholders, SSH and cookie material', () => {
  const base = resolve('work');
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'purge-test-'));
  const secret = 'sk-proj-' + 'A1b2C3d4'.repeat(6);
  const telegram = '123456789:' + 'Z9y8X7w6'.repeat(5);
  const put = (path, text) => {
    const full = join(root, path);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, text);
    return full;
  };
  try {
    const api = put('etc/investor-api/api.env', `OPENAI_API_KEY=${secret}\nGEMINI_API_KEY=synthetic-gemini-credential\nLLM_PROVIDER=openai\nDEMO_MODE=0\nDATA_DIR=/var/lib/custom\n`);
    put('etc/investor-bot/bot.env', `BOT_TELEGRAM_TOKEN=${telegram}\nSITE_SERVER_PASSWORD=synthetic-ssh-password\n`);
    put('etc/fightinvestor-gateway.env', 'WEB_COOKIE_SECRET=synthetic-cookie-secret-preserve\n');
    put('var/backups/fightinvestor-old/api.env', `OPENAI_KEY=${secret}\n`);
    put('opt/investor-bot.prev/.env.local', `DEEPSEEK_API_KEY=${secret}\n`);
    put('etc/systemd/system/investor-api.service', `[Service]\nEnvironment="PORT=8080" "OPENAI_API_KEY=${secret}"\n`);
    put('var/log/investor-api.log', `old Authorization Bearer ${secret}; telegram bot${telegram}/getMe\n`);
    put('etc/fightinvestor-tunnel/id_ed25519', 'synthetic-private-ssh-key-preserve');
    const source = "const x = { apiKey: 'test-key' };\nconst OPENAI_API_KEY = '${process.env.VALUE}';\n";
    put('opt/investor-bot/source.mjs', source);
    put('opt/investor-bot/.env.example', 'OPENAI_API_KEY=your-api-key-here\n');
    const archive = join(root, 'var/backups/fightinvestor-old/credentials.zip');
    const cleanArchive = join(root, 'var/backups/fightinvestor-old/clean.zip');
    const python = process.platform === 'win32' ? 'python' : 'python3';
    for (const [zip, file] of [[archive, api], [cleanArchive, join(root, 'opt/investor-bot/source.mjs')]]) {
      const result = spawnSync(python, ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],sys.argv[3]); z.close()', zip, file, zip === archive ? 'api.env' : 'source.mjs'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
    const pythonShim = process.platform === 'win32' ? 'python3() { command python "$@"; }; ' : '';
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', pythonShim + 'export API_KEY_PURGE_TEST=1; source deploy/revoke-api-keys.sh --test-root "$1"', 'test', root.replaceAll('\\', '/')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const path of ['etc/investor-api/api.env', 'etc/investor-bot/bot.env', 'var/backups/fightinvestor-old/api.env', 'opt/investor-bot.prev/.env.local', 'etc/systemd/system/investor-api.service', 'var/log/investor-api.log']) {
      const text = readFileSync(join(root, path), 'utf8');
      assert.ok(!text.includes(secret) && !text.includes(telegram), path);
    }
    assert.match(readFileSync(api, 'utf8'), /DEMO_MODE=1/);
    assert.match(readFileSync(api, 'utf8'), /DATA_DIR=\/var\/lib\/custom/);
    assert.match(readFileSync(join(root, 'etc/investor-bot/bot.env'), 'utf8'), /synthetic-ssh-password/);
    assert.match(readFileSync(join(root, 'etc/fightinvestor-gateway.env'), 'utf8'), /synthetic-cookie-secret-preserve/);
    assert.equal(readFileSync(join(root, 'etc/fightinvestor-tunnel/id_ed25519'), 'utf8'), 'synthetic-private-ssh-key-preserve');
    assert.equal(readFileSync(join(root, 'opt/investor-bot/source.mjs'), 'utf8'), source);
    assert.match(readFileSync(join(root, 'opt/investor-bot/.env.example'), 'utf8'), /your-api-key-here/);
    assert.ok(!existsSync(archive));
    assert.ok(existsSync(cleanArchive));
    assert.ok(existsSync(join(root, 'etc/investor-api/API_KEYS_DISABLED')));
    assert.ok(!result.stdout.includes(secret) && !result.stdout.includes(telegram));
  } finally {
    const separator = process.platform === 'win32' ? '\\' : '/';
    assert.ok(root.startsWith(base + separator));
    rmSync(root, { recursive: true, force: true });
  }
});
