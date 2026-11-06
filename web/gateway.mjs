// Browser gateway for CONTRACT 1.0. Scoring and conversations belong to server/.
// Keep the upstream on loopback (or an authenticated private tunnel), never expose it directly.
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { AbuseLimit, createAbuseGuard, networkKey } from './abuse.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const COOKIE = 'investor_browser';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL = 14 * 24 * 60 * 60 * 1000;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/motion.css', ['motion.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/demo.mjs', ['demo.mjs', 'text/javascript; charset=utf-8']],
  ['/motion.mjs', ['motion.mjs', 'text/javascript; charset=utf-8']],
  ['/investor-art.css', ['investor-art.css', 'text/css; charset=utf-8']],
  ['/investor-art.mjs', ['investor-art.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/investors/burgundy-investor.jpg', ['assets/investors/burgundy-investor.jpg', 'image/jpeg']],
  ['/assets/investors/corporate-investor.jpg', ['assets/investors/corporate-investor.jpg', 'image/jpeg']],
  ['/assets/investors/green-coat-investor.jpg', ['assets/investors/green-coat-investor.jpg', 'image/jpeg']],
  ['/entrance.css', ['entrance.css', 'text/css; charset=utf-8']],
  ['/entrance.mjs', ['entrance.mjs', 'text/javascript; charset=utf-8']],
  ['/fight-animation.mjs', ['fight-animation.mjs', 'text/javascript; charset=utf-8']],
  ['/fight-animation.css', ['fight-animation.css', 'text/css; charset=utf-8']],
  ['/assets/loading/face.png', ['assets/loading/face.png', 'image/png']],
  ['/assets/loading/title.png', ['assets/loading/title.png', 'image/png']],
  ['/assets/investor-fight.jpg', ['assets/investor-fight.jpg', 'image/jpeg']],
  ...['angel', 'corporate', 'grant', 'venture', 'hype-alchemist'].map((id) => [
    `/assets/personas/${id}.jpg`, [`assets/personas/${id}.jpg`, 'image/jpeg'],
  ]),
]);
const ERRORS = new Set(['BAD_REQUEST', 'EMPTY_PITCH', 'NOT_A_PITCH', 'PITCH_TOO_LONG', 'EMPTY_ANSWER', 'ANSWER_TOO_LONG', 'SESSION_NOT_FOUND', 'SESSION_DONE', 'STEP_MISMATCH', 'RATE_LIMITED', 'AI_UNAVAILABLE']);
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function loopback(address) { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address); }
function protocol(req) {
  return req.socket.encrypted || (loopback(req.socket.remoteAddress) && req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http';
}
function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    if (origin.origin !== `${protocol(req)}://${req.headers.host}` || origin.href !== origin.origin + '/') throw new Error();
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) throw new Error();
  } catch { throw new HttpError(403, 'ORIGIN', 'Отправьте запрос со страницы тренажёра.'); }
}
function requestIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (loopback(req.socket.remoteAddress) && typeof forwarded === 'string') {
    const value = forwarded.split(',').at(-1).trim();
    if (isIP(value)) return value;
  }
  return req.socket.remoteAddress || 'unknown';
}
function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}
function missing() { return new HttpError(404, 'SESSION_NOT_FOUND', 'Раунд не найден. Начните новый раунд.'); }
function unavailable() { return new HttpError(503, 'AI_UNAVAILABLE', 'Инвестор временно недоступен. Ваш текст сохранён; повторите отправку позже или откройте демопример.'); }
async function bodyJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'BAD_REQUEST', 'Ожидается JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new HttpError(413, 'BAD_REQUEST', 'Запрос слишком длинный.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'BAD_REQUEST', 'Некорректный запрос.'); }
}

export function createGateway({
  upstream = process.env.TRAINER_API_URL || 'http://127.0.0.1:8080',
  cookieSecret = process.env.WEB_COOKIE_SECRET || (process.env.NODE_ENV === 'production' ? '' : randomBytes(32).toString('hex')),
  staticRoot = ROOT, fetchImpl = fetch, now = Date.now, timeoutMs = 50000, rateLimit = 60, abuseOptions = {},
} = {}) {
  if (typeof cookieSecret !== 'string' || cookieSecret.length < 32) throw new Error('WEB_COOKIE_SECRET must contain at least 32 characters.');
  const upstreamURL = new URL(upstream);
  if (!['http:', 'https:'].includes(upstreamURL.protocol) || upstreamURL.username || upstreamURL.password || upstreamURL.search || upstreamURL.hash || upstreamURL.pathname !== '/') throw new Error('TRAINER_API_URL must be an origin.');
  const rates = new Map();
  const abuse = createAbuseGuard({ now, ...abuseOptions });
  const sign = (value) => createHmac('sha256', cookieSecret).update(value).digest('base64url');
  function tabTag(req) {
    const tag = req.headers['x-web-client'];
    if (typeof tag !== 'string' || !UUID.test(tag)) throw new HttpError(400, 'BAD_REQUEST', 'Не удалось определить вкладку. Обновите страницу тренажёра.');
    return tag.toLowerCase();
  }
  function identity(req, tag) {
    const name = `${COOKIE}_${tag}`;
    const raw = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1);
    if (!raw || raw.length > 160) return null;
    const [id, expires, signature, extra] = raw.split('.');
    if (extra || !UUID.test(id) || !/^\d{13}$/.test(expires || '') || !/^[A-Za-z0-9_-]{43}$/.test(signature || '')) return null;
    const expected = sign(`${tag}.${id}.${expires}`);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || Number(expires) <= now()) return null;
    return `web:${id}`;
  }
  function remember(req, res, userId, tag) {
    const payload = `${userId.slice(4)}.${now() + TTL}`;
    res.setHeader('Set-Cookie', `${COOKIE}_${tag}=${payload}.${sign(`${tag}.${payload}`)}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${TTL / 1000}${protocol(req) === 'https' ? '; Secure' : ''}`);
  }
  function charge(req) {
    const timestamp = now();
    for (const [key, rate] of rates) if (rate.expires <= timestamp) rates.delete(key);
    const ip = networkKey(requestIP(req));
    let rate = rates.get(ip);
    if (!rate) {
      if (rates.size >= 10000) throw unavailable();
      rates.set(ip, rate = { count: 0, expires: timestamp + 60000 });
    }
    if (++rate.count > rateLimit) throw new AbuseLimit((rate.expires - timestamp) / 1000);
  }
  async function modelRequest(req, res, path, body, start = false) {
    const release = abuse.acquire(requestIP(req), { start });
    try { return await proxy(req, res, path, body); }
    finally { release(); }
  }
  async function proxy(req, res, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await fetchImpl(new URL(path, upstreamURL), {
        method: req.method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Forwarded-For': requestIP(req) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 204) return json(res, 204);
      if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw unavailable();
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 524288) { controller.abort(); throw unavailable(); }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw unavailable(); }
      if (!response.ok) {
        if (!ERRORS.has(data?.error?.code) || typeof data.error.message !== 'string') throw unavailable();
        // An upstream/provider error must not leak diagnostics or credentials to the browser.
        if (data.error.code === 'AI_UNAVAILABLE' || response.status >= 500) throw unavailable();
        const error = { code: data.error.code, message: data.error.message.slice(0, 1000) };
        if (Array.isArray(data.error.missing)) error.missing = data.error.missing.filter((v) => typeof v === 'string').slice(0, 10).map((v) => v.slice(0, 200));
        if (Number.isFinite(data.error.retryAfterSec)) error.retryAfterSec = data.error.retryAfterSec;
        if (response.status === 429 && error.retryAfterSec > 0) res.setHeader('Retry-After', String(Math.ceil(error.retryAfterSec)));
        return json(res, response.status, { error });
      }
      return json(res, response.status, data);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    } finally { clearTimeout(timer); }
  }
  async function handle(req, res) {
    headers(res);
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    if (['GET', 'HEAD'].includes(req.method) && STATIC.has(path)) {
      const [file, mime] = STATIC.get(path);
      let data;
      try { data = await readFile(join(staticRoot, file)); } catch { throw new HttpError(404, 'NOT_FOUND', 'Страница не найдена.'); }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
      return res.end(req.method === 'HEAD' ? undefined : data);
    }
    if (!path.startsWith('/api/')) throw new HttpError(404, 'NOT_FOUND', 'Страница не найдена.');
    charge(req);
    if (req.method === 'GET' && ['/api/health', '/api/persona', '/api/personas'].includes(path)) return proxy(req, res, path);
    if (['POST', 'DELETE'].includes(req.method)) sameOrigin(req);
    const tag = tabTag(req);
    let userId = identity(req, tag);
    if (req.method === 'POST' && path === '/api/sessions') {
      const body = await bodyJSON(req);
      if (typeof body.pitch !== 'string' || body.pitch.length > 4000) throw new HttpError(422, 'PITCH_TOO_LONG', 'Питч должен содержать не больше 4000 символов.');
      if (body.previousSessionId != null && !UUID.test(body.previousSessionId)) throw new HttpError(400, 'BAD_REQUEST', 'Некорректный предыдущий раунд.');
      if (body.personaId !== undefined && (typeof body.personaId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(body.personaId))) throw new HttpError(400, 'BAD_REQUEST', 'Выберите характер инвестора из списка.');
      userId ||= `web:${randomUUID()}`;
      remember(req, res, userId, tag);
      return modelRequest(req, res, path, { userId, pitch: body.pitch, previousSessionId: body.previousSessionId ?? null, ...(body.personaId === undefined ? {} : { personaId: body.personaId }) }, true);
    }
    const match = path.match(/^\/api\/sessions\/([^/]+)(\/answers)?$/);
    if (match && UUID.test(match[1]) && ((req.method === 'GET' && !match[2]) || (req.method === 'POST' && match[2]))) {
      if (!userId) throw missing();
      remember(req, res, userId, tag);
      if (req.method === 'GET') return proxy(req, res, path + '?userId=' + encodeURIComponent(userId));
      const body = await bodyJSON(req);
      if (!Number.isInteger(body.step) || body.step < 1 || body.step > 5) throw new HttpError(400, 'BAD_REQUEST', 'Укажите номер вопроса от 1 до 5.');
      if (typeof body.answer !== 'string' || body.answer.length > 2000) throw new HttpError(422, 'ANSWER_TOO_LONG', 'Ответ должен содержать не больше 2000 символов.');
      return modelRequest(req, res, path, { userId, step: body.step, answer: body.answer });
    }
    if (req.method === 'DELETE' && path === '/api/users/me') {
      if (!userId) return json(res, 204);
      return proxy(req, res, '/api/users/' + encodeURIComponent(userId));
    }
    throw new HttpError(404, 'NOT_FOUND', 'Страница не найдена.');
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return res.destroy();
      if (error instanceof AbuseLimit) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        return json(res, 429, { error: { code: 'RATE_LIMITED', message: error.message, retryAfterSec: error.retryAfterSec } });
      }
      const safe = error instanceof HttpError ? error : unavailable();
      json(res, safe.status, { error: { code: safe.code, message: safe.message } });
    });
  });
  server.requestTimeout = 60000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createGateway();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8787);
  server.listen(port, host, () => console.log(`Сайт «Злой инвестор»: http://${host}:${port}`));
  const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
