// Заглушка общего API (T28) для разработки и демо без сервера.
// Форма ответов совпадает с bot/src/api/http.mjs. Содержание вопросов и оценки —
// условное: настоящие вопросы, шкалу и персонажа определяют T28 и T29.
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.mjs';

export const TOTAL_STEPS = 5;
export const MAX_PITCH_CHARS = 4000;
export const MAX_ANSWER_CHARS = 2000;

// 10 критериев «Стартап как диплом» из кейса (docs/case).
export const CRITERIA = Object.freeze([
  'Реалистичность решения проблемы',
  'Бизнес-модель',
  'Анализ рынка и конкурентов',
  'Финансовая модель',
  'Интеллектуальная собственность или регистрация стартапа',
  'Первые продажи',
  'Риски',
  'Горизонт расчёта',
  'Уникальность продукта',
  'Инвестиционная привлекательность',
]);

const QUESTIONS = [
  'Кто ваш клиент? Опишите одного конкретного человека.',
  'Сколько интервью вы провели и что вас в них удивило?',
  'Как люди решают эту задачу сейчас и сколько им это стоит?',
  'Сколько стоит привлечь одного клиента?',
  'Какая у вас самая рискованная гипотеза и как вы её проверите?',
];

const ADVICE = [
  'Проведите 5 коротких интервью с целевыми клиентами и выпишите их точные слова о проблеме.',
  'Посчитайте стоимость привлечения одного клиента по фактическим тратам и вынесите цифру на слайд.',
  'Произнесите вслух ответы на три самых неудобных вопроса и уложите каждый в 30 секунд.',
];

export function createMockApi({ newId = randomUUID } = {}) {
  const sessions = new Map();

  function own(sessionId, userId) {
    const s = sessions.get(sessionId);
    if (!s || s.userId !== userId) throw new ApiError('SESSION_NOT_FOUND', 'Сессия не найдена');
    return s;
  }

  return {
    mode: 'mock',

    async start({ userId, pitch }) {
      const text = String(pitch ?? '').trim();
      if (!text) throw new ApiError('EMPTY_PITCH', 'Пустое описание');
      if (text.length > MAX_PITCH_CHARS) throw new ApiError('PITCH_TOO_LONG', 'Слишком длинное описание');
      const sessionId = newId();
      sessions.set(sessionId, { userId, pitch: text, answers: [] });
      return { sessionId, step: 1, totalSteps: TOTAL_STEPS, question: QUESTIONS[0] };
    },

    async answer({ sessionId, userId, answer }) {
      const s = own(sessionId, userId);
      const text = String(answer ?? '').trim();
      if (!text) throw new ApiError('EMPTY_ANSWER', 'Пустой ответ');
      if (text.length > MAX_ANSWER_CHARS) throw new ApiError('ANSWER_TOO_LONG', 'Слишком длинный ответ');
      if (s.answers.length >= TOTAL_STEPS) throw new ApiError('SESSION_NOT_FOUND', 'Раунд уже завершён');
      s.answers.push(text);
      if (s.answers.length < TOTAL_STEPS) {
        const step = s.answers.length + 1;
        return { sessionId, step, totalSteps: TOTAL_STEPS, question: QUESTIONS[step - 1] };
      }
      // Условная оценка: чем подробнее ответы, тем выше балл. Только для демо.
      const avgLen = s.answers.reduce((a, t) => a + t.length, 0) / TOTAL_STEPS;
      const base = Math.max(1, Math.min(8, Math.round(avgLen / 40)));
      const criteria = CRITERIA.map((name, i) => ({
        name,
        score: Math.max(0, Math.min(10, base + ((i % 3) - 1))),
        max: 10,
        comment: 'Демо-оценка: настоящую выставит AI-ядро (T28).',
      }));
      const total = criteria.reduce((a, c) => a + c.score, 0);
      return {
        sessionId,
        done: true,
        result: { criteria, total, max: CRITERIA.length * 10, advice: [...ADVICE] },
      };
    },
  };
}
