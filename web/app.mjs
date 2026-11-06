import {
  CRITERIA,
  EXAMPLE_PITCH,
  QUESTIONS as DEMO_QUESTIONS,
  DEMO_RESULT
} from './demo.mjs';

const STORAGE_KEY = 'angry_investor_state_v1';
const LIVE_BACKUP_KEY = `${STORAGE_KEY}_live`;
const CLIENT_TAG_KEY = `${STORAGE_KEY}_client`;
const PITCH_MIN = 20;
const PITCH_MAX = 4000;
const ANSWER_MAX = 2000;
const TOTAL_STEPS = 5;
const clientTag = loadClientTag();

/**
 * Начальное состояние приложения, синхронизируемое с sessionStorage
 */
const defaultState = () => ({
  contractVersion: '1.0',
  mode: 'live',          // 'live' | 'demo'
  stage: 'pitch',        // 'pitch' | 'qa' | 'result'
  pitchDraft: '',
  answerDraft: '',
  sessionId: null,
  step: 1,
  totalSteps: TOTAL_STEPS,
  currentQuestion: null, // { title, text, hint }
  history: [],           // [{ step, question: {title, text, hint}, answer }]
  result: null,
  backendDemo: false,
  round: 1,
  previousSessionId: null,
  previousTotal: null,
  facts: null,
  reaction: null,
  notice: null
});

let state = loadState();
let isSubmitting = false;
let lastFailedAction = null;
let activeRequest = null;
let liveStateBeforeDemo = loadLiveBackup();
let quotaKnown = false;
let apiMode = 'unknown';

// Ссылки на DOM-элементы
const dom = {
  apiBadge: document.getElementById('api-badge'),
  apiDemoBanner: document.getElementById('api-demo-banner'),
  personaPanel: document.getElementById('persona-panel'),
  personaName: document.getElementById('persona-name'),
  personaIntro: document.getElementById('persona-intro'),
  personaScoring: document.getElementById('persona-scoring'),
  roundIntro: document.getElementById('round-intro'),
  startMainBtn: document.getElementById('start-main-btn'),
  startDemoHeroBtn: document.getElementById('start-demo-hero-btn'),
  startDemoPanelBtn: document.getElementById('start-demo-panel-btn'),
  exitDemoBtn: document.getElementById('exit-demo-btn'),
  demoBanner: document.getElementById('demo-banner'),
  errorBanner: document.getElementById('error-banner'),
  errorTitle: document.getElementById('error-title'),
  errorMessage: document.getElementById('error-message'),
  retryActionBtn: document.getElementById('retry-action-btn'),
  dismissErrorBtn: document.getElementById('dismiss-error-btn'),

  stepperItems: Array.from(document.querySelectorAll('[data-step-nav]')),

  viewPitch: document.getElementById('view-pitch'),
  pitchForm: document.getElementById('pitch-form'),
  pitchInput: document.getElementById('pitch-input'),
  pitchCounter: document.getElementById('pitch-counter'),
  submitPitchBtn: document.getElementById('submit-pitch-btn'),
  fillExampleBtn: document.getElementById('fill-example-btn'),
  criteriaPreviewList: document.getElementById('criteria-preview-list'),

  viewQa: document.getElementById('view-qa'),
  qaStepBadge: document.getElementById('qa-step-badge'),
  qaProgressBar: document.getElementById('qa-progress-bar'),
  abortSessionBtn: document.getElementById('abort-session-btn'),
  chatLog: document.getElementById('chat-log'),
  factsPanel: document.getElementById('facts-panel'),
  factsKnown: document.getElementById('facts-known'),
  factsMissing: document.getElementById('facts-missing'),
  apiReaction: document.getElementById('api-reaction'),
  apiNotice: document.getElementById('api-notice'),
  currentQuestionCounter: document.getElementById('current-question-counter'),
  currentQuestionTitle: document.getElementById('current-question-title'),
  currentQuestionText: document.getElementById('current-question-text'),
  currentQuestionHintWrap: document.getElementById('current-question-hint-wrap'),
  currentQuestionHint: document.getElementById('current-question-hint'),
  answerForm: document.getElementById('answer-form'),
  answerInput: document.getElementById('answer-input'),
  answerCounter: document.getElementById('answer-counter'),
  submitAnswerBtn: document.getElementById('submit-answer-btn'),

  viewResult: document.getElementById('view-result'),
  demoResultStamp: document.getElementById('demo-result-stamp'),
  resultHeading: document.getElementById('result-heading'),
  resultSummary: document.getElementById('result-summary'),
  resultScore: document.getElementById('result-score'),
  resultMaxScore: document.getElementById('result-max-score'),
  roundComparison: document.getElementById('round-comparison'),
  scoringDescription: document.getElementById('scoring-description'),
  criteriaGrid: document.getElementById('criteria-grid'),
  tipsList: document.getElementById('tips-list'),
  resultTranscript: document.getElementById('result-transcript'),
  newRoundTopBtn: document.getElementById('new-round-top-btn'),
  newRoundBottomBtn: document.getElementById('new-round-bottom-btn'),
  tryRealFromDemoBtn: document.getElementById('try-real-from-demo-btn'),
  secondRoundBtn: document.getElementById('second-round-btn'),

  srAnnouncer: document.getElementById('sr-announcer')
};

/* ==========================================================================
   ИНИЦИАЛИЗАЦИЯ И ХРАНИЛИЩЕ
   ========================================================================== */

function loadState(storageKey = STORAGE_KEY) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultState();
    const recovered = defaultState();
    if (typeof parsed.pitchDraft === 'string') recovered.pitchDraft = parsed.pitchDraft.slice(0, PITCH_MAX);
    if (typeof parsed.answerDraft === 'string') recovered.answerDraft = parsed.answerDraft.slice(0, ANSWER_MAX);
    if (!['live', 'demo'].includes(parsed.mode) || !['pitch', 'qa', 'result'].includes(parsed.stage)) return recovered;
    recovered.mode = parsed.mode;
    if (isSessionId(parsed.previousSessionId) && parsed.contractVersion === '1.0') recovered.previousSessionId = parsed.previousSessionId;
    if (Number.isInteger(parsed.round) && parsed.round > 0) recovered.round = parsed.round;
    if (Number.isFinite(parsed.previousTotal) && parsed.previousTotal >= 0 && parsed.previousTotal <= 100) recovered.previousTotal = parsed.previousTotal;
    if (parsed.stage === 'pitch') return recovered;
    if (parsed.mode === 'live' && parsed.contractVersion !== '1.0') return recovered;
    if (!Number.isInteger(parsed.step) || parsed.step < 1 || parsed.step > TOTAL_STEPS
      || parsed.totalSteps !== TOTAL_STEPS || !isQuestion(parsed.currentQuestion)
      || !Array.isArray(parsed.history) || parsed.history.length > TOTAL_STEPS
      || !parsed.history.every((entry, index) => entry && Number.isInteger(entry.step) && entry.step >= 1
        && entry.step <= TOTAL_STEPS && (index === 0 || entry.step > parsed.history[index - 1].step)
        && isQuestion(entry.question) && typeof entry.answer === 'string'
        && entry.answer.trim() && entry.answer.length <= ANSWER_MAX)
      || (parsed.mode === 'live' ? !isSessionId(parsed.sessionId) : parsed.sessionId !== 'demo-session')) return recovered;
    if (parsed.stage === 'qa' && parsed.history.some((entry) => entry.step >= parsed.step)) return recovered;
    if (parsed.stage === 'result' && !isResult(parsed.result, parsed.mode === 'live')) return recovered;
    return { ...recovered, stage: parsed.stage, sessionId: parsed.sessionId, step: parsed.step,
      currentQuestion: parsed.currentQuestion, history: parsed.history, result: parsed.stage === 'result' ? parsed.result : null,
      backendDemo: parsed.backendDemo === true, facts: isFacts(parsed.facts) ? parsed.facts : null,
      reaction: typeof parsed.reaction === 'string' ? parsed.reaction : null, notice: typeof parsed.notice === 'string' ? parsed.notice : null };
  } catch {
    return defaultState();
  }
}

function loadClientTag() {
  try {
    const saved = sessionStorage.getItem(CLIENT_TAG_KEY);
    if (isSessionId(saved)) return saved.toLowerCase();
  } catch { /* Private mode can disable storage. */ }
  // getRandomValues is available on HTTP previews as well as HTTPS.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  const tag = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  try { sessionStorage.setItem(CLIENT_TAG_KEY, tag); } catch { /* Keep the tab identity in memory. */ }
  return tag;
}

function loadLiveBackup() {
  try {
    if (!sessionStorage.getItem(LIVE_BACKUP_KEY)) return null;
    const backup = loadState(LIVE_BACKUP_KEY);
    return backup.mode === 'live' ? backup : null;
  } catch { return null; }
}

function clearLiveBackup() {
  liveStateBeforeDemo = null;
  try { sessionStorage.removeItem(LIVE_BACKUP_KEY); } catch { /* Storage can be unavailable. */ }
}

function isSessionId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

function isQuestion(value) {
  return value && typeof value === 'object' && ['title', 'text', 'hint'].every((key) => typeof value[key] === 'string')
    && value.title.trim() && value.text.trim() && value.title.length <= 120 && value.text.length <= 1500 && value.hint.length <= 500;
}

function isResult(value, contract = false) {
  return value && typeof value.summary === 'string' && value.summary.trim()
    && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100 && value.maxScore === 100
    && Array.isArray(value.criteria) && value.criteria.length === CRITERIA.length
    && value.criteria.every((item, index) => item && item.name === CRITERIA[index]
      && Number.isFinite(item.score) && item.score >= 0 && Number.isFinite(item.maxScore) && item.maxScore >= 0 && item.score <= item.maxScore
      && (contract ? Number.isInteger(item.level) && item.level >= 0 && item.level <= 3 && item.weight === item.maxScore
        && (item.evidence === null || typeof item.evidence === 'string') : Number.isInteger(item.score) && item.maxScore === 10)
      && typeof item.comment === 'string')
    && Array.isArray(value.tips) && value.tips.length === 3
    && value.tips.every((tip) => tip && typeof tip.title === 'string' && tip.title.trim() && typeof tip.text === 'string' && tip.text.trim());
}

function isFacts(value) {
  return value && ['known', 'missing'].every((key) => Array.isArray(value[key])
    && value[key].length <= 20 && value[key].every((item) => typeof item === 'string' && item.length <= 2000));
}

function mapResult(value) {
  if (!value || !value.summary || typeof value.summary.strong !== 'string' || typeof value.summary.weak !== 'string'
    || !Array.isArray(value.criteria) || !Array.isArray(value.advice)
    || value.criteria.some((item) => !item || !Number.isInteger(item.level) || !Number.isInteger(item.weight)
      || item.weight < 0 || item.max !== item.weight || (item.level > 0 && (typeof item.evidence !== 'string' || !item.evidence.trim())))
    || value.criteria.reduce((sum, item) => sum + item.weight, 0) !== 100
    || (value.previousTotal !== null && (!Number.isFinite(value.previousTotal) || value.previousTotal < 0 || value.previousTotal > 100))
    || value.advice.some((tip) => !tip || !['text', 'action', 'deadline', 'doneWhen', 'basedOn'].every((key) => typeof tip[key] === 'string' && tip[key].trim()))) throw invalidResponse();
  const result = {
    summary: `Сильное: ${value.summary.strong}\n\nСтоит усилить: ${value.summary.weak}`,
    score: value.total,
    maxScore: value.max,
    previousTotal: value.previousTotal,
    criteria: value.criteria.map((item) => ({ ...item, maxScore: item.max })),
    tips: value.advice.map((tip, index) => ({ title: `Приоритет ${index + 1}`, text: tip.text, basedOn: tip.basedOn })),
  };
  if (!isResult(result, true)) throw invalidResponse();
  return result;
}

function mapStep(data) {
  if (!data || !isSessionId(data.sessionId) || !Number.isInteger(data.round) || data.round < 1 || typeof data.demo !== 'boolean') throw invalidResponse();
  if (data.done === true && data.status === 'done') return { result: mapResult(data.result) };
  if (data.status !== 'in_progress' || !Number.isInteger(data.step) || data.step < 1 || data.step > TOTAL_STEPS
    || data.totalSteps !== TOTAL_STEPS || typeof data.question !== 'string' || !data.question.trim()
    || typeof data.topic !== 'string' || (data.facts !== undefined && !isFacts(data.facts))
    || ![data.reaction, data.notice].every((text) => text == null || typeof text === 'string')) throw invalidResponse();
  const question = { title: data.topic, text: data.question, hint: '' };
  if (!isQuestion(question)) throw invalidResponse();
  return { question };
}

function applyApiView(data, mapped, answerEntry = null) {
  if (answerEntry && !state.history.some((entry) => entry.step === answerEntry.step)) state.history.push(answerEntry);
  state.sessionId = data.sessionId;
  state.round = data.round;
  state.backendDemo = data.demo;
  if (data.facts) state.facts = data.facts;
  state.reaction = data.reaction || null;
  state.notice = data.notice || null;
  state.answerDraft = '';
  if (mapped.result) {
    state.result = mapped.result;
    state.stage = 'result';
    state.step = TOTAL_STEPS;
  } else {
    state.currentQuestion = mapped.question;
    state.step = data.step;
    state.stage = 'qa';
  }
  saveState();
  renderApp();
}

function invalidResponse() {
  return Object.assign(new Error('Сервер вернул неполный ответ. Текст сохранён — повторите отправку.'), { code: 'RESPONSE' });
}

function cancelPendingRequest() {
  const pending = activeRequest;
  activeRequest = null;
  pending?.abort();
  setSubmittingState(false);
}

function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Игнорируем переполнение приватного режима
  }
}

function announce(message) {
  if (!dom.srAnnouncer) return;
  dom.srAnnouncer.textContent = '';
  window.setTimeout(() => {
    dom.srAnnouncer.textContent = message;
  }, 40);
}

/* ==========================================================================
   ПРОВЕРКА /api/health И СЕТЕВЫЕ ЗАПРОСЫ
   ========================================================================== */

async function checkApiHealth() {
  try {
    const data = await apiRequest('/api/health');
    if (!data || data.ok !== true || !['live', 'demo'].includes(data.mode)) throw invalidResponse();
    apiMode = data.mode;
  } catch {
    apiMode = 'offline';
  }
  renderApiStatus();
}

function renderApiStatus() {
  dom.apiBadge.classList.remove('status-badge--ready', 'status-badge--offline');
  if (quotaKnown) {
    dom.apiBadge.classList.add('status-badge--offline');
    dom.apiBadge.textContent = 'ИИ временно недоступен · доступно демо';
  } else if (apiMode === 'demo') {
    dom.apiBadge.classList.add('status-badge--offline');
    dom.apiBadge.textContent = 'Учебный API · без модели';
  } else if (apiMode === 'live') {
    dom.apiBadge.classList.add('status-badge--ready');
    dom.apiBadge.textContent = 'Gemini Argon · общий API';
  } else {
    dom.apiBadge.classList.add('status-badge--offline');
    dom.apiBadge.textContent = apiMode === 'unknown' ? 'Проверяем общий API…' : 'Общий API недоступен · доступно демо';
  }
  dom.apiDemoBanner.hidden = state.mode === 'demo' || !(apiMode === 'demo' || state.backendDemo);
}

async function loadPersona() {
  try {
    const persona = await apiRequest('/api/persona');
    if (!persona || !['name', 'title', 'intro', 'howScored'].every((key) => typeof persona[key] === 'string')) return;
    dom.personaName.textContent = `${persona.name} · ${persona.title}`;
    dom.personaIntro.textContent = persona.intro;
    dom.personaScoring.textContent = persona.howScored;
    dom.personaPanel.hidden = false;
  } catch { /* The form stays available; submission reports a connection error. */ }
}

async function apiRequest(url, { payload, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
  try {
    const response = await fetch(url, {
      method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Web-Client': clientTag, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch { throw invalidResponse(); }
    if (!response.ok || data?.error) {
      const error = new Error(data?.error?.message || `Сервер вернул ошибку ${response.status}. Повторите отправку.`);
      error.code = data?.error?.code || (response.status === 429 ? 'RATE_LIMITED' : 'AI_UNAVAILABLE');
      error.missing = Array.isArray(data?.error?.missing) ? data.error.missing.filter((item) => typeof item === 'string') : [];
      error.retryAfterSec = data?.error?.retryAfterSec;
      throw error;
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timedOut) throw Object.assign(new Error('Сервер не успел ответить. Текст сохранён — повторите запрос.'), { code: 'TIMEOUT' });
    if (error.code) throw error;
    throw Object.assign(new Error('Не удалось связаться с общим сервером. Текст сохранён — повторите запрос.'), { code: 'NETWORK' });
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function apiPost(url, payload, signal) {
  return apiRequest(url, { payload, signal });
}

/* ==========================================================================
   УПРАВЛЕНИЕ ОШИБКАМИ И ЗАГРУЗКОЙ
   ========================================================================== */

function showError(title, message, retryCallback = null) {
  dom.errorTitle.textContent = title;
  dom.errorMessage.textContent = message;
  lastFailedAction = retryCallback;
  dom.retryActionBtn.hidden = typeof retryCallback !== 'function';
  dom.errorBanner.hidden = false;
  dom.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  dom.errorBanner.hidden = true;
  lastFailedAction = null;
}

function setSubmittingState(busy, labelText = '') {
  isSubmitting = busy;
  dom.submitPitchBtn.disabled = busy;
  dom.submitAnswerBtn.disabled = busy;
  dom.pitchInput.readOnly = busy;
  dom.answerInput.readOnly = busy;
  dom.retryActionBtn.disabled = busy;

  if (busy) {
    if (state.stage === 'pitch') {
      dom.submitPitchBtn.textContent = labelText || 'Злой инвестор изучает питч…';
    } else if (state.stage === 'qa') {
      dom.submitAnswerBtn.textContent = labelText || 'Инвестор анализирует ответ…';
    }
  } else {
    updateStageButtonsText();
  }
}

function updateStageButtonsText() {
  if (state.mode === 'demo') {
    dom.submitPitchBtn.textContent = 'Запустить демовопросы (StudySpot)';
  } else {
    dom.submitPitchBtn.textContent = 'Отправить питч и получить 1-й вопрос';
  }

  const isLastStep = state.step >= state.totalSteps;
  if (isLastStep) {
    dom.submitAnswerBtn.textContent = state.mode === 'demo'
      ? 'Завершить демо и открыть разбор'
      : 'Отправить 5-й ответ и получить вердикт';
  } else {
    dom.submitAnswerBtn.textContent = `Ответить (вопрос ${state.step} из ${state.totalSteps})`;
  }
}

/* ==========================================================================
   РЕНДЕРИНГ ИНТЕРФЕЙСА (ТОЛЬКО textContent / DOM API)
   ========================================================================== */

function renderCriteriaPreview() {
  dom.criteriaPreviewList.replaceChildren();
  const list = Array.isArray(CRITERIA) && CRITERIA.length === 10
    ? CRITERIA
    : [
        'Проблема и боль клиента',
        'Ценностное предложение',
        'Объём и динамика рынка',
        'Бизнес-модель и монеткизация',
        'Юнит-экономика',
        'Конкурентное преимущество',
        'Go-to-Market стратегия',
        'Трекшн и валидация',
        'Команда и компетенции',
        'Реалистичность планов и риски'
      ];

  list.forEach((itemName, index) => {
    const li = document.createElement('li');
    li.className = 'criteria-preview__item';

    const numSpan = document.createElement('span');
    numSpan.className = 'criteria-preview__num';
    numSpan.textContent = `${index + 1}.`;

    const textSpan = document.createElement('span');
    textSpan.textContent = String(itemName);

    li.append(numSpan, textSpan);
    dom.criteriaPreviewList.appendChild(li);
  });
}

function updateCounters() {
  const pitchLen = dom.pitchInput.value.trim().length;
  dom.pitchCounter.textContent = `${pitchLen} / ${PITCH_MAX}`;
  const pitchInvalid = pitchLen > 0 && (pitchLen < PITCH_MIN || pitchLen > PITCH_MAX);
  dom.pitchCounter.classList.toggle('field__counter--invalid', pitchInvalid);
  dom.pitchInput.classList.toggle('field__textarea--invalid', pitchInvalid);

  const ansLen = dom.answerInput.value.trim().length;
  dom.answerCounter.textContent = `${ansLen} / ${ANSWER_MAX}`;
  const ansInvalid = ansLen > ANSWER_MAX;
  dom.answerCounter.classList.toggle('field__counter--invalid', ansInvalid);
  dom.answerInput.classList.toggle('field__textarea--invalid', ansInvalid);
}

function renderStepper() {
  let activeStageNum = 1;
  if (state.stage === 'qa') activeStageNum = 2;
  if (state.stage === 'result') activeStageNum = 4;

  dom.stepperItems.forEach((item) => {
    const stepNum = Number(item.dataset.stepNav);
    item.classList.remove('stepper__item--active', 'stepper__item--done');
    item.removeAttribute('aria-current');

    if (state.stage === 'result' && (stepNum === 3 || stepNum === 4)) {
      item.classList.add('stepper__item--active');
      if (stepNum === 3) item.setAttribute('aria-current', 'step');
    } else if (stepNum === activeStageNum) {
      item.classList.add('stepper__item--active');
      item.setAttribute('aria-current', 'step');
    } else if (stepNum < activeStageNum) {
      item.classList.add('stepper__item--done');
    }
  });
}

function createChatBubbleElement(role, metaLabel, bodyText) {
  const wrapper = document.createElement('div');
  wrapper.className = `history-msg history-msg--${role}`;

  const meta = document.createElement('span');
  meta.className = 'history-msg__meta';
  meta.textContent = metaLabel;

  const textP = document.createElement('p');
  textP.className = 'history-msg__text';
  textP.textContent = bodyText;

  wrapper.append(meta, textP);
  return wrapper;
}

function renderChatHistory(targetContainer) {
  targetContainer.replaceChildren();

  // Сначала исходный питч пользователя
  if (state.pitchDraft) {
    targetContainer.appendChild(
      createChatBubbleElement('user', 'Ваш питч', state.pitchDraft)
    );
  }

  // Пройденные вопросы и ответы
  state.history.forEach((entry) => {
    const qTitle = entry.question?.title ? `${entry.question.title}: ` : '';
    const qFull = `${qTitle}${entry.question?.text || ''}`;
    targetContainer.appendChild(
      createChatBubbleElement('investor', `Вопрос ${entry.step} из ${state.totalSteps}`, qFull)
    );
    targetContainer.appendChild(
      createChatBubbleElement('user', `Ваш ответ #${entry.step}`, entry.answer)
    );
  });

  targetContainer.scrollTop = targetContainer.scrollHeight;
}

function renderQaStage() {
  const step = state.step;
  const total = state.totalSteps || TOTAL_STEPS;

  dom.qaStepBadge.textContent = `Вопрос ${step} из ${total}`;
  dom.currentQuestionCounter.textContent = `${step} / ${total}`;

  const pct = Math.min(100, Math.max(10, Math.round((step / total) * 100)));
  dom.qaProgressBar.style.width = `${pct}%`;

  renderChatHistory(dom.chatLog);
  renderFacts();
  dom.apiNotice.textContent = state.notice || '';
  dom.apiNotice.hidden = !state.notice;
  dom.apiReaction.textContent = state.reaction || '';
  dom.apiReaction.hidden = !state.reaction;

  const q = state.currentQuestion || { title: 'Вопрос инвестора', text: '', hint: '' };
  dom.currentQuestionTitle.textContent = q.title || `Вопрос #${step}`;
  dom.currentQuestionText.textContent = q.text || '';

  if (q.hint) {
    dom.currentQuestionHint.textContent = q.hint;
    dom.currentQuestionHintWrap.hidden = false;
  } else {
    dom.currentQuestionHintWrap.hidden = true;
  }

  dom.answerInput.value = state.answerDraft || '';
  updateCounters();
  updateStageButtonsText();
}

function renderFacts() {
  dom.factsPanel.hidden = !isFacts(state.facts);
  dom.factsKnown.replaceChildren();
  dom.factsMissing.replaceChildren();
  if (!isFacts(state.facts)) return;
  for (const [key, container] of [['known', dom.factsKnown], ['missing', dom.factsMissing]]) {
    for (const text of state.facts[key]) {
      const item = document.createElement('li');
      item.textContent = text;
      container.appendChild(item);
    }
    if (!state.facts[key].length) {
      const item = document.createElement('li');
      item.textContent = key === 'known' ? 'Подтверждённые факты пока не выделены.' : 'Дополнительных пробелов не указано.';
      container.appendChild(item);
    }
  }
}

function renderResultStage() {
  const res = state.result;
  if (!res) return;

  dom.demoResultStamp.hidden = state.mode !== 'demo';
  dom.tryRealFromDemoBtn.hidden = state.mode !== 'demo';
  dom.resultHeading.textContent = state.mode === 'demo' ? 'Пример разбора StudySpot'
    : state.backendDemo ? 'Учебный разбор вашего питча' : 'Разбор вашего питча';
  dom.scoringDescription.textContent = state.mode === 'demo'
    ? 'Учебный образец StudySpot: условная шкала 0–10 с равными весами. Этот пример не оценивает ваши ответы.'
    : 'Уровень 0 — данных нет, 1 — заявлено, 2 — есть цифры, 3 — есть подтверждение. Общий сервер считает баллы: вес × уровень / 3. Сумма весов — 100.';
  dom.secondRoundBtn.hidden = state.mode === 'demo';
  const previous = res.previousTotal;
  dom.roundComparison.hidden = !Number.isFinite(previous);
  dom.roundComparison.textContent = Number.isFinite(previous) ? `Раунд ${state.round}: ${previous} → ${res.score} / 100` : '';

  dom.resultSummary.textContent = res.summary || '';
  dom.resultScore.textContent = String(res.score ?? 0);
  dom.resultMaxScore.textContent = String(res.maxScore ?? 100);

  // Отрисовка 10 критериев
  dom.criteriaGrid.replaceChildren();
  const criteriaList = Array.isArray(res.criteria) ? res.criteria : [];
  criteriaList.forEach((item, idx) => {
    const card = document.createElement('article');
    card.className = 'criterion-card';

    const top = document.createElement('div');
    top.className = 'criterion-card__top';

    const title = document.createElement('h4');
    title.className = 'criterion-card__name';
    title.textContent = `${idx + 1}. ${item.name || 'Критерий'}`;

    const scoreVal = Number(item.score ?? 0);
    const maxVal = Number(item.maxScore ?? 10);
    const ratio = maxVal > 0 ? scoreVal / maxVal : 0;

    const badge = document.createElement('span');
    badge.className = 'criterion-card__score';
    if (ratio >= 0.75) {
      badge.classList.add('criterion-card__score--high');
    } else if (ratio >= 0.45) {
      badge.classList.add('criterion-card__score--mid');
    } else {
      badge.classList.add('criterion-card__score--low');
    }
    badge.textContent = `${scoreVal} / ${maxVal}`;

    top.append(title, badge);

    const bar = document.createElement('div');
    bar.className = 'criterion-card__bar';
    const fill = document.createElement('div');
    fill.className = 'criterion-card__bar-fill';
    fill.style.width = `${Math.min(100, Math.max(0, Math.round(ratio * 100)))}%`;
    bar.appendChild(fill);

    const comment = document.createElement('p');
    comment.className = 'criterion-card__comment';
    comment.textContent = item.comment || '';

    card.append(top, bar, comment);
    if (state.mode !== 'demo') {
      const level = document.createElement('p');
      level.className = 'field__hint';
      level.textContent = `Уровень ${item.level} / 3 · вес ${item.weight} из 100`;
      card.appendChild(level);
      if (item.evidence) {
        const evidence = document.createElement('blockquote');
        evidence.className = 'criterion-card__evidence';
        evidence.textContent = `«${item.evidence}»`;
        card.appendChild(evidence);
      }
    }
    dom.criteriaGrid.appendChild(card);
  });

  // Отрисовка 3 советов
  dom.tipsList.replaceChildren();
  const tips = Array.isArray(res.tips) ? res.tips : [];
  tips.forEach((tip, idx) => {
    const li = document.createElement('li');
    li.className = 'tip-card';

    const num = document.createElement('span');
    num.className = 'tip-card__num';
    num.textContent = `Совет ${idx + 1}`;

    const title = document.createElement('h4');
    title.className = 'tip-card__title';
    title.textContent = tip.title || '';

    const text = document.createElement('p');
    text.className = 'tip-card__text';
    text.textContent = tip.text || '';

    li.append(num, title, text);
    if (tip.basedOn && !tip.text.toLocaleLowerCase('ru').includes(tip.basedOn.toLocaleLowerCase('ru'))) {
      const basis = document.createElement('p');
      basis.className = 'field__hint';
      basis.textContent = `Основание: ${tip.basedOn}.`;
      li.appendChild(basis);
    }
    dom.tipsList.appendChild(li);
  });

  renderChatHistory(dom.resultTranscript);
}

function renderApp() {
  dom.demoBanner.hidden = state.mode !== 'demo';
  renderApiStatus();
  dom.roundIntro.hidden = !state.previousSessionId;
  dom.roundIntro.textContent = state.previousSessionId
    ? `Раунд ${state.round}: улучшите прошлый питч. После пяти ответов сравним результат с предыдущим раундом.` : '';
  renderStepper();

  dom.viewPitch.hidden = state.stage !== 'pitch';
  dom.viewQa.hidden = state.stage !== 'qa';
  dom.viewResult.hidden = state.stage !== 'result';

  if (state.stage === 'pitch') {
    dom.pitchInput.value = state.pitchDraft || '';
    updateCounters();
    updateStageButtonsText();
  } else if (state.stage === 'qa') {
    renderQaStage();
  } else if (state.stage === 'result') {
    renderResultStage();
  }
}

/* ==========================================================================
   БИЗНЕС-ЛОГИКА: ПИТЧ, ВОПРОСЫ, ДЕМО, ОБРАБОТКА ОШИБОК
   ========================================================================== */

async function handlePitchSubmit(event) {
  if (event) event.preventDefault();
  if (isSubmitting || state.stage !== 'pitch') return;

  hideError();
  const pitchText = dom.pitchInput.value.trim();
  state.pitchDraft = pitchText;
  saveState();
  updateCounters();

  if (pitchText.length < PITCH_MIN || pitchText.length > PITCH_MAX) {
    showError(
      'Проверьте длину питча',
      `Питч должен содержать от ${PITCH_MIN} до ${PITCH_MAX} символов. Сейчас введено: ${pitchText.length}.`
    );
    dom.pitchInput.focus();
    return;
  }

  // Деморежим: не обращаемся к серверу
  if (state.mode === 'demo') {
    state.sessionId = 'demo-session';
    state.step = 1;
    state.totalSteps = TOTAL_STEPS;
    state.history = [];
    state.answerDraft = '';
    state.currentQuestion = DEMO_QUESTIONS[0];
    state.stage = 'qa';
    saveState();
    renderApp();
    announce('Начат деморежим. Вопрос 1 из 5.');
    dom.currentQuestionTitle.focus();
    return;
  }

  // Боевой режим: POST /api/session
  const request = new AbortController();
  activeRequest = request;
  setSubmittingState(true, 'Генерируем 1-й вопрос…');
  try {
    const data = await apiPost('/api/sessions', { pitch: pitchText, previousSessionId: state.previousSessionId }, request.signal);
    if (activeRequest !== request) return;
    const mapped = mapStep(data);
    if (data.step !== 1 || mapped.result) throw invalidResponse();
    state.history = [];
    quotaKnown = false;
    applyApiView(data, mapped);
    announce(`Получен вопрос ${state.step} из ${state.totalSteps}`);
    dom.currentQuestionTitle.focus();
  } catch (err) {
    if (activeRequest === request) handleApiError(err, () => handlePitchSubmit());
  } finally {
    if (activeRequest === request) { activeRequest = null; setSubmittingState(false); }
  }
}

async function handleAnswerSubmit(event) {
  if (event) event.preventDefault();
  if (isSubmitting || state.stage !== 'qa') return;

  hideError();
  const answerText = dom.answerInput.value.trim();
  state.answerDraft = answerText;
  saveState();
  updateCounters();

  if (answerText.length < 1 || answerText.length > ANSWER_MAX) {
    showError(
      'Проверьте текст ответа',
      `Ответ не должен быть пустым и не может превышать ${ANSWER_MAX} символов (сейчас ${answerText.length}).`
    );
    dom.answerInput.focus();
    return;
  }

  const currentStep = state.step;
  const answeredQuestion = state.currentQuestion;

  // Деморежим
  if (state.mode === 'demo') {
    state.history.push({
      step: currentStep,
      question: answeredQuestion,
      answer: answerText
    });
    state.answerDraft = '';

    if (currentStep < TOTAL_STEPS) {
      state.step = currentStep + 1;
      state.currentQuestion = DEMO_QUESTIONS[state.step - 1];
      saveState();
      renderApp();
      announce(`Демовопрос ${state.step} из ${TOTAL_STEPS}`);
      dom.currentQuestionTitle.focus();
    } else {
      state.result = DEMO_RESULT;
      state.stage = 'result';
      saveState();
      renderApp();
      announce('Демонстрационный разбор готов');
      dom.resultHeading.focus();
    }
    return;
  }

  // Боевой режим: POST /api/session/:id/answer
  const request = new AbortController();
  activeRequest = request;
  setSubmittingState(true, currentStep >= state.totalSteps ? 'Формируем оценку по 10 критериям…' : 'Инвестор готовит следующий вопрос…');
  try {
    const url = `/api/sessions/${encodeURIComponent(state.sessionId)}/answers`;
    const data = await apiPost(url, {
      answer: answerText,
      step: currentStep
    }, request.signal);
    if (activeRequest !== request) return;
    const mapped = mapStep(data);
    if (data.sessionId !== state.sessionId || (currentStep === TOTAL_STEPS ? !mapped.result : mapped.result || data.step !== currentStep + 1)) throw invalidResponse();
    const entry = {
      step: currentStep,
      question: answeredQuestion,
      answer: answerText
    };
    quotaKnown = false;
    applyApiView(data, mapped, entry);
    if (mapped.result) {
      announce('Разбор питча завершён. Оценка готова.');
      dom.resultHeading.focus();
    } else {
      announce(`Вопрос ${state.step} из ${state.totalSteps}`);
      dom.currentQuestionTitle.focus();
    }
  } catch (err) {
    // Текст ответа остаётся в поле ввода и в state.answerDraft
    if (activeRequest === request) handleApiError(err, () => handleAnswerSubmit());
  } finally {
    if (activeRequest === request) { activeRequest = null; setSubmittingState(false); }
  }
}

function handleApiError(err, retryFn) {
  if (['STEP_MISMATCH', 'SESSION_DONE'].includes(err.code)) {
    void recoverSession();
    return;
  }
  if (err.code === 'SESSION_NOT_FOUND') {
    // Сохраняем питч пользователя и возвращаем на старт сессии
    const savedPitch = state.pitchDraft;
    state = {
      ...defaultState(),
      mode: 'live',
      stage: 'pitch',
      pitchDraft: savedPitch
    };
    saveState();
    renderApp();
    showError(
      'Сессия истекла или не найдена (SESSION_NOT_FOUND)',
      'Сессия на сервере завершилась. Ваш текст питча полностью сохранён — нажмите «Отправить питч», чтобы начать заново.',
      () => handlePitchSubmit()
    );
    dom.pitchInput.focus();
    return;
  }

  if (['EMPTY_PITCH', 'NOT_A_PITCH', 'INVALID_PITCH', 'PITCH_TOO_LONG', 'EMPTY_ANSWER', 'ANSWER_TOO_LONG'].includes(err.code)) {
    const missing = err.missing?.length ? ` Не хватает: ${err.missing.join('; ')}.` : '';
    showError('Нужно уточнить текст', `${err.message}${missing}`);
    return;
  }

  if (['RATE_LIMITED', 'RATE_LIMIT'].includes(err.code)) {
    showError('Сделайте короткую паузу', err.message || `Повторите запрос через ${err.retryAfterSec || 60} с.`, retryFn);
    return;
  }

  if (err.code === 'QUOTA') {
    quotaKnown = true;
    renderApiStatus();
    // При лимите Gemini показываем ошибку и кнопку повтора, НЕ подменяем деморежимом
    showError(
      'Превышен лимит запросов к Gemini (QUOTA)',
      err.message || 'Исчерпана квота обращения к модели Gemini Argon. Ваш текст сохранён. Подождите немного и нажмите «Повторить отправку».',
      retryFn
    );
    return;
  }

  if (err.code === 'AI_UNAVAILABLE') {
    quotaKnown = true;
    renderApiStatus();
    showError('Инвестор задумался', err.message || 'Модель временно недоступна. Ваш текст сохранён.', retryFn);
    return;
  }

  showError(
    `Ошибка связи с ИИ (${err.code || 'ERROR'})`,
    err.message || 'Не удалось выполнить запрос. Введённый вами текст сохранён, вы можете повторить попытку.',
    retryFn
  );
}

async function recoverSession() {
  if (state.mode !== 'live' || !isSessionId(state.sessionId)) return;
  cancelPendingRequest();
  hideError();
  const request = new AbortController();
  activeRequest = request;
  const sessionId = state.sessionId;
  const oldStep = state.step;
  const pendingAnswer = state.answerDraft;
  const question = state.currentQuestion;
  setSubmittingState(true, 'Восстанавливаем раунд…');
  try {
    const data = await apiRequest(`/api/sessions/${encodeURIComponent(sessionId)}`, { signal: request.signal });
    if (activeRequest !== request) return;
    const mapped = mapStep(data);
    if (data.sessionId !== sessionId) throw invalidResponse();
    const acceptedPendingAnswer = Boolean(pendingAnswer.trim()) && (mapped.result ? oldStep === TOTAL_STEPS : data.step === oldStep + 1);
    applyApiView(data, mapped, acceptedPendingAnswer ? { step: oldStep, question, answer: pendingAnswer } : null);
    // The API may still be retrying the same step; keep the unsent or failed answer.
    if (!mapped.result && data.step === oldStep) {
      state.answerDraft = pendingAnswer;
      saveState();
      dom.answerInput.value = pendingAnswer;
      updateCounters();
    }
    announce(mapped.result ? 'Результат восстановлен с общего сервера.' : `Раунд восстановлен. Вопрос ${data.step} из 5.`);
  } catch (error) {
    if (activeRequest === request) {
      // Recovery errors must not recursively start another recovery.
      if (['STEP_MISMATCH', 'SESSION_DONE'].includes(error.code)) error.code = 'RESPONSE';
      handleApiError(error, () => recoverSession());
    }
  } finally {
    if (activeRequest === request) { activeRequest = null; setSubmittingState(false); }
  }
}

/* ==========================================================================
   ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ И СБРОС РАУНДА
   ========================================================================== */

function activateDemoMode() {
  cancelPendingRequest();
  if (state.mode === 'live') {
    liveStateBeforeDemo = structuredClone(state);
    try { sessionStorage.setItem(LIVE_BACKUP_KEY, JSON.stringify(liveStateBeforeDemo)); } catch { /* Keep the in-memory backup. */ }
  }
  hideError();
  state = {
    ...defaultState(),
    mode: 'demo',
    stage: 'qa',
    pitchDraft: EXAMPLE_PITCH,
    answerDraft: '',
    sessionId: 'demo-session',
    step: 1,
    totalSteps: TOTAL_STEPS,
    currentQuestion: DEMO_QUESTIONS[0],
    history: [],
    result: null
  };
  saveState();
  renderApp();
  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth' });
  dom.currentQuestionTitle.focus();
  announce('Включён демопример StudySpot: ответы не оцениваются ИИ.');
}

function exitDemoToLive() {
  cancelPendingRequest();
  hideError();
  const keepPitch = state.pitchDraft === EXAMPLE_PITCH ? '' : state.pitchDraft;
  state = liveStateBeforeDemo || {
    ...defaultState(),
    mode: 'live',
    stage: 'pitch',
    pitchDraft: keepPitch
  };
  clearLiveBackup();
  saveState();
  renderApp();
  (state.stage === 'qa' ? dom.answerInput : dom.pitchInput).focus();
  announce('Вы вернулись в основной режим Gemini Argon.');
  if (state.stage !== 'pitch') void recoverSession();
}

function startNewRound(preservePitch = false) {
  cancelPendingRequest();
  clearLiveBackup();
  hideError();
  const savedPitch = preservePitch ? state.pitchDraft : '';
  state = {
    ...defaultState(),
    mode: 'live',
    stage: 'pitch',
    pitchDraft: savedPitch
  };
  saveState();
  renderApp();
  dom.pitchInput.focus();
  announce('Начат новый раунд. Введите питч проекта.');
}

function startSecondRound() {
  if (state.mode !== 'live' || state.stage !== 'result' || !isSessionId(state.sessionId)) return;
  const previousSessionId = state.sessionId;
  const previousTotal = state.result.score;
  const pitchDraft = state.pitchDraft;
  const round = state.round + 1;
  cancelPendingRequest();
  clearLiveBackup();
  hideError();
  state = { ...defaultState(), pitchDraft, previousSessionId, previousTotal, round };
  saveState();
  renderApp();
  dom.pitchInput.focus();
  announce('Улучшите питч для второго раунда. Итоги сравним после пяти ответов.');
}

/* ==========================================================================
   СОБЫТИЯ И ГОРЯЧИЕ КЛАВИШИ
   ========================================================================== */

function bindEvents() {
  dom.pitchInput.addEventListener('input', () => {
    state.pitchDraft = dom.pitchInput.value;
    saveState();
    updateCounters();
  });

  dom.answerInput.addEventListener('input', () => {
    state.answerDraft = dom.answerInput.value;
    saveState();
    updateCounters();
  });

  // Поддержка Ctrl+Enter / Cmd+Enter в полях ввода
  dom.pitchInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handlePitchSubmit(e);
    }
  });

  dom.answerInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleAnswerSubmit(e);
    }
  });

  dom.pitchForm.addEventListener('submit', handlePitchSubmit);
  dom.answerForm.addEventListener('submit', handleAnswerSubmit);

  dom.fillExampleBtn.addEventListener('click', () => {
    if (isSubmitting) return;
    hideError();
    state.mode = 'live';
    state.pitchDraft = EXAMPLE_PITCH;
    dom.pitchInput.value = EXAMPLE_PITCH;
    saveState();
    updateCounters();
    renderApp();
    dom.pitchInput.focus();
    announce('В поле питча подставлен пример проекта StudySpot.');
  });

  dom.startDemoHeroBtn.addEventListener('click', activateDemoMode);
  dom.startDemoPanelBtn.addEventListener('click', activateDemoMode);
  dom.exitDemoBtn.addEventListener('click', exitDemoToLive);
  dom.tryRealFromDemoBtn.addEventListener('click', exitDemoToLive);

  dom.startMainBtn.addEventListener('click', () => {
    if (state.mode === 'demo') {
      exitDemoToLive();
    } else if (state.stage === 'pitch') {
      dom.pitchInput.focus();
    }
  });

  dom.abortSessionBtn.addEventListener('click', () => {
    startNewRound(true);
  });

  dom.newRoundTopBtn.addEventListener('click', () => startNewRound(false));
  dom.newRoundBottomBtn.addEventListener('click', () => startNewRound(false));
  dom.secondRoundBtn.addEventListener('click', startSecondRound);

  dom.retryActionBtn.addEventListener('click', () => {
    if (typeof lastFailedAction === 'function') {
      const fn = lastFailedAction;
      hideError();
      fn();
    }
  });

  dom.dismissErrorBtn.addEventListener('click', hideError);
}

// Запуск
renderCriteriaPreview();
bindEvents();
renderApp();
checkApiHealth();
loadPersona();
if (state.mode === 'live' && state.stage !== 'pitch') void recoverSession();
