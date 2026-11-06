import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, OpenAIError, createOpenAIClient, createOpenAIClientFromEnv } from './responses.mjs';
import { SCHEMAS } from '../../core/llm.mjs';

// All credentials and responses are synthetic. These tests never call the network.
const API_KEY = 'synthetic-offline-openai-key';
const fetchGuard = mock.method(globalThis, 'fetch', async () => assert.fail('Offline test attempted network access'));
after(() => fetchGuard.mock.restore());
const schema = { type: 'object', properties: { answer: { type: 'string', maxLength: 10 } }, required: ['answer'] };
const request = { system: 'Правила', prompt: 'Питч студента', schema };
function payload(data = { answer: 'Ответ' }, extra = {}) {
  return { status: 'completed', model: DEFAULT_MODEL, output: [
    { type: 'reasoning', summary: [] },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
  ], ...extra };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function stub(body = payload(), options = {}) {
  const calls = [];
  const client = createOpenAIClient({ apiKey: API_KEY, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return response(body);
  }, ...options });
  return { client, calls };
}
const code = (expected, status = 0) => (error) => {
  assert.ok(error instanceof OpenAIError);
  assert.equal(error.code, expected);
  assert.equal(error.httpStatus, status);
  assert.ok(!JSON.stringify(error).includes(API_KEY));
  assert.ok(!String(error).includes('sensitive-provider-detail'));
  return true;
};
function awaitAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('Sol JSON request has server-only auth, no storage, bounded output and separate instructions', async () => {
  const { client, calls } = stub(payload({ answer: 'Ответ' }, {
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, model: 'gpt-6.1-sol-reported-version',
  }), { apiKey: ` ${API_KEY} ` });
  const result = await client.generateJSON(request);
  assert.deepEqual(result, { data: { answer: 'Ответ' }, modelVersion: 'gpt-6.1-sol-reported-version',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(init.redirect, 'error');
  assert.equal(init.method, 'POST');
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, 'gpt-6.1-sol');
  assert.equal(sent.store, false);
  assert.equal(sent.max_output_tokens, 8192);
  assert.deepEqual(sent.reasoning, { effort: 'low' });
  assert.equal(sent.instructions, request.system);
  assert.equal(sent.input, request.prompt);
  assert.equal(sent.text.format.type, 'json_schema');
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  assert.ok(!init.body.includes(API_KEY));
});

test('all three trainer schemas become strict recursively without mutating originals', async () => {
  const originals = structuredClone(SCHEMAS);
  const generated = [
    { kind: 'pitch', known: [], missing: [], manipulation: false, question: 'Кто платит?' },
    { reaction: 'Понятно.', question: 'Как проверяли?', manipulation: false },
    { criteria: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, level: 0, evidence: '', comment: 'Нет данных' })),
      strong: 'Есть идея', weak: 'Нет данных', advice: Array.from({ length: 3 }, () => ({
        action: 'Позвоните клиенту', deadline: 'сегодня', doneWhen: 'Есть запись', basedOn: 'критерий 1',
      })) },
  ];
  for (const [i, current] of Object.values(SCHEMAS).entries()) {
    const { client, calls } = stub(payload(generated[i]));
    await client.generateJSON({ ...request, schema: current });
    const converted = JSON.parse(calls[0].init.body).text.format.schema;
    function check(node) {
      if (node.type === 'object') {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual(node.required, Object.keys(node.properties));
        Object.values(node.properties).forEach(check);
      }
      if (node.type === 'array') check(node.items);
    }
    check(converted);
  }
  assert.deepEqual(SCHEMAS, originals);
});

for (const [status, expected] of [[400, 'REQUEST'], [401, 'AUTH'], [403, 'AUTH'], [404, 'MODEL'], [429, 'QUOTA'], [503, 'PROVIDER']]) {
  test(`HTTP ${status}: safe ${expected} error, no retry or provider-body leak`, async () => {
    let calls = 0;
    const { client } = stub(null, { fetchImpl: async () => {
      calls += 1;
      return { ok: false, status, json: () => assert.fail('Provider error body must not be read') };
    } });
    await assert.rejects(client.generateJSON(request), code(expected, status));
    assert.equal(calls, 1);
  });
}

for (const bad of [null, {}, { status: 'failed', error: { message: 'sensitive-provider-detail' } },
  payload(undefined, { output: [] }), payload(undefined, { output: [null] }),
  payload(undefined, { output: [{ type: 'function_call', arguments: '{}' }] })]) {
  test('malformed Responses envelope fails safely', async () => {
    await assert.rejects(stub(bad).client.generateJSON(request), code('RESPONSE'));
  });
}
test('incomplete response is rejected even when it includes parseable output', async () => {
  await assert.rejects(stub(payload({ answer: 'Ответ' }, { status: 'incomplete' })).client.generateJSON(request), code('INCOMPLETE'));
});
test('refusal is rejected explicitly', async () => {
  const body = payload();
  body.output[1].content = [{ type: 'refusal', refusal: 'sensitive-provider-detail' }];
  await assert.rejects(stub(body).client.generateJSON(request), code('BLOCKED'));
});
test('invalid provider JSON is rejected without exposing it', async () => {
  const body = payload();
  body.output[1].content[0].text = 'sensitive-provider-detail';
  await assert.rejects(stub(body).client.generateJSON(request), code('RESPONSE'));
  const { client } = stub(null, { fetchImpl: async () => ({ ok: true, json: async () => {
    throw new SyntaxError('sensitive-provider-detail');
  } }) });
  await assert.rejects(client.generateJSON(request), code('RESPONSE'));
});

for (const bad of [{}, { answer: 3 }, { answer: 'слишком длинный ответ' }, { answer: 'Ответ', extra: 'hidden' }, null, []]) {
  test('returned object must satisfy required fields, types, bounds and no extra properties', async () => {
    await assert.rejects(stub(payload(bad)).client.generateJSON(request), code('RESPONSE'));
  });
}
test('arrays, enums, integer bounds and nested fields are validated locally', async () => {
  const nested = { type: 'object', properties: { rows: { type: 'array', minItems: 1, maxItems: 1,
    items: { type: 'object', properties: {
      id: { type: 'integer', minimum: 1, maximum: 10 }, tag: { type: 'string', enum: ['ok'] },
    } } } } };
  for (const rows of [[], [{ id: 1, tag: 'ok' }, { id: 2, tag: 'ok' }], [{ id: 0, tag: 'ok' }],
    [{ id: 11, tag: 'ok' }], [{ id: 1.5, tag: 'ok' }], [{ id: 1, tag: 'wrong' }], [{ id: 1 }]]) {
    await assert.rejects(stub(payload({ rows })).client.generateJSON({ ...request, schema: nested }), code('RESPONSE'));
  }
  await stub(payload({ rows: [{ id: 1, tag: 'ok' }] })).client.generateJSON({ ...request, schema: nested });
});

test('config rejects invalid key, model, limits and reasoning before calling fetch', () => {
  for (const options of [{ apiKey: '' }, { apiKey: 'bad\nheader' }, { model: 'https://other.host' },
    { timeoutMs: 30001 }, { timeoutMs: 0 }, { maxOutputTokens: NaN }, { maxOutputTokens: 8193 }, { maxInputChars: 0 },
    { reasoningEffort: 'unknown' }, { fetchImpl: null }]) {
    assert.throws(() => createOpenAIClient({ apiKey: API_KEY, ...options }), code('CONFIG'));
  }
});
test('invalid inputs and unsupported schemas fail before a billable request', async () => {
  const { client, calls } = stub();
  const circular = { type: 'array' }; circular.items = circular;
  for (const input of [null, [], {}, { ...request, prompt: '' }, { ...request, prompt: 'a'.repeat(30001) },
    { ...request, system: 4 }, { ...request, signal: {} }, { ...request, schema: {} },
    { ...request, schema: { type: 'string' } }, { ...request, schema: { ...schema, oneOf: [] } },
    { ...request, schema: { type: 'object', properties: { cycle: circular } } }]) {
    await assert.rejects(client.generateJSON(input), code('INPUT'));
  }
  assert.equal(calls.length, 0);
});
test('pre-aborted request makes no network call', async () => {
  const { client, calls } = stub();
  await assert.rejects(client.generateJSON({ ...request, signal: AbortSignal.abort() }), code('CANCELLED'));
  assert.equal(calls.length, 0);
});
test('in-flight cancellation reaches fetch and returns sanitized cancellation', async () => {
  const controller = new AbortController();
  const { client } = stub(null, { fetchImpl: async (_, init) => {
    queueMicrotask(() => controller.abort(new Error('sensitive-provider-detail')));
    return awaitAbort(init.signal);
  } });
  await assert.rejects(client.generateJSON({ ...request, signal: controller.signal }), code('CANCELLED'));
});
test('timeout bounds fetch and response-body reads', async (t) => {
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  for (const afterHeaders of [false, true]) {
    const { client } = stub(null, { timeoutMs: 5, fetchImpl: async (_, init) => afterHeaders
      ? { ok: true, json: () => awaitAbort(init.signal) } : awaitAbort(init.signal) });
    await assert.rejects(client.generateJSON(request), code('TIMEOUT'));
  }
});
test('network exceptions do not leak raw messages or credentials', async () => {
  const { client } = stub(null, { fetchImpl: async () => { throw new Error(`${API_KEY} sensitive-provider-detail`); } });
  await assert.rejects(client.generateJSON(request), code('NETWORK'));
});
test('environment selects exact model and configurable limits without fallback', async () => {
  let body;
  const client = createOpenAIClientFromEnv({ OPENAI_API_KEY: API_KEY, OPENAI_MODEL: 'gpt-6-sol',
    OPENAI_TIMEOUT_MS: '10000', OPENAI_MAX_OUTPUT_TOKENS: '4096', OPENAI_REASONING_EFFORT: 'medium' },
  { fetchImpl: async (_, init) => { body = JSON.parse(init.body); return response(payload()); } });
  await client.generateJSON(request);
  assert.equal(client.model, 'gpt-6-sol');
  assert.equal(body.model, 'gpt-6-sol');
  assert.equal(body.max_output_tokens, 4096);
  assert.equal(body.reasoning.effort, 'medium');
});
test('usage is optional and malformed counts are not trusted', async () => {
  const { client } = stub(payload(undefined, { usage: { input_tokens: -1, output_tokens: '4', total_tokens: NaN } }));
  assert.deepEqual((await client.generateJSON(request)).usage, { inputTokens: null, outputTokens: null, totalTokens: null });
});
