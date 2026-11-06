import { env } from 'node:process';

if (typeof window !== 'undefined') throw new Error('OpenAI client must run on the server.');

export const DEFAULT_MODEL = 'gpt-6.1-sol';
const API_URL = 'https://api.openai.com/v1/responses';
const MESSAGES = Object.freeze({
  CONFIG: 'Проверьте серверные настройки OpenAI.',
  INPUT: 'Некорректный или слишком длинный запрос.',
  AUTH: 'OpenAI не разрешил доступ с серверным ключом.',
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

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const TYPES = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'];
const SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
  'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description']);

// Only the JSON Schema subset used by the trainer is accepted. Unsupported rules fail
// before a billable request, rather than appearing to be checked by the local validator.
function strictSchema(schema, depth = 0) {
  if (!object(schema) || depth > 16 || Object.keys(schema).some((key) => !SCHEMA_KEYS.has(key))) {
    throw new OpenAIError('INPUT');
  }
  if (!TYPES.includes(schema.type)) throw new OpenAIError('INPUT');
  const result = { ...schema };
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length
      || schema.enum.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
      throw new OpenAIError('INPUT');
    }
    result.enum = [...schema.enum];
  }
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && (!Number.isFinite(schema[key])
      || (key.startsWith('minL') || key.startsWith('maxL') || key.endsWith('Items'))
      && !integer(schema[key], 0, 100000))) throw new OpenAIError('INPUT');
  }
  if (schema.type === 'object') {
    if (!object(schema.properties)) throw new OpenAIError('INPUT');
    result.properties = Object.fromEntries(Object.entries(schema.properties)
      .map(([key, child]) => [key, strictSchema(child, depth + 1)]));
    result.required = Object.keys(result.properties);
    result.additionalProperties = false;
  } else if (schema.type === 'array') {
    result.items = strictSchema(schema.items, depth + 1);
  }
  return result;
}

function matches(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case 'object':
      return object(value) && schema.required.every((key) => Object.hasOwn(value, key))
        && Object.keys(value).every((key) => Object.hasOwn(schema.properties, key)
          && matches(value[key], schema.properties[key]));
    case 'array':
      return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
        && value.length <= (schema.maxItems ?? Infinity) && value.every((item) => matches(item, schema.items));
    case 'string': {
      if (typeof value !== 'string') return false;
      const length = [...value].length; // JSON Schema counts Unicode code points, not UTF-16 units.
      return length >= (schema.minLength ?? 0) && length <= (schema.maxLength ?? Infinity);
    }
    case 'integer':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        && (schema.type !== 'integer' || Number.isInteger(value))
        && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

function httpError(status) {
  const code = status === 401 || status === 403 ? 'AUTH'
    : status === 429 ? 'QUOTA' : status === 404 ? 'MODEL'
      : status >= 500 ? 'PROVIDER' : 'REQUEST';
  return new OpenAIError(code, { httpStatus: status, retryable: status === 429 || status >= 500 });
}

/** Server-only Responses client. Never logs inputs, keys, provider error bodies or raw exceptions. */
export function createOpenAIClient({
  apiKey,
  model = DEFAULT_MODEL,
  timeoutMs = 30000,
  maxOutputTokens = 8192,
  maxInputChars = 30000,
  reasoningEffort = 'low',
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)
    || typeof model !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(model)
    || !integer(timeoutMs, 1, 30000) || !integer(maxOutputTokens, 1, 8192)
    || !integer(maxInputChars, 1, 100000)
    || (reasoningEffort !== null && !['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort))
    || typeof fetchImpl !== 'function') throw new OpenAIError('CONFIG');

  async function generateJSON(request) {
    if (!object(request)) throw new OpenAIError('INPUT');
    const { prompt, system = '', schema, signal } = request;
    if (typeof prompt !== 'string' || !prompt.trim() || typeof system !== 'string'
      || prompt.length + system.length > maxInputChars
      || (signal !== undefined && !(signal instanceof AbortSignal))) throw new OpenAIError('INPUT');
    if (signal?.aborted) throw new OpenAIError('CANCELLED');
    let normalizedSchema, body;
    try {
      normalizedSchema = strictSchema(schema);
      if (normalizedSchema.type !== 'object') throw new OpenAIError('INPUT');
      body = JSON.stringify({
        model, store: false, instructions: system, input: prompt,
        ...(reasoningEffort === null ? {} : { reasoning: { effort: reasoningEffort } }), max_output_tokens: maxOutputTokens,
        text: { format: { type: 'json_schema', name: 'trainer_response', strict: true, schema: normalizedSchema } },
      });
    } catch { throw new OpenAIError('INPUT'); }
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetchImpl(API_URL, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body,
      });
      if (!response.ok) throw httpError(response.status);
      let payload;
      try { payload = await response.json(); }
      catch (error) {
        if (error instanceof SyntaxError) throw new OpenAIError('RESPONSE');
        throw error;
      }
      if (payload?.status === 'incomplete') throw new OpenAIError('INCOMPLETE');
      if (payload?.status !== 'completed' || payload.error || !Array.isArray(payload.output)) {
        throw new OpenAIError('RESPONSE');
      }
      const texts = [];
      for (const item of payload.output) {
        if (!object(item)) throw new OpenAIError('RESPONSE');
        if (item.type === 'reasoning') continue;
        if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed'
          || !Array.isArray(item.content)) throw new OpenAIError('RESPONSE');
        for (const part of item.content) {
          if (part?.type === 'refusal') throw new OpenAIError('BLOCKED');
          if (part?.type !== 'output_text' || typeof part.text !== 'string') throw new OpenAIError('RESPONSE');
          texts.push(part.text);
        }
      }
      let data;
      try { data = JSON.parse(texts.join('')); }
      catch { throw new OpenAIError('RESPONSE'); }
      if (!matches(data, normalizedSchema)) throw new OpenAIError('RESPONSE');
      return { data, modelVersion: typeof payload.model === 'string' ? payload.model : model, usage: {
        inputTokens: tokenCount(payload.usage?.input_tokens),
        outputTokens: tokenCount(payload.usage?.output_tokens),
        totalTokens: tokenCount(payload.usage?.total_tokens),
      } };
    } catch (error) {
      if (signal?.aborted) throw new OpenAIError('CANCELLED');
      if (timeout.aborted) throw new OpenAIError('TIMEOUT', { retryable: true });
      if (error instanceof OpenAIError) throw error;
      throw new OpenAIError('NETWORK', { retryable: true });
    }
  }

  return Object.freeze({ model, generateJSON });
}

export function createOpenAIClientFromEnv(settings = env, overrides = {}) {
  return createOpenAIClient({
    apiKey: settings.OPENAI_API_KEY,
    model: settings.OPENAI_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(settings.OPENAI_TIMEOUT_MS || 30000),
    maxOutputTokens: Number(settings.OPENAI_MAX_OUTPUT_TOKENS || 8192),
    reasoningEffort: settings.OPENAI_REASONING_EFFORT || 'low',
    ...overrides,
  });
}
