import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelegram, splitText, TelegramError } from '../src/telegram.mjs';
import { createHttpApi } from '../src/api/http.mjs';
import { loadConfig } from '../src/config.mjs';

const TOKEN = '123456:SYNTHETIC-test-token';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('ошибки Telegram не содержат токен', async () => {
  const tg = createTelegram({ token: TOKEN, fetchImpl: async () => json(401, { ok: false, error_code: 401, description: 'Unauthorized' }) });
  const err = await tg.getUpdates(0, 1).catch((e) => e);
  assert.ok(err instanceof TelegramError);
  assert.equal(err.code, 401);
  assert.ok(!err.message.includes(TOKEN));

  const tgNet = createTelegram({ token: TOKEN, fetchImpl: async () => { throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/x`); } });
  const netErr = await tgNet.getUpdates(0, 1).catch((e) => e);
  assert.equal(netErr.code, 'NETWORK');
  assert.ok(!netErr.message.includes(TOKEN));
});

test('длинный ответ делится на части в пределах лимита Telegram', () => {
  const text = Array.from({ length: 300 }, (_, i) => `Строка ${i} ${'x'.repeat(30)}`).join('\n');
  const parts = splitText(text, 4096);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= 4096);
  assert.equal(parts.join('\n').replace(/\n+/g, '\n'), text);
  assert.deepEqual(splitText('коротко'), ['коротко']);
});

test('sendMessage отправляет каждую часть', async () => {
  const sent = [];
  const tg = createTelegram({
    token: TOKEN,
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return json(200, { ok: true, result: {} }); },
  });
  await tg.sendMessage(42, 'a'.repeat(5000));
  assert.equal(sent.length, 2);
  assert.ok(sent.every((b) => b.chat_id === 42));
});

test('HTTP API: шаг, итог и коды ошибок', async () => {
  const calls = [];
  const replies = [
    json(200, { sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    json(200, { sessionId: 's1', done: true, result: { criteria: [], total: 0, max: 100, advice: [] } }),
    json(422, { error: { code: 'EMPTY_PITCH', message: 'empty' } }),
    json(503, {}),
    json(200, { unexpected: true }),
  ];
  const api = createHttpApi({
    baseUrl: 'https://api.example.test',
    fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body)]); return replies.shift(); },
  });
  assert.equal((await api.start({ userId: 'tg:1', pitch: 'p' })).question, 'Q1');
  assert.equal((await api.answer({ sessionId: 's1', userId: 'tg:1', answer: 'a' })).done, true);
  await assert.rejects(api.start({ userId: 'tg:1', pitch: '' }), { code: 'EMPTY_PITCH', retryable: false });
  await assert.rejects(api.start({ userId: 'tg:1', pitch: 'p' }), { code: 'AI_UNAVAILABLE', retryable: true });
  await assert.rejects(api.start({ userId: 'tg:1', pitch: 'p' }), { code: 'BAD_RESPONSE' });
  assert.equal(calls[0][0], 'https://api.example.test/api/sessions');
  assert.equal(calls[1][0], 'https://api.example.test/api/sessions/s1/answers');
  assert.deepEqual(calls[1][1], { userId: 'tg:1', answer: 'a' });
});

test('HTTP API: недоступный сервер — повторяемая ошибка NETWORK', async () => {
  const api = createHttpApi({ baseUrl: 'https://x.test', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(api.start({ userId: 'tg:1', pitch: 'p' }), { code: 'NETWORK', retryable: true });
});

test('конфиг: без TRAINER_API_URL — заглушка, токен только из окружения', () => {
  assert.equal(loadConfig({}).apiMode, 'mock');
  assert.equal(loadConfig({}).token, '');
  const c = loadConfig({ BOT_TELEGRAM_TOKEN: ' t ', TRAINER_API_URL: 'https://api.test/', BOT_HEALTH_PORT: '8081' });
  assert.equal(c.token, 't');
  assert.equal(c.apiMode, 'http');
  assert.equal(c.apiBaseUrl, 'https://api.test');
  assert.equal(c.healthPort, 8081);
});
