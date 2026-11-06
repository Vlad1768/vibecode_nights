// HTTP-клиент общего API тренажёра (T28).
// ВРЕМЕННАЯ СХЕМА до контракта T25 (предложена в канале агентов, issue #1):
//   POST {base}/api/sessions               {userId, pitch}  → {sessionId, step, totalSteps, question}
//   POST {base}/api/sessions/{id}/answers  {userId, answer} → {sessionId, step, totalSteps, question}
//                                                          | {sessionId, done: true, result}
//   ошибка: HTTP 4xx/5xx + {error: {code, message}}
// После T25 меняется только этот файл.
import { ApiError } from './errors.mjs';

function validateStep(data) {
  if (!data || typeof data.sessionId !== 'string') return false;
  if (data.done === true) {
    const r = data.result;
    return !!r && Array.isArray(r.criteria) && Array.isArray(r.advice);
  }
  return typeof data.question === 'string' && Number.isInteger(data.step);
}

export function createHttpApi({ baseUrl, timeoutMs = 60_000, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw new Error('TRAINER_API_URL не задан');

  async function post(path, body) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new ApiError(timeout ? 'TIMEOUT' : 'NETWORK', timeout ? 'API не ответил вовремя' : 'API недоступен');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const code = data?.error?.code;
      if (code) throw new ApiError(code, String(data.error.message ?? code));
      if (res.status === 429) throw new ApiError('RATE_LIMITED');
      if (res.status === 404) throw new ApiError('SESSION_NOT_FOUND');
      throw new ApiError(res.status >= 500 ? 'AI_UNAVAILABLE' : 'BAD_RESPONSE', `HTTP ${res.status}`);
    }
    if (!validateStep(data)) throw new ApiError('BAD_RESPONSE', 'Неожиданный ответ API');
    return data;
  }

  return {
    mode: 'http',
    start: ({ userId, pitch }) => post('/api/sessions', { userId, pitch }),
    answer: ({ sessionId, userId, answer }) =>
      post(`/api/sessions/${encodeURIComponent(sessionId)}/answers`, { userId, answer }),
  };
}
