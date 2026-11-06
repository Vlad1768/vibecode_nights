// Оценка и советы. Модель (или демо-движок) даёт только уровни 0–3, цитаты и тексты.
// Итог, проверку цитат и отбраковку советов делает этот код (docs/CONTRACT.md, раздел 8).
import { CRITERIA_NAMES } from './content.mjs';
import { capitalize, clean, limit, normalize, numbersCovered, quoteFound } from './text.mjs';
import { badOutput, noticeFor } from './guard.mjs';

export const round1 = (x) => Math.round(x * 10) / 10;

const NO_DATA = 'Нет данных в питче и ответах.';
const NOT_CONFIRMED = 'Цитаты нет в питче и ответах, поэтому уровень 0.';

/**
 * Собирает 10 критериев контракта из уровней модели.
 * @param {Array<{id:number, level:number, evidence?:string|null, comment?:string}>} raw
 * @param {number[]} weights
 * @param {string} source питч и все ответы одним текстом — для проверки цитат
 */
export function buildCriteria(raw, weights, source) {
  const byId = new Map((Array.isArray(raw) ? raw : []).map((c) => [Number(c?.id), c]));
  return CRITERIA_NAMES.map((name, i) => {
    const id = i + 1;
    const r = byId.get(id) || {};
    let level = Number.isInteger(r.level) && r.level >= 0 && r.level <= 3 ? r.level : 0;
    let evidence = clean(r.evidence) || null;
    const given = limit(r.comment, 240);
    let comment = given && !badOutput(given) && numbersCovered(given, source) ? given : (level ? 'Оценено по питчу и ответам.' : NO_DATA);
    // Цитата должна быть в тексте студента и не быть уговором («поставьте высокий балл»).
    if (level > 0 && !(evidence && quoteFound(evidence, source) && !noticeFor(evidence))) {
      level = 0;
      comment = NOT_CONFIRMED;
    }
    if (level === 0) {
      evidence = null;
      if (comment !== NOT_CONFIRMED && !r.comment) comment = NO_DATA;
    }
    const weight = weights[i];
    return { id, name, level, weight, score: round1((weight * level) / 3), max: weight, evidence: evidence && limit(evidence, 400), comment };
  });
}

export const totalOf = (criteria) => Math.round(criteria.reduce((a, c) => a + c.score, 0));

// Срок — в днях, не дольше недели.
const DEADLINE = /^(сегодня|завтра|послезавтра|сегодня вечером|за (1|один) день|за ([2-7]|два|три|четыре|пять|шесть|семь) (дня|дней)|за неделю|за выходные|до выходных|до (понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья)|до защиты|до выступления)$/u;

export function validDeadline(deadline) {
  return DEADLINE.test(normalize(deadline));
}

/** Причина отбраковки совета или null, если совет годится. */
export function adviceProblem(a, stopPhrases) {
  if (!a || typeof a !== 'object') return 'не объект';
  const action = clean(a.action);
  const doneWhen = clean(a.doneWhen);
  if (action.length < 10) return 'нет действия';
  if (!doneWhen) return 'нет признака «готово»';
  if (!validDeadline(a.deadline)) return 'нет срока или дольше недели';
  const text = normalize(`${action} ${doneWhen}`);
  if (stopPhrases.some((p) => text.includes(normalize(p)))) return 'стоп-фраза';
  if (badOutput(`${action} ${doneWhen}`)) return 'выдуманные данные или грубость';
  return null;
}

const BASED_ON = /^(вопрос [1-5]|критерий ([1-9]|10))$/u;

/** Оформляет совет в тип Advice контракта. */
export function formatAdvice(a, fallbackBasedOn) {
  const action = limit(clean(a.action).replace(/[.;]+$/, ''), 300);
  const doneWhen = limit(clean(a.doneWhen).replace(/^готово,?\s*когда\s*/iu, '').replace(/[.;]+$/, ''), 200);
  const deadline = normalize(a.deadline);
  const basedOn = BASED_ON.test(normalize(a.basedOn)) ? normalize(a.basedOn) : fallbackBasedOn;
  return {
    text: `${capitalize(deadline)}: ${action}. Готово, когда ${doneWhen}.`,
    action, deadline, doneWhen, basedOn,
  };
}

/**
 * Ровно 3 совета: сначала годные от модели, недостающие — из запасных (они заранее годные).
 * Дубли по действию отбрасываются.
 */
export function pickAdvice(candidates, reserve, stopPhrases, fallbackBasedOn) {
  const out = [];
  const seen = new Set();
  const take = (a) => {
    if (out.length >= 3 || adviceProblem(a, stopPhrases)) return;
    const key = normalize(a.action).slice(0, 40);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(formatAdvice(a, fallbackBasedOn));
  };
  (Array.isArray(candidates) ? candidates : []).forEach(take);
  reserve.forEach(take);
  if (out.length !== 3) throw new Error('не удалось собрать 3 совета: запасных советов недостаточно');
  return out;
}

/** Короткие «сильное / слабое» по критериям, если модель их не дала. */
export function summaryFrom(criteria, given = {}) {
  const sorted = [...criteria].sort((a, b) => b.score / (b.max || 1) - a.score / (a.max || 1));
  const best = sorted[0];
  const worst = [...criteria].filter((c) => c.max > 0).sort((a, b) => a.level - b.level || b.max - a.max)[0];
  const strong = limit(given.strong, 200) || (best.level > 0 ? `Лучше всего: «${best.name}». ${best.comment}` : 'Сильных сторон с цифрами пока не видно.');
  const weak = limit(given.weak, 200) || `Слабее всего: «${worst.name}». ${worst.level === 0 ? 'Данных нет.' : worst.comment}`;
  return { strong, weak };
}
