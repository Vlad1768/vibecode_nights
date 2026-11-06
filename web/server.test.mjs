import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, MODEL } from './server.mjs';
import { CRITERIA } from './demo.mjs';

const question = (n = 1) => ({ title: `Тема ${n}`, text: `Как вы проверили гипотезу ${n}?`, hint: 'Приведите подтверждённый факт.' });
const questionOutput = (request, n = 1) => request.schema.properties.accepted
  ? { accepted: true, reason: '', question: question(n) }
  : question(n);
const result = () => ({
  summary: 'Проблема описана, но спрос ещё нужно проверить.', score: 999, maxScore: 999,
  criteria: CRITERIA.map((name, i) => ({ name, score: i, comment: `Обоснование ${i}.` })),
  tips: [1, 2, 3].map((i) => ({ title: `Шаг ${i}`, text: `Проведите проверку ${i} за два дня.` })),
});
function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    async generateJSON(request) {
      calls.push(request);
      return { data: await (handler ? handler(request, calls.length) : request.schema.properties.criteria ? result() : questionOutput(request, calls.length)) };
    },
  };
}
async function fixture(t, options = {}) {
  const client = Object.hasOwn(options, 'client') ? options.client : fakeClient();
  const server = createApp({ ...options, client });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  async function post(path, body, cookie, headers = {}) {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: JSON.stringify(body),
    });
    return { response, status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function start(pitch = 'Сервис записи студентов на свободные места для учёбы.') { return post('/api/session', { pitch }); }
  return { base, client, post, start };
}

test('health reports configuration without disclosing keys; absent key returns a safe error', async (t) => {
  const f = await fixture(t, { client: null });
  assert.deepEqual(await (await fetch(`${f.base}/api/health`)).json(), { ready: false, model: MODEL });
  const reply = await f.start();
  assert.equal(reply.status, 503);
  assert.equal(reply.body.error.code, 'CONFIG');
  assert.equal(reply.cookie, undefined);
});

test('static whitelist serves app files and never server/source/env files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'investor-web-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<h1>Инвестор</h1>');
  await writeFile(join(directory, '.env'), 'PRIVATE');
  await writeFile(join(directory, 'server.mjs'), 'SERVER SOURCE');
  const f = await fixture(t, { staticRoot: directory });
  const home = await fetch(f.base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /Инвестор/);
  for (const path of ['/.env', '/server.mjs', '/server.test.mjs', '/integrations/gemini/client.mjs', '/%2e%2e/.env']) {
    const response = await fetch(f.base + path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /PRIVATE|SERVER SOURCE/);
  }
});

test('five adaptive questions produce ten scored criteria and three tips; server recomputes total', async (t) => {
  const f = await fixture(t);
  const start = await f.start('Наш проект снижает время ожидания. Пока это гипотеза.');
  assert.equal(start.status, 201);
  assert.equal(start.body.step, 1);
  assert.equal(start.body.totalSteps, 5);
  assert.ok(start.response.headers.get('set-cookie').includes(`HttpOnly; SameSite=Strict; Path=/api/session/${start.body.sessionId}`));
  let reply;
  for (let step = 1; step <= 5; step += 1) {
    reply = await f.post(`/api/session/${start.body.sessionId}/answer`, { step, answer: `Ответ ${step}: данных пока мало.` }, start.cookie);
    assert.equal(reply.status, 200);
    if (step < 5) assert.equal(reply.body.step, step + 1);
  }
  assert.equal(reply.body.done, true);
  assert.equal(reply.body.result.criteria.length, 10);
  assert.equal(reply.body.result.tips.length, 3);
  assert.equal(reply.body.result.score, 45);
  assert.equal(reply.body.result.maxScore, 100);
  assert.equal(f.client.calls.length, 6);
  assert.match(f.client.calls[1].prompt, /Ответ 1/);
  assert.match(f.client.calls[4].prompt, /Ответ 4/);
  assert.match(f.client.calls[5].prompt, /Ответ 5/);
  assert.match(f.client.calls[0].system, /НЕДОВЕРЕННЫЕ ДАННЫЕ/);
  assert.match(f.client.calls[0].system, /не оскорбляй человека/);
});

test('knowing a session id cannot access another browser session', async (t) => {
  const f = await fixture(t);
  const alice = await f.start('Питч Алисы');
  const bob = await f.start('Питч Боба');
  assert.notEqual(alice.cookie, bob.cookie);
  const path = `/api/session/${alice.body.sessionId}/answer`;
  for (const cookie of [undefined, bob.cookie, 'investor_session=wrong']) {
    const reply = await f.post(path, { step: 1, answer: 'Чужой ответ' }, cookie);
    assert.equal(reply.status, 404);
  }
  assert.equal(f.client.calls.length, 2);
  assert.equal((await f.post(path, { step: 1, answer: 'Мой ответ' }, alice.cookie)).status, 200);
});

test('provider quota failure preserves the step and retry; successful duplicate is idempotent', async (t) => {
  const client = fakeClient((request, count) => {
    if (count === 2) throw Object.assign(new Error('secret-provider-body-key-123'), { code: 'QUOTA' });
    return questionOutput(request, count);
  });
  const f = await fixture(t, { client });
  const start = await f.start();
  const path = `/api/session/${start.body.sessionId}/answer`;
  const body = { step: 1, answer: 'Первый ответ' };
  const failed = await f.post(path, body, start.cookie);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, 'QUOTA');
  assert.doesNotMatch(JSON.stringify(failed.body), /secret-provider/);
  const retried = await f.post(path, body, start.cookie);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.step, 2);
  const repeated = await f.post(path, body, start.cookie);
  assert.deepEqual(repeated.body, retried.body);
  assert.equal(client.calls.length, 3);
  const changed = await f.post(path, { step: 1, answer: 'Другой ответ' }, start.cookie);
  assert.equal(changed.status, 409);
  assert.equal(client.calls.length, 3);
});

test('malformed final result cannot advance the round and can be retried', async (t) => {
  let finalCalls = 0;
  const client = fakeClient((request) => {
    if (!request.schema.properties.criteria) return questionOutput(request);
    finalCalls += 1;
    const value = result();
    if (finalCalls === 1) value.criteria[9].name = value.criteria[0].name;
    return value;
  });
  const f = await fixture(t, { client });
  const start = await f.start();
  const path = `/api/session/${start.body.sessionId}/answer`;
  for (let step = 1; step <= 4; step += 1) assert.equal((await f.post(path, { step, answer: `Ответ ${step}` }, start.cookie)).status, 200);
  const failed = await f.post(path, { step: 5, answer: 'Последний ответ' }, start.cookie);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, 'RESPONSE');
  const retried = await f.post(path, { step: 5, answer: 'Последний ответ' }, start.cookie);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.done, true);
  assert.equal(finalCalls, 2);
});

test('origin, JSON content type, body limits and step bounds reject before generation', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.post('/api/session', { pitch: 'Проект' }, null, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await f.post('/api/session', { pitch: 'Проект' }, null, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await f.post('/api/session', { pitch: ' ' })).status, 400);
  assert.equal((await f.post('/api/session', { pitch: 'a'.repeat(4001) })).status, 400);
  assert.equal((await f.post('/api/session', { pitch: 'a'.repeat(40000) })).status, 413);
  assert.equal(f.client.calls.length, 0);
  const start = await f.start();
  const path = `/api/session/${start.body.sessionId}/answer`;
  assert.equal((await f.post(path, { step: 0, answer: 'Ответ' }, start.cookie)).status, 400);
  assert.equal((await f.post(path, { step: 6, answer: 'Ответ' }, start.cookie)).status, 400);
  assert.equal((await f.post(path, { step: 2, answer: 'Ответ' }, start.cookie)).status, 409);
  assert.equal((await f.post(path, { step: 1, answer: 'a'.repeat(2001) }, start.cookie)).status, 400);
  assert.equal(f.client.calls.length, 1);
});

test('session TTL and capacity are enforced and expired entries are reclaimed', async (t) => {
  let time = 0;
  const f = await fixture(t, { now: () => time, sessionTtlMs: 100, maxSessions: 1 });
  const start = await f.start();
  assert.equal((await f.start()).status, 503);
  time = 101;
  const expired = await f.post(`/api/session/${start.body.sessionId}/answer`, { step: 1, answer: 'Ответ' }, start.cookie);
  assert.equal(expired.status, 404);
  assert.equal((await f.start()).status, 201);
});

test('rate limits stop extra calls and expire; limiter memory is bounded', async (t) => {
  let time = 0;
  const f = await fixture(t, { now: () => time, rateLimit: 2, rateWindowMs: 100, maxRateEntries: 1 });
  assert.equal((await f.start()).status, 201);
  assert.equal((await f.start()).status, 201);
  assert.equal((await f.start()).status, 429);
  assert.equal(f.client.calls.length, 2);
  assert.equal((await f.post('/api/session', { pitch: 'Проект' }, null, { 'X-Forwarded-For': '192.0.2.10' })).status, 503);
  time = 101;
  assert.equal((await f.post('/api/session', { pitch: 'Проект' }, null, { 'X-Forwarded-For': '192.0.2.10' })).status, 201);
});

test('concurrent submission of one step cannot consume it twice', async (t) => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const client = fakeClient(async (request, count) => {
    if (count === 2) { entered(); await blocked; }
    return questionOutput(request, count);
  });
  const f = await fixture(t, { client });
  const start = await f.start();
  const path = `/api/session/${start.body.sessionId}/answer`;
  const body = { step: 1, answer: 'Ответ' };
  const first = f.post(path, body, start.cookie);
  await enteredPromise;
  const concurrent = await f.post(path, body, start.cookie);
  assert.equal(concurrent.status, 409);
  assert.equal(concurrent.body.error.code, 'IN_PROGRESS');
  release();
  const completed = await first;
  assert.equal(completed.body.step, 2);
  assert.equal(client.calls.length, 2);
});

test('global concurrency permits at most two Gemini generations', async (t) => {
  const releases = [];
  let entered;
  const bothEntered = new Promise((resolve) => { entered = resolve; });
  const client = fakeClient(async (request) => {
    await new Promise((resolve) => {
      releases.push(resolve);
      if (releases.length === 2) entered();
    });
    return questionOutput(request);
  });
  const f = await fixture(t, { client });
  const pending = [f.start(), f.start()];
  await bothEntered;
  const busy = await f.start();
  assert.equal(busy.status, 503);
  assert.equal(busy.body.error.code, 'BUSY');
  assert.equal(client.calls.length, 2);
  releases.forEach((release) => release());
  assert.deepEqual((await Promise.all(pending)).map((reply) => reply.status), [201, 201]);
});

test('HTTPS behind loopback proxy gets Secure cookies and correct origin validation', async (t) => {
  const f = await fixture(t);
  const reply = await f.post('/api/session', { pitch: 'Проект' }, null, { Origin: f.base.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https' });
  assert.equal(reply.status, 201);
  assert.match(reply.response.headers.get('set-cookie'), /; Secure$/);
});

test('semantically empty non-pitch is rejected before a session, question count or score exists', async (t) => {
  const client = fakeClient((request, count) => count === 1
    ? { accepted: false, reason: 'Опишите проект в сообщении: проблему, пользователя и решение.', question: null }
    : questionOutput(request));
  const f = await fixture(t, { client, maxSessions: 1 });
  const rejected = await f.start('Описание и все цифры в презентации, прикрепила файлом.');
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error.code, 'INVALID_PITCH');
  assert.match(rejected.body.error.message, /Опишите проект/);
  assert.equal(rejected.body.sessionId, undefined);
  assert.equal(rejected.body.question, undefined);
  assert.equal(rejected.body.result, undefined);
  assert.equal(rejected.cookie, undefined);
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].system, /не начинай раунд и не оценивай/);
  assert.ok(client.calls[0].schema.properties.accepted);
  // Refusal must not consume the one available session slot.
  assert.equal((await f.start()).status, 201);
});

test('two concurrent first sessions keep independent cookie names and both remain usable', async (t) => {
  const releases = [];
  let entered;
  const bothEntered = new Promise((resolve) => { entered = resolve; });
  const client = fakeClient(async (request) => {
    if (request.schema.properties.accepted) {
      await new Promise((resolve) => {
        releases.push(resolve);
        if (releases.length === 2) entered();
      });
    }
    return questionOutput(request);
  });
  const f = await fixture(t, { client });
  const pending = [f.start('Первый проект'), f.start('Второй проект')];
  await bothEntered;
  releases[1]();
  const second = await pending[1];
  releases[0]();
  const first = await pending[0];
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.cookie.split('=')[0], second.cookie.split('=')[0]);
  for (const reply of [first, second]) {
    assert.ok(reply.cookie.startsWith(`investor_session_${reply.body.sessionId}=`));
    assert.ok(reply.response.headers.get('set-cookie').includes(`Path=/api/session/${reply.body.sessionId};`));
  }
  // Simulate both Set-Cookie responses stored in the same browser.
  const cookies = `${second.cookie}; ${first.cookie}`;
  for (const reply of [first, second]) {
    assert.equal((await f.post(`/api/session/${reply.body.sessionId}/answer`, { step: 1, answer: 'Мой ответ' }, cookies)).status, 200);
  }
});

test('successful activity refreshes cookie lifetime together with sliding session TTL', async (t) => {
  let time = 0;
  const f = await fixture(t, { now: () => time });
  const start = await f.start();
  let cookie = start.cookie;
  let browserExpiry = time + Number(start.response.headers.get('set-cookie').match(/Max-Age=(\d+)/)[1]) * 1000;
  const path = `/api/session/${start.body.sessionId}/answer`;
  time = 59 * 60 * 1000;
  const first = await f.post(path, { step: 1, answer: 'Первый ответ' }, time < browserExpiry ? cookie : undefined);
  assert.equal(first.status, 200);
  assert.ok(first.cookie);
  cookie = first.cookie;
  browserExpiry = time + Number(first.response.headers.get('set-cookie').match(/Max-Age=(\d+)/)[1]) * 1000;
  time = 61 * 60 * 1000;
  const next = await f.post(path, { step: 2, answer: 'Второй ответ' }, time < browserExpiry ? cookie : undefined);
  assert.equal(next.status, 200);
  assert.equal(next.body.step, 3);
  assert.ok(next.response.headers.get('set-cookie'));
  const replay = await f.post(path, { step: 2, answer: 'Второй ответ' }, next.cookie);
  assert.deepEqual(replay.body, next.body);
  assert.ok(replay.response.headers.get('set-cookie'));
});
