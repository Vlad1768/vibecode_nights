import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContent, validateContent } from './content.mjs';
import { createPersonaCatalog } from './personas.mjs';
import { createDemoEngine } from './demo.mjs';
import { createTrainer } from './trainer.mjs';
import { createFileStore, createMemoryStore } from '../server/store.mjs';

const content = loadContent();
const IDS = ['angel', 'corporate', 'grant', 'venture', 'hype-alchemist'];
const PITCH = 'Сервис помогает студентам проверять арендодателя до залога. Есть 85 платных проверок по 790 рублей, клиенты приходят по рекомендации.';
const ANSWER = 'Провели 12 интервью и получили 3 оплаты. Продолжаем проверять спрос.';

test('пять характеров сохраняют общую шкалу и прежнюю карточку без выбора', () => {
  const trainer = createTrainer({ content, store: createMemoryStore() });
  const list = trainer.personas();
  assert.equal(list.defaultId, 'angel');
  assert.deepEqual(list.personas.map((p) => p.id), IDS);
  assert.equal(trainer.persona().name, 'Олег');
  assert.equal(list.personas[0].name, 'Золотой локоть');
  for (const p of list.personas) {
    for (const key of ['id', 'name', 'title', 'intro', 'howScored', 'trait', 'focus']) assert.ok(p[key]);
    assert.equal(p.character, undefined);
  }
  for (const c of createPersonaCatalog(content).values()) {
    assert.deepEqual(c.weights, content.weights);
    assert.equal(c.slots.length, 5);
  }
});

test('параллельные раунды всех характеров передают свой контекст модели на start/next/finish', async () => {
  const seen = [];
  const demo = createDemoEngine();
  const engine = Object.fromEntries(['start', 'next', 'finish'].map((op) => [op, async (ctx) => {
    await new Promise((r) => setImmediate(r));
    seen.push({ op, pitch: ctx.pitch, content: structuredClone(ctx.content) });
    return demo[op](ctx);
  }]));
  const store = createMemoryStore();
  const trainer = createTrainer({ content, store, engine, fallback: false });
  const rounds = await Promise.all(IDS.map(async (personaId) => {
    const userId = `web:${personaId}`;
    const pitch = `${PITCH} Название проекта: ${personaId}.`;
    const { body } = await trainer.start({ userId, pitch, personaId });
    assert.equal(body.persona.id, personaId);
    return { userId, pitch, personaId, sessionId: body.sessionId };
  }));
  for (let step = 1; step <= 5; step++) {
    await Promise.all(rounds.map(async (round) => {
      const response = await trainer.answer(round.sessionId, { userId: round.userId, step, answer: ANSWER });
      assert.equal(response.body.persona.id, round.personaId);
      assert.equal(response.body.demo, false);
      if (step === 4) assert.equal(response.body.topic, createPersonaCatalog(content).get(round.personaId).slots[4].topic);
      if (step === 5) {
        assert.equal(response.body.result.criteria.length, 10);
        assert.equal(response.body.result.advice.length, 3);
        assert.deepEqual(response.body.result.criteria.map((c) => c.weight), content.weights);
      }
    }));
  }
  for (const round of rounds) {
    const calls = seen.filter((entry) => entry.pitch === round.pitch);
    assert.deepEqual(calls.map((entry) => entry.op), ['start', 'next', 'next', 'next', 'next', 'finish']);
    for (const call of calls) assert.deepEqual(call.content, createPersonaCatalog(content).get(round.personaId));
    assert.equal((await trainer.get(round.sessionId, round.userId)).body.persona.id, round.personaId);
    await assert.rejects(trainer.get(round.sessionId, 'web:other'), (e) => e.code === 'SESSION_NOT_FOUND');
  }
  assert.equal(content.persona.name, 'Олег', 'общий персонаж не мутирует');
});

test('снимок переживает перезапуск, изменение настроек и наследуется вторым раундом', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'investor-persona-'));
  const file = join(dir, 'sessions.json');
  const store = createFileStore({ file });
  let reopened;
  t.after(() => { store.close(); reopened?.close(); rmSync(dir, { recursive: true, force: true }); });
  const first = createTrainer({ content, store });
  const { body: started } = await first.start({ userId: 'web:restore', pitch: PITCH, personaId: 'corporate' });
  await first.answer(started.sessionId, { userId: 'web:restore', step: 1, answer: ANSWER });
  store.close();
  reopened = createFileStore({ file });
  const changed = validateContent({ ...content, weights: Array(10).fill(10), persona: { ...content.persona, id: 'grant', name: 'Новая конфигурация' } });
  const restored = createTrainer({ content: changed, store: reopened });
  const view = (await restored.get(started.sessionId, 'web:restore')).body;
  assert.equal(view.step, 2);
  assert.equal(view.persona.name, 'Мадам Протокол');
  let done;
  for (let step = 2; step <= 5; step++) done = (await restored.answer(started.sessionId, { userId: 'web:restore', step, answer: ANSWER })).body;
  assert.equal(done.persona.id, 'corporate');
  assert.deepEqual(done.result.criteria.map((c) => c.weight), content.weights);
  const next = (await restored.start({ userId: 'web:restore', pitch: PITCH, previousSessionId: started.sessionId })).body;
  assert.equal(next.persona.id, 'corporate');
  assert.equal(next.round, 2);
  const saved = await reopened.get(next.sessionId);
  assert.deepEqual(saved.contentSnapshot, (await reopened.get(started.sessionId)).contentSnapshot);
  assert.equal(saved.previousTotal, done.result.total);
  await assert.rejects(restored.start({ userId: 'web:restore', pitch: PITCH, previousSessionId: started.sessionId, personaId: 'venture' }), (e) => e.status === 400 && e.code === 'BAD_REQUEST');
  const same = (await restored.start({ userId: 'web:restore', pitch: PITCH, previousSessionId: started.sessionId, personaId: 'corporate' })).body;
  assert.equal(same.persona.id, 'corporate');
});

test('старые сессии и клиенты без personaId продолжают работать с настроенным персонажем', async () => {
  const custom = validateContent({ ...content, persona: { ...content.persona, id: 'hype-alchemist', name: 'Настроенный инвестор' } });
  const store = createMemoryStore();
  const trainer = createTrainer({ content: custom, store });
  assert.equal(trainer.personas().defaultId, 'hype-alchemist');
  const { body } = await trainer.start({ userId: 'tg:legacy', pitch: PITCH });
  assert.equal(body.persona.name, 'Настроенный инвестор');
  const old = await store.get(body.sessionId);
  delete old.contentSnapshot;
  await store.save(old);
  assert.equal((await trainer.get(body.sessionId, 'tg:legacy')).body.persona.name, 'Настроенный инвестор');
  const answered = (await trainer.answer(body.sessionId, { userId: 'tg:legacy', answer: ANSWER })).body;
  assert.equal(answered.step, 2);
  assert.equal(answered.persona.name, 'Настроенный инвестор');
  const again = (await trainer.answer(body.sessionId, { userId: 'tg:legacy', step: 1, answer: 'повтор' })).body;
  assert.deepEqual(again, answered);
  assert.ok((await store.get(body.sessionId)).contentSnapshot);
});
