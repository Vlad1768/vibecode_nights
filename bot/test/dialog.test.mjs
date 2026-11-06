import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialog, TEXTS, MAX_INPUT_CHARS } from '../src/dialog.mjs';
import { createMockApi, CRITERIA } from '../src/api/mock.mjs';
import { ApiError } from '../src/api/errors.mjs';

const PITCH =
  'ЛабСклад — сервис, через который вузовские лаборатории сдают друг другу в аренду простаивающее ' +
  'оборудование. 23 интервью, пилот в двух лабораториях, 9 бронирований за 6 недель.';

function user(dialog, id) {
  return (text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text });
}

test('полный раунд: /start → описание → 5 вопросов → итог с 10 критериями и 3 советами', async () => {
  const send = user(createDialog({ api: createMockApi() }), 1);
  assert.deepEqual(await send('/start'), [TEXTS.welcome]);

  const first = await send(PITCH);
  assert.equal(first[0], TEXTS.demo);
  assert.match(first[1], /^Вопрос 1\/5\n\n/);

  for (let step = 2; step <= 5; step++) {
    const [q] = await send(`Подробный ответ на вопрос ${step - 1} с цифрами и фактами.`);
    assert.match(q, new RegExp(`^Вопрос ${step}/5`));
  }
  const [result] = await send('Последний ответ с цифрами.');
  assert.match(result, /^Итог: \d+\/100/);
  for (const name of CRITERIA) assert.ok(result.includes(name), `нет критерия ${name}`);
  const advice = result.split('Что сделать до выступления:')[1].trim().split('\n').filter((l) => /^\d\. /.test(l));
  assert.equal(advice.length, 3);
});

test('после итога новый текст начинает новый раунд, /new сбрасывает текущий', async () => {
  const send = user(createDialog({ api: createMockApi() }), 2);
  await send(PITCH);
  await send('ответ');
  const [, q] = await send('/new').then(() => send(PITCH));
  assert.match(q, /^Вопрос 1\/5/);
});

test('сессии разных пользователей не смешиваются', async () => {
  const dialog = createDialog({ api: createMockApi() });
  const a = user(dialog, 10);
  const b = user(dialog, 20);
  await a(PITCH);
  await a('ответ A1');
  await a('ответ A2');
  const [, qb] = await b(PITCH);
  assert.match(qb, /^Вопрос 1\/5/);
  const [qa] = await a('ответ A3');
  assert.match(qa, /^Вопрос 4\/5/);
  const [qb2] = await b('ответ B1');
  assert.match(qb2, /^Вопрос 2\/5/);
});

test('API не отдаёт чужую сессию', async () => {
  const api = createMockApi();
  const { sessionId } = await api.start({ userId: 'tg:1', pitch: PITCH });
  await assert.rejects(api.answer({ sessionId, userId: 'tg:2', answer: 'x' }), { code: 'SESSION_NOT_FOUND' });
});

test('пустой, слишком длинный и нетекстовый ввод дают понятный ответ', async () => {
  const send = user(createDialog({ api: createMockApi() }), 3);
  assert.deepEqual(await send('   '), [TEXTS.emptyInput]);
  assert.deepEqual(await send('x'.repeat(MAX_INPUT_CHARS + 1)), [TEXTS.tooLong]);
  assert.deepEqual(await send(undefined), [TEXTS.notText]);
  assert.deepEqual(await send('/foo'), [TEXTS.unknownCommand]);
});

test('пока идёт запрос, второе сообщение того же пользователя отклоняется', async () => {
  let release;
  const api = {
    mode: 'http',
    start: () => new Promise((r) => { release = () => r({ sessionId: 's', step: 1, totalSteps: 5, question: 'Q1' }); }),
    answer: async () => ({ sessionId: 's', step: 2, totalSteps: 5, question: 'Q2' }),
  };
  const send = user(createDialog({ api }), 4);
  const first = send(PITCH);
  assert.deepEqual(await send('второе'), [TEXTS.busy]);
  release();
  assert.deepEqual(await first, ['Вопрос 1/5\n\nQ1']);
});

test('сбой API не теряет ответ: /retry повторяет тот же запрос', async () => {
  const seen = [];
  let fail = true;
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async ({ answer }) => {
      seen.push(answer);
      if (fail) throw new ApiError('AI_UNAVAILABLE');
      return { sessionId: 's1', step: 2, totalSteps: 5, question: 'Q2' };
    },
  };
  const send = user(createDialog({ api }), 5);
  await send(PITCH);
  const [err] = await send('мой важный ответ');
  assert.match(err, /\/retry/);
  fail = false;
  assert.deepEqual(await send('/retry'), ['Вопрос 2/5\n\nQ2']);
  assert.deepEqual(seen, ['мой важный ответ', 'мой важный ответ']);
  assert.deepEqual(await send('/retry'), [TEXTS.nothingToRetry]);
});

test('потерянная сессия на сервере возвращает к вводу описания', async () => {
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async () => { throw new ApiError('SESSION_NOT_FOUND'); },
  };
  const dialog = createDialog({ api });
  const send = user(dialog, 6);
  await send(PITCH);
  const [msg] = await send('ответ');
  assert.match(msg, /описание стартапа/);
  assert.equal(dialog._states.get('6:tg:6').phase, 'pitch');
});
