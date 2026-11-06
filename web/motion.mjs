/** Decorative, dependency-free progressive enhancement. No app state or API access. */
const PALETTE = ['#ece7dd', '#faf7f0', '#ffdcc4', '#ffac71', '#ff7730', '#ff5c00', '#75300e', '#171614'];
const FRAME_MS = 1000 / 30;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
let mounted = false;

export function mountMotion() {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const abort = new AbortController();
  const canvas = document.getElementById('pixel-wave');
  const strip = canvas?.closest('.motion-strip');
  const button = document.getElementById('motion-toggle');
  let ctx;
  try { ctx = canvas?.getContext('2d', { alpha: false }); } catch { /* Keep the CSS pixel fallback. */ }
  let paused = false;
  try { paused = sessionStorage.getItem('investor.motion.paused') === 'true'; } catch { /* Storage is optional. */ }
  let inView = !('IntersectionObserver' in window);
  let frame = 0;
  let lastFrame = 0;
  let elapsed = 2.4;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let cell = 8;
  let columns = 0;
  let rows = 0;
  let grain = new Float32Array(0);
  let ripples = [];
  let lastRipple = -1;
  const pointer = { x: 0, y: 0, present: false, strength: 0 };
  const enabled = () => !paused && !reduced.matches;
  const runnable = () => Boolean(ctx && enabled() && inView && !document.hidden && width && height);
  const on = (target, event, listener, options = {}) => target?.addEventListener(event, listener, { ...options, signal: abort.signal });

  function paint() {
    if (!ctx || !width || !height) return;
    ctx.fillStyle = '#fffefa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gap = 2;
    const size = Math.max(1, Math.round((cell - gap) * dpr));
    const phase = elapsed * 0.28;
    for (let col = 0; col < columns; col += 1) {
      const nx = col / Math.max(1, columns - 1);
      const bend = Math.sin(nx * 7.2 - phase) * 1.8 + Math.sin(nx * 13.5 + phase * 0.7) * 0.48;
      const cross = Math.cos(nx * 4.6 + phase * 0.6);
      const x = col * cell;
      for (let row = 0; row < rows; row += 1) {
        const ny = row / Math.max(1, rows - 1);
        const y = row * cell;
        const noise = grain[col * rows + row];
        let energy = (Math.sin(ny * 7.8 + bend + phase * 0.45) + 1) * 0.43
          + Math.cos(ny * 11.4 + cross - phase * 0.55) * 0.12 + noise * 0.11;
        let wake = 0;
        if (pointer.strength > 0.01) {
          wake += Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / 95) * pointer.strength * 0.5;
        }
        for (const ripple of ripples) {
          const age = elapsed - ripple.at;
          const distance = Math.hypot(x - ripple.x, y - ripple.y);
          const edge = (distance - (18 + age * 95)) / 19;
          if (Math.abs(edge) < 3) wake += Math.exp(-edge * edge) * (1 - age / 1.2) * 0.35;
        }
        energy += wake;
        const color = clamp(Math.floor(energy * PALETTE.length), 0, PALETTE.length - 1);
        // Sparse hot squares trace the pointer without strobing the whole field.
        ctx.fillStyle = wake > 0.18 && noise > 0.84 ? '#ffd29a' : PALETTE[color];
        ctx.fillRect(Math.round((x + 1) * dpr), Math.round((y + 1) * dpr), size, size);
      }
    }
  }

  function resize() {
    if (!ctx) return;
    const bounds = canvas.getBoundingClientRect();
    width = Math.round(bounds.width);
    height = Math.round(bounds.height);
    if (!width || !height) return;
    dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.imageSmoothingEnabled = false;
    // Keep an upper bound on work even on ultrawide displays.
    cell = Math.max(8, Math.ceil(width / 240));
    columns = Math.ceil(width / cell);
    rows = Math.ceil(height / cell);
    grain = new Float32Array(columns * rows);
    for (let i = 0; i < grain.length; i += 1) {
      const value = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      grain[i] = value - Math.floor(value);
    }
    paint();
    schedule();
  }

  function tick(timestamp) {
    frame = 0;
    if (!runnable()) { lastFrame = 0; return; }
    if (!lastFrame || timestamp - lastFrame >= FRAME_MS) {
      const dt = lastFrame ? Math.min((timestamp - lastFrame) / 1000, 0.1) : 0;
      elapsed += dt;
      lastFrame = timestamp;
      pointer.strength += ((pointer.present ? 1 : 0) - pointer.strength) * 0.18;
      ripples = ripples.filter((ripple) => elapsed - ripple.at < 1.2);
      paint();
    }
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (runnable() && !frame) { lastFrame = 0; frame = requestAnimationFrame(tick); }
    else if (!runnable() && frame) { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; }
  }

  const phone = document.querySelector('.hero__visual .phone-mockup');
  const phoneArea = document.querySelector('.hero__visual');
  let tiltTimer = 0;
  let tiltX = 0;
  let tiltY = 0;
  function resetTilt() {
    clearTimeout(tiltTimer);
    tiltTimer = 0;
    phone?.style.setProperty('--motion-tilt-x', '0deg');
    phone?.style.setProperty('--motion-tilt-y', '0deg');
  }
  if (phone) {
    phone.classList.add('motion-phone');
    on(phoneArea, 'pointermove', (event) => {
      if (!enabled() || !finePointer.matches || document.hidden || event.pointerType === 'touch') return;
      const bounds = phoneArea.getBoundingClientRect();
      tiltX = clamp((0.5 - (event.clientY - bounds.top) / bounds.height) * 5, -2.5, 2.5);
      tiltY = clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 7, -3.5, 3.5);
      if (!tiltTimer) tiltTimer = window.setTimeout(() => {
        tiltTimer = 0;
        if (!enabled() || document.hidden) return;
        phone.style.setProperty('--motion-tilt-x', `${tiltX.toFixed(2)}deg`);
        phone.style.setProperty('--motion-tilt-y', `${tiltY.toFixed(2)}deg`);
      }, FRAME_MS);
    }, { passive: true });
    on(phoneArea, 'pointerleave', resetTilt, { passive: true });
  }

  function updatePreference() {
    root.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-reduced', reduced.matches);
    if (button) {
      button.setAttribute('aria-label', 'Анимация оформления');
      button.setAttribute('aria-pressed', String(Boolean(ctx && enabled())));
      button.disabled = reduced.matches || !ctx;
      button.textContent = reduced.matches || !ctx ? 'Без анимации' : paused ? 'Включить' : 'Пауза';
      button.title = reduced.matches ? 'Учитывается системная настройка уменьшения движения' : '';
    }
    if (!enabled()) {
      pointer.present = false;
      pointer.strength = 0;
      ripples = [];
      resetTilt();
      paint();
    }
    schedule();
  }
  on(button, 'click', () => {
    paused = !paused;
    try { sessionStorage.setItem('investor.motion.paused', String(paused)); } catch { /* Do not require storage. */ }
    updatePreference();
  });
  on(reduced, 'change', updatePreference);
  on(finePointer, 'change', resetTilt);
  on(document, 'visibilitychange', () => {
    if (document.hidden) { pointer.present = false; resetTilt(); }
    schedule();
  });

  if (ctx && strip) {
    canvas.setAttribute('aria-hidden', 'true');
    function pointerMove(event) {
      if (!enabled() || event.target.closest('button')) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.present = true;
      if (elapsed - lastRipple > 0.09) {
        ripples.push({ x: pointer.x, y: pointer.y, at: elapsed });
        if (ripples.length > 6) ripples.shift();
        lastRipple = elapsed;
      }
    }
    on(strip, 'pointermove', pointerMove, { passive: true });
    on(strip, 'pointerdown', pointerMove, { passive: true });
    on(strip, 'pointerleave', () => { pointer.present = false; }, { passive: true });
    on(strip, 'pointerup', (event) => { if (event.pointerType === 'touch') pointer.present = false; }, { passive: true });
    on(strip, 'pointercancel', () => { pointer.present = false; }, { passive: true });
  }

  let waveObserver;
  if (ctx && strip && 'IntersectionObserver' in window) {
    waveObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; schedule(); }, { threshold: 0.01 });
    waveObserver.observe(strip);
  }
  let sizeObserver;
  if (ctx && 'ResizeObserver' in window) {
    sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(canvas);
  }
  on(window, 'resize', resize, { passive: true });

  // Observe existing panels, including hidden QA/result sections: they animate
  // once when the app makes them visible, without observing form mutations.
  let revealObserver;
  let phoneReveal;
  const revealElements = document.querySelectorAll('.hero__title, .hero__steps, .stepper, .stage-panel, .result-block, .result-hero');
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (enabled()) {
          entry.target.classList.add('motion-enter');
          if (entry.target.matches('.hero__steps')) entry.target.style.setProperty('--motion-delay', '120ms');
        }
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.05 });
    revealElements.forEach((element) => revealObserver.observe(element));
    if (phoneArea && phone) {
      phoneReveal = new IntersectionObserver(([entry], observer) => {
        if (!entry.isIntersecting) return;
        if (enabled()) phone.querySelectorAll('.chat-bubble').forEach((bubble, index) => {
          bubble.style.setProperty('--motion-delay', `${index * 150 + 160}ms`);
          bubble.classList.add('motion-chat-enter');
        });
        observer.disconnect();
      }, { threshold: 0.15 });
      phoneReveal.observe(phoneArea);
      on(window, 'pagehide', () => phoneReveal.disconnect(), { once: true });
    }
  }
  resize();
  updatePreference();
  return function destroyMotion() {
    abort.abort();
    cancelAnimationFrame(frame);
    clearTimeout(tiltTimer);
    waveObserver?.disconnect();
    sizeObserver?.disconnect();
    revealObserver?.disconnect();
    phoneReveal?.disconnect();
    resetTilt();
    root.classList.remove('motion-paused', 'motion-reduced');
    mounted = false;
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountMotion, { once: true });
  else mountMotion();
}
