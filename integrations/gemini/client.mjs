import { env } from 'node:process';

if (typeof window !== 'undefined') {
  throw new Error('Gemini client must run on the server.');
}

export const DEFAULT_MODEL = 'gemini-4-argon';
const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MESSAGES = Object.freeze({
  CONFIG: 'Проверьте серверные настройки Gemini.',
  INPUT: 'Некорректный или слишком длинный запрос.',
  AUTH: 'Gemini не разрешил доступ с серверным ключом.',
  ACCESS: 'Для Gemini требуется дополнительная настройка доступа в проекте Google.',
  QUOTA: 'Достигнут лимит Gemini. Повторите запрос позже.',
  MODEL: 'Выбранная модель Gemini недоступна.',
  REQUEST: 'Gemini отклонил параметры запроса.',
  PROVIDER: 'Gemini временно недоступен.',
  NETWORK: 'Не удалось связаться с Gemini.',
  TIMEOUT: 'Gemini не ответил за отведённое время.',
  CANCELLED: 'Запрос отменён.',
  BLOCKED: 'Gemini не смог сформировать разрешённый ответ.',
  INCOMPLETE: 'Gemini вернул незавершённый ответ.',
  RESPONSE: 'Gemini вернул некорректный ответ.',
});

export class GeminiError extends Error {
  constructor(code, { httpStatus = 0, retryable = false } = {}) {
    super(MESSAGES[code] || MESSAGES.RESPONSE);
    this.name = 'GeminiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function httpError(status, providerStatus) {
  const code = status === 400 && providerStatus === 'FAILED_PRECONDITION' ? 'ACCESS'
    : status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'QUOTA'
    : status === 404 ? 'MODEL'
    : status >= 500 ? 'PROVIDER' : 'REQUEST';
  return new GeminiError(code, { httpStatus: status, retryable: status === 429 || status >= 500 });
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Server-only provider. It does not log keys/prompts or perform automatic retries. */
export function createGeminiClient({
  apiKey,
  model = DEFAULT_MODEL,
  timeoutMs = 30000,
  maxOutputTokens = 1024,
  maxInputChars = 20000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()
    || typeof model !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(model)
    || !integer(timeoutMs, 1, 120000)
    || !integer(maxOutputTokens, 1, 8192)
    || !integer(maxInputChars, 1, 100000)
    || typeof fetchImpl !== 'function') {
    throw new GeminiError('CONFIG');
  }

  async function generate(requestInput, jsonMode) {
    if (!requestInput || typeof requestInput !== 'object' || Array.isArray(requestInput)) {
      throw new GeminiError('INPUT');
    }
    const { prompt, system = '', signal, schema } = requestInput;
    if (typeof prompt !== 'string' || !prompt.trim() || typeof system !== 'string'
      || prompt.length + system.length > maxInputChars
      || (signal !== undefined && !(signal instanceof AbortSignal))
      || (jsonMode && (!schema || typeof schema !== 'object' || Array.isArray(schema)))) {
      throw new GeminiError('INPUT');
    }
    if (signal?.aborted) throw new GeminiError('CANCELLED');

    const generationConfig = { candidateCount: 1, maxOutputTokens };
    if (jsonMode) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseJsonSchema = schema;
    }
    const request = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig };
    if (system) request.systemInstruction = { parts: [{ text: system }] };
    let body;
    try { body = JSON.stringify(request); }
    catch { throw new GeminiError('INPUT'); }

    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetchImpl(API_ROOT + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
        body,
        signal: combined,
        redirect: 'error',
      });
      if (!response.ok) {
        let providerStatus;
        if (response.status === 400) {
          try { providerStatus = (await response.json())?.error?.status; }
          catch { /* The HTTP error is still useful when its body is not JSON. */ }
        }
        throw httpError(response.status, providerStatus);
      }
      let payload;
      try { payload = await response.json(); }
      catch (error) {
        if (error instanceof SyntaxError) throw new GeminiError('RESPONSE');
        throw error;
      }
      if (payload?.promptFeedback?.blockReason) throw new GeminiError('BLOCKED');
      const candidate = payload?.candidates?.[0];
      if (!candidate) throw new GeminiError('RESPONSE');
      if (candidate.finishReason !== 'STOP') {
        throw new GeminiError(candidate.finishReason === 'MAX_TOKENS' ? 'INCOMPLETE' : 'BLOCKED');
      }
      const parts = candidate.content?.parts;
      if (!Array.isArray(parts) || parts.some((part) => !part || typeof part !== 'object' || Array.isArray(part))) {
        throw new GeminiError('RESPONSE');
      }
      const text = parts.filter((part) => !part.thought && typeof part.text === 'string')
        .map((part) => part.text).join('').trim();
      if (!text) throw new GeminiError('RESPONSE');
      let data = text;
      if (jsonMode) {
        try { data = JSON.parse(text); }
        catch { throw new GeminiError('RESPONSE'); }
      }
      // The caller must validate its business schema, price IDs and permissions.
      return { data, modelVersion: typeof payload.modelVersion === 'string' ? payload.modelVersion : model, usage: {
        inputTokens: tokenCount(payload.usageMetadata?.promptTokenCount),
        outputTokens: tokenCount(payload.usageMetadata?.candidatesTokenCount),
        totalTokens: tokenCount(payload.usageMetadata?.totalTokenCount),
      } };
    } catch (error) {
      if (signal?.aborted) throw new GeminiError('CANCELLED');
      if (timeout.aborted) throw new GeminiError('TIMEOUT');
      if (error instanceof GeminiError) throw error;
      throw new GeminiError('NETWORK', { retryable: true });
    }
  }

  return Object.freeze({
    model,
    generateText: (request) => generate(request, false),
    generateJSON: (request) => generate(request, true),
  });
}

export function createGeminiClientFromEnv(settings = env, overrides = {}) {
  return createGeminiClient({
    apiKey: settings.GEMINI_API_KEY,
    model: settings.GEMINI_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(settings.GEMINI_TIMEOUT_MS || 30000),
    maxOutputTokens: Number(settings.GEMINI_MAX_OUTPUT_TOKENS || 1024),
    ...overrides,
  });
}
