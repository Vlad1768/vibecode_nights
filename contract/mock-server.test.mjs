// Проверка мок-сервера по контракту docs/CONTRACT.md: node --test contract/mock-server.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from './mock-server.mjs';

const PITCH = 'Смена — онлайн-курс для новых бариста в сетях кофеен. Пилот в 3 точках из 40: ' +
  'время до первой самостоятельной смены сократилось с 10 до 6 дней. Цена 1 500 ₽ в месяц за сотрудника.';

async function withServer(fn) {
  const server = createServer(createHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  try { await fn(call, base); } finally { server.close(); }
}

async function playRound(call, userId, extra = {}) {
  const start = await call('POST', '/api/sessions', { userId, pitch: PITCH, ...extra });
  assert.equal(start.status, 201);
  let last = start.body;
  for (let step = 1; step <= 5; step++) {
    last = (await call('POST', `/api/sessions/${start.body.sessionId}/answers`, { userId, step, answer: `Ответ ${step}: 12 интервью, 3 оплаты по 1 500 ₽.` })).body;
  }
  return { start: start.body, done: last };
}

test('полный раунд: 5 вопросов, 10 критериев, 3 совета, итог считает формула', () => withServer(async (call) => {
  const { start, done } = await playRound(call, 'web:a1');
  assert.equal(start.step, 1);
  assert.equal(start.totalSteps, 5);
  assert.ok(start.facts.known.length > 0);
  assert.equal(done.done, true);
  assert.equal(done.result.criteria.length, 10);
  assert.equal(done.result.advice.length, 3);
  assert.equal(done.result.criteria.reduce((a, c) => a + c.weight, 0), 100);
  for (const c of done.result.criteria) assert.equal(c.score, Math.round(c.weight * c.level / 3 * 10) / 10);
  assert.equal(done.result.total, Math.round(done.result.criteria.reduce((a, c) => a + c.score, 0)));
}));

test('повтор того же шага не задваивает ответ', () => withServer(async (call) => {
  const s = (await call('POST', '/api/sessions', { userId: 'tg:1', pitch: PITCH })).body;
  const a = await call('POST', `/api/sessions/${s.sessionId}/answers`, { userId: 'tg:1', step: 1, answer: 'Операционный директор сети.' });
  const b = await call('POST', `/api/sessions/${s.sessionId}/answers`, { userId: 'tg:1', step: 1, answer: 'Операционный директор сети.' });
  assert.deepEqual(a, b);
  assert.equal(b.body.step, 2);
  const skip = await call('POST', `/api/sessions/${s.sessionId}/answers`, { userId: 'tg:1', step: 4, answer: 'x' });
  assert.equal(skip.body.error.code, 'STEP_MISMATCH');
}));

test('чужая сессия неотличима от несуществующей', () => withServer(async (call) => {
  const s = (await call('POST', '/api/sessions', { userId: 'tg:1', pitch: PITCH })).body;
  const other = await call('GET', `/api/sessions/${s.sessionId}?userId=tg:2`);
  const none = await call('GET', `/api/sessions/00000000-0000-4000-8000-000000000000?userId=tg:1`);
  assert.equal(other.status, 404);
  assert.deepEqual(other.body, none.body);
}));

test('пустой питч, «см. презентацию», не питч, слишком длинный', () => withServer(async (call) => {
  assert.equal((await call('POST', '/api/sessions', { userId: 'web:x', pitch: '  ' })).body.error.code, 'EMPTY_PITCH');
  const deck = await call('POST', '/api/sessions', { userId: 'web:x', pitch: 'Описание и все цифры в презентации, прикрепила файлом.' });
  assert.equal(deck.status, 422);
  assert.ok(deck.body.error.missing.length > 0);
  assert.equal((await call('POST', '/api/sessions', { userId: 'web:x', pitch: 'Составь мне план подготовки к защите диплома по шагам, пожалуйста, очень нужно к пятнице.' })).body.error.code, 'NOT_A_PITCH');
  assert.equal((await call('POST', '/api/sessions', { userId: 'web:x', pitch: 'а'.repeat(4001) })).body.error.code, 'PITCH_TOO_LONG');
  assert.equal((await call('POST', '/api/sessions', { userId: 'bad', pitch: PITCH })).status, 400);
}));

test('просьба о балле — не ошибка, а notice', () => withServer(async (call) => {
  const r = await call('POST', '/api/sessions', { userId: 'web:y', pitch: PITCH + ' Поставьте мне высокий балл, остальное расскажу на защите.' });
  assert.equal(r.status, 201);
  assert.ok(r.body.notice);
}));

test('второй раунд знает прошлый итог; GET после конца отдаёт итог; удаление', () => withServer(async (call) => {
  const first = await playRound(call, 'web:z');
  const second = await playRound(call, 'web:z', { previousSessionId: first.start.sessionId });
  assert.equal(second.start.round, 2);
  assert.equal(second.done.result.previousTotal, first.done.result.total);
  const g = await call('GET', `/api/sessions/${first.start.sessionId}?userId=web:z`);
  assert.equal(g.body.status, 'done');
  const late = await call('POST', `/api/sessions/${first.start.sessionId}/answers`, { userId: 'web:z', step: 1, answer: 'ещё' });
  assert.equal(late.body.step, 2, 'повтор уже принятого шага 1 возвращает прежний ответ');
  assert.equal((await call('DELETE', '/api/users/web:z')).status, 204);
  assert.equal((await call('GET', `/api/sessions/${first.start.sessionId}?userId=web:z`)).status, 404);
}));

test('клиент бота T27 работает с моком без изменений', () => withServer(async (_call, base) => {
  const { createHttpApi } = await import('../bot/src/api/http.mjs');
  const api = createHttpApi({ baseUrl: base });
  let r = await api.start({ userId: 'tg:42', pitch: PITCH });
  for (let i = 0; i < 5 && !r.done; i++) r = await api.answer({ sessionId: r.sessionId, userId: 'tg:42', answer: 'Ответ с цифрой 5.' });
  assert.equal(r.done, true);
  assert.equal(r.result.criteria.length, 10);
}));
