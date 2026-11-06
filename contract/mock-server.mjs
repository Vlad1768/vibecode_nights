#!/usr/bin/env node
// Mock-сервер API «Злой инвестор» по контракту docs/CONTRACT.md (T25).
// Без модели и npm-зависимостей: вопросы, оценка и советы — заготовки.
// Нужен сайту (T26) и боту (T27), пока нет настоящего API (T28).
//
//   node contract/mock-server.mjs                 → http://127.0.0.1:8080
//   PORT=9090 node contract/mock-server.mjs
//
// Понимает: пустой питч, «не питч», просьбу о балле, двойную отправку ответа,
// чужую сессию, второй раунд. Данные живут в памяти до остановки процесса.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export const TOTAL_STEPS = 5;
export const MAX_PITCH = 4000;
export const MAX_ANSWER = 2000;
const USER_ID = /^(tg|web):[A-Za-z0-9-]{1,64}$/;

export const PERSONA = {
  id: 'angel',
  name: 'Олег',
  title: 'Бизнес-ангел',
  intro:
    'Я Олег, бизнес-ангел. Вложил свои деньги в 7 проектов. Ищу команду, которая не бросит проект после диплома. ' +
    'Хвалить не буду: задам 5 вопросов по твоему питчу, поставлю оценку и дам 3 дела на ближайшие дни.',
  howScored:
    'Каждый из 10 критериев «Стартап как диплом» получает уровень от 0 до 3: 0 — нет данных, 3 — подтверждено ' +
    'продажами, интервью или расчётом. Итог из 100 считает код по весам персонажа, а не модель.',
};

// Порядок и названия — как в кейсе (docs/case/README.md). Веса — пример для ангела из docs/BOT_SCENARIO.md.
const CRITERIA = [
  ['Реалистичность решения проблемы', 15],
  ['Бизнес-модель', 10],
  ['Анализ рынка и конкурентов', 10],
  ['Финансовая модель', 10],
  ['Интеллектуальная собственность или регистрация стартапа', 5],
  ['Первые продажи', 15],
  ['Риски', 10],
  ['Горизонт расчёта', 5],
  ['Уникальность продукта: технологии или услуги', 10],
  ['Инвестиционная привлекательность', 10],
];

const QUESTIONS = [
  ['Клиент', 'Кто конкретно платит за ваш продукт? Назовите должность или одного человека и что у него болит.'],
  ['Доказательства', 'Сколько интервью или продаж у вас уже было и что в них вас удивило?'],
  ['Деньги', 'Сколько стоит привлечь одного клиента и когда вы выйдете в ноль?'],
  ['Конкуренты', 'Как люди решают эту задачу сейчас и почему перейдут к вам, а не останутся с привычным способом?'],
  ['Мотивация', 'Через полгода диплом. Вы лично будете делать этот проект после защиты и сколько часов в неделю?'],
];

const REACTIONS = [
  'Записал. Посмотрим, подтвердится ли это цифрами.',
  'Понял. На сцене это спросят первым делом.',
  'Хорошо. Без цифры это пока только слова.',
  'Принято. Жюри будет сравнивать вас с этим способом.',
];

const ADVICE = [
  { action: 'позвоните трём целевым клиентам и запишите их точные слова о проблеме', deadline: 'за 2 дня', doneWhen: 'есть три цитаты с именами и должностями', basedOn: 'вопрос 1' },
  { action: 'посчитайте стоимость привлечения одного клиента по фактическим тратам', deadline: 'до пятницы', doneWhen: 'на слайде есть строка «клиент обходится в N ₽»', basedOn: 'вопрос 3' },
  { action: 'ответьте вслух на самый трудный вопрос за 30 секунд и запишите на диктофон', deadline: 'сегодня', doneWhen: 'в записи нет «ну, наверное» и есть одна цифра', basedOn: 'вопрос 5' },
];

const BEGGING = /(высок\p{L}*|максимальн\p{L}*|хорош\p{L}*)\s+(балл|оценк)|постав\p{L}*\s+(мне\s+)?(100|высок|макс)|игнорируй/iu;
const NOT_A_PITCH = /^(составь|составьте|напиши|помоги|подготовь)(?=\s|$)/iu;
const SEE_DECK = /(см\.?|смотрите|в)\s+презентаци/i;

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

const clean = (v) => String(v ?? '').trim();
const sentences = (t) => t.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

function extractFacts(pitch) {
  const known = sentences(pitch).filter((s) => /\d/.test(s)).slice(0, 4);
  const checks = [
    [/клиент|покупател|пользовател|для\s+\S+/i, 'кто клиент и кто платит'],
    [/конкурент|аналог|альтернатив/i, 'конкуренты и как задачу решают сейчас'],
    [/₽|руб|выручк|цен[аы]|подписк|стоимост/i, 'как зарабатываете и сколько'],
    [/регистрац|ООО|ИП|патент|самозанят/i, 'регистрация или интеллектуальная собственность'],
  ];
  const missing = checks.filter(([re]) => !re.test(pitch)).map(([, label]) => label);
  return { known, missing };
}

function checkPitch(pitch) {
  if (!pitch) throw new HttpError(422, 'EMPTY_PITCH', 'Пустое описание. Вставьте питч текстом.', { missing: ['проблема и для кого', 'решение', 'что сделано, с цифрами', 'как зарабатываете'] });
  if (pitch.length > MAX_PITCH) throw new HttpError(422, 'PITCH_TOO_LONG', `Питч длиннее ${MAX_PITCH} символов. Сократите, я не обрезаю текст.`);
  if (NOT_A_PITCH.test(pitch)) throw new HttpError(422, 'NOT_A_PITCH', 'Это просьба, а не стартап. Я прожариваю питчи: вставьте описание своего проекта.');
  if (pitch.length < 80 || (SEE_DECK.test(pitch) && pitch.length < 300)) {
    throw new HttpError(422, 'EMPTY_PITCH', 'Здесь нечего прожаривать: файлы и презентации я не открываю. Вставьте суть текстом.', { missing: ['проблема и для кого', 'решение', 'что сделано, с цифрами', 'как зарабатываете'] });
  }
}

function score(s) {
  const text = [s.pitch, ...s.answers].join('\n');
  const digits = (text.match(/\d+/g) || []).length;
  const avg = s.answers.reduce((a, t) => a + t.length, 0) / TOTAL_STEPS;
  const base = Math.min(3, (digits >= 6 ? 1 : 0) + (avg >= 60 ? 1 : 0) + (avg >= 150 ? 1 : 0));
  const quote = sentences(text).find((x) => /\d/.test(x)) || sentences(text)[0] || null;
  const criteria = CRITERIA.map(([name, weight], i) => {
    const level = Math.max(0, Math.min(3, base + ((i % 3) - 1)));
    return {
      id: i + 1, name, level, weight,
      score: Math.round((weight * level) / 3 * 10) / 10,
      max: weight,
      evidence: level === 0 ? null : quote,
      comment: level === 0 ? 'Нет данных в питче и ответах.' : 'Демо-оценка мок-сервера: настоящую ставит API T28.',
    };
  });
  const total = Math.round(criteria.reduce((a, c) => a + c.score, 0));
  return {
    criteria, total, max: 100,
    summary: { strong: 'Есть описание проблемы и решения.', weak: 'Мало цифр, подтверждённых продажами или интервью.' },
    advice: ADVICE.map((a) => ({ ...a, text: `${a.deadline[0].toUpperCase()}${a.deadline.slice(1)}: ${a.action}. Готово, когда ${a.doneWhen}.` })),
    previousTotal: s.previousTotal,
  };
}

export function createMockApi() {
  const sessions = new Map();

  function own(id, userId) {
    const s = sessions.get(id);
    if (!s || s.userId !== userId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Сессия не найдена. Начните новый раунд.');
    return s;
  }

  function stepView(s, { withFacts = false, reaction = null, notice = null } = {}) {
    const [topic, question] = QUESTIONS[s.answers.length];
    const view = {
      sessionId: s.id, round: s.round, status: 'in_progress',
      step: s.answers.length + 1, totalSteps: TOTAL_STEPS,
      question, topic, reaction, notice, demo: true,
    };
    if (withFacts) view.facts = s.facts;
    return view;
  }

  const doneView = (s) => ({ sessionId: s.id, round: s.round, status: 'done', done: true, result: s.result, demo: true });

  return {
    start({ userId, pitch, previousSessionId }) {
      const text = clean(pitch);
      checkPitch(text);
      let round = 1, previousTotal = null;
      if (previousSessionId) {
        const prev = own(String(previousSessionId), userId);
        round = prev.round + 1;
        previousTotal = prev.result ? prev.result.total : null;
      }
      const s = { id: randomUUID(), userId, pitch: text, round, previousTotal, answers: [], replies: [], facts: extractFacts(text), result: null };
      sessions.set(s.id, s);
      return { status: 201, body: stepView(s, { withFacts: true, notice: BEGGING.test(text) ? 'Балл получают ответами, а не просьбами. На защите тоже попросят цифры.' : null }) };
    },

    answer(id, { userId, step, answer }) {
      const s = own(id, userId);
      if (step === undefined || step === null) step = s.result ? TOTAL_STEPS + 1 : s.answers.length + 1; // без step — в текущий вопрос, без защиты от повтора
      if (s.result && step > TOTAL_STEPS) throw new HttpError(409, 'SESSION_DONE', 'Раунд уже завершён. Итог можно получить через GET.');
      if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) throw new HttpError(400, 'BAD_REQUEST', 'step должен быть целым от 1 до 5');
      if (step <= s.replies.length) return { status: 200, body: s.replies[step - 1] }; // повтор того же запроса
      if (s.result) throw new HttpError(409, 'SESSION_DONE', 'Раунд уже завершён. Итог можно получить через GET.');
      if (step !== s.answers.length + 1) throw new HttpError(409, 'STEP_MISMATCH', `Сейчас вопрос ${s.answers.length + 1}, а не ${step}.`);
      const text = clean(answer);
      if (!text) throw new HttpError(422, 'EMPTY_ANSWER', 'Пустой ответ. Если не знаете, так и напишите.');
      if (text.length > MAX_ANSWER) throw new HttpError(422, 'ANSWER_TOO_LONG', `Ответ длиннее ${MAX_ANSWER} символов. Коротко и с цифрами.`);
      s.answers.push(text);
      let body;
      if (s.answers.length < TOTAL_STEPS) {
        body = stepView(s, {
          reaction: REACTIONS[(s.answers.length - 1) % REACTIONS.length],
          notice: BEGGING.test(text) ? 'Балл получают ответами, а не просьбами.' : null,
        });
      } else {
        s.result = score(s);
        body = doneView(s);
      }
      s.replies.push(body);
      return { status: 200, body };
    },

    get(id, userId) {
      const s = own(id, userId);
      return { status: 200, body: s.result ? doneView(s) : stepView(s, { withFacts: true }) };
    },

    deleteUser(userId) {
      for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
      return { status: 204, body: null };
    },
  };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new HttpError(400, 'BAD_REQUEST', 'Слишком большой запрос');
    chunks.push(c);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Тело запроса должно быть JSON-объектом');
  }
}

function needUser(userId) {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) throw new HttpError(400, 'BAD_REQUEST', 'userId должен быть вида tg:<id> или web:<uuid>');
  return userId;
}

export function createHandler(api = createMockApi()) {
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, body === null ? {} : { 'content-type': 'application/json; charset=utf-8' });
      res.end(body === null ? undefined : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname.replace(/\/+$/, '');
      let m;
      if (req.method === 'GET' && p === '/api/health') return send(200, { ok: true, mode: 'demo', version: '1.0' });
      if (req.method === 'GET' && p === '/api/persona') return send(200, PERSONA);
      if (req.method === 'POST' && p === '/api/sessions') {
        const b = await readJson(req);
        const r = api.start({ userId: needUser(b.userId), pitch: b.pitch, previousSessionId: b.previousSessionId });
        return send(r.status, r.body);
      }
      if (req.method === 'POST' && (m = p.match(/^\/api\/sessions\/([^/]+)\/answers$/))) {
        const b = await readJson(req);
        const r = api.answer(decodeURIComponent(m[1]), { userId: needUser(b.userId), step: b.step, answer: b.answer });
        return send(r.status, r.body);
      }
      if (req.method === 'GET' && (m = p.match(/^\/api\/sessions\/([^/]+)$/))) {
        const r = api.get(decodeURIComponent(m[1]), needUser(url.searchParams.get('userId')));
        return send(r.status, r.body);
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/api\/users\/([^/]+)$/))) {
        const r = api.deleteUser(needUser(decodeURIComponent(m[1])));
        return send(r.status, r.body);
      }
      throw new HttpError(404, 'SESSION_NOT_FOUND', 'Нет такого адреса');
    } catch (err) {
      if (err instanceof HttpError) return send(err.status, { error: { code: err.code, message: err.message, ...err.extra } });
      console.error(JSON.stringify({ level: 'error', msg: String(err?.message || err) }));
      return send(503, { error: { code: 'AI_UNAVAILABLE', message: 'Инвестор задумался. Повторите запрос.' } });
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '127.0.0.1';
  createServer(createHandler()).listen(port, host, () => {
    console.log(`Мок API «Злой инвестор»: http://${host}:${port}/api/health`);
  });
}
