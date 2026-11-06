import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialog, TEXTS, MAX_INPUT_CHARS, formatResult } from '../src/dialog.mjs';
import { createMockApi, CRITERIA } from '../src/api/mock.mjs';
import { ApiError } from '../src/api/errors.mjs';

const PITCH =
  'ЛабСклад — сервис, через который вузовские лаборатории сдают друг другу в аренду простаивающее ' +
  'оборудование. 23 интервью, пилот в двух лабораториях, 9 бронирований за 6 недель.';

function user(dialog, id) {
  return (text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text });
}

async function playRound(send, answers = 5) {
  let last;
  for (let i = 1; i <= answers; i++) [last] = (await send(`Ответ ${i}: 12 клиентов, 3 продажи.`)).slice(-1);
  return last;
}

test('полный раунд: карточка → факты и вопрос 1 → 5 вопросов → итог из 10 критериев и 3 советов', async () => {
  const send = user(createDialog({ api: createMockApi() }), 1);
  const [card] = await send('/start');
  assert.match(card, /Олег/);
  assert.match(card, /Вставьте описание стартапа/);

  const first = await send(PITCH);
  assert.equal(first[0], TEXTS.demo);
  assert.match(first[1], /^Что я понял из питча:\n✅ /);
  assert.match(first[1], /❌ нет: /);
  assert.match(first[2], /^Вопрос 1\/5 · Клиент\n\n/);

  for (let step = 2; step <= 5; step++) {
    const [q] = await send(`Ответ ${step - 1}: 12 клиентов.`);
    assert.match(q, /^Записал\./, 'реакция перед вопросом');
    assert.match(q, new RegExp(`Вопрос ${step}/5 · `));
  }
  const [result] = await send('Последний ответ: 40 точек.');
  assert.match(result, /^Итог: \d+ из 100/);
  assert.match(result, /Сильное: .+\nСлабое: /);
  for (const c of CRITERIA) assert.ok(result.includes(c.name), `нет критерия ${c.name}`);
  const advice = result.split('Что сделать до выступления:')[1].split('\n').filter((l) => /^\d\. /.test(l));
  assert.equal(advice.length, 3);
  assert.ok(!result.includes('[object Object]'));
});

test('второй раунд /again показывает «было → стало», /result повторяет итог', async () => {
  const send = user(createDialog({ api: createMockApi() }), 2);
  assert.deepEqual(await send('/again'), [TEXTS.noAgain]);
  assert.deepEqual(await send('/result'), [TEXTS.noResult]);
  await send(PITCH);
  const first = await playRound(send);
  assert.match(first, /^Итог: \d+ из 100/);
  assert.equal((await send('/result'))[0], first);

  const again = await send('/again');
  assert.match(again.at(-1), /^Вопрос 1\/5/);
  const second = await playRound(send);
  assert.match(second, /^Итог: \d+ → \d+ из 100/);
});

test('сессии разных пользователей не смешиваются', async () => {
  const dialog = createDialog({ api: createMockApi() });
  const a = user(dialog, 10);
  const b = user(dialog, 20);
  await a(PITCH);
  await a('ответ A1');
  await a('ответ A2');
  assert.match((await b(PITCH)).at(-1), /^Вопрос 1\/5/);
  assert.match((await a('ответ A3'))[0], /Вопрос 4\/5/);
  assert.match((await b('ответ B1'))[0], /Вопрос 2\/5/);
});

test('API не отдаёт чужую сессию', async () => {
  const api = createMockApi();
  const { sessionId } = await api.start({ userId: 'tg:1', pitch: PITCH });
  await assert.rejects(api.answer({ sessionId, userId: 'tg:2', step: 1, answer: 'x' }), { code: 'SESSION_NOT_FOUND' });
  await assert.rejects(api.get({ sessionId, userId: 'tg:2' }), { code: 'SESSION_NOT_FOUND' });
});

test('пустой, слишком длинный и нетекстовый ввод дают понятный ответ', async () => {
  const send = user(createDialog({ api: createMockApi() }), 3);
  assert.deepEqual(await send('   '), [TEXTS.emptyInput]);
  assert.deepEqual(await send('x'.repeat(MAX_INPUT_CHARS + 1)), [TEXTS.tooLong]);
  assert.deepEqual(await send(undefined), [TEXTS.notText]);
  assert.deepEqual(await send('/foo'), [TEXTS.unknownCommand]);
});

test('ошибка API показывает текст сервера и список «чего не хватает»', async () => {
  const api = {
    mode: 'http',
    start: async () => { throw new ApiError('EMPTY_PITCH', 'Здесь нечего прожаривать.', { missing: ['решение', 'цифры'], fromServer: true }); },
  };
  const [msg] = await user(createDialog({ api }), 7)('см. презентацию');
  assert.equal(msg, 'Здесь нечего прожаривать.\n\nНе хватает:\n• решение\n• цифры');
});

test('пока идёт запрос, второе сообщение того же пользователя отклоняется', async () => {
  let release;
  const api = {
    mode: 'http',
    start: () => new Promise((r) => { release = () => r({ sessionId: 's', step: 1, totalSteps: 5, question: 'Q1' }); }),
  };
  const send = user(createDialog({ api }), 4);
  const first = send(PITCH);
  assert.deepEqual(await send('второе'), [TEXTS.busy]);
  release();
  assert.deepEqual(await first, ['Вопрос 1/5\n\nQ1']);
});

test('сбой API не теряет ответ: /retry повторяет тот же запрос с тем же step', async () => {
  const seen = [];
  let fail = true;
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async (req) => {
      seen.push(req);
      if (fail) throw new ApiError('AI_UNAVAILABLE', 'Инвестор задумался.', { fromServer: true });
      return { sessionId: 's1', step: 2, totalSteps: 5, question: 'Q2' };
    },
  };
  const send = user(createDialog({ api }), 5);
  await send(PITCH);
  const [err] = await send('мой важный ответ');
  assert.match(err, /^Инвестор задумался\.\n\n.*\/retry/s);
  fail = false;
  assert.deepEqual(await send('/retry'), ['Вопрос 2/5\n\nQ2']);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(seen[0].step, 1);
  assert.deepEqual(await send('/retry'), [TEXTS.nothingToRetry]);
});

test('STEP_MISMATCH: бот берёт текущее состояние из API и показывает актуальный вопрос', async () => {
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async () => { throw new ApiError('STEP_MISMATCH', 'Уже позади.', { fromServer: true }); },
    get: async () => ({ sessionId: 's1', step: 3, totalSteps: 5, question: 'Q3' }),
  };
  const dialog = createDialog({ api });
  const send = user(dialog, 8);
  await send(PITCH);
  assert.deepEqual(await send('ответ'), ['Вопрос 3/5\n\nQ3']);
  assert.equal(dialog._states.get('8:tg:8').step, 3);
});

test('потерянная сессия на сервере возвращает к вводу питча', async () => {
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async () => { throw new ApiError('SESSION_NOT_FOUND', 'Сессия не найдена. Начните новый раунд.', { fromServer: true }); },
  };
  const dialog = createDialog({ api });
  const send = user(dialog, 6);
  await send(PITCH);
  assert.deepEqual(await send('ответ'), ['Сессия не найдена. Начните новый раунд.']);
  assert.equal(dialog._states.get('6:tg:6').phase, 'pitch');
});

test('/delete удаляет данные и сбрасывает раунд', async () => {
  const api = createMockApi();
  const dialog = createDialog({ api });
  const send = user(dialog, 9);
  await send(PITCH);
  const { sessionId } = dialog._states.get('9:tg:9');
  assert.deepEqual(await send('/delete'), [TEXTS.deleted]);
  await assert.rejects(api.get({ sessionId, userId: 'tg:9' }), { code: 'SESSION_NOT_FOUND' });
  assert.deepEqual(await send('/result'), [TEXTS.noResult]);
});

test('итог совместим со старой формой советов-строк', () => {
  const text = formatResult({ criteria: [], total: 1, max: 100, advice: ['a', 'b', 'c'], previousTotal: null });
  assert.match(text, /1\. a\n2\. b\n3\. c/);
});
