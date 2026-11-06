// Серверный клиент OpenAI (ChatGPT) без зависимостей. Тот же интерфейс, что у integrations/gemini:
//   generateText({ prompt, system?, signal?, media? }) → { data: string, modelVersion, usage }
//   generateJSON({ prompt, system?, signal?, schema, media? }) → { data: object, ... }
//   transcribe({ buffer, mimeType, filename? }) → { data: string }  — голосовые (Telegram OGG/Opus)
// media: [{ mimeType, data(base64) }] — PDF уходит файлом, картинки — image_url.
// Ключ не логируется и не попадает в тексты ошибок; автоматических повторов нет.
import { env } from 'node:process';
import { createOpenAIClient as createResponsesClient, OpenAIError as ResponsesError } from './responses.mjs';

if (typeof window !== 'undefined') {
  throw new Error('OpenAI client must run on the server.');
}

export const DEFAULT_MODEL = 'gpt-6.1-sol';
export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1';
const DEFAULT_BASE = 'https://api.openai.com/v1';
const MAX_MEDIA_BASE64 = 18 * 1024 * 1024;

const MESSAGES = Object.freeze({
  CONFIG: 'Проверьте серверные настройки OpenAI.',
  INPUT: 'Некорректный или слишком длинный запрос.',
  AUTH: 'OpenAI не принял серверный ключ.',
  QUOTA: 'Достигнут лимит OpenAI. Повторите запрос позже.',
  MODEL: 'Выбранная модель OpenAI недоступна.',
  REQUEST: 'OpenAI отклонил параметры запроса.',
  PROVIDER: 'OpenAI временно недоступен.',
  NETWORK: 'Не удалось связаться с OpenAI.',
  TIMEOUT: 'OpenAI не ответил за отведённое время.',
  CANCELLED: 'Запрос отменён.',
  BLOCKED: 'OpenAI не смог сформировать разрешённый ответ.',
  INCOMPLETE: 'OpenAI вернул незавершённый ответ.',
  RESPONSE: 'OpenAI вернул некорректный ответ.',
});

export class OpenAIError extends Error {
  constructor(code, { httpStatus = 0, retryable = false } = {}) {
    super(MESSAGES[code] || MESSAGES.RESPONSE);
    this.name = 'OpenAIError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function httpError(status) {
  const code = status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'QUOTA'
    : status === 404 ? 'MODEL'
    : status >= 500 ? 'PROVIDER' : 'REQUEST';
  return new OpenAIError(code, { httpStatus: status, retryable: status === 429 || status >= 500 });
}

// Модели с рассуждениями (gpt-5*, o*) тратят часть лимита на рассуждения и не принимают temperature.
export const isReasoningModel = (model) => /^(gpt-[56]|o\d)/i.test(model);
// Классические модели без рассуждений; для остальных (в т. ч. новых gpt-6*) даём запас токенов.
const isClassicModel = (model) => /^(gpt-4|gpt-3)/i.test(model);

function mediaPart(m) {
  if (m.mimeType === 'application/pdf') {
    return { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${m.data}` } };
  }
  if (m.mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url: `data:${m.mimeType};base64,${m.data}` } };
  throw new OpenAIError('INPUT'); // аудио — через transcribe()
}

const tokens = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

export function createOpenAIClient({
  apiKey,
  model = DEFAULT_MODEL,
  transcribeModel = DEFAULT_TRANSCRIBE_MODEL,
  baseUrl = DEFAULT_BASE,
  timeoutMs = 30000,
  maxOutputTokens = 8192,
  maxInputChars = 30000,
  reasoningEffort = 'low',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)
    || typeof model !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(model)
    || typeof transcribeModel !== 'string' || !/^[a-zA-Z0-9._:-]+$/.test(transcribeModel)
    || typeof baseUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(baseUrl)
    || !integer(timeoutMs, 1, 300000)
    || !integer(maxOutputTokens, 1, 32768)
    || !integer(maxInputChars, 1, 200000)
    || !['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)
    || typeof fetchImpl !== 'function') {
    throw new OpenAIError('CONFIG');
  }
  const root = baseUrl.replace(/\/+$/, '');
  const auth = { Authorization: `Bearer ${apiKey.trim()}` };

  async function send(path, init, signal) {
    if (signal?.aborted) throw new OpenAIError('CANCELLED');
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(root + path, { ...init, headers: { ...auth, ...init.headers }, signal: combined, redirect: 'error' });
    } catch {
      if (signal?.aborted) throw new OpenAIError('CANCELLED');
      if (timeout.aborted) throw new OpenAIError('TIMEOUT');
      throw new OpenAIError('NETWORK', { retryable: true });
    }
    if (!response.ok) throw httpError(response.status);
    try {
      return await response.json();
    } catch {
      if (timeout.aborted) throw new OpenAIError('TIMEOUT');
      throw new OpenAIError('RESPONSE');
    }
  }

  async function generate(input, jsonMode) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OpenAIError('INPUT');
    const { prompt, system = '', signal, schema, media = [] } = input;
    if (typeof prompt !== 'string' || !prompt.trim() || typeof system !== 'string'
      || prompt.length + system.length > maxInputChars
      || (signal !== undefined && !(signal instanceof AbortSignal))
      || (jsonMode && (!schema || typeof schema !== 'object' || Array.isArray(schema)))
      || !Array.isArray(media) || media.length > 4
      || media.some((m) => !m || typeof m.mimeType !== 'string' || typeof m.data !== 'string' || !m.data)
      || media.reduce((sum, m) => sum + m.data.length, 0) > MAX_MEDIA_BASE64) {
      throw new OpenAIError('INPUT');
    }
    // The trainer sends text-only JSON. Keep Ivan's media/text/transcription routes,
    // but use strict Responses output and local schema checks for the shared core.
    if (jsonMode && media.length === 0) {
      if (root !== DEFAULT_BASE) throw new OpenAIError('CONFIG');
      try {
        const responses = createResponsesClient({ apiKey, model, timeoutMs, maxOutputTokens,
          maxInputChars, reasoningEffort: isReasoningModel(model) ? reasoningEffort : null, fetchImpl });
        return await responses.generateJSON({ prompt, system, schema, signal });
      } catch (error) {
        if (error instanceof ResponsesError) {
          throw new OpenAIError(error.code, { httpStatus: error.httpStatus, retryable: error.retryable });
        }
        throw new OpenAIError('RESPONSE');
      }
    }
    const reasoning = isReasoningModel(model);
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: media.length ? [...media.map(mediaPart), { type: 'text', text: prompt }] : prompt });
    const body = {
      model,
      messages,
      n: 1,
      // У моделей с рассуждениями лимит включает рассуждения — даём запас (и новым моделям на всякий случай).
      max_completion_tokens: isClassicModel(model) ? maxOutputTokens : Math.max(maxOutputTokens, 8192),
    };
    if (reasoning) body.reasoning_effort = reasoningEffort;
    if (jsonMode) body.response_format = { type: 'json_schema', json_schema: { name: 'response', schema, strict: false } };

    const payload = await send('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
    const choice = payload?.choices?.[0];
    if (!choice) throw new OpenAIError('RESPONSE');
    if (choice.finish_reason === 'length') throw new OpenAIError('INCOMPLETE');
    if (choice.finish_reason === 'content_filter' || choice.message?.refusal) throw new OpenAIError('BLOCKED');
    const text = typeof choice.message?.content === 'string' ? choice.message.content.trim() : '';
    if (!text) throw new OpenAIError('RESPONSE');
    let data = text;
    if (jsonMode) {
      try { data = JSON.parse(text); } catch { throw new OpenAIError('RESPONSE'); }
    }
    // Бизнес-схему, права и содержимое проверяет вызывающий код (core/).
    return {
      data,
      modelVersion: typeof payload.model === 'string' ? payload.model : model,
      usage: {
        inputTokens: tokens(payload.usage?.prompt_tokens),
        outputTokens: tokens(payload.usage?.completion_tokens),
        totalTokens: tokens(payload.usage?.total_tokens),
      },
    };
  }

  async function transcribe({ buffer, mimeType = 'audio/ogg', filename = 'voice.ogg', signal } = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 25 * 1024 * 1024) throw new OpenAIError('INPUT');
    const form = new FormData();
    form.set('model', transcribeModel);
    form.set('response_format', 'text');
    form.set('file', new Blob([buffer], { type: mimeType }), filename);
    let response;
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetchImpl(`${root}/audio/transcriptions`, { method: 'POST', headers: auth, body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error' });
    } catch {
      if (timeout.aborted) throw new OpenAIError('TIMEOUT');
      throw new OpenAIError('NETWORK', { retryable: true });
    }
    if (!response.ok) throw httpError(response.status);
    const text = (await response.text()).trim();
    return { data: text };
  }

  return Object.freeze({
    provider: 'openai',
    model,
    generateText: (request) => generate(request, false),
    generateJSON: (request) => generate(request, true),
    transcribe,
  });
}

export function createOpenAIClientFromEnv(settings = env, overrides = {}) {
  return createOpenAIClient({
    apiKey: settings.OPENAI_API_KEY,
    model: settings.OPENAI_MODEL || DEFAULT_MODEL,
    transcribeModel: settings.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL,
    baseUrl: settings.OPENAI_BASE_URL || DEFAULT_BASE,
    timeoutMs: Number(settings.OPENAI_TIMEOUT_MS || 30000),
    maxOutputTokens: Number(settings.OPENAI_MAX_OUTPUT_TOKENS || 8192),
    reasoningEffort: settings.OPENAI_REASONING_EFFORT || 'low',
    ...overrides,
  });
}
