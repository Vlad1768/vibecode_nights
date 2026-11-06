// HTTP-обработчик API по контракту docs/CONTRACT.md: маршруты, JSON, ошибки, лимиты, тайм-аут.
import { TrainerError } from '../core/guard.mjs';
import { clientIp, createWindow } from './limits.mjs';

export const API_VERSION = '1.0';
const USER_ID = /^(tg|web):[A-Za-z0-9-]{1,64}$/;
const MAX_BODY = 64 * 1024;

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new TrainerError(400, 'BAD_REQUEST', 'Слишком большой запрос');
    chunks.push(c);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new TrainerError(400, 'BAD_REQUEST', 'Тело запроса должно быть JSON-объектом');
  }
}

function needUser(userId) {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) {
    throw new TrainerError(400, 'BAD_REQUEST', 'userId должен быть вида tg:<id> или web:<uuid>');
  }
  return userId;
}

function needText(value, field) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new TrainerError(400, 'BAD_REQUEST', `${field} должен быть строкой`);
  }
  return value;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TrainerError(503, 'AI_UNAVAILABLE', 'Инвестор задумался. Повторите запрос: питч и ответы сохранены.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {ReturnType<import('../core/trainer.mjs').createTrainer>} trainer
 * @param {{ requestTimeoutMs?: number, sessionsPerHour?: number, requestsPerMinute?: number, log?: Function }} [o]
 */
export function createHandler(trainer, { requestTimeoutMs = 45_000, sessionsPerHour = 10, requestsPerMinute = 60, log = () => {} } = {}) {
  const perIp = createWindow({ max: requestsPerMinute, windowMs: 60_000 });
  const perUser = createWindow({ max: sessionsPerHour, windowMs: 60 * 60_000 });
  const limited = (sec) => new TrainerError(429, 'RATE_LIMITED', `Слишком много запросов. Подождите ${sec} с.`, { retryAfterSec: sec });

  const handler = async (req, res) => {
    const send = (status, body) => {
      const headers = { 'cache-control': 'no-store' };
      if (body !== null) headers['content-type'] = 'application/json; charset=utf-8';
      if (status === 429 && body?.error?.retryAfterSec) headers['retry-after'] = String(body.error.retryAfterSec);
      res.writeHead(status, headers);
      res.end(body === null ? undefined : JSON.stringify(body));
    };
    try {
      const ip = clientIp(req);
      if (ip) {
        const wait = perIp.wait(ip);
        if (wait) throw limited(wait);
        perIp.hit(ip);
      }
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname.replace(/\/+$/, '');
      let m;
      if (req.method === 'GET' && p === '/api/health') return send(200, { ok: true, mode: trainer.mode, version: API_VERSION });
      if (req.method === 'GET' && p === '/api/persona') return send(200, trainer.persona());
      if (req.method === 'GET' && p === '/api/personas') return send(200, trainer.personas());
      if (req.method === 'POST' && p === '/api/sessions') {
        const b = await readJson(req);
        const userId = needUser(b.userId);
        const wait = perUser.wait(userId);
        if (wait) throw limited(wait);
        const r = await withTimeout(trainer.start({ userId, pitch: needText(b.pitch, 'pitch'), previousSessionId: b.previousSessionId ?? null, personaId: b.personaId }), requestTimeoutMs);
        perUser.hit(userId);
        return send(r.status, r.body);
      }
      if (req.method === 'POST' && (m = p.match(/^\/api\/sessions\/([^/]+)\/answers$/))) {
        const b = await readJson(req);
        const r = await withTimeout(trainer.answer(decodeURIComponent(m[1]), { userId: needUser(b.userId), step: b.step, answer: needText(b.answer, 'answer') }), requestTimeoutMs);
        return send(r.status, r.body);
      }
      if (req.method === 'GET' && (m = p.match(/^\/api\/sessions\/([^/]+)$/))) {
        const r = await trainer.get(decodeURIComponent(m[1]), needUser(url.searchParams.get('userId')));
        return send(r.status, r.body);
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/api\/users\/([^/]+)$/))) {
        const r = await trainer.deleteUser(needUser(decodeURIComponent(m[1])));
        return send(r.status, r.body);
      }
      throw new TrainerError(404, 'SESSION_NOT_FOUND', 'Нет такого адреса');
    } catch (err) {
      if (err instanceof TrainerError) return send(err.status, { error: { code: err.code, message: err.message, ...err.extra } });
      log({ level: 'error', msg: 'необработанная ошибка', code: err?.code || err?.name || 'ERROR', detail: String(err?.message || '').slice(0, 200) });
      return send(503, { error: { code: 'AI_UNAVAILABLE', message: 'Инвестор задумался. Повторите запрос: питч и ответы сохранены.' } });
    }
  };
  handler.close = () => { perIp.close(); perUser.close(); };
  return handler;
}
