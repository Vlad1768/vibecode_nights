// Содержание тренажёра: персонаж, 10 критериев, веса, 5 слотов вопросов, стоп-фразы.
//
// По умолчанию — условный бизнес-ангел из docs/BOT_SCENARIO.md, пока T29 (Ника) не утвердит
// персонажа по жеребьёвке. Утверждённое содержание кладётся JSON-файлом (формат в core/README.md),
// путь задаёт CONTENT_FILE. Битый файл не подменяется молча дефолтом: сервер не стартует.
import { readFileSync, existsSync } from 'node:fs';

// Порядок и названия — как в кейсе (docs/case/README.md, раздел 4). Их не меняет никакой персонаж.
export const CRITERIA_NAMES = Object.freeze([
  'Реалистичность решения проблемы',
  'Бизнес-модель',
  'Анализ рынка и конкурентов',
  'Финансовая модель',
  'Интеллектуальная собственность или регистрация стартапа',
  'Первые продажи',
  'Риски',
  'Горизонт расчёта',
  'Уникальность продукта: технологии или услуги',
  'Инвестиционная привлекательность',
]);

export const DEFAULT_CONTENT = Object.freeze({
  persona: {
    id: 'angel',
    name: 'Олег',
    title: 'Бизнес-ангел',
    intro:
      'Я Олег, бизнес-ангел. Вложил свои деньги в 7 проектов. Ищу команду, которая не бросит проект после диплома. ' +
      'Хвалить не буду: задам 5 вопросов по твоему питчу, поставлю оценку и дам 3 дела на ближайшие дни.',
    howScored:
      'Каждый из 10 критериев «Стартап как диплом» получает уровень от 0 до 3: 0 — нет данных, 3 — подтверждено ' +
      'продажами, интервью или расчётом. Итог из 100 считает код по весам персонажа, а не модель.',
    character:
      'Предприниматель, вкладывает свои деньги, за плечами несколько сделок. Хочет верить в команду и видеть шанс ' +
      'вернуть вложения в разы. Боится, что фаундер бросит проект после диплома. Решает быстро, перебивает, ' +
      'спрашивает про личные мотивы.',
  },
  // Сумма 100. Порядок — как CRITERIA_NAMES.
  weights: [15, 10, 10, 10, 5, 15, 10, 5, 10, 10],
  slots: [
    { topic: 'Клиент', goal: 'конкретный клиент: кто платит, должность или один человек, как он решает задачу сейчас и сколько ему это стоит', criteria: [1, 2] },
    { topic: 'Доказательства', goal: 'доказательства спроса: сколько интервью, продаж, пилотов, возвратов и что в них удивило', criteria: [6] },
    { topic: 'Деньги', goal: 'деньги: кто платит, сколько стоит привлечь клиента, сколько стоит сделать продукт для одного клиента, когда выход в ноль', criteria: [4, 8] },
    { topic: 'Конкуренты', goal: 'конкуренты и привычный способ: почему клиент уйдёт от текущего решения и почему крупная компания не сделает это за месяц', criteria: [3, 9] },
    { topic: 'Мотивация', goal: 'страх персонажа: будет ли автор делать проект после защиты диплома, сколько часов в неделю, какая самая рискованная гипотеза', criteria: [7, 10] },
  ],
  stopPhrases: [
    'проведите исследование рынка',
    'провести исследование рынка',
    'исследуйте рынок',
    'улучшите продукт',
    'улучшить продукт',
    'наймите команду',
    'нанять команду',
    'найдите инвестора',
  ],
});

function fail(why) {
  throw new Error(`Содержание тренажёра не прошло проверку: ${why}`);
}

const isText = (v, max = 2000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Проверяет содержание и возвращает замороженную копию. */
export function validateContent(raw) {
  if (!raw || typeof raw !== 'object') fail('ожидается JSON-объект');
  const p = raw.persona;
  if (!p || typeof p !== 'object') fail('нет persona');
  for (const key of ['id', 'name', 'title', 'intro', 'howScored', 'character']) {
    if (!isText(p[key])) fail(`persona.${key} — непустая строка`);
  }
  for (const key of ['trait', 'focus']) {
    if (p[key] !== undefined && !isText(p[key], 200)) fail(`persona.${key} — строка до 200 символов`);
  }
  const w = raw.weights;
  if (!Array.isArray(w) || w.length !== 10 || !w.every((x) => Number.isInteger(x) && x >= 0)) {
    fail('weights — 10 целых чисел ≥ 0 в порядке критериев кейса');
  }
  if (w.reduce((a, b) => a + b, 0) !== 100) fail('сумма weights должна быть 100');
  const s = raw.slots;
  if (!Array.isArray(s) || s.length !== 5) fail('slots — ровно 5 слотов вопросов');
  s.forEach((slot, i) => {
    if (!isText(slot?.topic, 40) || !isText(slot?.goal, 500)) fail(`slots[${i}] — нужны topic и goal`);
    if (!Array.isArray(slot.criteria) || !slot.criteria.every((c) => Number.isInteger(c) && c >= 1 && c <= 10)) {
      fail(`slots[${i}].criteria — номера критериев 1..10`);
    }
    if (slot.demoQuestion !== undefined && !isText(slot.demoQuestion, 300)) fail(`slots[${i}].demoQuestion — строка до 300 символов`);
  });
  const stop = raw.stopPhrases ?? DEFAULT_CONTENT.stopPhrases;
  if (!Array.isArray(stop) || !stop.every((x) => isText(x, 200))) fail('stopPhrases — массив строк');
  return deepFreeze({
    persona: {
      id: p.id, name: p.name, title: p.title, intro: p.intro, howScored: p.howScored, character: p.character,
      ...(p.trait ? { trait: p.trait } : {}), ...(p.focus ? { focus: p.focus } : {}),
    },
    weights: [...w],
    slots: s.map((slot) => ({
      topic: slot.topic, goal: slot.goal, criteria: [...slot.criteria],
      ...(slot.demoQuestion ? { demoQuestion: slot.demoQuestion } : {}),
    })),
    stopPhrases: stop.map((x) => x.toLowerCase()),
  });
}

/** Загружает содержание из файла или возвращает дефолт, если путь не задан. */
export function loadContent(file) {
  if (!file) return validateContent(DEFAULT_CONTENT);
  if (!existsSync(file)) fail(`файл ${file} не найден`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} — не JSON`);
  }
  return validateContent(raw);
}

/** Карточка персонажа в форме контракта (тип Persona). */
export const personaView = (content) => {
  const { id, name, title, intro, howScored } = content.persona;
  return { id, name, title, intro, howScored };
};

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
