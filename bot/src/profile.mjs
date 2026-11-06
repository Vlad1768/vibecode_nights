// Профиль и геймификация (ТЗ §9): уровни по XP, ачивки, серия дней, статистика по накопленным баллам.
import { PITCH_CRITERIA, ANSWER_CRITERIA, ISSUES } from './coach.mjs';

export const DEFENDED_THRESHOLD = 70;

export const LEVELS = Object.freeze([
  { name: 'Новичок', xp: 0 },
  { name: 'Стартапер', xp: 300 },
  { name: 'Питчер', xp: 800 },
  { name: 'Фаундер', xp: 1500 },
  { name: 'Серийный фаундер', xp: 2500 },
  { name: 'Единорог', xp: 4000 },
]);

export const ACHIEVEMENTS = Object.freeze({
  first: '🎬 Первый питч',
  defended: '🛡 Защитился',
  sniper: '🎯 Снайпер',
  rework: '🔧 Работа над ошибками',
  noHints: '🧠 Без подсказок',
  business: '👔 Деловой стиль',
  fire: '🔥 Огонь',
});

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

export function levelFor(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const next = LEVELS[i + 1] ?? null;
  return { index: i, name: LEVELS[i].name, next };
}

// Серия: сколько дней подряд (по UTC-датам) были сессии, заканчивая сегодня или вчера.
export function streakDays(sessions, now = Date.now()) {
  const days = new Set(sessions.map((s) => dayKey(s.at)));
  let cursor = now;
  if (!days.has(dayKey(cursor))) cursor -= DAY;
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor -= DAY;
  }
  return n;
}

const LANGUAGE_ISSUES = new Set(['slang', 'profanity']);
const languageClean = (s) => !s.issues?.some((i) => LANGUAGE_ISSUES.has(i));

// Ачивки после очередной сессии. sessions — все сессии пользователя по порядку, последняя — новая.
export function achievementsFor(sessions, now = Date.now()) {
  const got = new Set();
  if (sessions.length >= 1) got.add('first');
  if (sessions.some((s) => s.total >= DEFENDED_THRESHOLD)) got.add('defended');
  if (sessions.some((s) => s.answers?.length === 5 && s.answers.every((a) => a.total >= 15))) got.add('sniper');
  if (sessions.some((s) => s.pitchTotals?.length > 1 && s.pitchTotals.at(-1) - s.pitchTotals[0] >= 20)) got.add('rework');
  if (sessions.some((s) => s.replacements === 0 && s.answers?.length === 5)) got.add('noHints');
  for (let i = 0; i + 5 <= sessions.length; i++) {
    if (sessions.slice(i, i + 5).every(languageClean)) { got.add('business'); break; }
  }
  if (streakDays(sessions, now) >= 7) got.add('fire');
  return got;
}

const SPARK = '▁▂▃▄▅▆▇█';
export function sparkline(values) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((v) => SPARK[max === min ? 3 : Math.round(((v - min) / (max - min)) * (SPARK.length - 1))]).join('');
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x) => Math.round(x);

// Средний % по каждому критерию питча и ответов за все сессии.
export function criteriaPercents(sessions) {
  const acc = new Map();
  const add = (name, score, max) => {
    const a = acc.get(name) ?? { sum: 0, n: 0 };
    a.sum += score / max;
    a.n++;
    acc.set(name, a);
  };
  for (const s of sessions) {
    s.pitchScores?.forEach((v, i) => add(PITCH_CRITERIA[i].name, v, PITCH_CRITERIA[i].max));
    for (const a of s.answers ?? []) a.scores?.forEach((v, i) => add(`Ответы: ${ANSWER_CRITERIA[i].name.toLowerCase()}`, v, ANSWER_CRITERIA[i].max));
  }
  return [...acc.entries()].map(([name, a]) => ({ name, pct: round((a.sum / a.n) * 100) }));
}

export function frequentIssues(sessions, limit = 3) {
  const count = new Map();
  for (const s of sessions) for (const i of s.issues ?? []) count.set(i, (count.get(i) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, n]) => ({ text: ISSUES[id] ?? id, n }));
}

export function buildProfile({ name, sessions, allUsers = [], userId, now = Date.now() }) {
  const xp = sessions.reduce((a, s) => a + (s.total ?? 0), 0);
  const level = levelFor(xp);
  const defended = sessions.filter((s) => s.total >= DEFENDED_THRESHOLD).length;
  const last5 = sessions.slice(-5).map((s) => s.total);
  const trend = last5.length > 1 ? round((last5.at(-1) - last5[0]) / (last5.length - 1)) : 0;
  const pct = criteriaPercents(sessions).sort((a, b) => b.pct - a.pct);
  const ranking = allUsers.map((u) => ({ id: u.userId, xp: u.sessions.reduce((a, s) => a + (s.total ?? 0), 0) })).sort((a, b) => b.xp - a.xp);
  const place = ranking.findIndex((u) => u.id === userId);
  return {
    name: name || 'Фаундер',
    xp,
    level,
    sessions: sessions.length,
    defended,
    approval: sessions.length ? round((defended / sessions.length) * 100) : 0,
    avgPitch: round(avg(sessions.map((s) => s.pitchTotal ?? 0))),
    avgAnswers: round(avg(sessions.map((s) => s.answersTotal ?? 0))),
    best: sessions.length ? Math.max(...sessions.map((s) => s.total ?? 0)) : 0,
    last5,
    trend,
    streak: streakDays(sessions, now),
    strong: pct.slice(0, 3),
    weak: pct.slice(-3).reverse(),
    issues: frequentIssues(sessions),
    achievements: [...achievementsFor(sessions, now)].map((id) => ACHIEVEMENTS[id]),
    place: ranking.length > 1 && place >= 0 ? { n: place + 1, of: ranking.length } : null,
  };
}

export function formatProfile(p) {
  const lines = [];
  const next = p.level.next ? `${p.xp}/${p.level.next.xp} до «${p.level.next.name}»` : `${p.xp} — максимальный уровень`;
  lines.push(`👤 ${p.name} · Уровень: ${p.level.name} · XP: ${next}`);
  if (!p.sessions) {
    lines.push('', 'Сессий пока нет. Пришли питч — после первой сессии здесь появится статистика.');
    return lines.join('\n');
  }
  const arrow = p.trend > 0 ? `↑ +${p.trend} за сессию` : p.trend < 0 ? `↓ ${p.trend} за сессию` : '→ без изменений';
  lines.push(
    '',
    '📈 Статистика:',
    `• Сессий пройдено: ${p.sessions}`,
    `• Стартапов защищено: ${p.defended} (одобрение ${p.approval}%)`,
    `• Средний балл питча: ${p.avgPitch} · ответов: ${p.avgAnswers}`,
    `• Лучший результат: ${p.best}/100`,
    `• Последние сессии: ${sparkline(p.last5)} ${p.last5.join(' · ')} ${p.last5.length > 1 ? arrow : ''}`.trimEnd(),
    `• Серия: ${p.streak} ${p.streak === 1 ? 'день' : p.streak >= 2 && p.streak <= 4 ? 'дня' : 'дней'} подряд${p.streak >= 2 ? ' 🔥' : ''}`,
  );
  if (p.strong.length) lines.push('', '💪 Сильные стороны:', ...p.strong.map((c) => `• ${c.name} — ${c.pct}%`));
  if (p.weak.length) lines.push('', '⚠️ Слабые места:', ...p.weak.map((c) => `• ${c.name} — ${c.pct}%`));
  if (p.issues.length) lines.push('', '🔁 Частые ошибки:', ...p.issues.map((i) => `• ${i.text} (${i.n})`));
  lines.push('', `🎖 Ачивки: ${p.achievements.length ? p.achievements.join(' ') : 'пока нет'}`);
  if (p.place) lines.push(`🏅 Место в общем рейтинге: #${p.place.n} из ${p.place.of}`);
  return lines.join('\n');
}
