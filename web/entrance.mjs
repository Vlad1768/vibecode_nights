/** Short, optional greeting. The trainer never waits for this animation or an API. */
const SHOW_MS = 2200;
const FADE_MS = 380;
let mounted = false;

function polygon(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fill();
}

function paintLaugh(ctx, image, elapsed) {
  ctx.clearRect(0, 0, 1024, 1024);
  ctx.save();
  ctx.beginPath();
  ctx.arc(512, 512, 512, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, 0, 0, 1024, 1024);

  if (elapsed > 160 && elapsed < 2050) {
    // Native pixel shapes animate the supplied artwork; the original stays intact.
    ctx.fillStyle = '#eaa073';
    ctx.fillRect(416, 534, 69, 30);
    ctx.fillRect(544, 534, 69, 30);
    for (const x of [419, 547]) {
      polygon(ctx, [[x, 550], [x + 9, 550], [x + 9, 541], [x + 20, 541],
        [x + 20, 535], [x + 42, 535], [x + 42, 541], [x + 53, 541],
        [x + 53, 550], [x + 62, 550], [x + 62, 559], [x + 45, 559],
        [x + 45, 550], [x + 17, 550], [x + 17, 559], [x, 559]], '#482b32');
    }

    const beat = [0, 12, 5, 16][Math.floor((elapsed - 160) / 145) % 4];
    ctx.fillStyle = '#efa475';
    ctx.fillRect(446, 646, 132, 55);
    polygon(ctx, [[451, 646], [470, 646], [470, 652], [554, 652],
      [554, 646], [574, 646], [574, 669 + beat], [565, 669 + beat],
      [565, 683 + beat], [548, 683 + beat], [548, 691 + beat],
      [478, 691 + beat], [478, 683 + beat], [460, 683 + beat],
      [460, 669 + beat], [451, 669 + beat]], '#64383b');
    ctx.fillStyle = '#291e2b';
    ctx.fillRect(462, 662, 101, 18 + beat);
    ctx.fillRect(478, 675, 70, 9 + beat);
    ctx.fillStyle = '#fff1d9';
    ctx.fillRect(464, 654, 96, 12);
    ctx.fillStyle = '#dfd5c0';
    ctx.fillRect(475, 666, 75, 4);
    ctx.fillStyle = '#d66b63';
    ctx.fillRect(487, 677 + beat, 50, 9);
    ctx.fillStyle = '#ec9181';
    ctx.fillRect(497, 677 + beat, 30, 4);
  }
  ctx.restore();
}

export async function mountEntrance() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || document.hidden || performance.getEntriesByType('navigation')[0]?.type === 'back_forward') return;

  // A slow/missing image must never put a loading screen over an already usable page.
  const pending = new AbortController();
  let interrupted = false;
  const interrupt = () => { interrupted = true; };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'pagehide']) {
    window.addEventListener(type, interrupt, { once: true, signal: pending.signal });
  }
  const image = new Image();
  const ready = await new Promise((resolve) => {
    let timer = 0;
    const settle = (value) => { window.clearTimeout(timer); image.onload = image.onerror = null; resolve(value); };
    timer = window.setTimeout(() => settle(false), 1200);
    image.onload = () => settle(true);
    image.onerror = () => settle(false);
    image.src = new URL('./assets/investor-fight.jpg', import.meta.url).href;
  });
  pending.abort();
  if (!ready || interrupted || reduced.matches || document.hidden) return;

  const overlay = document.createElement('div');
  overlay.className = 'entrance';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Приветствие Злого инвестора');
  overlay.innerHTML = `
    <span class="entrance__corner" aria-hidden="true">ЗЛОЙ ИНВЕСТОР</span>
    <button class="entrance__skip" type="button">Пропустить <span aria-hidden="true">↗</span></button>
    <div class="entrance__stage">
      <div class="entrance__art" aria-hidden="true">
        <span class="entrance__ha entrance__ha--one">ХА!</span>
        <canvas class="entrance__badge" width="1024" height="1024"></canvas>
        <span class="entrance__ha entrance__ha--two">ХА-ХА!</span>
        <span class="entrance__spark entrance__spark--one">+</span>
        <span class="entrance__spark entrance__spark--two">+</span>
      </div>
      <p class="entrance__line">Смех смехом.<br><strong>А питч готов?</strong></p>
      <div class="entrance__loading" aria-hidden="true"><span></span></div>
      <p class="entrance__caption">Сейчас начнём</p>
    </div>
    <span class="entrance__footer" aria-hidden="true">5 ВОПРОСОВ · ТВОЙ ПИТЧ</span>`;
  const canvas = overlay.querySelector('canvas');
  let ctx;
  try { ctx = canvas.getContext('2d'); } catch { return; }
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  paintLaugh(ctx, image, 0);

  const previousFocus = document.activeElement;
  const savedInert = [];
  const events = new AbortController();
  let frame = 0;
  let durationTimer = 0;
  let fadeTimer = 0;
  let watchdog = 0;
  let closing = false;
  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    window.cancelAnimationFrame(frame);
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
    window.cancelAnimationFrame(frame);
    overlay.classList.add('entrance--leaving');
    fadeTimer = window.setTimeout(cleanup, FADE_MS);
  };

  // Install the escape hatches before changing focus, scroll, or interactivity.
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
    durationTimer = window.setTimeout(() => finish(), SHOW_MS);
    const start = performance.now();
    let last = 0;
    const tick = (now) => {
      if (closing || removed) return;
      try {
        if (now - last >= 1000 / 24) { paintLaugh(ctx, image, now - start); last = now; }
        frame = window.requestAnimationFrame(tick);
      } catch { cleanup(); }
    };
    frame = window.requestAnimationFrame(tick);
  } catch { cleanup(); }
}

if (typeof document !== 'undefined') mountEntrance().catch(() => { /* The page is available without the greeting. */ });
