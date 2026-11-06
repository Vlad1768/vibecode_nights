// Ошибки API тренажёра. Коды — временная схема до контракта T25.
export const ERROR_CODES = Object.freeze([
  'EMPTY_PITCH',
  'PITCH_TOO_LONG',
  'EMPTY_ANSWER',
  'ANSWER_TOO_LONG',
  'SESSION_NOT_FOUND',
  'RATE_LIMITED',
  'AI_UNAVAILABLE',
  'NETWORK',
  'TIMEOUT',
  'BAD_RESPONSE',
]);

// Ошибки, после которых тот же запрос можно повторить без потери ответа.
const RETRYABLE = new Set(['RATE_LIMITED', 'AI_UNAVAILABLE', 'NETWORK', 'TIMEOUT', 'BAD_RESPONSE']);

export class ApiError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ApiError';
    this.code = ERROR_CODES.includes(code) ? code : 'BAD_RESPONSE';
    this.retryable = RETRYABLE.has(this.code);
  }
}
