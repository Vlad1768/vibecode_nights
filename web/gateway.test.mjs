import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createGateway } from './gateway.mjs';
import { createApp } from '../server/index.mjs';

const secret = 'test-secret-for-signed-web-identities-at-least-32';
const pitch = 'StudySpot — сервис бронирования тихих мест для учёбы студентам. Кафе платят комиссию за бронирования. Провели 15 интервью и получили 3 заявки на пилот.';
async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture(t, settings = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'investor-gateway-'));
  const app = createApp({ DATA_DIR: dataDir, DEMO_MODE: '1', AI_FALLBACK: 'off' });
  t.after(async () => { app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const upstream = await listen(t, createServer(app.handler));
  const base = await listen(t, createGateway({ upstream, cookieSecret: secret, ...settings }));
  const clientTag = randomUUID();
  async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method, headers: { Origin: base, 'Content-Type': 'application/json', 'X-Web-Client': clientTag, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return { status: response.status, response, body: response.status === 204 ? null : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const start = (extra = {}, cookie) => request('/api/sessions', { method: 'POST', body: { pitch, ...extra }, cookie });
  return { base, upstream, request, start, clientTag };
}

test('gateway uses shared core for all five questions, scoring, replay, recovery and second round', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/health')).body, { ok: true, mode: 'demo', version: '1.0' });
  assert.ok((await f.request('/api/persona')).body.name);
  const first = await f.start();
  assert.equal(first.status, 201);
  assert.equal(first.body.step, 1);
  assert.equal(first.body.demo, true);
  assert.ok(first.body.facts);
  assert.match(first.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/api;/);
  const sessionPath = `/api/sessions/${first.body.sessionId}`;
  let reply;
  for (let step = 1; step <= 5; step++) {
    const body = { step, answer: `Проверили ${step + 5} гипотез. Пока продажи не подтверждены.` };
    reply = await f.request(sessionPath + '/answers', { method: 'POST', body, cookie: first.cookie });
    assert.equal(reply.status, 200);
    const replay = await f.request(sessionPath + '/answers', { method: 'POST', body, cookie: first.cookie });
    assert.deepEqual(replay.body, reply.body);
  }
  assert.equal(reply.body.done, true);
  assert.equal(reply.body.result.criteria.length, 10);
  assert.equal(reply.body.result.advice.length, 3);
  assert.equal(reply.body.result.max, 100);
  assert.ok(reply.body.result.criteria.every((item) => item.level >= 0 && item.level <= 3 && item.max === item.weight));
  assert.deepEqual((await f.request(sessionPath, { cookie: first.cookie })).body, reply.body);
  const second = await f.start({ previousSessionId: first.body.sessionId }, first.cookie);
  assert.equal(second.status, 201);
  assert.equal(second.body.round, 2);
});

test('browser cannot impersonate another browser or a Telegram user via body/query/cookie', async (t) => {
  const f = await fixture(t);
  const a = await f.start({ userId: 'tg:1234' });
  const b = await f.start({ userId: 'tg:1234' });
  const path = `/api/sessions/${a.body.sessionId}`;
  assert.equal((await f.request(path, { cookie: b.cookie })).status, 404);
  assert.equal((await f.request(path + '?userId=tg:1234', { cookie: b.cookie })).status, 404);
  assert.equal((await f.request(path)).status, 404);
  assert.equal((await f.request(path, { cookie: a.cookie.slice(0, -1) + (a.cookie.endsWith('a') ? 'b' : 'a') })).status, 404);
  assert.equal((await f.request(path + '/answers', { method: 'POST', cookie: b.cookie, body: { userId: 'tg:1234', step: 1, answer: 'подмена' } })).status, 404);
  assert.equal((await f.start({ previousSessionId: a.body.sessionId }, b.cookie)).status, 404);
});

test('signed identity survives gateway restart; expiration rejects access', async (t) => {
  let timestamp = Date.now();
  const f = await fixture(t, { now: () => timestamp });
  const a = await f.start();
  const restartedBase = await listen(t, createGateway({ upstream: f.upstream, cookieSecret: secret, now: () => timestamp }));
  assert.equal((await fetch(restartedBase + '/api/sessions/' + a.body.sessionId, { headers: { Cookie: a.cookie, 'X-Web-Client': f.clientTag } })).status, 200);
  timestamp += 15 * 24 * 60 * 60 * 1000;
  assert.equal((await f.request('/api/sessions/' + a.body.sessionId, { cookie: a.cookie })).status, 404);
});

test('only own data deletion is exposed; arbitrary tg and web deletion paths are forbidden', async (t) => {
  const f = await fixture(t);
  const a = await f.start();
  const b = await f.start();
  for (const target of ['tg:1234', `web:${randomUUID()}`, 'tg%3A1234']) {
    assert.equal((await f.request('/api/users/' + target, { method: 'DELETE', cookie: a.cookie })).status, 404);
  }
  assert.equal((await f.request('/api/users/me', { method: 'DELETE', cookie: a.cookie })).status, 204);
  assert.equal((await f.request('/api/sessions/' + a.body.sessionId, { cookie: a.cookie })).status, 404);
  assert.equal((await f.request('/api/sessions/' + b.body.sessionId, { cookie: b.cookie })).status, 200);
});

test('writes enforce same origin, JSON and bounds, and forward contract validation errors', async (t) => {
  const f = await fixture(t);
  const call = (body, headers = {}) => f.request('/api/sessions', { method: 'POST', body, headers });
  assert.equal((await call({ pitch }, { Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await call({ pitch }, { Origin: '' })).status, 403);
  assert.equal((await call({ pitch }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await call('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call('{')).status, 400);
  assert.equal((await call({ pitch: 'x'.repeat(33000) })).status, 413);
  assert.equal((await call({ pitch: 'x'.repeat(4001) })).status, 422);
  assert.equal((await call({ pitch: '' })).body.error.code, 'EMPTY_PITCH');
  const first = await f.start();
  const path = `/api/sessions/${first.body.sessionId}/answers`;
  assert.equal((await f.request(path, { method: 'POST', body: { step: 6, answer: 'Ответ' }, cookie: first.cookie })).status, 400);
  assert.equal((await f.request(path, { method: 'POST', body: { step: 1, answer: 'x'.repeat(2001) }, cookie: first.cookie })).status, 422);
});

test('private files are not served; public assets have correct MIME', async (t) => {
  const f = await fixture(t);
  for (const path of ['/gateway.mjs', '/server.mjs', '/.env', '/.git/config', '/server/.data/sessions.json', '/api/../gateway.mjs']) {
    assert.equal((await fetch(f.base + path)).status, 404, path);
  }
  const home = await fetch(f.base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match((await fetch(f.base + '/app.mjs')).headers.get('content-type'), /javascript/);
  for (const [path, mime] of [
    ['/investor-art.css', 'text/css'],
    ['/investor-art.mjs', 'text/javascript'],
    ['/assets/investors/burgundy-investor.jpg', 'image/jpeg'],
    ['/assets/investors/corporate-investor.jpg', 'image/jpeg'],
    ['/assets/investors/green-coat-investor.jpg', 'image/jpeg'],
    ['/entrance.css', 'text/css'], ['/entrance.mjs', 'text/javascript'],
    ['/assets/investor-fight.jpg', 'image/jpeg'],
  ]) {
    const response = await fetch(f.base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(mime), path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  assert.equal((await fetch(f.base + '/assets/investors/../../gateway.mjs')).status, 404);
  assert.equal((await fetch(f.base + '/assets/../gateway.mjs')).status, 404);
});

test('upstream outages and diagnostics become a safe retry error without fake results', async (t) => {
  for (const fetchImpl of [
    async () => { throw new Error('PRIVATE network trace'); },
    async () => new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE', message: 'PRIVATE key diagnostic' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('PRIVATE <html>', { status: 502 }),
    async () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    const f = await fixture(t, { fetchImpl });
    const r = await f.start();
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'AI_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(r.body), /PRIVATE|"demo":true/);
  }
});

test('gateway timeout aborts upstream and produces retryable error', async (t) => {
  let aborted = false;
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  });
  const f = await fixture(t, { fetchImpl, timeoutMs: 20 });
  assert.equal((await f.start()).status, 503);
  assert.equal(aborted, true);
});

test('rate limit and cookie flags are enforced behind the trusted loopback reverse proxy', async (t) => {
  const f = await fixture(t, { rateLimit: 2 });
  const r = await f.request('/api/sessions', { method: 'POST', body: { pitch }, headers: { Origin: f.base.replace('http:', 'https:'), 'X-Forwarded-Proto': 'https' } });
  assert.equal(r.status, 201);
  assert.match(r.response.headers.get('set-cookie'), /; Secure$/);
  assert.equal((await f.request('/api/health')).status, 200);
  assert.equal((await f.request('/api/health')).status, 429);
});

test('production cookie identity requires a persistent signing secret', () => {
  assert.throws(() => createGateway({ cookieSecret: '' }), /WEB_COOKIE_SECRET/);
  assert.throws(() => createGateway({ cookieSecret: secret, upstream: 'https://user:pass@example.com' }), /TRAINER_API_URL/);
});

test('parallel first starts in two tabs retain independent signed cookies in the same browser jar', async (t) => {
  const f = await fixture(t);
  const tagA = randomUUID();
  const tagB = randomUUID();
  const [a, b] = await Promise.all([tagA, tagB].map((tag) => f.request('/api/sessions', {
    method: 'POST', body: { pitch }, headers: { 'X-Web-Client': tag },
  })));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.cookie.split('=')[0], b.cookie.split('=')[0]);
  const browserCookies = `${a.cookie}; ${b.cookie}`;
  const get = (id, tag, cookie = browserCookies) => f.request('/api/sessions/' + id, {
    cookie, headers: { 'X-Web-Client': tag },
  });
  assert.equal((await get(a.body.sessionId, tagA)).status, 200);
  assert.equal((await get(b.body.sessionId, tagB)).status, 200);
  assert.equal((await get(a.body.sessionId, tagB)).status, 404);
  assert.equal((await get(a.body.sessionId, randomUUID())).status, 404);
  const renamedCookie = a.cookie.replace(`investor_browser_${tagA}=`, `investor_browser_${tagB}=`);
  assert.equal((await get(a.body.sessionId, tagB, renamedCookie)).status, 404, 'signature binds the selected tab namespace');
  const second = await f.request('/api/sessions', {
    method: 'POST', body: { pitch, previousSessionId: a.body.sessionId }, cookie: browserCookies,
    headers: { 'X-Web-Client': tagA },
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.round, 2);
});

test('identity operations require a valid tab header and never forward it upstream', async (t) => {
  const forwarded = [];
  const f = await fixture(t, { fetchImpl: (url, options) => {
    forwarded.push(new Headers(options.headers));
    return fetch(url, options);
  } });
  const a = await f.start();
  for (const tag of ['', 'not-a-uuid']) {
    for (const [path, method, body] of [
      ['/api/sessions', 'POST', { pitch }],
      [`/api/sessions/${a.body.sessionId}`, 'GET', undefined],
      [`/api/sessions/${a.body.sessionId}/answers`, 'POST', { step: 1, answer: 'Ответ' }],
      ['/api/users/me', 'DELETE', undefined],
    ]) {
      assert.equal((await f.request(path, { method, body, cookie: a.cookie, headers: { 'X-Web-Client': tag } })).status, 400);
    }
  }
  assert.equal((await f.request('/api/health', { headers: { 'X-Web-Client': '' } })).status, 200);
  assert.equal((await f.request('/api/persona', { headers: { 'X-Web-Client': '' } })).status, 200);
  assert.ok(forwarded.length >= 3);
  assert.ok(forwarded.every((headers) => !headers.has('x-web-client') && !headers.has('cookie')));
});
