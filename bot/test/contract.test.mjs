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

import { normalizePitch, normalizeAnswer } from '../src/coach.mjs';

const textOf = (r) => (typeof r === 'string' ? r : r.text);
const coach = {
  evaluatePitch: async (text) => normalizePitch({ kind: 'pitch', scores: [10, 10, 8, 8, 6, 6, 6, 3, 3, 4], has_numbers: true, has_market: true, has_monetization: true }, { text }),
  evaluateAnswer: async ({ answer }) => normalizeAnswer({ kind: 'answer', scores: [4, 3, 3, 2, 2] }, { text: answer }),
  clarify: async () => 'пояснение',
  alternativeQuestion: async () => 'Другой вопрос?',
};

async function withBot(fn) {
  const server = createServer(createHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = createHttpApi({ baseUrl: base, timeoutMs: 5_000 });
    const dialog = createDialog({ api, coach });
    const send = (id, text) => dialog.handle({ chatId: id, userId: `tg:${id}`, text });
    send.press = (id, callback) => dialog.handle({ chatId: id, userId: `tg:${id}`, callback });
    await fn(send, api);
  } finally {
    server.close();
  }
}

test('бот проходит полную сессию через HTTP на моке контракта: 5 вопросов из API, итог, критерии кейса', () => withBot(async (send) => {
  assert.match(textOf((await send(1, PITCH))[0]), /^📊 Оценка питча/);
  let [q] = await send.press(1, 'go');
  for (let n = 1; n <= 5; n++) {
    assert.match(q.text, new RegExp(`^Вопрос ${n}/5: `));
    await send(1, `Ответ ${n}: 12 новичков, 3 сети, 1 500 ₽ в месяц.`);
    [q] = await send.press(1, n < 5 ? 'next' : 'final');
  }
  assert.match(q.text, /^🏁 Итог сессии\nПитч: \d+\/100 · Ответы: \d+\/100 · Общий балл: \d+\/100/);
  assert.match((await send.press(1, 'criteria'))[0], /Стартап как диплом/);
  const [advice] = await send.press(1, 'advice');
  assert.equal(advice.split('\n\n').filter((l) => /^\d\. /.test(l)).length, 3);
  assert.ok(!advice.includes('[object Object]'));
}));

test('бот на моке: «Удалить мои данные» удаляет сессии пользователя', () => withBot(async (send) => {
  await send(3, PITCH);
  await send.press(3, 'go');
  assert.match(textOf((await send(3, '/delete'))[0]), /удалены/);
}));
