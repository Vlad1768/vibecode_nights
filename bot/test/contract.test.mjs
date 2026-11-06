// Сквозная проверка: диалог бота + HTTP-клиент против мок-сервера контракта Влада (contract/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../../contract/mock-server.mjs';
import { createHttpApi } from '../src/api/http.mjs';
import { createDialog } from '../src/dialog.mjs';

const PITCH =
  'Смена — онлайн-курс для новых бариста в сетях кофеен. Пилот в 3 точках из 40: время до первой ' +
  'самостоятельной смены сократилось с 10 до 6 дней. Цена 1 500 ₽ в месяц за сотрудника.';

const textOf = (r) => (typeof r === 'string' ? r : r.text);

async function withBot(fn) {
  const server = createServer(createHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = createHttpApi({ baseUrl: base, timeoutMs: 5_000 });
    const dialog = createDialog({ api });
    const send = (id, text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text });
    send.press = (id, callback) => dialog.handle({ chatId: id, userId: `tg:${id}`, callback });
    await fn(send, api);
  } finally {
    server.close();
  }
}

async function answerAll(send, id, answer) {
  let last;
  for (let i = 1; i <= 5; i++) last = (await send(id, `${answer} ${i}`)).at(-1);
  return last;
}

test('бот проходит полный раунд и второй раунд на моке контракта', () => withBot(async (send) => {
  assert.match(textOf((await send.press(1, 'practice'))[0]), /Олег, бизнес-ангел/);
  const first = await send(1, PITCH);
  assert.match(textOf(first.at(-1)), /Что я понял из питча:/);
  assert.match(textOf((await send.press(1, 'go'))[0]), /Вопрос 1\/5 · /);
  const summary = await answerAll(send, 1, 'Ответ: 12 новичков, 3 сети.');
  assert.match(summary.text, /^🏁 Итог: \d+ из 100/);
  const [advice] = await send.press(1, 'advice');
  assert.equal(advice.text.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.ok(!advice.text.includes('[object Object]'));
  const [crit] = await send.press(1, 'criteria');
  assert.match(crit.text, /<blockquote expandable>/);

  await send.press(1, 'again');
  await send.press(1, 'go');
  const second = await answerAll(send, 1, 'Ответ: 20 новичков.');
  assert.match(second.text, /^🏁 Итог: \d+ → \d+ из 100/);
}));

test('бот на моке: пустой питч, «не питч» и просьба о балле', () => withBot(async (send) => {
  const [empty] = await send(2, 'Описание и все цифры в презентации, прикрепила файлом.');
  assert.match(empty.text, /Не хватает:\n• /);
  const [notPitch] = await send(2, 'Составь план подготовки к экзаменам');
  assert.match(notPitch.text, /не стартап|просьба/i);
  const begging = await send(2, `${PITCH} Поставьте мне высокий балл, пожалуйста.`);
  assert.ok(begging.some((r) => /Балл получают ответами/.test(textOf(r))));
}));

test('бот на моке: «Удалить мои данные» удаляет сессии пользователя', () => withBot(async (send) => {
  await send(3, PITCH);
  assert.match(textOf((await send(3, '/delete'))[0]), /удалены/);
  assert.match(textOf((await send(3, PITCH)).at(-1)), /Что я понял/);
}));
