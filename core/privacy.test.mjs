import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainer } from './trainer.mjs';
import { DEFAULT_CONTENT } from './content.mjs';
import { createMemoryStore } from '../server/store.mjs';

const userId = 'web:privacy-test';
const pitch = 'Наш сервис помогает небольшим кафе вести учет продуктов и снижать потери. Провели 12 интервью и 2 пилота. Клиенты платят подписку 900 рублей в месяц.';
const startData = () => ({ kind: 'pitch', known: ['Сервис для кафе'], missing: [], manipulation: false, question: 'Кто покупает ваш продукт и почему?' });
const nextData = () => ({ reaction: 'Нужна проверка.', question: 'Чем подтверждён спрос на ваш продукт?', manipulation: false });
const notFound = (error) => error.status === 404 && error.code === 'SESSION_NOT_FOUND';
const outcome = (promise) => promise.then(value => ({ value }), error => ({ error }));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const make = (engine, store = createMemoryStore()) => ({
  store,
  trainer: createTrainer({ content: DEFAULT_CONTENT, store, engine, fallback: false }),
});

test('deleting while start waits for the model prevents saving the new session', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const { trainer, store } = make({ start: async () => {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return startData();
  } });
  const pending = outcome(trainer.start({ userId, pitch }));
  await entered.promise;
  assert.equal((await trainer.deleteUser(userId)).status, 204);
  release.resolve();
  assert.ok(notFound((await pending).error));
  assert.equal(store.size(), 0);
  const fresh = await trainer.start({ userId, pitch });
  assert.equal(fresh.status, 201);
  assert.equal(store.size(), 1);
});

test('deleting during an answer cancels both its save and queued duplicate answer', async () => {
  const entered = deferred();
  const release = deferred();
  let nextCalls = 0;
  const { trainer, store } = make({
    start: async () => startData(),
    next: async () => { nextCalls++; entered.resolve(); await release.promise; return nextData(); },
  });
  const first = await trainer.start({ userId, pitch });
  const sessionId = first.body.sessionId;
  const input = { userId, step: 1, answer: 'Клиент — владелец кафе, которому важно сокращение потерь.' };
  const pending = outcome(trainer.answer(sessionId, input));
  await entered.promise;
  const duplicate = outcome(trainer.answer(sessionId, input));
  assert.equal((await trainer.deleteUser(userId)).status, 204);
  assert.equal(store.size(), 0);
  release.resolve();
  assert.ok(notFound((await pending).error));
  assert.ok(notFound((await duplicate).error));
  assert.equal(nextCalls, 1);
  assert.equal(store.size(), 0);
  await assert.rejects(trainer.get(sessionId, userId), notFound);
  await assert.rejects(trainer.start({ userId, pitch, previousSessionId: sessionId }), notFound);
  assert.equal((await trainer.start({ userId, pitch })).status, 201);
});

test('a fresh start after deletion survives when an older model call finishes later', async () => {
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const { trainer, store } = make({ start: async () => {
    if (++calls === 1) { entered.resolve(); await release.promise; }
    return startData();
  } });
  const old = outcome(trainer.start({ userId, pitch }));
  await entered.promise;
  await trainer.deleteUser(userId);
  const fresh = await trainer.start({ userId, pitch });
  release.resolve();
  assert.ok(notFound((await old).error));
  assert.equal(store.size(), 1);
  assert.equal((await trainer.get(fresh.body.sessionId, userId)).status, 200);
  await assert.rejects(trainer.get(fresh.body.sessionId, 'web:other-user'), notFound);
});

test('deletion waits for a pending store write and removes its data before returning', async () => {
  const store = createMemoryStore();
  const save = store.save.bind(store);
  const entered = deferred();
  const release = deferred();
  let saves = 0;
  store.save = async session => {
    if (++saves === 1) { entered.resolve(); await release.promise; }
    return save(session);
  };
  const { trainer } = make({ start: async () => startData() }, store);
  const starting = outcome(trainer.start({ userId, pitch }));
  await entered.promise;
  const deleting = trainer.deleteUser(userId);
  release.resolve();
  assert.equal((await deleting).status, 204);
  assert.ok(notFound((await starting).error));
  assert.equal(store.size(), 0);
  assert.equal((await trainer.start({ userId, pitch })).status, 201);
});

test('deleting one user does not invalidate another user model operation', async () => {
  const entered = deferred();
  const release = deferred();
  const { trainer, store } = make({ start: async () => { entered.resolve(); await release.promise; return startData(); } });
  const starting = trainer.start({ userId: 'web:other-user', pitch });
  await entered.promise;
  await trainer.deleteUser(userId);
  release.resolve();
  assert.equal((await starting).status, 201);
  assert.equal(store.size(), 1);
});

test('deleting while the final score is being generated cannot restore the result', async () => {
  const entered = deferred();
  const release = deferred();
  const { trainer, store } = make({
    start: async () => startData(),
    next: async () => nextData(),
    finish: async () => {
      entered.resolve();
      await release.promise;
      return { criteria: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, level: 0, evidence: '', comment: 'Нет данных.' })), advice: [], strong: '', weak: '' };
    },
  });
  const first = await trainer.start({ userId, pitch });
  for (let step = 1; step < 5; step++) {
    await trainer.answer(first.body.sessionId, { userId, step, answer: 'Пока не знаю, проверю на следующем пилоте.' });
  }
  const finishing = outcome(trainer.answer(first.body.sessionId, { userId, step: 5, answer: 'Пока не знаю.' }));
  await entered.promise;
  await trainer.deleteUser(userId);
  release.resolve();
  assert.ok(notFound((await finishing).error));
  assert.equal(store.size(), 0);
});
