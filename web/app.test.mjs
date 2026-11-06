// Exercise the browser state machine against the actual gateway and shared core.
// The small DOM stand-in records rendered content; visual layout is checked in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID, webcrypto } from 'node:crypto';
import { createGateway } from './gateway.mjs';
import { createHandler } from '../server/handler.mjs';
import { createMemoryStore } from '../server/store.mjs';
import { createTrainer } from '../core/trainer.mjs';
import { loadContent } from '../core/content.mjs';
import { CRITERIA, EXAMPLE_PITCH, QUESTIONS, DEMO_RESULT } from './demo.mjs';

const source = (await readFile(new URL('./app.mjs', import.meta.url), 'utf8'))
  .replace(/^import \{[\s\S]*?\} from '.\/demo.mjs';/, '');
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const storageKey = 'angry_investor_state_v1';
const turn = () => new Promise((resolve) => setImmediate(resolve));

class Element {
  constructor() {
    this.value = ''; this.hidden = false; this.dataset = {}; this.style = {}; this.children = [];
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, [...listeners, listener]);
  }
  dispatch(type) { for (const listener of this.listeners.get(type) || []) listener({ target: this }); }
  removeAttribute() {}
  setAttribute() {}
  focus() {}
  scrollIntoView() {}
}

async function fixture(t) {
  const trainer = createTrainer({ content: loadContent(), store: createMemoryStore(), fallback: false });
  const handler = createHandler(trainer);
  const upstream = createServer(handler);
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const gateway = createGateway({
    upstream: `http://127.0.0.1:${upstream.address().port}`,
    cookieSecret: 'browser-integration-test-persistent-secret-over-32',
  });
  gateway.listen(0, '127.0.0.1');
  await once(gateway, 'listening');
  t.after(async () => {
    handler.close();
    for (const server of [gateway, upstream]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const cookies = new Map();
  const browser = {
    calls: [], intercept: null,
    async fetch(path, options = {}) {
      const headers = new Headers(options.headers);
      const cookie = [...cookies.values()].filter((item) => path === item.path || path.startsWith(item.path + '/'))
        .map((item) => item.pair).join('; ');
      if (cookie) headers.set('Cookie', cookie);
      if (options.method === 'POST') headers.set('Origin', base);
      const payload = options.body ? JSON.parse(options.body) : undefined;
      assert.ok(!payload || !Object.hasOwn(payload, 'userId'), 'browser never sends a client-controlled userId');
      const call = { path, method: options.method || 'GET', payload };
      browser.calls.push(call);
      const request = async () => {
        const response = await fetch(base + path, { ...options, headers });
        for (const raw of response.headers.getSetCookie()) {
          const pair = raw.split(';')[0];
          const cookiePath = /;\s*Path=([^;]+)/i.exec(raw)?.[1] || '/';
          cookies.set(pair.split('=')[0] + cookiePath, { pair, path: cookiePath });
        }
        return response;
      };
      return browser.intercept ? browser.intercept(call, request) : request();
    },
  };
  return browser;
}

function boot(browser, storage = new Map()) {
  const elements = new Map(ids.map((id) => [id, new Element()]));
  const pending = new Set();
  const context = vm.createContext({
    CRITERIA, EXAMPLE_PITCH, DEMO_QUESTIONS: QUESTIONS, DEMO_RESULT,
    AbortController, structuredClone, crypto: webcrypto,
    window: { setTimeout, clearTimeout },
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelectorAll: () => [1, 2, 3, 4].map((n) => Object.assign(new Element(), { dataset: { stepNav: String(n) } })),
      createElement: () => new Element(),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: (...args) => {
      const request = browser.fetch(...args);
      pending.add(request);
      request.then(() => pending.delete(request), () => pending.delete(request));
      return request;
    },
  });
  vm.runInContext(source + `
    globalThis.probe = {
      get state() { return state; }, get busy() { return isSubmitting; },
      pitch: handlePitchSubmit, answer: handleAnswerSubmit, demo: activateDemoMode,
      exitDemo: exitDemoToLive, secondRound: startSecondRound, reset: startNewRound
    };`, context);
  return {
    state: context.probe, elements, storage,
    async idle() {
      for (let i = 0; i < 300 && (pending.size || context.probe.busy); i++) {
        await Promise.allSettled([...pending]);
        await turn();
      }
      await turn();
      assert.equal(context.probe.busy, false, 'UI eventually leaves its submitting state');
    },
  };
}

async function complete(app) {
  for (let step = app.state.state.step; step <= 5; step++) {
    app.elements.get('answer-input').value = `Ответ ${step}: провели 12 интервью со студентами, получили 3 оплаты по 1500 рублей.`;
    await app.state.answer();
  }
  assert.equal(app.state.state.stage, 'result');
}

function personaRadio(app, id) {
  const radios = app.elements.get('persona-options').children.map((label) => label.children[0]);
  const radio = radios.find((item) => item.value === id);
  assert.ok(radio, `character ${id} has a radio option`);
  return radio;
}

function choosePersona(app, id) {
  const radio = personaRadio(app, id);
  radio.checked = true;
  radio.dispatch('change');
}

test('shared API: persona, facts, weighted score, evidence, recovery and a second round', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  assert.equal(app.elements.get('persona-panel').hidden, false);
  assert.equal(app.elements.get('api-badge').textContent, 'Учебный режим · без ИИ');
  assert.equal(app.elements.get('api-demo-banner').hidden, false, 'API demo is clear before submitting a pitch');
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  await app.state.pitch();
  assert.equal(app.state.state.step, 1);
  assert.ok(app.state.state.facts);
  const sessionId = app.state.state.sessionId;
  await complete(app);
  const result = app.state.state.result;
  assert.equal(app.elements.get('criteria-grid').children.length, 10);
  assert.equal(app.elements.get('tips-list').children.length, 3);
  assert.ok(result.criteria.some((item) => !Number.isInteger(item.score)), 'decimal tenths survive the API mapping');
  assert.equal(result.criteria.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.ok(result.criteria.every((item) => item.maxScore === item.weight && item.level >= 0 && item.level <= 3));
  assert.ok(result.criteria.some((item) => item.evidence));
  const restored = boot(browser, app.storage);
  await restored.idle();
  assert.equal(restored.state.state.stage, 'result');
  assert.equal(restored.state.state.result.score, result.score);
  restored.state.secondRound();
  assert.equal(restored.state.state.previousSessionId, sessionId);
  await restored.state.pitch();
  assert.equal(restored.state.state.round, 2);
  await complete(restored);
  assert.equal(restored.state.state.result.previousTotal, result.score);
  assert.equal(restored.elements.get('round-comparison').hidden, false);
});

test('a lost successful answer is reconciled by GET after reload without sending it twice', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  await app.state.pitch();
  browser.intercept = async (call, request) => {
    const response = await request();
    if (call.path.endsWith('/answers')) {
      browser.intercept = null;
      await response.body.cancel();
      throw new TypeError('simulated network loss after server accepted the answer');
    }
    return response;
  };
  app.elements.get('answer-input').value = 'Сохранённый ответ: провели 12 интервью со студентами.';
  await app.state.answer();
  assert.equal(app.state.state.step, 1);
  assert.match(app.state.state.answerDraft, /Сохранённый ответ/);
  const restored = boot(browser, app.storage);
  await restored.idle();
  assert.equal(restored.state.state.step, 2);
  assert.equal(restored.state.state.history.length, 1);
  assert.match(restored.state.state.history[0].answer, /Сохранённый ответ/);
  assert.equal(browser.calls.filter((call) => call.path.endsWith('/answers')).length, 1);
});

test('cancel into explicit demo ignores the stale response and GET recovers when leaving demo', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  await app.state.pitch();
  let release, entered;
  const arrived = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  browser.intercept = async (call, request) => {
    const response = await request();
    if (call.path.endsWith('/answers')) { entered(); await held; }
    return response;
  };
  app.elements.get('answer-input').value = 'Опросили 12 студентов, готовы проверить готовность платить.';
  const sent = app.state.answer();
  await arrived;
  app.state.demo();
  assert.equal(app.state.state.mode, 'demo');
  release();
  await sent;
  assert.equal(app.state.state.sessionId, 'demo-session');
  browser.intercept = null;
  app.state.exitDemo();
  await app.idle();
  assert.equal(app.state.state.mode, 'live');
  assert.equal(app.state.state.step, 2);
  assert.equal(browser.calls.filter((call) => call.path.endsWith('/answers')).length, 1);
  app.state.demo();
  await complete(app);
  assert.equal(app.state.state.result.score, DEMO_RESULT.score);
  assert.match(app.elements.get('result-heading').textContent, /StudySpot/);
});

test('503 preserves the answer without substituting demo; unknown IDs and damaged storage recover safely', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  await app.state.pitch();
  browser.intercept = (call, request) => call.path.endsWith('/answers')
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE', message: 'Модель недоступна.' } }), { status: 503 }))
    : request();
  app.elements.get('answer-input').value = 'Черновик, который нельзя потерять при отказе модели.';
  await app.state.answer();
  assert.equal(app.state.state.mode, 'live');
  assert.equal(app.state.state.step, 1);
  assert.match(app.state.state.answerDraft, /нельзя потерять/);
  assert.equal(app.elements.get('error-banner').hidden, false);
  browser.intercept = null;
  const saved = JSON.parse(app.storage.get(storageKey));
  saved.sessionId = randomUUID();
  const unknown = boot(browser, new Map([[storageKey, JSON.stringify(saved)]]));
  await unknown.idle();
  assert.equal(unknown.state.state.stage, 'pitch');
  assert.equal(unknown.state.state.pitchDraft, EXAMPLE_PITCH);
  for (const bad of ['null', '[]', '{broken', '{"mode":"live","stage":"qa","history":null}']) {
    const recovered = boot(browser, new Map([[storageKey, bad]]));
    await recovered.idle();
    assert.equal(recovered.state.state.stage, 'pitch');
  }
});

test('character choice reaches the API, survives reload/demo, and stays fixed for a second round', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  assert.equal(app.elements.get('persona-selector').hidden, false);
  assert.equal(app.elements.get('persona-options').children.length, 5);
  choosePersona(app, 'corporate');
  assert.equal(app.state.state.personaId, 'corporate');
  assert.match(app.elements.get('persona-name').textContent, /Мадам Протокол/);
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  app.elements.get('pitch-input').dispatch('input');

  const restoredDraft = boot(browser, app.storage);
  await restoredDraft.idle();
  assert.equal(personaRadio(restoredDraft, 'corporate').checked, true);
  restoredDraft.state.demo();
  assert.equal(restoredDraft.elements.get('persona-selector').hidden, true);
  assert.equal(restoredDraft.elements.get('round-persona').hidden, true);
  const restoredDemo = boot(browser, app.storage);
  await restoredDemo.idle();
  restoredDemo.state.exitDemo();
  assert.equal(restoredDemo.state.state.personaId, 'corporate');
  await restoredDemo.state.pitch();
  const startCall = browser.calls.find((call) => call.method === 'POST' && call.path === '/api/sessions');
  assert.equal(startCall.payload.personaId, 'corporate');
  assert.equal(restoredDemo.state.state.persona.id, 'corporate');
  assert.match(restoredDemo.elements.get('question-speaker').textContent, /Мадам Протокол/);
  assert.match(restoredDemo.elements.get('round-persona').textContent, /Мадам Протокол/);

  // A valid but stale stored preference must not replace the server's session persona.
  const stale = JSON.parse(restoredDemo.storage.get(storageKey));
  stale.personaId = 'grant';
  restoredDemo.storage.set(storageKey, JSON.stringify(stale));
  const restoredRound = boot(browser, restoredDemo.storage);
  await restoredRound.idle();
  assert.equal(restoredRound.state.state.personaId, 'corporate');
  await complete(restoredRound);
  assert.match(restoredRound.elements.get('round-persona').textContent, /Мадам Протокол/);
  restoredRound.state.secondRound();
  assert.equal(restoredRound.elements.get('persona-selector').disabled, true);
  assert.equal(personaRadio(restoredRound, 'corporate').disabled, true);
  choosePersona(restoredRound, 'venture');
  assert.equal(restoredRound.state.state.personaId, 'corporate', 'locked choice ignores stale change events');
  await restoredRound.state.pitch();
  assert.equal(restoredRound.state.state.round, 2);
  assert.equal(restoredRound.state.state.persona.id, 'corporate');
  restoredRound.state.reset(true);
  assert.equal(restoredRound.state.state.personaId, 'corporate');
  assert.equal(restoredRound.elements.get('persona-selector').disabled, false);
  choosePersona(restoredRound, 'venture');
  assert.equal(restoredRound.state.state.personaId, 'venture');
});

test('catalogue failure retains the legacy default and does not send an invisible stored selection', async (t) => {
  const browser = await fixture(t);
  browser.intercept = (call, request) => call.path === '/api/personas'
    ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'AI_UNAVAILABLE', message: 'Каталог недоступен.' } }), { status: 503 }))
    : request();
  const app = boot(browser, new Map([[storageKey, JSON.stringify({ mode: 'live', stage: 'pitch', personaId: 'venture', pitchDraft: EXAMPLE_PITCH })]]));
  await app.idle();
  assert.equal(app.elements.get('persona-selector').hidden, true);
  assert.equal(app.elements.get('persona-unavailable').hidden, false);
  assert.equal(app.elements.get('persona-panel').hidden, false);
  await app.state.pitch();
  const call = browser.calls.find((item) => item.method === 'POST' && item.path === '/api/sessions');
  assert.equal(Object.hasOwn(call.payload, 'personaId'), false);
  assert.equal(app.state.state.stage, 'qa');
  assert.equal(app.state.state.persona.id, 'angel');
});

test('pending pitch keeps its chosen character even if a stale change event fires', async (t) => {
  const browser = await fixture(t);
  const app = boot(browser);
  await app.idle();
  choosePersona(app, 'grant');
  app.elements.get('pitch-input').value = EXAMPLE_PITCH;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  browser.intercept = async (call, request) => {
    if (call.method === 'POST' && call.path === '/api/sessions') await held;
    return request();
  };
  const submitted = app.state.pitch();
  assert.equal(app.elements.get('persona-selector').disabled, true);
  choosePersona(app, 'venture');
  assert.equal(app.state.state.personaId, 'grant');
  release();
  await submitted;
  assert.equal(app.state.state.persona.id, 'grant');
});
