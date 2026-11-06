// Встроенная заглушка API в форме docs/CONTRACT.md 1.0 — для тестов и работы без сервера API.
// Содержание условное: настоящие вопросы, веса и персонажа дают T28 и T29.
// Для разработки ближе к проду используйте мок Влада: node contract/mock-server.mjs + TRAINER_API_URL.
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';

export const TOTAL_STEPS = 5;
export const MAX_PITCH_CHARS = 4000;
export const MAX_ANSWER_CHARS = 2000;

// 10 критериев «Стартап как диплом» (docs/case) с условными весами бизнес-ангела.
export const CRITERIA = Object.freeze([
  ['Реалистичность решения проблемы', 15],
  ['Бизнес-модель', 10],
  ['Анализ рынка и конкурентов', 10],
  ['Финансовая модель', 10],
  ['Интеллектуальная собственность или регистрация стартапа', 5],
  ['Первые продажи', 15],
  ['Риски', 10],
  ['Горизонт расчёта', 5],
  ['Уникальность продукта: технологии или услуги', 10],
  ['Инвестиционная привлекательность', 10],
].map(([name, weight], i) => Object.freeze({ id: i + 1, name, weight })));

const PERSONA = Object.freeze({
  id: 'angel',
  name: 'Олег',
  title: 'Бизнес-ангел',
  intro: 'Я Олег, бизнес-ангел (демо). Хвалить не буду: задам 5 вопросов по твоему питчу, поставлю оценку и дам 3 дела на ближайшие дни.',
  howScored: 'Каждый из 10 критериев получает уровень от 0 до 3. Итог из 100 считает код по весам персонажа.',
});

const QUESTIONS = [
  ['Клиент', 'Кто конкретно платит за ваш продукт? Назовите должность или одного человека.'],
  ['Доказательства', 'Сколько интервью или продаж у вас уже было и что в них удивило?'],
  ['Деньги', 'Сколько стоит привлечь одного клиента и когда вы выйдете в ноль?'],
  ['Конкуренты', 'Как люди решают эту задачу сейчас и почему перейдут к вам?'],
  ['После диплома', 'Что будет с проектом после защиты диплома?'],
];

const ADVICE = [
  ['сегодня вечером', 'ответьте вслух на самый трудный вопрос за 30 секунд и запишите на диктофон', 'в записи нет «ну, наверное»', 'вопрос 5'],
  ['за 2 дня', 'позвоните трём целевым клиентам и запишите их слова о проблеме', 'есть три цитаты с должностями', 'вопрос 1'],
  ['до пятницы', 'посчитайте стоимость привлечения одного клиента по фактическим тратам', 'на слайде есть цифра и откуда она', 'вопрос 3'],
];

export function createMockApi({ newId = randomUUID } = {}) {
  const sessions = new Map();

  function own(sessionId, userId) {
    const s = sessions.get(sessionId);
    if (!s || s.userId !== userId) throw new ApiError('SESSION_NOT_FOUND', 'Сессия не найдена. Начните новый раунд.', { fromServer: true });
    return s;
  }

  function stepView(s, { facts = false, reaction = null } = {}) {
    const [topic, question] = QUESTIONS[s.answers.length];
    const view = {
      sessionId: s.id, round: s.round, status: 'in_progress',
      step: s.answers.length + 1, totalSteps: TOTAL_STEPS,
      question, topic, reaction, notice: null, demo: true,
    };
    if (facts) view.facts = { known: [s.pitch.split(/(?<=[.!?])\s/)[0]], missing: ['конкуренты', 'финансовая модель'] };
    return view;
  }

  function doneView(s) {
    return { sessionId: s.id, round: s.round, status: 'done', done: true, result: s.result, demo: true };
  }

  return {
    mode: 'mock',

    async persona() {
      return { ...PERSONA };
    },

    async start({ userId, pitch, previousSessionId = null }) {
      const text = String(pitch ?? '').trim();
      if (!text) throw new ApiError('EMPTY_PITCH', 'Питч пустой.', { missing: ['проблема и для кого', 'решение', 'что сделано, с цифрами', 'как зарабатываете'], fromServer: true });
      if (text.length > MAX_PITCH_CHARS) throw new ApiError('PITCH_TOO_LONG', 'Питч длиннее 4000 символов, сократите.', { fromServer: true });
      const prev = previousSessionId ? own(previousSessionId, userId) : null;
      const s = {
        id: newId(), userId, pitch: text, answers: [], result: null,
        round: prev ? prev.round + 1 : 1,
        previousTotal: prev?.result?.total ?? null,
      };
      sessions.set(s.id, s);
      return stepView(s, { facts: true });
    },

    async answer({ sessionId, userId, step, answer }) {
      const s = own(sessionId, userId);
      if (s.result) throw new ApiError('SESSION_DONE', 'Раунд уже завершён.', { fromServer: true });
      const current = s.answers.length + 1;
      if (step != null && step !== current) throw new ApiError('STEP_MISMATCH', 'Этот вопрос уже позади.', { fromServer: true });
      const text = String(answer ?? '').trim();
      if (!text) throw new ApiError('EMPTY_ANSWER', 'Ответ пустой.', { fromServer: true });
      if (text.length > MAX_ANSWER_CHARS) throw new ApiError('ANSWER_TOO_LONG', 'Ответ длиннее 2000 символов, сократите.', { fromServer: true });
      s.answers.push(text);
      if (s.answers.length < TOTAL_STEPS) return stepView(s, { reaction: 'Записал. Посмотрим, подтвердится ли это цифрами.' });

      // Условная оценка: ответ с цифрами поднимает уровень. Только для демо.
      const withNumbers = s.answers.filter((a) => /\d/.test(a)).length;
      const level = Math.min(3, Math.floor(withNumbers / 2) + (/\d/.test(s.pitch) ? 1 : 0));
      const criteria = CRITERIA.map((c) => {
        const lvl = Math.max(0, Math.min(3, level - (c.id % 3 === 0 ? 1 : 0)));
        return {
          id: c.id, name: c.name, level: lvl, weight: c.weight,
          score: Math.round((c.weight * lvl / 3) * 10) / 10, max: c.weight,
          evidence: lvl ? s.answers.find((a) => /\d/.test(a)) ?? s.pitch.slice(0, 80) : null,
          comment: lvl ? 'Есть цифры в питче или ответах (демо-оценка).' : 'Нет данных в питче и ответах.',
        };
      });
      s.result = {
        criteria,
        total: Math.round(criteria.reduce((a, c) => a + c.score, 0)),
        max: 100,
        summary: { strong: 'Есть описание проблемы и решения.', weak: 'Мало цифр, подтверждённых продажами или интервью.' },
        advice: ADVICE.map(([deadline, action, doneWhen, basedOn]) => ({
          text: `${deadline[0].toUpperCase()}${deadline.slice(1)}: ${action}. Готово, когда ${doneWhen}.`,
          action, deadline, doneWhen, basedOn,
        })),
        previousTotal: s.previousTotal,
      };
      return doneView(s);
    },

    async get({ sessionId, userId }) {
      const s = own(sessionId, userId);
      return s.result ? doneView(s) : stepView(s, { facts: true });
    },

    async deleteUser({ userId }) {
      for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
      return null;
    },
  };
}
