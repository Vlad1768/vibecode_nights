import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, streakDays, achievementsFor, buildProfile, formatProfile, sparkline } from '../src/profile.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12);
const sess = (over = {}) => ({
  at: NOW, total: 50, pitchTotal: 50, answersTotal: 50, pitchScores: [8, 8, 8, 5, 5, 5, 5, 2, 2, 2], pitchTotals: [50],
  answers: Array.from({ length: 5 }, () => ({ total: 10, scores: [3, 3, 2, 1, 1] })), replacements: 1, issues: ['no_numbers'], ...over,
});

test('уровни по XP', () => {
  assert.equal(levelFor(0).name, 'Новичок');
  assert.equal(levelFor(299).name, 'Новичок');
  assert.equal(levelFor(300).name, 'Стартапер');
  assert.equal(levelFor(1500).name, 'Фаундер');
  assert.equal(levelFor(5000).name, 'Единорог');
  assert.equal(levelFor(5000).next, null);
});

test('серия дней подряд', () => {
  assert.equal(streakDays([sess({ at: NOW }), sess({ at: NOW - DAY }), sess({ at: NOW - 2 * DAY })], NOW), 3);
  assert.equal(streakDays([sess({ at: NOW - DAY })], NOW), 1, 'вчера — серия ещё жива');
  assert.equal(streakDays([sess({ at: NOW - 3 * DAY })], NOW), 0);
});

test('ачивки', () => {
  assert.deepEqual([...achievementsFor([sess()], NOW)], ['first']);
  const best = sess({ total: 80, answers: Array.from({ length: 5 }, () => ({ total: 16, scores: [4, 4, 3, 3, 2] })), pitchTotals: [40, 65], replacements: 0, issues: [] });
  const got = achievementsFor([best], NOW);
  for (const a of ['first', 'defended', 'sniper', 'rework', 'noHints']) assert.ok(got.has(a), a);
  const week = Array.from({ length: 7 }, (_, i) => sess({ at: NOW - i * DAY, issues: [] }));
  const w = achievementsFor(week, NOW);
  assert.ok(w.has('fire') && w.has('business'));
});

test('профиль: статистика, сильные/слабые, частые ошибки, рейтинг', () => {
  const sessions = [sess({ total: 40, at: NOW - DAY }), sess({ total: 75, defended: true, issues: ['no_numbers', 'evasive'] })];
  const p = buildProfile({
    name: 'Иван', sessions, userId: 'tg:1', now: NOW,
    allUsers: [{ userId: 'tg:1', sessions }, { userId: 'tg:2', sessions: [sess({ total: 200 })] }],
  });
  assert.equal(p.sessions, 2);
  assert.equal(p.defended, 1);
  assert.equal(p.approval, 50);
  assert.equal(p.best, 75);
  assert.equal(p.streak, 2);
  assert.equal(p.issues[0].text, 'нет цифр');
  assert.deepEqual(p.place, { n: 2, of: 2 });
  const text = formatProfile(p);
  for (const part of ['👤 Иван · Уровень: Новичок · XP: 115/300', 'Сессий пройдено: 2', 'Стартапов защищено: 1 (одобрение 50%)', '💪 Сильные стороны', '⚠️ Слабые места', '🔁 Частые ошибки', '🎖 Ачивки', '🏅 Место в общем рейтинге: #2 из 2']) {
    assert.ok(text.includes(part), part);
  }
  assert.match(formatProfile(buildProfile({ name: 'Аня', sessions: [], userId: 'tg:3' })), /Сессий пока нет/);
  assert.equal(sparkline([10, 20, 30]).length, 3);
});
