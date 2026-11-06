// HTTP-клиент общего API тренажёра (T28) по docs/CONTRACT.md версии 1.0.
//   GET    /api/persona
//   POST   /api/sessions                  {userId, pitch, previousSessionId?} → 201 Step (+facts)
//   POST   /api/sessions/{id}/answers     {userId, step, answer}              → 200 Step | Done
//   GET    /api/sessions/{id}?userId=…                                         → 200 Step | Done
//   DELETE /api/users/{userId}                                                 → 204
//   ошибка: {error: {code, message, missing?, retryAfterSec?}}
import { ApiError } from './errors.mjs';

function isStepOrDone(data) {
  if (!data || typeof data.sessionId !== 'string') return false;
  if (data.done === true) {
    const r = data.result;
    return !!r && Array.isArray(r.criteria) && Array.isArray(r.advice);
  }
  return typeof data.question === 'string' && Number.isInteger(data.step);
}

function isPersona(data) {
  return !!data && typeof data.intro === 'string' && typeof data.name === 'string';
}

export function createHttpApi({ baseUrl, timeoutMs = 60_000, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw new Error('TRAINER_API_URL не задан');

  async function request(method, path, body, validate) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new ApiError(timeout ? 'TIMEOUT' : 'NETWORK', timeout ? 'API не ответил вовремя' : 'API недоступен');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error;
      if (e?.code) {
        throw new ApiError(e.code, String(e.message ?? e.code), {
          missing: e.missing,
          retryAfterSec: e.retryAfterSec,
          fromServer: true,
        });
      }
      if (res.status === 429) throw new ApiError('RATE_LIMITED');
      if (res.status === 404) throw new ApiError('SESSION_NOT_FOUND');
      throw new ApiError(res.status >= 500 ? 'AI_UNAVAILABLE' : 'BAD_RESPONSE', `HTTP ${res.status}`);
    }
    if (validate && !validate(data)) throw new ApiError('BAD_RESPONSE', 'Неожиданный ответ API');
    return data;
  }

  const sid = (id) => encodeURIComponent(id);

  return {
    mode: 'http',
    persona: () => request('GET', '/api/persona', null, isPersona),
    // personaId (необязательно) — характер инвестора из GET /api/personas (docs/PERSONA_SELECTION.md).
    start: ({ userId, pitch, previousSessionId = null, personaId }) =>
      request('POST', '/api/sessions', personaId ? { userId, pitch, previousSessionId, personaId } : { userId, pitch, previousSessionId }, isStepOrDone),
    // step необязателен (совместимость с временной схемой), но с ним повтор безопасен.
    answer: ({ sessionId, userId, step, answer }) =>
      request('POST', `/api/sessions/${sid(sessionId)}/answers`, step == null ? { userId, answer } : { userId, step, answer }, isStepOrDone),
    get: ({ sessionId, userId }) =>
      request('GET', `/api/sessions/${sid(sessionId)}?userId=${encodeURIComponent(userId)}`, null, isStepOrDone),
    deleteUser: ({ userId }) => request('DELETE', `/api/users/${encodeURIComponent(userId)}`, null, null),
  };
}
