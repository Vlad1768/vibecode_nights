// Демо-движок: тот же интерфейс, что у модели, но без сети, на правилах и заготовках.
// Работает, когда нет ключа Gemini, включён DEMO_MODE=1 или модель не ответила.
// Вопросы цепляются за цитаты из питча, оценка ищет подтверждения в тексте, цифр не выдумывает.
import { DEFAULT_CONTENT } from './content.mjs';
import { authorText, isDontKnow, missingParts, noticeFor } from './guard.mjs';
import { limit, normalize, sentences } from './text.mjs';
import { findWeak, planNotFact, weakClaim } from './claims.mjs';

const DEFAULT_TOPICS = DEFAULT_CONTENT.slots.map((s) => s.topic);

// По два вопроса на слот: второй — для второго раунда, чтобы не повторяться.
const QUESTIONS = [
  ['Кто конкретно платит за продукт? Назовите должность или одного человека и что у него болит.',
    'Как этот клиент решает задачу сейчас и сколько ему это стоит в деньгах или часах?'],
  ['Сколько интервью, продаж или пилотов у вас было и что в них вас удивило?',
    'Сколько клиентов вернулось или заплатило второй раз и откуда эта цифра?'],
  ['Сколько стоит привлечь одного клиента и когда вы выйдете в ноль?',
    'Во сколько вам обходится один клиент: работа, контент, привлечение? И сколько он платит?'],
  ['Как люди решают эту задачу сейчас и почему перейдут к вам, а не останутся с привычным способом?',
    'Почему крупная компания не сделает то же самое за месяц?'],
  ['Через полгода диплом. Вы лично будете делать этот проект после защиты и сколько часов в неделю?',
    'Какая у вас самая рискованная гипотеза и как вы проверите её за неделю?'],
];

// Где в питче искать цитату для крючка вопроса.
const HOOKS = [
  /клиент|для\s|сет[ьиям]|вуз|студент|пользовател|родител|дачник|лаборатор/iu,
  /интервью|пилот|продаж|заказ|скачиван|регистрац|опрос|бронирован|проверок|занят/iu,
  /₽|руб|подписк|комисси|цен[аы]|себестоим|чек/iu,
  /конкурент|аналог|маркетплейс|крупн|больш\p{L}*\s+(приложени|сервис|компани|игрок)|уже\s+есть|есть,\s+но|сейчас\s+(это\s+)?(ведут|решают|делают)|excel|таблиц/iu,
  /команд|человек|выходн|сам\s|диплом|инженер|разработчик/iu,
];

/** Предложения автора по строкам: без подписей формы, и каждое — дословный кусок исходного текста. */
function authorSentences(text) {
  return String(text ?? '').split('\n')
    .filter((line) => !/^\s*(#+\s*)?заявка\s+\d+|^\s*\*\*(команда|стадия)/iu.test(line))
    .map(authorText).flatMap(sentences);
}

const hookText = (s) => limit(s.replace(/[.!?…]+$/, ''), 110);

function factSentences(pitch) {
  return authorSentences(pitch).filter((s) => /\d/.test(s) && s.length >= 12);
}

function missingFacts(text) {
  const t = normalize(text);
  const checks = [
    [/платит|заказчик|покупател|клиент[аы]?\s+—|кто платит|лицензи/u, 'кто именно платит'],
    [/конкурент|аналог|альтернатив|сейчас\s+(это|ведут|решают)/u, 'конкуренты и как задачу решают сейчас'],
    [/стоимость привлечения|cac|реклам|привлекал|сарафан/u, 'сколько стоит привлечь клиента'],
    [/\bооо\b|\bип\b|самозанят|патент|зарегистрир|сертификац/u, 'регистрация или интеллектуальная собственность'],
  ];
  return [...missingParts(text).filter((m) => m !== 'проблема и для кого'), ...checks.filter(([re]) => !re.test(t)).map(([, l]) => l)].slice(0, 5);
}

function hookFor(slotIndex, pitch, used) {
  const re = HOOKS[slotIndex];
  const s = re && authorSentences(pitch).find((x) => re.test(x) && !used.has(hookText(x)) && x.length >= 30);
  return s ? hookText(s) : null;
}

// Вопрос под конкретную слабость питча (банк вопросов Ивана, pitch/research/question-bank.md).
const WEAK_QUESTIONS = [
  ['analogy', 'Сравнение с известной компанией жюри не убедит. Кто ваш клиент? Опишите одного конкретного человека.'],
  null,
  ['top_down', 'Это расчёт сверху вниз. Посчитайте снизу: сколько клиентов вы реально получите, какой у них чек и как часто они платят?'],
  ['no_competitors', 'Вы пишете, что конкурентов нет. Но привычный способ есть всегда: как клиент решает задачу сегодня и почему уйдёт от этого к вам?'],
  null,
];

function weakQuestion(slotIndex, ctx) {
  const rule = WEAK_QUESTIONS[slotIndex];
  if (!rule || ctx.previousQuestions?.length) return null;
  const found = findWeak(authorSentences(ctx.pitch), rule[0]);
  return found ? { question: `В питче: «${hookText(found)}». ${rule[1]}`, hook: hookText(found) } : null;
}

function questionFor(content, slotIndex, ctx) {
  const slot = content.slots[slotIndex];
  if (slot.topic === DEFAULT_TOPICS[slotIndex]) {
    const special = weakQuestion(slotIndex, ctx);
    if (special) return special;
  }
  const round2 = ctx.previousQuestions?.length > 0;
  let base;
  if (slot.demoQuestion && !round2) base = slot.demoQuestion;
  else if (slot.topic === DEFAULT_TOPICS[slotIndex]) base = QUESTIONS[slotIndex][round2 ? 1 : 0];
  else base = slot.demoQuestion || `Про ${slot.goal.split(':')[0]}: что у вас есть по этому пункту, с цифрами?`;
  const used = new Set((ctx.history || []).map((h) => h.hook).filter(Boolean));
  const hook = slotIndex < 4 ? hookFor(slotIndex, ctx.pitch, used) : null;
  return { question: hook ? `В питче: «${hook}». ${base}` : base, hook };
}

const REACTIONS = {
  dontKnow: ['Честно. Это пойдёт в план на ближайшие дни.', 'Хорошо, что признали. На сцене так не получится, значит, это в советы.'],
  short: ['Коротко. На сцене этого не хватит: нужна цифра или пример.', 'Одной фразы мало. Жюри переспросит.'],
  numbers: ['Цифра есть, это уже разговор.', 'С цифрой спорить легче. Дальше.'],
  plain: ['Записал. Без цифры это пока только слова.', 'Понял. Где доказательство?'],
  top_down: ['Это расчёт сверху вниз. Жюри попросит снизу: клиенты × чек × частота.', '«Процент от рынка» — не расчёт. Сколько клиентов у вас будет на самом деле?'],
  analogy: ['Сравнение с известной компанией — не доказательство. Нужны ваши цифры.', 'Аналогией жюри не убедить. Что уже сделали вы?'],
  no_competitors: ['«Конкурентов нет» для жюри значит «рынок не изучен».', 'Конкурент есть всегда, хотя бы привычный способ. Назовите его.'],
  plans: ['Это план. На сцене спросят, что уже сделано.', 'Планы есть у всех. Какой факт уже на руках?'],
};

function reactionFor(answer, step) {
  const weak = weakClaim(answer);
  const kind = isDontKnow(answer) ? 'dontKnow'
    : weak ? weak
    : planNotFact(answer) ? 'plans'
    : answer.length < 40 ? 'short'
    : /\d/.test(answer) ? 'numbers' : 'plain';
  const list = REACTIONS[kind];
  return list[step % list.length];
}

// Что в тексте подтверждает каждый критерий (порядок как в кейсе).
const CRITERIA_CUES = [
  /проблем|боль|теря|тратит|текучк|обман|простаива|не успева|приходится|загружен|ищет/iu,
  /₽|руб|подписк|комисси|лицензи|платит|платн|монетиз|продаж/iu,
  /конкурент|аналог|рынок|рынк|маркетплейс|альтернатив|крупн|excel|таблиц/iu,
  /себестоим|выручк|окупа|в ноль|маржа|расход|остается|остаётся|средний чек|стоит нам|обходится/iu,
  /\bооо\b|\bип\b|самозанят|патент|зарегистрир|товарн\p{L}* знак|сертификац|юрид|юрист/iu,
  /продаж|оплат|платн\p{L}* провер|заказ|договор|письм\p{L}* о намерени|бронирован|выручк|заплатил/iu,
  /риск|гипотез|если не|согласован|сертификац|бухгалтер|зависи|проверим/iu,
  /через\s+(\d+|год|полгода|месяц)|к\s+(весне|лету|осени|зиме|декабр|сезон)|за\s+полгода|в ноль|окупа|часов в неделю|после (защиты|диплома)/iu,
  /в отличие|уникальн|наш плюс|отлича|только у нас|без аналог|не для студентов|патент|технолог|нет уведомлен/iu,
  /масштаб|сет[ьиейям]|\d+\s+(точ|вуз|общежит|лаборатор|сет)|рост|повторн|рекомендаци|готов\p{L}* продолжить|выйти в/iu,
];
const PROOF = /пилот|продаж|оплат|интервью|договор|письм|заказ|клиент|повторн|вернул|выручк|бронирован|проверок|точк/iu;
const COMMENTS = ['', 'Заявлено, но без цифр.', 'Есть цифры, но мало подтверждений.', 'Подтверждено цифрами из питча или ответов.'];

function scoreCriteria(source) {
  // Уговоры и попытки подменить правила баллов не дают.
  const all = authorSentences(source).filter((s) => s.length >= 10 && !noticeFor(s));
  return CRITERIA_CUES.map((re, i) => {
    const hits = all.filter((s) => re.test(s));
    if (!hits.length) return { id: i + 1, level: 0, evidence: null, comment: 'Нет данных в питче и ответах.' };
    // Слабые заявления (аналогия, рынок сверху вниз) дают не больше 1; «конкурентов нет» по рынку — 0.
    const solid = hits.filter((s) => !weakClaim(s));
    const strong = solid.find((s) => /\d/.test(s) && PROOF.test(s));
    const withDigits = solid.find((s) => /\d/.test(s));
    const usableWeak = hits.find((s) => weakClaim(s) && !(i === 2 && weakClaim(s) === 'no_competitors'));
    const first = solid[0] || usableWeak;
    if (!first) return { id: i + 1, level: 0, evidence: null, comment: i === 2 ? '«Конкурентов нет» для жюри значит «рынок не изучен».' : 'Нет данных в питче и ответах.' };
    const level = strong ? 3 : withDigits ? 2 : 1;
    return { id: i + 1, level, evidence: strong || withDigits || first, comment: COMMENTS[level] };
  });
}

// Запасные советы по критериям: каждый уже проходит проверку scoring.adviceProblem.
const ADVICE_BY_CRITERION = [
  { action: 'поговорите с тремя людьми из целевой аудитории и запишите, как они решают задачу сейчас', deadline: 'за 2 дня', doneWhen: 'есть три записи с точными словами людей' },
  { action: 'запишите одной строкой, кто платит, за что и сколько', deadline: 'сегодня', doneWhen: 'строка «платит такой-то, столько-то рублей за то-то» стоит на слайде' },
  { action: 'выпишите три способа, которыми клиенты решают задачу без вас, и чем вы лучше каждого', deadline: 'за 2 дня', doneWhen: 'есть таблица из трёх строк с одним отличием в каждой' },
  { action: 'посчитайте, во сколько обходится один клиент и сколько он приносит за месяц', deadline: 'до пятницы', doneWhen: 'на слайде есть строка «клиент окупается за столько-то месяцев»' },
  { action: 'выясните, какая форма нужна для первых продаж: самозанятость, ИП или ООО', deadline: 'за 3 дня', doneWhen: 'знаете форму и что для неё нужно' },
  { action: 'предложите продукт пяти потенциальным клиентам и попросите оплату или письмо о намерениях', deadline: 'за неделю', doneWhen: 'есть хотя бы одна оплата или письмо' },
  { action: 'назовите самую рискованную гипотезу и придумайте её проверку на 3 дня без денег', deadline: 'завтра', doneWhen: 'гипотеза и проверка умещаются в два предложения' },
  { action: 'распишите по месяцам, что будет с проектом в ближайшие полгода', deadline: 'до пятницы', doneWhen: 'есть 6 строк: месяц и измеримый результат' },
  { action: 'сформулируйте одно отличие от конкурентов, которое можно показать на демо', deadline: 'сегодня', doneWhen: 'отличие умещается в одну фразу и подтверждается примером' },
  { action: 'посчитайте, сколько клиентов вы реально получите за год и сколько это денег', deadline: 'за 3 дня', doneWhen: 'расчёт в три строки с источником каждой цифры' },
];

/**
 * Запасные советы в порядке пользы: два самых слабых критерия, «проговорить вслух», остальные.
 * Используется и демо-движком, и ядром, когда модель дала меньше 3 годных советов.
 */
export function reserveAdvice(criteria, weights, history = []) {
  const weakest = criteria
    .map((c, i) => ({ i, gap: weights[i] * (3 - c.level) }))
    .sort((a, b) => b.gap - a.gap)
    .map(({ i }) => ({ ...ADVICE_BY_CRITERION[i], basedOn: `критерий ${i + 1}` }));
  const hardest = [...history].sort((a, b) => Number(isDontKnow(b.answer)) - Number(isDontKnow(a.answer)) || a.answer.length - b.answer.length)[0];
  const aloud = {
    action: 'ответьте вслух на самый трудный вопрос за 30 секунд и запишите себя на диктофон',
    deadline: 'сегодня вечером',
    doneWhen: 'в записи нет «ну, наверное» и есть одна цифра',
    basedOn: hardest ? `вопрос ${hardest.step}` : 'вопрос 5',
  };
  return [weakest[0], weakest[1], aloud, ...weakest.slice(2)];
}

export function createDemoEngine() {
  return {
    mode: 'demo',

    async start(ctx) {
      const known = factSentences(ctx.pitch).slice(0, 5).map((s) => limit(s, 200));
      const { question, hook } = questionFor(ctx.content, 0, ctx);
      return { kind: 'pitch', facts: { known, missing: missingFacts(authorText(ctx.pitch)) }, question, hook, manipulation: false };
    },

    async next(ctx) {
      const last = ctx.history[ctx.history.length - 1];
      const { question, hook } = questionFor(ctx.content, ctx.step - 1, ctx);
      return { reaction: reactionFor(last.answer, ctx.step), question, hook, manipulation: false };
    },

    async finish(ctx) {
      const source = [ctx.pitch, ...ctx.history.map((h) => h.answer)].join('\n');
      const criteria = scoreCriteria(source);
      return { criteria, strong: '', weak: '', advice: reserveAdvice(criteria, ctx.content.weights, ctx.history).slice(0, 3) };
    },
  };
}
