import { mountFight } from './fight-animation.mjs';

/** Optional greeting: API calls and the usable page never wait for this animation. */
const SHOW_MS = 2700;
const FADE_MS = 280;
let mounted = false;

export async function mountEntrance() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || document.hidden || performance.getEntriesByType('navigation')[0]?.type === 'back_forward') return;

  const overlay = document.createElement('div');
  overlay.className = 'entrance';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Приветствие Злого инвестора');
  overlay.innerHTML = `
    <span class="entrance__corner" aria-hidden="true">ЗЛОЙ ИНВЕСТОР</span>
    <button class="entrance__skip" type="button">Пропустить <span aria-hidden="true">↗</span></button>
    <div class="entrance__stage">
      <div class="entrance__art" aria-hidden="true"></div>
      <p class="entrance__line">Смех смехом.<br><strong>А питч готов?</strong></p>
    </div>
    <span class="entrance__footer" aria-hidden="true">5 ВОПРОСОВ · ТВОЙ ПИТЧ</span>`;
  const animation = mountFight(overlay.querySelector('.entrance__art'), { startDelayMs: 150, paused: true });
  const pending = new AbortController();
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'pagehide']) {
    window.addEventListener(type, interrupt, { once: true, signal: pending.signal });
  }
  let loadTimer;
  const ready = await Promise.race([
    animation.ready,
    new Promise((resolve) => { loadTimer = window.setTimeout(() => resolve(false), 1200); }),
  ]);
  window.clearTimeout(loadTimer);
  pending.abort();
  if (!ready || interrupted || reduced.matches || document.hidden) { animation.destroy(); return; }

  const previousFocus = document.activeElement;
  const savedInert = [];
  const events = new AbortController();
  let durationTimer = 0;
  let fadeTimer = 0;
  let watchdog = 0;
  let closing = false;
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    animation.destroy();
    for (const timer of [durationTimer, fadeTimer, watchdog]) window.clearTimeout(timer);
    events.abort();
    for (const [element, inert] of savedInert) element.inert = inert;
    document.documentElement.classList.remove('entrance-active');
    overlay.remove();
    if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus?.({ preventScroll: true });
  };
  const finish = (immediate = false) => {
    if (immediate) { cleanup(); return; }
    if (closing || removed) return;
    closing = true;
    animation.pause();
    overlay.classList.add('entrance--leaving');
    fadeTimer = window.setTimeout(cleanup, FADE_MS);
  };

  // Escape hatches are installed before changing focus or interactivity.
  watchdog = window.setTimeout(cleanup, SHOW_MS + FADE_MS + 600);
  const on = (target, type, listener) => target.addEventListener(type, listener, { signal: events.signal });
  on(overlay.querySelector('button'), 'click', () => finish(true));
  on(document, 'keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); finish(true); } });
  on(window, 'pagehide', cleanup);
  on(document, 'visibilitychange', () => { if (document.hidden) cleanup(); });
  on(reduced, 'change', () => { if (reduced.matches) cleanup(); });
  try {
    for (const child of document.body.children) {
      if (child instanceof HTMLElement) { savedInert.push([child, child.inert]); child.inert = true; }
    }
    document.body.append(overlay);
    document.documentElement.classList.add('entrance-active');
    overlay.querySelector('button').focus({ preventScroll: true });
    animation.play();
    durationTimer = window.setTimeout(() => finish(), SHOW_MS);
  } catch { cleanup(); }
}

/** Observe the real request lifecycle; this controller never delays a response. */
export function mountRequestLoading() {
  const panel = document.getElementById('request-loading');
  const art = document.getElementById('request-loading-art');
  const button = document.getElementById('request-loading-pause');
  if (!panel || !art || !button) return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animation = null;
  let paused = false;
  let artworkReady = false;
  const updateButton = () => {
    button.hidden = !artworkReady || reduced.matches;
    button.textContent = paused ? 'Продолжить анимацию' : 'Пауза анимации';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', 'Приостановить анимацию ожидания');
  };
  const sync = () => {
    if (panel.hidden) {
      animation?.destroy();
      animation = null;
      artworkReady = false;
      return;
    }
    if (animation) return;
    paused = false;
    artworkReady = false;
    art.hidden = false;
    updateButton();
    const current = mountFight(art, { startDelayMs: 100 });
    animation = current;
    current.ready.then((ok) => {
      if (animation !== current) return;
      artworkReady = ok;
      art.hidden = !ok;
      updateButton();
    });
  };
  const toggle = () => {
    paused = !paused;
    if (paused) animation?.pause(); else animation?.play();
    updateButton();
  };
  const observer = new MutationObserver(sync);
  observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  button.addEventListener('click', toggle);
  reduced.addEventListener('change', updateButton);
  const cleanup = () => {
    observer.disconnect();
    animation?.destroy();
    animation = null;
    button.removeEventListener('click', toggle);
    reduced.removeEventListener('change', updateButton);
    window.removeEventListener('pagehide', onPageHide);
  };
  // BFCache keeps the existing document and its request controller alive.
  const onPageHide = (event) => { if (!event.persisted) cleanup(); };
  window.addEventListener('pagehide', onPageHide);
  sync();
  return cleanup;
}

if (typeof document !== 'undefined') {
  mountRequestLoading();
  mountEntrance().catch(() => { /* The page stays available without the greeting. */ });
}
