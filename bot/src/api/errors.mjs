// Ошибки API тренажёра: коды из docs/CONTRACT.md (раздел 7) + внутренние коды клиента.
export const ERROR_CODES = Object.freeze([
  // от API
  'BAD_REQUEST',
  'EMPTY_PITCH',
  'NOT_A_PITCH',
  'PITCH_TOO_LONG',
  'EMPTY_ANSWER',
  'ANSWER_TOO_LONG',
  'SESSION_NOT_FOUND',
  'SESSION_DONE',
  'STEP_MISMATCH',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  // внутренние: ответа сервера нет или он не по контракту
  'NETWORK',
  'TIMEOUT',
  'BAD_RESPONSE',
]);

// Ошибки, после которых тот же запрос можно повторить: API идемпотентен по (sessionId, step).
const RETRYABLE = new Set(['RATE_LIMITED', 'AI_UNAVAILABLE', 'NETWORK', 'TIMEOUT', 'BAD_RESPONSE']);

export class ApiError extends Error {
  // message — текст от API, его можно показать пользователю как есть (контракт, раздел 5).
  constructor(code, message = code, { missing, retryAfterSec, fromServer = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = ERROR_CODES.includes(code) ? code : 'BAD_RESPONSE';
    this.retryable = RETRYABLE.has(this.code);
    this.missing = Array.isArray(missing) ? missing.map(String) : [];
    this.retryAfterSec = Number.isFinite(retryAfterSec) ? retryAfterSec : null;
    this.fromServer = fromServer;
  }
}
