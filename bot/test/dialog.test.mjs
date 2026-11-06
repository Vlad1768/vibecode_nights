import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialog, TEXTS, MAX_INPUT_CHARS, formatResult, formatCriteriaHtml, progressBar, REMIND_AFTER_MS } from '../src/dialog.mjs';
import { createMockApi, CRITERIA } from '../src/api/mock.mjs';
import { ApiError } from '../src/api/errors.mjs';
import { createStore } from '../src/store.mjs';
import { buttonsAfterPress } from '../src/buttons.mjs';

const PITCH =
  'ЛабСклад — сервис, через который вузовские лаборатории сдают друг другу в аренду простаивающее ' +
  'оборудование. 23 интервью, пилот в двух лабораториях, 9 бронирований за 6 недель.';

const textOf = (r) => (typeof r === 'string' ? r : r.text);
const dataOf = (r) => (r.buttons ?? []).flat().map((x) => x.data);

function user(dialog, id) {
  const send = (text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text });
  send.press = (callback) => dialog.handle({ chatId: id, userId: `tg:${id}`, callback });
  return send;
}

// Питч → сверка фактов → «поехали» → вопрос 1.
async function startRound(send) {
  const r = await send(PITCH);
  assert.deepEqual(dataOf(r.at(-1)), ['go', 'fix']);
  return send.press('go');
}

async function answerAll(send, from = 1) {
  let last;
  for (let i = from; i <= 5; i++) last = (await send(`Ответ ${i}: 12 клиентов, 3 продажи.`)).at(-1);
  return last;
}

test('приветствие: фото, текст до 1024 знаков и кнопки практики, обучения и примера; без команд в тексте', async () => {
  const send = user(createDialog({ api: createMockApi() }), 1);
  const [welcome] = await send('/start');
  assert.equal(welcome.photo, 'welcome');
  assert.match(welcome.text, /^Злой инвестор — тренажёр защиты стартапа/);
  assert.ok(welcome.text.length <= 1024);
  assert.deepEqual(dataOf(welcome), ['practice', 'learn', 'example']);
  for (const t of [TEXTS.welcome, TEXTS.learn, TEXTS.example, TEXTS.askPitch, TEXTS.help, TEXTS.reminder]) {
    assert.doesNotMatch(t, /\/[a-z]+/, 'в текстах нет команд');
  }
  const [learn] = await send.press('learn');
  assert.match(learn.text, /Как подготовиться к питчу/);
  assert.deepEqual(dataOf(learn), ['practice']);
  const [example] = await send('/start demo');
  assert.match(example.text, /на примере питча «Смена»/);
});

test('полный раунд кнопками: практика → сверка фактов → 5 вопросов с прогрессом → итог по шагам', async () => {
  const send = user(createDialog({ api: createMockApi() }), 2);
  const [card] = await send.press('practice');
  assert.match(card.text, /^Сегодня вас слушает Олег, бизнес-ангел\./);
  assert.deepEqual(dataOf(card), ['template', 'example']);

  const first = await send(PITCH);
  assert.equal(first[0], TEXTS.demo);
  assert.match(first.at(-1).text, /^Что я понял из питча:\n✅ /);
  const [q1] = await send.press('go');
  assert.match(q1.text, /^▰▱▱▱▱ Вопрос 1\/5 · Клиент\n\n/);
  assert.deepEqual(dataOf(q1), ['idk', 'pause']);

  const second = await send('Ответ 1: 12 клиентов.');
  assert.match(textOf(second[0]), /^Записал\./, 'реакция — отдельным сообщением');
  assert.match(second.at(-1).text, /^▰▰▱▱▱ Вопрос 2\/5/);

  const summary = await answerAll(send, 2);
  assert.match(summary.text, /^🏁 Итог: \d+ из 100/);
  assert.match(summary.text, /💪 Сильное: .+\n🎯 Слабое: /);
  assert.deepEqual(dataOf(summary), ['advice', 'criteria']);

  const [crit] = await send.press('criteria');
  assert.equal(crit.html, true);
  for (const c of CRITERIA) assert.ok(crit.text.includes(c.name.replace(/:/g, ':')), `нет критерия ${c.name}`);
  assert.match(crit.text, /<blockquote expandable>/);

  const [advice] = await send.press('advice');
  assert.equal(advice.text.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.deepEqual(dataOf(advice), ['done:1', 'done:2', 'done:3', 'remind', 'pin', 'again']);
  assert.ok(!advice.text.includes('[object Object]'));
});

test('«Поправить питч» и новый текст на сверке фактов начинают заново', async () => {
  const dialog = createDialog({ api: createMockApi() });
  const send = user(dialog, 3);
  await send(PITCH);
  assert.deepEqual(await send.press('fix'), [TEXTS.fix]);
  const again = await send(PITCH);
  assert.match(again.at(-1).text, /Что я понял/);
});

test('«Не знаю ответа» уходит как ответ, «Пауза» не двигает раунд', async () => {
  const seen = [];
  const api = createMockApi();
  const orig = api.answer;
  api.answer = (req) => { seen.push(req.answer); return orig(req); };
  const send = user(createDialog({ api }), 4);
  await startRound(send);
  assert.deepEqual(await send.press('pause'), [TEXTS.pause]);
  const r = await send.press('idk');
  assert.equal(seen[0], TEXTS.idkAnswer);
  assert.match(r.at(-1).text, /Вопрос 2\/5/);
});

test('второй раунд показывает «было → стало»; «Сделал ✔» отмечает дела', async () => {
  const send = user(createDialog({ api: createMockApi() }), 5);
  assert.deepEqual(await send.press('again'), [TEXTS.noAgain]);
  await startRound(send);
  await answerAll(send);
  for (const i of [1, 2]) {
    const r = await send.press(`done:${i}`);
    assert.deepEqual(r[0], { action: 'markDone', index: i });
    assert.match(textOf(r[1]), new RegExp(`Дело ${i} — сделано`));
  }
  const [, last] = await send.press('done:3');
  assert.deepEqual(dataOf(last), ['again']);
  const [advice] = await send.press('advice');
  assert.match(advice.text, /☑️ /);

  const r2 = await send.press('again');
  assert.match(r2.at(-1).text, /Что я понял/);
  await send.press('go');
  const summary = await answerAll(send);
  assert.match(summary.text, /^🏁 Итог: \d+ → \d+ из 100/);
});

test('напоминание через 2 дня сохраняется и приходит с кнопкой второго раунда', async () => {
  let t = 1_000_000;
  const store = createStore({ now: () => t });
  const dialog = createDialog({ api: createMockApi(), store, now: () => t });
  const send = user(dialog, 6);
  assert.deepEqual(await send.press('remind'), [TEXTS.remindNoRound]);
  await startRound(send);
  await answerAll(send);
  assert.deepEqual(await send.press('remind'), [TEXTS.remindSet]);
  assert.deepEqual(store.takeDue(), []);
  t += REMIND_AFTER_MS + 1;
  assert.deepEqual(store.takeDue(), [{ chatId: 6, userId: 'tg:6', dueAt: 1_000_000 + REMIND_AFTER_MS }]);
  assert.deepEqual(dataOf(dialog.reminderReply()), ['again', 'new']);
});

test('прошлый раунд переживает перезапуск бота (хранилище)', async () => {
  const store = createStore();
  const api = createMockApi();
  const send1 = user(createDialog({ api, store }), 7);
  await startRound(send1);
  await answerAll(send1);
  const send2 = user(createDialog({ api, store }), 7); // «новый процесс» с тем же хранилищем
  assert.match((await send2.press('result'))[0].text, /^🏁 Итог/);
  assert.match((await send2.press('again')).at(-1).text, /Что я понял/);
});

test('сессии разных пользователей не смешиваются', async () => {
  const dialog = createDialog({ api: createMockApi() });
  const a = user(dialog, 10);
  const b = user(dialog, 20);
  await startRound(a);
  await a('ответ A1');
  await a('ответ A2');
  assert.match((await startRound(b))[0].text, /Вопрос 1\/5/);
  assert.match((await a('ответ A3')).at(-1).text, /Вопрос 4\/5/);
  assert.match((await b('ответ B1')).at(-1).text, /Вопрос 2\/5/);
});

test('API не отдаёт чужую сессию', async () => {
  const api = createMockApi();
  const { sessionId } = await api.start({ userId: 'tg:1', pitch: PITCH });
  await assert.rejects(api.answer({ sessionId, userId: 'tg:2', step: 1, answer: 'x' }), { code: 'SESSION_NOT_FOUND' });
  await assert.rejects(api.get({ sessionId, userId: 'tg:2' }), { code: 'SESSION_NOT_FOUND' });
});

test('пустой, слишком длинный и нетекстовый ввод дают понятный ответ', async () => {
  const send = user(createDialog({ api: createMockApi() }), 8);
  assert.deepEqual(await send('   '), [TEXTS.emptyInput]);
  assert.deepEqual(await send('x'.repeat(MAX_INPUT_CHARS + 1)), [TEXTS.tooLong]);
  assert.deepEqual(await send(undefined), [TEXTS.notText]);
  assert.deepEqual(await send('/foo'), [TEXTS.unknownCommand]);
});

test('пустой питч: текст сервера, «чего не хватает» и кнопка шаблона', async () => {
  const api = {
    mode: 'http',
    start: async () => { throw new ApiError('EMPTY_PITCH', 'Здесь нечего прожаривать.', { missing: ['решение', 'цифры'], fromServer: true }); },
  };
  const send = user(createDialog({ api }), 9);
  const [msg] = await send('см. презентацию');
  assert.equal(msg.text, 'Здесь нечего прожаривать.\n\nНе хватает:\n• решение\n• цифры');
  assert.deepEqual(dataOf(msg), ['template']);
  assert.deepEqual(await send.press('template'), [TEXTS.template]);
});

test('пока идёт запрос, второе сообщение того же пользователя отклоняется', async () => {
  let release;
  const api = {
    mode: 'http',
    start: () => new Promise((r) => { release = () => r({ sessionId: 's', step: 1, totalSteps: 5, question: 'Q1' }); }),
  };
  const send = user(createDialog({ api }), 11);
  const first = send(PITCH);
  assert.deepEqual(await send('второе'), [TEXTS.busy]);
  release();
  assert.equal((await first)[0].text, '▰▱▱▱▱ Вопрос 1/5\n\nQ1');
});

test('сбой API не теряет ответ: «Повторить» шлёт тот же запрос с тем же step', async () => {
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
  const send = user(createDialog({ api }), 12);
  await send(PITCH);
  const [err] = await send('мой важный ответ');
  assert.equal(err.text, 'Инвестор задумался.');
  assert.deepEqual(dataOf(err), ['retry']);
  fail = false;
  assert.equal((await send.press('retry'))[0].text, '▰▰▱▱▱ Вопрос 2/5\n\nQ2');
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(seen[0].step, 1);
  assert.deepEqual(dataOf((await send.press('retry'))[0]), ['new']);
});

test('STEP_MISMATCH: бот берёт текущее состояние из API', async () => {
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async () => { throw new ApiError('STEP_MISMATCH', 'Уже позади.', { fromServer: true }); },
    get: async () => ({ sessionId: 's1', step: 3, totalSteps: 5, question: 'Q3' }),
  };
  const dialog = createDialog({ api });
  const send = user(dialog, 13);
  await send(PITCH);
  assert.equal((await send('ответ'))[0].text, '▰▰▰▱▱ Вопрос 3/5\n\nQ3');
  assert.equal(dialog._states.get('13:tg:13').step, 3);
});

test('потерянная сессия на сервере: сообщение и кнопка нового питча', async () => {
  const api = {
    mode: 'http',
    start: async () => ({ sessionId: 's1', step: 1, totalSteps: 5, question: 'Q1' }),
    answer: async () => { throw new ApiError('SESSION_NOT_FOUND', 'Сессия не найдена. Начните новый раунд.', { fromServer: true }); },
  };
  const dialog = createDialog({ api });
  const send = user(dialog, 14);
  await send(PITCH);
  const [msg] = await send('ответ');
  assert.equal(msg.text, 'Сессия не найдена. Начните новый раунд.');
  assert.deepEqual(dataOf(msg), ['new']);
});

test('«Удалить мои данные» стирает API, прошлый раунд и напоминания', async () => {
  const api = createMockApi();
  const store = createStore();
  const dialog = createDialog({ api, store });
  const send = user(dialog, 15);
  await startRound(send);
  await answerAll(send);
  await send.press('remind');
  const { lastDone } = dialog._states.get('15:tg:15');
  const [msg] = await send('/delete');
  assert.equal(msg.text, TEXTS.deleted);
  await assert.rejects(api.get({ sessionId: lastDone.sessionId, userId: 'tg:15' }), { code: 'SESSION_NOT_FOUND' });
  assert.equal(store.getProfile('15:tg:15'), null);
  assert.equal((await send.press('result'))[0].text, TEXTS.noResult);
});

test('голосовое: расшифровка показывается и уходит как питч, потом как ответ', async () => {
  let n = 0;
  const media = { toText: async () => ({ text: n++ === 0 ? PITCH : 'Ответ голосом: 12 клиентов.', source: 'voice', shortened: false }) };
  const dialog = createDialog({ api: createMockApi(), media });
  const send = (input) => dialog.handle({ chatId: 16, userId: 'tg:16', ...input });
  const first = await send({ media: { kind: 'voice', fileId: 'v1' } });
  assert.match(first[0], /^🎙 Расслышал так:\n«ЛабСклад/);
  await send({ callback: 'go' });
  const second = await send({ media: { kind: 'voice', fileId: 'v2' } });
  assert.match(second[0], /^🎙 Расслышал так/);
  assert.match(second.at(-1).text, /Вопрос 2\/5/);
});

test('файл принимается как питч, но не как ответ; без распознавания — понятный отказ', async () => {
  const media = { toText: async () => ({ text: PITCH, source: 'file', shortened: true }) };
  const dialog = createDialog({ api: createMockApi(), media });
  const send = (input) => dialog.handle({ chatId: 17, userId: 'tg:17', ...input });
  const r = await send({ media: { kind: 'document', fileId: 'd1', fileName: 'pitch.pdf' } });
  assert.match(r[0], /^📄 Взял текст из файла \(\d+ знаков\), длинный — сократил до сути, проверьте/);
  await send({ callback: 'go' });
  assert.deepEqual(await send({ media: { kind: 'document', fileId: 'd2' } }), [TEXTS.answerNoFile]);

  const plain = createDialog({ api: createMockApi() });
  const [no] = await plain.handle({ chatId: 18, userId: 'tg:18', media: { kind: 'voice', fileId: 'v' } });
  assert.match(no, /не подключено/);
});

test('ошибка распознавания не ломает раунд', async () => {
  const { MediaError, MEDIA_TEXTS } = await import('../src/media.mjs');
  const media = { toText: async () => { throw new MediaError('UNSUPPORTED', MEDIA_TEXTS.UNSUPPORTED); } };
  const dialog = createDialog({ api: createMockApi(), media });
  assert.deepEqual(await dialog.handle({ chatId: 19, userId: 'tg:19', media: { kind: 'document', fileId: 'x' } }), [MEDIA_TEXTS.UNSUPPORTED]);
  assert.equal(dialog._states.get('19:tg:19').phase, 'idle');
});

test('кнопки после нажатия гаснут или меняются', () => {
  const markup = { inline_keyboard: [[{ text: '✔ Дело 1', callback_data: 'done:1' }, { text: '✔ Дело 2', callback_data: 'done:2' }], [{ text: 'Напомнить', callback_data: 'remind' }, { text: 'Закрепить', callback_data: 'pin' }], [{ text: 'Второй раунд', callback_data: 'again' }]] };
  assert.equal(buttonsAfterPress(markup, 'go'), null);
  assert.equal(buttonsAfterPress(markup, 'pause'), undefined);
  assert.equal(buttonsAfterPress(undefined, 'go'), undefined);
  assert.equal(buttonsAfterPress(markup, 'done:2').inline_keyboard[0][1].text, '☑️ 2');
  assert.deepEqual(buttonsAfterPress(markup, 'pin').inline_keyboard[1].map((x) => x.callback_data), ['remind']);
});

test('форматирование: прогресс, HTML экранируется, советы-строки поддерживаются', () => {
  assert.equal(progressBar(2, 5), '▰▰▱▱▱');
  const html = formatCriteriaHtml({ criteria: [{ id: 1, name: 'A<b>', score: 1, max: 15, level: 1, evidence: '<script>', comment: 'x & y' }] });
  assert.match(html, /A&lt;b&gt;/);
  assert.match(html, /«&lt;script&gt;»/);
  assert.match(html, /x &amp; y/);
  const text = formatResult({ criteria: [], total: 1, max: 100, advice: ['a', 'b', 'c'], previousTotal: null });
  assert.match(text, /1\. a\n\n2\. b\n\n3\. c/);
});
