import test from 'node:test';
import assert from 'node:assert/strict';
import { CRITERIA, EXAMPLE_PITCH, QUESTIONS, DEMO_RESULT } from './demo.mjs';

test('round has exactly five complete, distinct question cards', () => {
  assert.equal(QUESTIONS.length, 5);
  assert.equal(new Set(QUESTIONS.map(({ text }) => text)).size, 5);
  for (const question of QUESTIONS) {
    for (const key of ['title', 'text', 'hint']) {
      assert.equal(typeof question[key], 'string');
      assert.ok(question[key].trim().length > 0, `Missing ${key}`);
    }
  }
});

test('report preserves all ten case criteria in the same order', () => {
  assert.equal(CRITERIA.length, 10);
  assert.equal(new Set(CRITERIA).size, 10);
  assert.deepEqual(DEMO_RESULT.criteria.map(({ name }) => name), CRITERIA);
  for (const criterion of DEMO_RESULT.criteria) {
    assert.ok(Number.isFinite(criterion.score));
    assert.ok(criterion.maxScore > 0);
    assert.ok(criterion.score >= 0 && criterion.score <= criterion.maxScore);
    assert.ok(criterion.comment.trim().length > 0);
  }
});

test('headline score equals the sum of criterion scores and maxima', () => {
  assert.equal(DEMO_RESULT.score, DEMO_RESULT.criteria.reduce((sum, item) => sum + item.score, 0));
  assert.equal(DEMO_RESULT.maxScore, DEMO_RESULT.criteria.reduce((sum, item) => sum + item.maxScore, 0));
});

test('report has exactly three actionable advice cards', () => {
  assert.equal(DEMO_RESULT.tips.length, 3);
  assert.equal(new Set(DEMO_RESULT.tips.map(({ title }) => title)).size, 3);
  for (const tip of DEMO_RESULT.tips) {
    assert.ok(tip.title.trim().length > 0);
    assert.ok(tip.text.trim().length > 0);
  }
});

test('fixtures identify themselves as examples rather than live assessment', () => {
  assert.match(EXAMPLE_PITCH, /Учебный пример/);
  assert.match(DEMO_RESULT.summary, /образец отчёта, а не оценка ваших ответов/);
});
