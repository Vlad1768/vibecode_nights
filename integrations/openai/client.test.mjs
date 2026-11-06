// Автономные тесты клиента OpenAI: сеть подменена, ключи синтетические.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIClient, createOpenAIClientFromEnv, OpenAIError, isReasoningModel } from './client.mjs';
import { createLlmClientFromEnv, llmProvider } from '../llm.mjs';

const KEY = 'sk-synthetic-test-key';
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (content, finish = 'stop') => reply({ model: 'gpt-4.1-mini-2026', choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
const jsonSchema = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] };
const jsonOk = (content, status = 'completed') => reply({ model: 'gpt-6.1-sol', status, output: [{
  type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content }],
}], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });

test('generateJSON: strict Responses со схемой, ключ только в заголовке', async () => {
  let url, init;
  const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async (u, i) => { url = u; init = i; return jsonOk('{"question":"Кто платит?"}'); } });
  const r = await client.generateJSON({ system: 'sys', prompt: 'питч', schema: jsonSchema });
  assert.deepEqual(r.data, { question: 'Кто платит?' });
  assert.equal(r.usage.totalTokens, 15);
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gpt-6.1-sol');
  assert.equal(body.instructions, 'sys');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 8192);
  assert.equal(body.reasoning.effort, 'low');
  assert.ok(!init.body.includes(KEY));
});

test('модели с рассуждениями получают запас токенов и reasoning_effort', async () => {
  let body;
  const client = createOpenAIClient({ apiKey: KEY, model: 'gpt-5-mini', maxOutputTokens: 2048, fetchImpl: async (_u, i) => { body = JSON.parse(i.body); return ok('текст'); } });
  await client.generateText({ prompt: 'x' });
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 8192);
  assert.ok(isReasoningModel('o4-mini') && !isReasoningModel('gpt-4.1-mini'));
  const c6 = createOpenAIClient({ apiKey: KEY, model: 'gpt-6.1-sol', fetchImpl: async (_u, i) => { body = JSON.parse(i.body); return ok('текст'); } });
  await c6.generateText({ prompt: 'x' });
  assert.equal(body.reasoning_effort, 'low', 'Sol поддерживает low reasoning');
  assert.equal(body.max_completion_tokens, 8192, 'но запас токенов даём');
});

test('PDF и картинка уходят частями сообщения, аудио — только через transcribe', async () => {
  let body;
  const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async (_u, i) => { body = JSON.parse(i.body); return ok('текст'); } });
  await client.generateText({ prompt: 'извлеки', media: [{ mimeType: 'application/pdf', data: 'JVBERi0=' }, { mimeType: 'image/png', data: 'iVBO' }] });
  const parts = body.messages.at(-1).content;
  assert.equal(parts[0].type, 'file');
  assert.equal(parts[0].file.file_data, 'data:application/pdf;base64,JVBERi0=');
  assert.equal(parts[1].image_url.url, 'data:image/png;base64,iVBO');
  assert.deepEqual(parts[2], { type: 'text', text: 'извлеки' });
  await assert.rejects(client.generateText({ prompt: 'x', media: [{ mimeType: 'audio/ogg', data: 'T2dn' }] }), { code: 'INPUT' });
});

test('transcribe: multipart в /audio/transcriptions', async () => {
  let url, init;
  const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async (u, i) => { url = u; init = i; return new Response('Мы продаём курсы.\n', { status: 200 }); } });
  const r = await client.transcribe({ buffer: Buffer.from('OggS'), mimeType: 'audio/ogg', filename: 'voice.ogg' });
  assert.equal(r.data, 'Мы продаём курсы.');
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get('model'), 'whisper-1');
  await assert.rejects(client.transcribe({ buffer: Buffer.alloc(0) }), { code: 'INPUT' });
});

test('ошибки HTTP и ответа превращаются в безопасные коды без ключа', async () => {
  const cases = [[401, 'AUTH'], [429, 'QUOTA'], [404, 'MODEL'], [500, 'PROVIDER'], [400, 'REQUEST']];
  for (const [status, code] of cases) {
    const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async () => reply({ error: { message: `bad key ${KEY}` } }, status) });
    const err = await client.generateText({ prompt: 'x' }).catch((e) => e);
    assert.ok(err instanceof OpenAIError);
    assert.equal(err.code, code);
    assert.ok(!err.message.includes(KEY));
  }
  const cut = createOpenAIClient({ apiKey: KEY, fetchImpl: async () => jsonOk('{"question":', 'incomplete') });
  await assert.rejects(cut.generateJSON({ prompt: 'x', schema: jsonSchema }), { code: 'INCOMPLETE' });
  const bad = createOpenAIClient({ apiKey: KEY, fetchImpl: async () => jsonOk('не json') });
  await assert.rejects(bad.generateJSON({ prompt: 'x', schema: jsonSchema }), { code: 'RESPONSE' });
  const net = createOpenAIClient({ apiKey: KEY, fetchImpl: async () => { throw new TypeError(`fetch failed ${KEY}`); } });
  const e = await net.generateText({ prompt: 'x' }).catch((x) => x);
  assert.equal(e.code, 'NETWORK');
  assert.ok(!e.message.includes(KEY));
});

test('неверные настройки и вход — CONFIG/INPUT', async () => {
  assert.throws(() => createOpenAIClient({ apiKey: '' }), { code: 'CONFIG' });
  assert.throws(() => createOpenAIClient({ apiKey: KEY, baseUrl: 'http://insecure' }), { code: 'CONFIG' });
  const client = createOpenAIClient({ apiKey: KEY, maxInputChars: 10, fetchImpl: async () => ok('x') });
  await assert.rejects(client.generateText({ prompt: 'слишком длинный запрос' }), { code: 'INPUT' });
  await assert.rejects(client.generateJSON({ prompt: 'x' }), { code: 'INPUT' });
});

test('выбор провайдера: OpenAI важнее Gemini, LLM_PROVIDER переопределяет, без ключей — null', () => {
  assert.equal(llmProvider({ OPENAI_API_KEY: 'a', GEMINI_API_KEY: 'b' }), 'openai');
  assert.equal(llmProvider({ OPENAI_API_KEY: 'a', GEMINI_API_KEY: 'b', LLM_PROVIDER: 'gemini' }), 'gemini');
  assert.equal(llmProvider({ GEMINI_API_KEY: 'b' }), 'gemini');
  assert.equal(llmProvider({}), null);
  assert.equal(createLlmClientFromEnv({}), null);
  const c = createLlmClientFromEnv({ OPENAI_API_KEY: KEY, OPENAI_MODEL: 'gpt-4o-mini' }, { maxOutputTokens: 2048 });
  assert.equal(c.provider, 'openai');
  assert.equal(c.model, 'gpt-4o-mini');
  assert.equal(createOpenAIClientFromEnv({ OPENAI_API_KEY: KEY }).model, 'gpt-6.1-sol');
});

test('JSON с media сохраняет Chat Completions, без media идёт через Responses', async () => {
  const calls = [];
  const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return url.endsWith('/responses') ? jsonOk('{"question":"Кто платит?"}') : ok('{"question":"Что в PDF?"}');
  } });
  const media = [{ mimeType: 'application/pdf', data: 'JVBERi0=' }];
  assert.deepEqual((await client.generateJSON({ prompt: 'извлеки', schema: jsonSchema, media })).data, { question: 'Что в PDF?' });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.messages[0].content[0].type, 'file');
  assert.deepEqual((await client.generateJSON({ prompt: 'питч', schema: jsonSchema, media: [] })).data, { question: 'Кто платит?' });
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
});

test('ошибка Responses сохраняет публичный класс OpenAIError и безопасные поля', async () => {
  const client = createOpenAIClient({ apiKey: KEY, fetchImpl: async () => reply({ error: { message: KEY } }, 429) });
  const error = await client.generateJSON({ prompt: 'питч', schema: jsonSchema }).catch((e) => e);
  assert.ok(error instanceof OpenAIError);
  assert.equal(error.code, 'QUOTA');
  assert.equal(error.httpStatus, 429);
  assert.equal(error.retryable, true);
  assert.ok(!error.message.includes(KEY));
});

test('custom base сохраняется для media/text, но явно запрещён для trainer JSON', async () => {
  let calls = 0;
  const client = createOpenAIClient({ apiKey: KEY, baseUrl: 'https://example.test/v1', fetchImpl: async (url) => {
    calls += 1;
    assert.equal(url, 'https://example.test/v1/chat/completions');
    return ok('ответ');
  } });
  await client.generateText({ prompt: 'x' });
  await assert.rejects(client.generateJSON({ prompt: 'x', schema: jsonSchema }), { code: 'CONFIG' });
  assert.equal(calls, 1);
});

test('JSON сохраняет явный бюджет и не отправляет reasoning классическим моделям', async () => {
  let body;
  const client = createOpenAIClient({ apiKey: KEY, model: 'gpt-4.1-mini', maxOutputTokens: 2048,
    fetchImpl: async (_, init) => { body = JSON.parse(init.body); return jsonOk('{"question":"Кто платит?"}'); } });
  await client.generateJSON({ prompt: 'питч', schema: jsonSchema });
  assert.equal(body.model, 'gpt-4.1-mini');
  assert.equal(body.max_output_tokens, 2048);
  assert.equal(body.reasoning, undefined);
});
