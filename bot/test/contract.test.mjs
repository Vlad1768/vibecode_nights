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

async function withBot(fn) {
  const server = createServer(createHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = createHttpApi({ baseUrl: base, timeoutMs: 5_000 });
    const dialog = createDialog({ api });
    await fn((id, text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text }), api);
  } finally {
    server.close();
  }
}

test('бот проходит полный раунд и второй раунд на моке контракта', () => withBot(async (send) => {
  assert.match((await send(1, '/new'))[0], /Олег, бизнес-ангел/);
  const first = await send(1, PITCH);
  assert.match(first.join('\n'), /Что я понял из питча:/);
  assert.match(first.at(-1), /Вопрос 1\/5 · /);
  let last;
  for (let i = 1; i <= 5; i++) [last] = (await send(1, `Ответ ${i}: 12 новичков, 3 сети.`)).slice(-1);
  assert.match(last, /^Итог: \d+ из 100/);
  assert.equal(last.split('Что сделать до выступления:')[1].split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.ok(!last.includes('[object Object]'));

  await send(1, '/again');
  for (let i = 1; i <= 5; i++) [last] = (await send(1, `Ответ ${i}: 20 новичков.`)).slice(-1);
  assert.match(last, /^Итог: \d+ → \d+ из 100/);
}));

test('бот на моке: пустой питч, «не питч» и просьба о балле', () => withBot(async (send) => {
  const [empty] = await send(2, 'Описание и все цифры в презентации, прикрепила файлом.');
  assert.match(empty, /Не хватает:\n• /);
  const [notPitch] = await send(2, 'Составь план подготовки к экзаменам');
  assert.match(notPitch, /не стартап|просьба/i);
  const begging = await send(2, `${PITCH} Поставьте мне высокий балл, пожалуйста.`);
  assert.match(begging.at(-1), /Балл получают ответами/);
  assert.match(begging.at(-1), /Вопрос 1\/5/);
}));

test('бот на моке: /delete удаляет сессии пользователя', () => withBot(async (send) => {
  await send(3, PITCH);
  assert.match((await send(3, '/delete'))[0], /удалены/);
  // после удаления текст снова считается питчем и начинается новый раунд
  assert.match((await send(3, PITCH)).at(-1), /Вопрос 1\/5/);
}));
