// Ядро тренажёра: раунд из 5 вопросов, оценка и 3 совета по контракту docs/CONTRACT.md.
// Не знает про HTTP: сервер (server/) только переводит запросы в вызовы start/answer/get/deleteUser.
//
// Что гарантирует код, а не промпт:
//  - ровно 5 вопросов и 3 совета, 10 критериев в порядке кейса, итог по формуле;
//  - цитата без совпадения с питчем или ответами обнуляет уровень, цифры в вопросах — только из текста студента;
//  - повтор того же ответа возвращает прежний результат и ничего не меняет;
//  - сбой модели не теряет питч и ответы: срабатывает демо-движок (или 503, если запасной режим выключен).
import { randomUUID } from 'node:crypto';
import { personaView, validateContent } from './content.mjs';
import { createPersonaCatalog, selectedPersonaView } from './personas.mjs';
import { badOutput, checkAnswer, checkPitch, missingParts, authorText, noticeFor, NOTICE_BEGGING, TOTAL_STEPS, TrainerError } from './guard.mjs';
import { buildCriteria, pickAdvice, summaryFrom, totalOf } from './scoring.mjs';
import { createDemoEngine, reserveAdvice } from './demo.mjs';
import { clean, limit, numbersCovered } from './text.mjs';

const notFound = () => new TrainerError(404, 'SESSION_NOT_FOUND', 'Сессия не найдена. Начните новый раунд.');
const sessionDone = () => new TrainerError(409, 'SESSION_DONE', 'Раунд уже завершён. Итог можно получить через GET.');

/**
 * @param {object} o
 * @param {object} o.content          содержание из core/content.mjs
 * @param {object} o.store            хранилище сессий: get(id), save(session), deleteUser(userId)
 * @param {object} [o.engine]         движок модели (core/llm.mjs); без него — только демо
 * @param {boolean} [o.fallback=true] при сбое модели отвечать демо-движком, а не 503
 * @param {(event:string, data:object) => void} [o.onEvent] журнал событий без текстов
 * @param {(msg:object) => void} [o.log] журнал ошибок без текстов студента
 */
export function createTrainer({ content, store, engine = null, fallback = true, onEvent = () => {}, log = () => {} }) {
  const demo = createDemoEngine();
  const primary = engine || demo;
  const locks = new Map();
  const catalog = createPersonaCatalog(content);
  // Persisted content, rather than a mutable process-wide choice, owns the round.
  // Sessions created before selection existed continue with the configured default.
  const sessionContent = (s) => s.contentSnapshot ? validateContent(s.contentSnapshot) : content;
  const sessionPersona = (s) => selectedPersonaView(sessionContent(s));

  /** Вызывает движок; при сбое — демо-движок или 503. Возвращает { data, demo }. */
  async function run(op, ctx, valid) {
    if (primary !== demo) {
      try {
        const data = await primary[op](ctx);
        if (valid(data)) return { data, demo: false };
        log({ level: 'warn', msg: 'ответ модели не прошёл проверку', op });
      } catch (err) {
        log({ level: 'warn', msg: 'модель недоступна', op, code: err?.code || err?.name || 'ERROR' });
      }
      if (!fallback) throw new TrainerError(503, 'AI_UNAVAILABLE', 'Инвестор задумался. Повторите запрос: питч и ответы сохранены.');
    }
    return { data: await demo[op](ctx), demo: true };
  }

  async function withLock(id, fn) {
    const prev = locks.get(id) || Promise.resolve();
    let release;
    const mine = new Promise((r) => { release = r; });
    const chain = prev.then(() => mine);
    locks.set(id, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(id) === chain) locks.delete(id);
    }
  }

  async function own(id, userId) {
    const s = typeof id === 'string' && id ? await store.get(id) : null;
    if (!s || s.userId !== userId) throw notFound();
    return s;
  }

  // ---- проверки ответов модели --------------------------------------------------------------

  function goodQuestion(q, source) {
    const t = clean(q);
    return t.length >= 10 && t.length <= 400 && numbersCovered(t, source) && !badOutput(t);
  }

  async function questionOrDemo(op, ctx, given, source) {
    if (goodQuestion(given, source)) return clean(given);
    return (await demo[op](ctx)).question;
  }

  function cleanFacts(raw, pitch) {
    const list = (arr, max, len) => (Array.isArray(arr) ? arr : [])
      .map((x) => limit(x, len)).filter((x) => x && numbersCovered(x, pitch) && !badOutput(x)).slice(0, max);
    return { known: list(raw?.known, 6, 200), missing: list(raw?.missing, 6, 80) };
  }

  // ---- представления в форме контракта -------------------------------------------------------

  function stepView(s, { answered = s.replies.length, withFacts = false, reaction = null, notice = null } = {}) {
    const current = s.steps[answered];
    const view = {
      sessionId: s.id,
      round: s.round,
      status: 'in_progress',
      step: answered + 1,
      totalSteps: TOTAL_STEPS,
      question: current.question,
      topic: current.topic,
      reaction,
      notice,
      demo: current.demo,
      persona: sessionPersona(s),
    };
    if (withFacts) view.facts = s.facts;
    return view;
  }

  const doneView = (s) => ({ sessionId: s.id, round: s.round, status: 'done', done: true, result: s.result, demo: s.resultDemo, persona: sessionPersona(s) });

  const history = (s, upTo) => s.steps.slice(0, upTo).map((q, i) => ({ step: i + 1, topic: q.topic, question: q.question, hook: q.hook, answer: s.answers[i] }));

  // ---- операции ------------------------------------------------------------------------------

  async function start({ userId, pitch: rawPitch, previousSessionId = null, personaId }) {
    if (personaId !== undefined && (typeof personaId !== 'string' || !personaId)) {
      throw new TrainerError(400, 'BAD_REQUEST', 'Выберите характер инвестора из списка.');
    }
    const { pitch, notice: pitchNotice } = checkPitch(rawPitch);
    let selectedContent = content;
    let round = 1;
    let previousTotal = null;
    let previousQuestions = [];
    if (previousSessionId !== null && previousSessionId !== undefined && previousSessionId !== '') {
      const prev = await own(String(previousSessionId), userId);
      selectedContent = sessionContent(prev);
      if (personaId !== undefined && personaId !== selectedContent.persona.id) {
        throw new TrainerError(400, 'BAD_REQUEST', 'Для сравнения результатов второй раунд проходит с тем же инвестором. Для смены характера начните новый раунд.');
      }
      round = prev.round + 1;
      previousTotal = prev.result ? prev.result.total : null;
      previousQuestions = prev.steps.map((q) => q.question);
    } else if (personaId !== undefined) {
      selectedContent = catalog.get(personaId);
      if (!selectedContent) throw new TrainerError(400, 'BAD_REQUEST', 'Неизвестный характер инвестора. Выберите вариант из списка.');
    }
    const ctx = { content: selectedContent, pitch, round, previousQuestions, history: [] };
    const { data, demo: isDemo } = await run('start', ctx, (d) => d && ['pitch', 'empty', 'not_pitch'].includes(d.kind));

    if (data.kind === 'empty') {
      const missing = missingParts(authorText(pitch));
      throw new TrainerError(422, 'EMPTY_PITCH', 'Слишком мало, чтобы задавать вопросы. Вставьте суть проекта текстом.', {
        missing: missing.length ? missing : ['проблема и для кого', 'решение', 'что сделано, с цифрами', 'как зарабатываете'],
      });
    }
    if (data.kind === 'not_pitch') {
      throw new TrainerError(422, 'NOT_A_PITCH', 'Это просьба, а не стартап. Я прожариваю питчи: вставьте описание своего проекта.');
    }

    let facts = cleanFacts(data.facts ?? data, pitch);
    if (!facts.known.length) facts = { ...facts, known: (await demo.start(ctx)).facts.known };
    const question = await questionOrDemo('start', ctx, data.question, pitch);
    const notice = pitchNotice || (data.manipulation === true ? NOTICE_BEGGING : null);

    const now = Date.now();
    const s = {
      id: randomUUID(),
      userId,
      round,
      previousSessionId: round > 1 ? String(previousSessionId) : null,
      previousTotal,
      pitch,
      facts,
      contentSnapshot: selectedContent,
      steps: [{ topic: selectedContent.slots[0].topic, question, hook: data.hook ?? null, demo: isDemo }],
      answers: [],
      replies: [],
      result: null,
      resultDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    await store.save(s);
    onEvent('session_started', { sessionId: s.id });
    if (round > 1) onEvent('round_started', { sessionId: s.id, round });
    return { status: 201, body: stepView(s, { withFacts: true, notice }) };
  }

  async function answer(sessionId, { userId, step, answer: rawAnswer }) {
    return withLock(String(sessionId), async () => {
      const s = await own(sessionId, userId);
      const content = sessionContent(s);
      const answered = s.replies.length;
      if (step === undefined || step === null) step = s.result ? TOTAL_STEPS + 1 : answered + 1;
      if (s.result && step > TOTAL_STEPS) throw sessionDone();
      if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) {
        throw new TrainerError(400, 'BAD_REQUEST', 'step должен быть целым от 1 до 5');
      }
      if (step <= answered) return { status: 200, body: { ...s.replies[step - 1], persona: sessionPersona(s) } };
      if (s.result) throw sessionDone();
      if (step !== answered + 1) throw new TrainerError(409, 'STEP_MISMATCH', `Сейчас вопрос ${answered + 1}, а не ${step}.`);

      const { answer: text, notice: answerNotice } = checkAnswer(rawAnswer);
      // Ответ сохраняется до вызова модели: при сбое повтор того же запроса продолжит с этого места.
      s.answers[step - 1] = text;
      s.answers.length = step;
      s.updatedAt = Date.now();
      s.contentSnapshot = content;
      await store.save(s);

      const source = [s.pitch, ...s.answers].join('\n');
      let body;
      if (step < TOTAL_STEPS) {
        const ctx = { content, pitch: s.pitch, facts: s.facts, step: step + 1, history: history(s, step), previousQuestions: [] };
        if (s.round > 1 && s.previousSessionId) {
          const prev = await store.get(s.previousSessionId);
          ctx.previousQuestions = prev ? prev.steps.map((q) => q.question) : [];
        }
        const { data, demo: isDemo } = await run('next', ctx, (d) => d && typeof d.question === 'string');
        const question = await questionOrDemo('next', ctx, data.question, source);
        const reactionText = limit(data.reaction, 200);
        const reaction = reactionText && numbersCovered(reactionText, source) && !badOutput(reactionText) ? reactionText : (await demo.next(ctx)).reaction;
        s.steps[step] = { topic: content.slots[step].topic, question, hook: data.hook ?? null, demo: isDemo };
        s.steps.length = step + 1;
        const notice = answerNotice || noticeFor(text) || (data.manipulation === true ? NOTICE_BEGGING : null);
        body = stepView(s, { answered: step, reaction, notice });
      } else {
        const ctx = { content, pitch: s.pitch, facts: s.facts, history: history(s, TOTAL_STEPS) };
        const { data, demo: isDemo } = await run('finish', ctx, (d) => d && Array.isArray(d.criteria) && d.criteria.length >= 10);
        const criteria = buildCriteria(data.criteria, content.weights, source);
        const reserve = reserveAdvice(criteria, content.weights, ctx.history);
        const advice = pickAdvice(data.advice, reserve, content.stopPhrases, reserve[0].basedOn);
        s.result = {
          criteria,
          total: totalOf(criteria),
          max: 100,
          summary: summaryFrom(criteria, {
            strong: numbersCovered(data.strong, source) && !badOutput(data.strong) ? data.strong : '',
            weak: numbersCovered(data.weak, source) && !badOutput(data.weak) ? data.weak : '',
          }),
          advice,
          previousTotal: s.previousTotal,
        };
        s.resultDemo = isDemo;
        body = doneView(s);
      }
      s.replies.push(body);
      s.updatedAt = Date.now();
      await store.save(s);
      onEvent('answered', { sessionId: s.id, step });
      if (s.result) onEvent('result_shown', { sessionId: s.id, total: s.result.total });
      return { status: 200, body };
    });
  }

  async function get(sessionId, userId) {
    const s = await own(sessionId, userId);
    if (s.result) return { status: 200, body: doneView(s) };
    const last = s.replies[s.replies.length - 1];
    return { status: 200, body: stepView(s, { withFacts: true, reaction: last?.reaction ?? null }) };
  }

  async function deleteUser(userId) {
    await store.deleteUser(userId);
    return { status: 204, body: null };
  }

  return {
    mode: primary === demo ? 'demo' : 'live',
    persona: () => personaView(content),
    personas: () => ({
      defaultId: catalog.has(content.persona.id) ? content.persona.id : 'angel',
      personas: [...catalog.values()].map(selectedPersonaView),
    }),
    start,
    answer,
    get,
    deleteUser,
  };
}
