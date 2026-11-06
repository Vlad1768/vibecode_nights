import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL,
  GeminiError,
  createGeminiClient,
  createGeminiClientFromEnv,
} from './client.mjs';

// All credentials and provider responses below are synthetic. Never use the network.
const MODEL = 'gemini-4-argon';
const API_KEY = 'synthetic-offline-test-key';
const globalFetch = mock.method(globalThis, 'fetch', async () => {
  assert.fail('An offline client test attempted to call global fetch.');
});
after(() => globalFetch.mock.restore());

function successfulPayload(text = 'Готово', extra = {}) {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
    ...extra,
  };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function stubbedClient(payload = successfulPayload(), options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(payload);
  };
  return { calls, client: createGeminiClient({ apiKey: API_KEY, fetchImpl, ...options }) };
}

function isGeminiError(code, { httpStatus = 0, retryable = false } = {}) {
  return (error) => {
    assert.ok(error instanceof GeminiError);
    assert.equal(error.name, 'GeminiError');
    assert.equal(error.code, code);
    assert.equal(error.httpStatus, httpStatus);
    assert.equal(error.retryable, retryable);
    return true;
  };
}

function waitForAbort(signal) {
  assert.ok(signal instanceof AbortSignal);
  return new Promise((resolve, reject) => {
    const rejectAbort = () => reject(signal.reason);
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

function keepAlive(t) {
  // AbortSignal.timeout uses an unref'ed timer. Keep its offline fetch stub alive.
  const timer = setInterval(() => {}, 1000);
  t.after(() => clearInterval(timer));
}

test('retains the selected model and sends a server-side key only in the header', async () => {
  assert.equal(DEFAULT_MODEL, MODEL);
  const { client, calls } = stubbedClient(successfulPayload('Ответ', {
    modelVersion: 'gemini-4-argon-reported-version',
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7, totalTokenCount: 19 },
  }), { apiKey: ` ${API_KEY} `, model: MODEL, maxOutputTokens: 300 });

  const result = await client.generateText({ prompt: 'Запрос', system: 'Инструкция' });
  assert.equal(client.model, MODEL);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
  assert.equal(new URL(url).search, '');
  assert.ok(!url.includes(API_KEY));
  const headers = new Headers(init.headers);
  assert.equal(headers.get('x-goog-api-key'), API_KEY);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  const request = JSON.parse(init.body);
  assert.deepEqual(request.contents, [{ role: 'user', parts: [{ text: 'Запрос' }] }]);
  assert.deepEqual(request.systemInstruction, { parts: [{ text: 'Инструкция' }] });
  assert.deepEqual(request.generationConfig, { candidateCount: 1, maxOutputTokens: 300 });
  assert.ok(!init.body.includes(API_KEY));
  assert.deepEqual(result, {
    data: 'Ответ', modelVersion: 'gemini-4-argon-reported-version',
    usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
  });
});

test('JSON mode uses the schema contract and returns parsed data', async () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
  const { client, calls } = stubbedClient(successfulPayload('{"title":"Черновик"}'));
  const result = await client.generateJSON({ prompt: 'Подготовь JSON', schema });
  const request = JSON.parse(calls[0].init.body);
  assert.equal(request.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(request.generationConfig.responseJsonSchema, schema);
  assert.ok(!('responseSchema' in request.generationConfig));
  assert.ok(!('systemInstruction' in request));
  assert.deepEqual(result.data, { title: 'Черновик' });
  assert.equal(result.modelVersion, MODEL);
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
});

test('STOP output omits thought and non-text parts', async () => {
  const { client } = stubbedClient({ candidates: [{
    finishReason: 'STOP',
    content: { parts: [
      { text: 'Do not return internal thinking.', thought: true },
      { text: ' Первая ' },
      { inlineData: { mimeType: 'image/png', data: 'synthetic' } },
      { text: 'часть ' },
    ] },
  }] });
  assert.equal((await client.generateText({ prompt: 'Вопрос' })).data, 'Первая часть');
});

test('missing key and invalid configuration fail before any request', () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return response(successfulPayload()); };
  for (const badSettings of [
    {}, { apiKey: null }, { apiKey: '' }, { apiKey: '   ' },
    { apiKey: API_KEY, model: 'models/not-an-allowed-path' },
    { apiKey: API_KEY, timeoutMs: 0 },
    { apiKey: API_KEY, maxOutputTokens: 0 },
    { apiKey: API_KEY, maxInputChars: 0 },
    { apiKey: API_KEY, fetchImpl: null },
  ]) {
    assert.throws(() => createGeminiClient({ fetchImpl, ...badSettings }), isGeminiError('CONFIG'));
  }
  assert.equal(requests, 0);
});

test('invalid prompt, system, signal and request envelopes never call the provider', async () => {
  const { client, calls } = stubbedClient(successfulPayload(), { maxInputChars: 10 });
  for (const request of [
    undefined, null, {}, { prompt: '' }, { prompt: '   ' }, { prompt: 123 },
    { prompt: 'a', system: null }, { prompt: 'a', signal: {} },
    { prompt: '123456', system: '12345' },
  ]) {
    await assert.rejects(client.generateText(request), isGeminiError('INPUT'));
  }
  assert.equal(calls.length, 0);
  await client.generateText({ prompt: '123456', system: '1234' });
  assert.equal(calls.length, 1, 'the combined input limit is inclusive');
});

test('invalid or unserializable JSON schemas fail without a request', async () => {
  const { client, calls } = stubbedClient();
  const cyclic = { type: 'object' };
  cyclic.self = cyclic;
  for (const schema of [undefined, null, [], 'object', cyclic, { value: 1n }]) {
    await assert.rejects(client.generateJSON({ prompt: 'Вопрос', schema }), isGeminiError('INPUT'));
  }
  assert.equal(calls.length, 0);
});

test('an already cancelled request does not call the provider', async () => {
  const { client, calls } = stubbedClient();
  const controller = new AbortController();
  controller.abort(new Error(API_KEY));
  await assert.rejects(client.generateText({ prompt: 'Вопрос', signal: controller.signal }),
    isGeminiError('CANCELLED'));
  assert.equal(calls.length, 0);
});

test('invalid provider JSON and invalid generated JSON are RESPONSE failures', async () => {
  const client = createGeminiClient({ apiKey: API_KEY, fetchImpl: async () => ({
    ok: true, status: 200, json: async () => { throw new SyntaxError(API_KEY); },
  }) });
  await assert.rejects(client.generateText({ prompt: 'Вопрос' }), isGeminiError('RESPONSE'));
  const generated = stubbedClient(successfulPayload('not valid JSON')).client;
  await assert.rejects(generated.generateJSON({ prompt: 'Вопрос', schema: { type: 'object' } }),
    isGeminiError('RESPONSE'));
});

test('truncated output is rejected before attempting to parse partial JSON', async () => {
  const { client } = stubbedClient({ candidates: [{
    finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"partial":' }] },
  }] });
  await assert.rejects(client.generateJSON({ prompt: 'Вопрос', schema: { type: 'object' } }),
    isGeminiError('INCOMPLETE'));
});

test('prompt-level and candidate-level safety blocks do not expose partial output', async (t) => {
  const payloads = [
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: API_KEY }] } }] },
    { candidates: [{ finishReason: 'RECITATION', content: { parts: [{ text: API_KEY }] } }] },
  ];
  for (const [index, payload] of payloads.entries()) {
    await t.test(`blocked response ${index + 1}`, async () => {
      const { client } = stubbedClient(payload);
      await assert.rejects(client.generateText({ prompt: 'Вопрос' }), isGeminiError('BLOCKED'));
    });
  }
});

test('empty and malformed provider response shapes are non-retryable RESPONSE errors', async (t) => {
  const payloads = [
    null, {}, { candidates: [] },
    { candidates: [{ finishReason: 'STOP' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: 'invalid' } }] },
    successfulPayload(' \n '),
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hidden', thought: true }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [null] } }] },
  ];
  for (const [index, payload] of payloads.entries()) {
    await t.test(`response shape ${index + 1}`, async () => {
      const { client } = stubbedClient(payload);
      await assert.rejects(client.generateText({ prompt: 'Вопрос' }), isGeminiError('RESPONSE'));
    });
  }
});

test('HTTP failures have stable classification and are never automatically retried', async (t) => {
  for (const [status, code, retryable] of [
    [400, 'REQUEST', false], [401, 'AUTH', false], [403, 'AUTH', false],
    [404, 'MODEL', false], [429, 'QUOTA', true],
    [500, 'PROVIDER', true], [503, 'PROVIDER', true],
  ]) {
    await t.test(`HTTP ${status}`, async () => {
      let requests = 0;
      const client = createGeminiClient({ apiKey: API_KEY, fetchImpl: async () => {
        requests += 1;
        return response({ error: { message: API_KEY } }, status);
      } });
      await assert.rejects(client.generateText({ prompt: 'Вопрос' }), (error) => {
        isGeminiError(code, { httpStatus: status, retryable })(error);
        assert.ok(!error.message.includes(API_KEY));
        return true;
      });
      assert.equal(requests, 1);
    });
  }
});

test('network exceptions are sanitized and retryability does not cause a retry', async () => {
  let requests = 0;
  const privatePrompt = 'synthetic-private-prompt';
  const client = createGeminiClient({ apiKey: API_KEY, fetchImpl: async () => {
    requests += 1;
    throw new Error(`Network details: ${API_KEY}, ${privatePrompt}`);
  } });
  await assert.rejects(client.generateText({ prompt: privatePrompt }), (error) => {
    isGeminiError('NETWORK', { retryable: true })(error);
    const publicError = `${error.stack}\n${JSON.stringify(error)}`;
    assert.ok(!publicError.includes(API_KEY));
    assert.ok(!publicError.includes(privatePrompt));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(requests, 1);
});

test('HTTP 400 prerequisites are distinguished from invalid request parameters', async () => {
  const client = createGeminiClient({ apiKey: API_KEY, fetchImpl: async () => response({
    error: { status: 'FAILED_PRECONDITION', message: API_KEY },
  }, 400) });
  await assert.rejects(client.generateText({ prompt: 'Вопрос' }), (error) => {
    isGeminiError('ACCESS', { httpStatus: 400 })(error);
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
});

test('transport failure during body reading remains a sanitized network error', async () => {
  const client = createGeminiClient({ apiKey: API_KEY, fetchImpl: async () => ({
    ok: true, status: 200, json: async () => { throw new TypeError(API_KEY); },
  }) });
  await assert.rejects(client.generateText({ prompt: 'Вопрос' }), (error) => {
    isGeminiError('NETWORK', { retryable: true })(error);
    assert.ok(!error.message.includes(API_KEY));
    return true;
  });
});

test('usage preserves reported zero but represents unknown or invalid counters as null', async () => {
  const { client } = stubbedClient(successfulPayload('ok', {
    usageMetadata: { promptTokenCount: 0, candidatesTokenCount: -1, totalTokenCount: '12' },
  }));
  assert.deepEqual((await client.generateText({ prompt: 'Вопрос' })).usage, {
    inputTokens: 0, outputTokens: null, totalTokens: null,
  });
});

for (const phase of ['fetch', 'body']) {
  test(`timeout remains TIMEOUT during ${phase}`, async (t) => {
    keepAlive(t);
    let requests = 0;
    const client = createGeminiClient({ apiKey: API_KEY, timeoutMs: 30,
      fetchImpl: async (url, { signal }) => {
        requests += 1;
        if (phase === 'fetch') return waitForAbort(signal);
        return { ok: true, status: 200, json: () => waitForAbort(signal) };
      },
    });
    await assert.rejects(client.generateText({ prompt: 'Вопрос' }), isGeminiError('TIMEOUT'));
    assert.equal(requests, 1);
  });

  test(`caller cancellation remains CANCELLED during ${phase}`, async () => {
    const controller = new AbortController();
    let notifyStarted;
    const started = new Promise((resolve) => { notifyStarted = resolve; });
    let requests = 0;
    const client = createGeminiClient({ apiKey: API_KEY, timeoutMs: 1000,
      fetchImpl: async (url, { signal }) => {
        requests += 1;
        if (phase === 'fetch') {
          notifyStarted();
          return waitForAbort(signal);
        }
        return { ok: true, status: 200, json: () => {
          notifyStarted();
          return waitForAbort(signal);
        } };
      },
    });
    const pending = client.generateText({ prompt: 'Вопрос', signal: controller.signal });
    await started;
    controller.abort(new Error(API_KEY));
    await assert.rejects(pending, isGeminiError('CANCELLED'));
    assert.equal(requests, 1);
  });
}

test('environment factory uses supplied settings without reading real environment files', async () => {
  const calls = [];
  const client = createGeminiClientFromEnv({
    GEMINI_API_KEY: API_KEY,
    GEMINI_MODEL: MODEL,
    GEMINI_TIMEOUT_MS: '1234',
    GEMINI_MAX_OUTPUT_TOKENS: '300',
  }, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return response(successfulPayload());
  } });
  assert.equal(client.model, MODEL);
  await client.generateText({ prompt: 'Вопрос' });
  assert.equal(JSON.parse(calls[0].init.body).generationConfig.maxOutputTokens, 300);
  assert.equal(calls.length, 1);
  assert.throws(() => createGeminiClientFromEnv({}), isGeminiError('CONFIG'));
  assert.throws(() => createGeminiClientFromEnv({
    GEMINI_API_KEY: API_KEY, GEMINI_TIMEOUT_MS: 'not-a-number',
  }), isGeminiError('CONFIG'));
});

test('media: аудио/PDF уходят как inlineData перед текстом, неверные — INPUT', async () => {
  let sent;
  const client = createGeminiClient({
    apiKey: 'synthetic-key',
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'расшифровка' }] } }] }), { status: 200 });
    },
  });
  const r = await client.generateText({ prompt: 'Расшифруй', media: [{ mimeType: 'audio/ogg', data: 'AAAA' }] });
  assert.equal(r.data, 'расшифровка');
  assert.deepEqual(sent.contents[0].parts, [{ inlineData: { mimeType: 'audio/ogg', data: 'AAAA' } }, { text: 'Расшифруй' }]);
  await assert.rejects(client.generateText({ prompt: 'x', media: [{ mimeType: 'bad', data: 'A' }] }), { code: 'INPUT' });
  await assert.rejects(client.generateText({ prompt: 'x', media: 'nope' }), { code: 'INPUT' });
});
