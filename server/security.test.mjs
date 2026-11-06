import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from './handler.mjs';
import { TrainerError } from '../core/guard.mjs';

const PITCH = 'Наш сервис помогает небольшим кафе вести учет продуктов и снижать потери. Провели 12 интервью и 2 пилота. Клиенты платят подписку 900 рублей в месяц.';
const success = () => ({ status: 201, body: { ok: true } });
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function withServer(trainer, options, fn) {
  const handler = createHandler({ mode: 'live', ...trainer }, options);
  const server = createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), retry: response.headers.get('retry-after') };
  };
  const start = (userId = 'web:security', pitch = PITCH) => request('/api/sessions', { userId, pitch });
  try { await fn({ request, start }); }
  finally { await new Promise(r => server.close(r)); handler.close(); }
}

test('one user cannot bypass start quota with concurrent requests', async () => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  await withServer({ start: async () => { calls++; entered.resolve(); await gate.promise; return success(); } },
    { sessionsPerHour: 1 }, async ({ start }) => {
      const first = start();
      await entered.promise;
      // They arrive while the first model operation is still running.
      const others = await Promise.all([start(), start()]);
      assert.deepEqual(others.map(r => r.status), [429, 429]);
      assert.ok(others.every(r => Number(r.retry) > 0));
      assert.equal(calls, 1);
      gate.resolve();
      assert.equal((await first).status, 201);
    });
});

for (const failure of ['rejected', 'unavailable']) {
  test(`a ${failure} model attempt still consumes the hourly quota`, async () => {
    let calls = 0;
    await withServer({ start: async () => {
      calls++;
      if (failure === 'rejected') throw new TrainerError(422, 'NOT_A_PITCH', 'Not a pitch');
      throw new Error('Simulated provider failure');
    } }, { sessionsPerHour: 1 }, async ({ start }) => {
      assert.equal((await start()).status, failure === 'rejected' ? 422 : 503);
      assert.equal((await start()).status, 429);
      assert.equal(calls, 1);
    });
  });
}

test('cheap invalid pitch is rejected before counting a model attempt', async () => {
  let calls = 0;
  await withServer({ start: async () => { calls++; return success(); } },
    { sessionsPerHour: 1 }, async ({ start }) => {
      assert.equal((await start('web:security', '')).status, 422);
      assert.equal((await start('web:security', 'x'.repeat(4001))).status, 422);
      assert.equal((await start()).status, 201);
      assert.equal(calls, 1);
    });
});

test('global cap covers bot/API starts and answers without blocking health', async () => {
  const gate = deferred();
  const entered = deferred();
  let calls = 0;
  const work = async () => { calls++; entered.resolve(); await gate.promise; return success(); };
  await withServer({ start: work, answer: work }, { maxConcurrent: 1, sessionsPerHour: 1 }, async ({ start, request }) => {
    const first = start('tg:1');
    await entered.promise;
    assert.equal((await start('web:second')).status, 429);
    assert.equal((await request('/api/sessions/local/answers', { userId: 'tg:2', step: 1, answer: 'Some answer' })).status, 429);
    assert.equal((await request('/api/health')).status, 200);
    assert.equal(calls, 1);
    gate.resolve();
    assert.equal((await first).status, 201);
    // Saturation did not charge the rejected second user's hourly allowance.
    assert.equal((await start('web:second')).status, 201);
  });
});

test('HTTP timeout does not release a still-running operation slot', async () => {
  const gate = deferred();
  const finished = deferred();
  let calls = 0;
  await withServer({ start: async () => {
    calls++;
    if (calls === 1) { await gate.promise; finished.resolve(); }
    return success();
  } }, { maxConcurrent: 1, requestTimeoutMs: 20 }, async ({ start }) => {
    assert.equal((await start('web:first')).status, 503);
    assert.equal((await start('web:second')).status, 429);
    assert.equal(calls, 1);
    gate.resolve();
    await finished.promise;
    assert.equal((await start('web:second')).status, 201);
    assert.equal(calls, 2);
  });
});

test('a rejected operation releases its global slot', async () => {
  let calls = 0;
  await withServer({ start: async () => {
    if (++calls === 1) throw new Error('Simulated provider failure');
    return success();
  } }, { maxConcurrent: 1 }, async ({ start }) => {
    assert.equal((await start('web:first')).status, 503);
    assert.equal((await start('web:second')).status, 201);
  });
});
