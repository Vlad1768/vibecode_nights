// Диалог бота-тренера по питчам (ТЗ «доработка бота-тренера»).
// Флоу: питч → оценка (до 3 правок с разбором изменений) → 5 вопросов из общего API (по одному,
// «Уточнить»/«Изменить вопрос», оценка каждого ответа) → итог (питч 50% + ответы 50%) → профиль.
// Совмещено с кейсом: вопросы и итог по 10 критериям «Стартап как диплом» + 3 совета берутся из общего API
// (docs/CONTRACT.md), оценку питча и ответов по критериям ТЗ ставит тренер (coach.mjs).
// Ответ диалога: строка или { text, buttons?, html?, photo? }.
import { ApiError } from './api/errors.mjs';
import { MediaError, MEDIA_TEXTS } from './media.mjs';
import { createStore } from './store.mjs';
import { PITCH_CRITERIA, ANSWER_CRITERIA, isInjection, isAbuseOnly, isTooShortForPitch } from './coach.mjs';
import { achievementsFor, ACHIEVEMENTS, buildProfile, formatProfile, levelFor, DEFENDED_THRESHOLD } from './profile.mjs';
import { pickPersona, personaCard, personaLabel } from './personas.mjs';

export const MAX_INPUT_CHARS = 4000;
export const MAX_EDITS = 3;
export const MAX_REPLACEMENTS = 2;
export const TOTAL_QUESTIONS = 5;

export const COMMANDS = Object.freeze([
  ['start', 'Приветствие и как начать'],
  ['new', 'Новая сессия'],
  ['profile', 'Профиль'],
  ['help', 'Как работает оценка'],
  ['delete', 'Удалить мои данные'],
]);

const b = (text, data) => ({ text, data });
export const BUTTONS = {
  go: b('✅ Всё верно, поехали дальше', 'go'),
  fix: b('✏️ Поправить питч', 'fix'),
  clarify: b('❓ Уточнить вопрос', 'clarify'),
  replace: b('🔄 Изменить вопрос', 'replace'),
  next: b('➡️ Следующий вопрос', 'next'),
  final: b('🏁 Итоги', 'final'),
  newSession: b('🔁 Новая сессия', 'new'),
  profile: b('👤 Профиль', 'profile'),
  caseCriteria: b('📋 Критерии «Стартап как диплом»', 'criteria'),
  advice: b('✅ 3 дела до защиты', 'advice'),
  learn: b('📋 Как подготовиться', 'learn'),
  retry: b('🔁 Повторить', 'retry'),
};

export const TEXTS = {
  welcome:
    'Привет! Я тренер по питчам — строгий, но доброжелательный инвестор.\n\n' +
    'Как это работает:\n' +
    '1. Ты присылаешь питч — я оцениваю его по 10 критериям из 100 и говорю, что исправить.\n' +
    '2. Можно поправить питч до 3 раз — покажу, что стало лучше.\n' +
    '3. Задаю 5 вопросов, как на защите, и оцениваю каждый ответ.\n' +
    '4. Итог: защищён стартап или нет, и всё копится в профиле.\n\n' +
    'Пришли питч своего проекта: проблема, решение, рынок, деньги, команда — на 1–2 минуты чтения. Можно текстом, голосовым или файлом.',
  help:
    'Как работает оценка:\n' +
    '• Питч — 10 критериев, всего 100 баллов: проблема, решение, рынок, попадание в задание, бизнес-модель, конкуренты, доказательства, масштаб, «вау», подача.\n' +
    '• Каждый ответ на вопрос — до 20 баллов, пять ответов — до 100.\n' +
    '• Общий балл = питч 50% + ответы 50%. От 70 — «🛡 Стартап защищён».\n' +
    '• Баллы считает код по фиксированной шкале, поэтому одинаковый питч получает близкую оценку. Без цифр, рынка или монетизации — не больше 60.\n' +
    '• В итоге — ещё оценка по 10 критериям конкурса «Стартап как диплом» и 3 дела до защиты.\n\n' +
    'Чтобы начать — пришли питч.',
  learn:
    '📋 Как подготовиться к питчу\n\n' +
    '1. Одна фраза о проекте — 4–8 слов.\n' +
    '2. Проблема глазами клиента: кто, как решает сейчас, сколько это стоит.\n' +
    '3. Доказательства с числами: интервью, пилоты, продажи.\n' +
    '4. Деньги: кто платит, сколько стоит привлечь клиента, когда выход в ноль. Рынок — снизу вверх.\n' +
    '5. Конкуренты есть всегда, хотя бы «как сейчас». Отличие — одной фразой.\n' +
    '6. Главный риск и как ты его проверишь.\n' +
    '7. Почему именно вы и что будет с проектом после защиты.\n\n' +
    'Отвечай одной-двумя фразами, с цифрами и фактами, без «воды». Не знаешь — скажи честно и как проверишь.',
  offtopic: 'Я тренер по питчам и работаю только с ними 🙂 Пришли питч своего проекта или ответь на текущий вопрос.',
  tooShort: 'Это пока не питч. Опиши: какую проблему решаешь, для кого, как и почему это выгодно.',
  abuse: 'Давай в деловом формате — на защите так не говорят. Перепиши, пожалуйста.',
  editsOver: `Правок было уже ${MAX_EDITS} — в зачёт идёт последняя версия. Переходим к вопросам.`,
  fixAsk: 'Пришли исправленную версию питча целиком.',
  clarifyAsk: 'Напиши, что именно непонятно в вопросе.',
  replaceOver: `Заменить вопрос можно не больше ${MAX_REPLACEMENTS} раз за сессию.`,
  answerNoFile: 'Ответ на вопрос пришли текстом или голосовым.',
  notText: 'Такое сообщение я не читаю. Пришли текст, голосовое или файл.',
  emptyInput: 'Сообщение пустое.',
  tooLong: `Слишком длинно: уложись в ${MAX_INPUT_CHARS} символов.`,
  busy: 'Ещё обдумываю прошлое сообщение — подожди ответа.',
  noCoach: 'Тренер временно недоступен: не подключена модель. Попробуй позже.',
  coachFailed: 'Не получилось оценить — модель не ответила. Нажми «Повторить».',
  nothingToRetry: 'Повторять нечего — пришли питч.',
  noResult: 'Итога пока нет — пройди сессию до конца.',
  deleted: 'Твои питчи, ответы и статистика удалены.',
  pressNext: 'Ответ уже оценён. Нажми «➡️ Следующий вопрос».',
  pressFinal: 'Все 5 ответов оценены. Нажми «🏁 Итоги».',
  unknown: 'Не понял. Пришли питч или воспользуйся кнопками под сообщениями.',
};

// ---------- Форматирование (ТЗ §4–§8) ----------

const criterionLines = (set, scores) => set.map((c, i) => `• ${c.name} — ${scores[i]}/${c.max}`);

export function formatPitchEval(e) {
  const lines = [`📊 Оценка питча: ${e.total}/100 — «${e.level}»`, '', ...criterionLines(PITCH_CRITERIA, e.scores)];
  if (e.capped) lines.push('', `Без цифр, рынка или монетизации больше ${e.total} не ставлю.`);
  if (e.strengths.length) lines.push('', '💪 Сильные стороны:', ...e.strengths.map((x) => `• ${x}`));
  if (e.weaknesses.length) lines.push('', '⚠️ Слабые места:', ...e.weaknesses.map((w) => `• ${w.criterion ? `${w.criterion}: ` : ''}${w.text}`));
  if (e.missing.length) lines.push('', '❌ Чего не хватило:', ...e.missing.map((x) => `• ${x}`));
  if (e.delivery) lines.push('', `🗣 Подача: ${e.delivery}`);
  if (e.advice) lines.push('', `🎯 Главный совет: ${e.advice}`);
  return lines.join('\n');
}

export function formatRevision(prev, e) {
  const diff = e.total - prev.total;
  const lines = [`🔄 Было ${prev.total} → стало ${e.total} (${diff >= 0 ? '+' : '−'}${Math.abs(diff)}) — «${e.level}»`];
  const changed = PITCH_CRITERIA.map((c, i) => ({ c, was: prev.scores[i], now: e.scores[i] })).filter((x) => x.was !== x.now);
  const better = changed.filter((x) => x.now > x.was);
  const worse = changed.filter((x) => x.now < x.was);
  const fixed = e.fixed ?? [];
  if (better.length || fixed.length) {
    lines.push('', '✅ Исправлено:');
    for (const x of better) {
      const note = fixed.find((f) => f.criterion === x.c.name)?.text;
      lines.push(`• ${x.c.name}: ${x.was} → ${x.now}${note ? ` — ${note}` : ''}`);
    }
    for (const f of fixed.filter((f) => !better.some((x) => x.c.name === f.criterion))) lines.push(`• ${f.criterion ? `${f.criterion}: ` : ''}${f.text}`);
  }
  if (e.unchanged?.length) lines.push('', '➖ Не изменилось:', ...e.unchanged.map((x) => `• ${x}`));
  if (worse.length || e.newProblems?.length) {
    lines.push('', '🆕 Новые проблемы:');
    for (const x of worse) lines.push(`• ${x.c.name}: ${x.was} → ${x.now}`);
    for (const p of e.newProblems ?? []) lines.push(`• ${p}`);
  }
  if (e.advice) lines.push('', `🎯 Следующий шаг: ${e.advice}`);
  return lines.join('\n');
}

export const formatQuestion = (n, text, replaced = false) => `Вопрос ${n}/${TOTAL_QUESTIONS}${replaced ? ' (заменён)' : ''}: ${text}`;

export function formatAnswerEval(e) {
  const lines = [`📝 Ответ: ${e.total}/20`];
  if (e.evasive) lines.push('', 'Это уход от ответа — на защите это провал. Даже «не знаю» лучше сопровождать планом проверки.');
  if (e.strong) lines.push('', `💪 Сильное: ${e.strong}`);
  if (e.weak) lines.push(`⚠️ Слабое: ${e.weak}`);
  if (e.missing) lines.push(`❌ Чего не хватило: ${e.missing}`);
  if (e.delivery) lines.push(`🗣 Подача: ${e.delivery}`);
  if (e.hint) lines.push('', `💡 Как ответил бы сильный фаундер: ${e.hint}`);
  return lines.join('\n');
}

// Сильные и зоны роста сессии — по % от максимума каждого критерия питча и ответов.
function sessionCriteria(pitchScores, answers) {
  const rows = PITCH_CRITERIA.map((c, i) => ({ name: c.name, pct: pitchScores[i] / c.max }));
  ANSWER_CRITERIA.forEach((c, i) => {
    const vals = answers.map((a) => a.scores[i]);
    if (vals.length) rows.push({ name: `Ответы: ${c.name.toLowerCase()}`, pct: vals.reduce((x, y) => x + y, 0) / (vals.length * c.max) });
  });
  return rows.sort((a, b) => b.pct - a.pct);
}

export function formatFinal({ pitchTotal, answersTotal, total, rows, newAchievements, levelUp, persona = null }) {
  const defended = total >= DEFENDED_THRESHOLD;
  const lines = [
    persona ? `🏁 Итог сессии · слушал(а) ${personaLabel(persona)}` : '🏁 Итог сессии',
    `Питч: ${pitchTotal}/100 · Ответы: ${answersTotal}/100 · Общий балл: ${total}/100`,
    `Вердикт: ${defended ? '«🛡 Стартап защищён»' : '«Пока не защищён»'}`,
    '',
    '🏆 Топ-2 сильных стороны:',
    ...rows.slice(0, 2).map((r) => `• ${r.name} — ${Math.round(r.pct * 100)}%`),
    '',
    '🎯 Топ-2 зоны роста:',
    ...rows.slice(-2).reverse().map((r) => `• ${r.name} — ${Math.round(r.pct * 100)}%`),
  ];
  if (newAchievements.length || levelUp) {
    lines.push('', '🎖 Новое:');
    if (levelUp) lines.push(`• Уровень «${levelUp}»`);
    for (const a of newAchievements) lines.push(`• ${a}`);
  }
  return lines.join('\n');
}

// Критерии кейса и советы из общего API (Done.result).
export function formatCaseCriteria(result) {
  const lines = [`📋 По критериям «Стартап как диплом»: ${result.total}/${result.max}`, ''];
  result.criteria.forEach((c, i) => lines.push(`${c.id ?? i + 1}. ${c.name} — ${c.score}/${c.max}${c.comment ? `: ${c.comment}` : ''}`));
  return lines.join('\n');
}

export function formatAdvice(result) {
  return ['✅ 3 дела до защиты', ...result.advice.map((a, i) => `${i + 1}. ${typeof a === 'string' ? a : a.text}`)].join('\n\n');
}

function apiErrorText(err) {
  if (err instanceof ApiError && err.fromServer && err.message) return err.message;
  return 'Сервер вопросов не ответил. Нажми «Повторить».';
}

// ---------- Диалог ----------

// personas — список персонажей (personas.mjs); для каждой новой сессии выбирается случайный.
export function createDialog({ api, coach = null, media = null, store = createStore(), now = () => Date.now(), personas = [], random = Math.random }) {
  const states = new Map();

  function stateOf(chatId, userId) {
    const key = `${chatId}:${userId}`;
    let s = states.get(key);
    if (!s) {
      s = { key, chatId, userId, name: null, phase: 'idle', session: null, busy: false, pending: null, lastResult: null };
      states.set(key, s);
    }
    return s;
  }

  function newSession(s) {
    const persona = pickPersona(personas, s.session?.persona?.id ?? s.lastPersonaId ?? null, random);
    if (persona) s.lastPersonaId = persona.id;
    s.session = {
      persona, personaShown: false,
      at: now(), versions: [], evals: [], edits: 0, replacements: 0, clarifications: 0,
      apiSessionId: null, step: 0, question: null, topic: null, replaced: false, asked: [], answers: [], apiNext: null, apiDone: null,
    };
    s.phase = 'idle';
    s.pending = null;
  }

  // Карточка персонажа (один раз за сессию): фото + кто он, чего хочет, чего боится.
  function cardOnce(s, extra = '') {
    const sess = s.session;
    if (!sess.persona || sess.personaShown) return [];
    sess.personaShown = true;
    return [{ photo: 'persona', imagePath: sess.persona.imagePath, text: `${personaCard(sess.persona)}${extra}` }];
  }

  const pitchButtons = (sess) => (sess.edits < MAX_EDITS ? [[BUTTONS.go], [BUTTONS.fix]] : [[BUTTONS.go]]);
  const questionButtons = (sess) => (sess.replacements < MAX_REPLACEMENTS ? [[BUTTONS.clarify, BUTTONS.replace]] : [[BUTTONS.clarify]]);
  const finalButtons = (s) => [
    [BUTTONS.newSession, BUTTONS.profile],
    ...(s.lastResult ? [[BUTTONS.caseCriteria], [BUTTONS.advice]] : []),
  ];

  // ---------- Питч ----------

  async function evaluatePitch(s, text) {
    if (!coach) return [TEXTS.noCoach];
    if (isAbuseOnly(text)) return [TEXTS.abuse];
    if (isInjection(text)) return [TEXTS.offtopic];
    if (isTooShortForPitch(text)) return [TEXTS.tooShort];
    const sess = s.session;
    const previous = sess.evals.length ? { text: sess.versions.at(-1), evaluation: sess.evals.at(-1) } : null;
    let e;
    try {
      e = await coach.evaluatePitch(text, previous, sess.persona);
    } catch {
      s.pending = { kind: 'pitch', text };
      return [{ text: TEXTS.coachFailed, buttons: [[BUTTONS.retry]] }];
    }
    s.pending = null;
    if (e.kind === 'not_startup' || e.kind === 'offtopic' || e.kind === 'injection') return [TEXTS.offtopic];
    if (previous) sess.edits++;
    sess.versions.push(text);
    sess.evals.push(e);
    s.phase = 'review';
    const body = previous ? formatRevision(previous.evaluation, e) : formatPitchEval(e);
    return [{ text: body, buttons: pitchButtons(sess) }];
  }

  // ---------- Вопросы (общий API) ----------

  function showQuestion(s, step) {
    const sess = s.session;
    sess.step = step.step;
    sess.question = step.question;
    sess.topic = step.topic ?? null;
    sess.replaced = false;
    sess.asked.push(step.question);
    sess.apiNext = null;
    s.phase = 'question';
    return [{ text: formatQuestion(step.step, step.question), buttons: questionButtons(sess) }];
  }

  async function startQuestions(s) {
    const sess = s.session;
    try {
      const step = await api.start({ userId: s.userId, pitch: sess.versions.at(-1), previousSessionId: null });
      sess.apiSessionId = step.sessionId;
      s.pending = null;
      return showQuestion(s, step);
    } catch (err) {
      s.pending = { kind: 'start' };
      return [{ text: apiErrorText(err), buttons: [[BUTTONS.retry]] }];
    }
  }

  // Ответ уходит в общий API; если вопрос заменён, API получает формулировку, на которую отвечал студент.
  async function sendAnswerToApi(s, answer) {
    const sess = s.session;
    const text = sess.replaced ? `(Вопрос был переформулирован: «${sess.question}»)\n${answer}` : answer;
    try {
      const data = await api.answer({ sessionId: sess.apiSessionId, userId: s.userId, step: sess.step, answer: text.slice(0, 2000) });
      if (data.done) {
        sess.apiDone = data;
        s.lastResult = data.result;
      } else {
        sess.apiNext = data;
      }
      s.pending = null;
      return null;
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'STEP_MISMATCH' || err.code === 'SESSION_DONE')) {
        try {
          const cur = await api.get({ sessionId: sess.apiSessionId, userId: s.userId });
          if (cur.done) { sess.apiDone = cur; s.lastResult = cur.result; } else sess.apiNext = cur;
          s.pending = null;
          return null;
        } catch { /* ниже — повтор */ }
      }
      s.pending = { kind: 'api-answer', answer };
      return err;
    }
  }

  async function handleAnswer(s, answer) {
    const sess = s.session;
    if (isAbuseOnly(answer)) return [TEXTS.abuse];
    if (isInjection(answer)) return [TEXTS.offtopic];
    let e;
    try {
      e = await coach.evaluateAnswer({ pitch: sess.versions.at(-1), question: sess.question, answer, persona: sess.persona });
    } catch {
      s.pending = { kind: 'answer', text: answer };
      return [{ text: TEXTS.coachFailed, buttons: [[BUTTONS.retry]] }];
    }
    if (e.kind === 'offtopic' || e.kind === 'injection') return [TEXTS.offtopic];
    sess.answers.push({ question: sess.question, answer, ...e });
    s.phase = 'answered';
    const err = await sendAnswerToApi(s, answer);
    const last = sess.answers.length >= TOTAL_QUESTIONS;
    const out = [{ text: formatAnswerEval(e), buttons: [[last ? BUTTONS.final : BUTTONS.next]] }];
    if (err) out.push({ text: apiErrorText(err), buttons: [[BUTTONS.retry]] });
    return out;
  }

  async function nextQuestion(s) {
    const sess = s.session;
    if (s.phase !== 'answered') return [TEXTS.unknown];
    if (s.pending?.kind === 'api-answer') {
      const err = await sendAnswerToApi(s, s.pending.answer);
      if (err) return [{ text: apiErrorText(err), buttons: [[BUTTONS.retry]] }];
    }
    if (sess.answers.length >= TOTAL_QUESTIONS || sess.apiDone) return finish(s);
    if (!sess.apiNext) return [{ text: 'Следующий вопрос ещё не пришёл. Нажми «Повторить».', buttons: [[BUTTONS.retry]] }];
    return showQuestion(s, sess.apiNext);
  }

  async function replaceQuestion(s) {
    const sess = s.session;
    if (s.phase !== 'question') return [TEXTS.unknown];
    if (sess.replacements >= MAX_REPLACEMENTS) return [TEXTS.replaceOver];
    let q = null;
    try {
      q = await coach.alternativeQuestion({ pitch: sess.versions.at(-1), question: sess.question, topic: sess.topic, asked: sess.asked, persona: sess.persona });
    } catch {
      q = null;
    }
    if (!q) return [{ text: TEXTS.coachFailed, buttons: questionButtons(sess) }];
    sess.replacements++;
    sess.question = q;
    sess.replaced = true;
    sess.asked.push(q);
    return [{ text: formatQuestion(sess.step, q, true), buttons: questionButtons(sess) }];
  }

  async function clarify(s, request) {
    const sess = s.session;
    let text = null;
    try {
      text = await coach.clarify({ pitch: sess.versions.at(-1), question: sess.question, request, persona: sess.persona });
    } catch {
      text = null;
    }
    s.phase = 'question';
    sess.clarifications++;
    if (!text) return [{ text: TEXTS.coachFailed, buttons: questionButtons(sess) }];
    return [`❓ ${text}`, { text: formatQuestion(sess.step, sess.question, sess.replaced), buttons: questionButtons(sess) }];
  }

  // ---------- Итог и профиль ----------

  function finish(s) {
    const sess = s.session;
    const lastEval = sess.evals.at(-1);
    const pitchTotal = lastEval.total;
    const answersTotal = sess.answers.reduce((a, x) => a + x.total, 0);
    const total = Math.round(pitchTotal * 0.5 + answersTotal * 0.5);
    const before = store.getUser(s.userId).sessions;
    const xpBefore = before.reduce((a, x) => a + (x.total ?? 0), 0);
    const achBefore = achievementsFor(before, now());
    const record = {
      at: sess.at,
      pitchTotal,
      answersTotal,
      total,
      defended: total >= DEFENDED_THRESHOLD,
      pitchScores: lastEval.scores,
      pitchTotals: sess.evals.map((e) => e.total),
      answers: sess.answers.map((a) => ({ total: a.total, scores: a.scores, evasive: a.evasive })),
      edits: sess.edits,
      replacements: sess.replacements,
      clarifications: sess.clarifications,
      issues: [...new Set([...lastEval.issues, ...sess.answers.flatMap((a) => a.issues)])],
      caseTotal: sess.apiDone?.result?.total ?? null,
      persona: sess.persona?.id ?? null,
      texts: { pitches: sess.versions, answers: sess.answers.map((a) => ({ question: a.question, answer: a.answer })) },
    };
    store.addSession(s.userId, s.name, record);
    const after = store.getUser(s.userId).sessions;
    const achAfter = achievementsFor(after, now());
    const newAchievements = [...achAfter].filter((a) => !achBefore.has(a)).map((a) => ACHIEVEMENTS[a]);
    const lvlBefore = levelFor(xpBefore);
    const lvlAfter = levelFor(xpBefore + total);
    const rows = sessionCriteria(lastEval.scores, sess.answers);
    s.phase = 'final';
    return [{
      text: formatFinal({ pitchTotal, answersTotal, total, rows, newAchievements, levelUp: lvlAfter.index > lvlBefore.index ? lvlAfter.name : null, persona: sess.persona }),
      buttons: finalButtons(s),
    }];
  }

  function profile(s) {
    const user = store.getUser(s.userId);
    const p = buildProfile({ name: s.name ?? user.name, sessions: user.sessions, allUsers: store.allUsers(), userId: s.userId, now: now() });
    return [{ text: formatProfile(p), buttons: [[BUTTONS.newSession]] }];
  }

  async function deleteData(s) {
    try {
      await api.deleteUser({ userId: s.userId });
    } catch {
      // данные бота удаляем в любом случае
    }
    store.deleteUser(s.userId);
    newSession(s);
    s.lastResult = null;
    return [TEXTS.deleted];
  }

  // ---------- Кнопки и команды ----------

  async function action(s, name) {
    const sess = s.session;
    switch (name) {
      case 'start':
        newSession(s);
        return [{ photo: 'welcome', text: TEXTS.welcome, buttons: [[BUTTONS.learn, BUTTONS.profile]] }, ...cardOnce(s)];
      case 'new':
      case 'practice': {
        newSession(s);
        const card = cardOnce(s);
        return [...card, { text: 'Новая сессия. Пришли питч своего проекта: проблема, решение, рынок, деньги, команда — на 1–2 минуты чтения.', buttons: [[BUTTONS.learn]] }];
      }
      case 'help':
      case 'how':
        return [TEXTS.help];
      case 'learn':
        return [TEXTS.learn];
      case 'profile':
        return profile(s);
      case 'delete':
        return deleteData(s);
      case 'go':
        if (s.phase !== 'review') return [TEXTS.unknown];
        return startQuestions(s);
      case 'fix':
        if (s.phase !== 'review') return [TEXTS.unknown];
        if (sess.edits >= MAX_EDITS) return [TEXTS.editsOver, ...(await startQuestions(s))];
        s.phase = 'fixing';
        return [TEXTS.fixAsk];
      case 'clarify':
        if (s.phase !== 'question') return [TEXTS.unknown];
        s.phase = 'clarify';
        return [TEXTS.clarifyAsk];
      case 'replace':
        return replaceQuestion(s);
      case 'next':
      case 'final':
        return nextQuestion(s);
      case 'criteria':
        return s.lastResult ? [formatCaseCriteria(s.lastResult)] : [TEXTS.noResult];
      case 'advice':
        return s.lastResult ? [formatAdvice(s.lastResult)] : [TEXTS.noResult];
      case 'retry': {
        const p = s.pending;
        if (!p) return [TEXTS.nothingToRetry];
        if (p.kind === 'pitch') return evaluatePitch(s, p.text);
        if (p.kind === 'start') return startQuestions(s);
        if (p.kind === 'answer') return handleAnswer(s, p.text);
        if (p.kind === 'api-answer') return nextQuestion(s);
        return [TEXTS.nothingToRetry];
      }
      default:
        return [TEXTS.unknown];
    }
  }

  // Голосовое или файл → текст.
  async function readMedia(s, item) {
    const answering = s.phase === 'question' || s.phase === 'clarify';
    if (answering && !['voice', 'audio'].includes(item.kind)) return { reply: [TEXTS.answerNoFile] };
    if (!media) return { reply: [MEDIA_TEXTS.NO_RECOGNITION] };
    try {
      const r = await media.toText(item);
      const quote = r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text;
      const note = r.source === 'voice'
        ? `🎙 Расслышал так:\n«${quote}»`
        : `📄 Взял текст из файла (${r.text.length} знаков)${r.shortened ? ', длинный — сократил до сути, проверь' : ''}.`;
      return { text: r.text, note };
    } catch (err) {
      return { reply: [err instanceof MediaError ? err.message : MEDIA_TEXTS.FAILED] };
    }
  }

  async function handleUnlocked(s, input) {
    if (!s.session) newSession(s);
    if (input.callback) return action(s, input.callback);

    let text = input.text;
    let note = null;
    if (input.media) {
      const r = await readMedia(s, input.media);
      if (r.reply) return r.reply;
      ({ text, note } = r);
    } else if (typeof text !== 'string') {
      return [TEXTS.notText];
    }
    const trimmed = text.trim();
    if (!note && trimmed.startsWith('/')) {
      const [cmd] = trimmed.slice(1).split(/\s+/);
      return action(s, cmd.split('@')[0].toLowerCase());
    }
    if (!trimmed) return [TEXTS.emptyInput];
    if (trimmed.length > MAX_INPUT_CHARS) return [TEXTS.tooLong];
    if (!coach) return [TEXTS.noCoach];

    const out = note ? [note] : [];
    switch (s.phase) {
      case 'question':
        return [...out, ...(await handleAnswer(s, trimmed))];
      case 'clarify':
        if (isAbuseOnly(trimmed)) return [TEXTS.abuse];
        if (isInjection(trimmed)) return [TEXTS.offtopic];
        return [...out, ...(await clarify(s, trimmed))];
      case 'answered':
        return [s.session.answers.length >= TOTAL_QUESTIONS ? TEXTS.pressFinal : TEXTS.pressNext];
      case 'review':
        // Новый текст на этапе оценки — это исправленная версия (если правки остались).
        if (s.session.edits >= MAX_EDITS) return [TEXTS.editsOver, ...(await startQuestions(s))];
        return [...out, ...(await evaluatePitch(s, trimmed))];
      case 'final': {
        newSession(s);
        const r = await evaluatePitch(s, trimmed);
        return [...out, ...(s.phase === 'review' ? cardOnce(s) : []), ...r];
      }
      default: { // idle, fixing
        const r = await evaluatePitch(s, trimmed);
        return [...out, ...(s.phase === 'review' ? cardOnce(s) : []), ...r];
      }
    }
  }

  return {
    // input: { chatId, userId, name?, text?, media?, callback? }
    async handle({ chatId, userId, name, ...input }) {
      const s = stateOf(chatId, userId);
      if (name) s.name = name;
      if (s.busy) return [TEXTS.busy];
      s.busy = true;
      try {
        return await handleUnlocked(s, input);
      } finally {
        s.busy = false;
      }
    },
    _states: states,
  };
}
