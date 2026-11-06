// Self-hosted adaptation of the user's Investor Fight.webarchive.
// Decorative only: mounting does not make model requests or delay the application.
const FRAME_MS = 1000 / 24;
const FACE_H = 267;
const MOUTH_Y = 204;
const MOUTH_LEFT = 90;
const MOUTH_RIGHT = 150;
const MAX_DROP = 24;
const BEAT_MS = 230;
const COLORS = {
  dark: '#2a0708', line: '#5b1c17', teeth: '#f4efe0', teethShade: '#b9ad95',
  tongue: '#b8323a', tongueDark: '#86202a', crease: '#7d3a2c',
};

/** Mount one independent animation. Call destroy() when its container is retired. */
export function mountFight(container, { startDelayMs = 1200, paused = false } = {}) {
  const doc = container?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win || typeof container.appendChild !== 'function') {
    return { ready: Promise.resolve(false), play() {}, pause() {}, destroy() {} };
  }
  const delay = Number.isFinite(startDelayMs) ? Math.max(0, Math.min(60000, startDelayMs)) : 1200;
  const root = doc.createElement('div');
  root.className = 'fight';
  root.setAttribute('aria-hidden', 'true');
  const title = doc.createElement('img');
  title.className = 'fight-title';
  title.alt = '';
  title.width = 404;
  title.height = 154;
  title.draggable = false;
  const wrap = doc.createElement('div');
  wrap.className = 'fight-head-wrap';
  const canvas = doc.createElement('canvas');
  canvas.className = 'fight-head';
  canvas.width = 240;
  canvas.height = 292;
  wrap.appendChild(canvas);
  root.append(title, wrap);
  container.appendChild(root);

  let ctx;
  try { ctx = canvas.getContext('2d'); } catch { /* Static fallback is controlled by the caller. */ }
  if (!ctx) {
    root.remove();
    return { ready: Promise.resolve(false), play() {}, pause() {}, destroy() {} };
  }

  const image = new win.Image();
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const words = ['HA!', 'HA', 'HA!', 'HAHA!', 'HA', 'MWAHA!', 'HA!'];
  const haTimers = new Map();
  let face;
  let loaded = false;
  let destroyed = false;
  let userPaused = Boolean(paused);
  let inView = !('IntersectionObserver' in win);
  let frame = 0;
  let lastFrame = -Infinity;
  let laughStart = -1;
  let laughBeats = 0;
  let lastBeat = -1;
  let nextAuto = 0;
  let resolveReady;
  let settled = false;
  let titleLoaded = false;
  let faceLoaded = false;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const loadTimer = win.setTimeout(() => settle(false), 8000);

  const rectangle = (x, y, width, height, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
  };

  function mouth(drop) {
    const x = MOUTH_LEFT;
    const right = MOUTH_RIGHT;
    const y = MOUTH_Y;
    const width = right - x;
    rectangle(x - 5, y - 3, 6, 5, COLORS.line);
    rectangle(x - 10, y - 8, 6, 6, COLORS.line);
    rectangle(right - 1, y - 3, 6, 5, COLORS.line);
    rectangle(right + 4, y - 8, 6, 6, COLORS.line);
    rectangle(x - 18, y - 20, 4, 10, COLORS.crease);
    rectangle(right + 14, y - 20, 4, 10, COLORS.crease);
    if (drop < 3) { rectangle(x, y, width, 5, COLORS.line); return; }
    rectangle(x, y - 2, width, drop + 4, COLORS.line);
    rectangle(x + 3, y, width - 6, drop + 2, COLORS.dark);
    const teethHeight = Math.min(6, drop - 1);
    rectangle(x + 5, y, width - 10, teethHeight, COLORS.teeth);
    for (let tooth = x + 13; tooth < right - 6; tooth += 9) rectangle(tooth, y, 1, teethHeight, COLORS.teethShade);
    rectangle(x + 5, y + teethHeight - 1, width - 10, 1, COLORS.teethShade);
    if (drop >= 12) {
      rectangle(x + 14, y + drop - 7, width - 28, 7, COLORS.tongue);
      rectangle(x + 26, y + drop - 7, 2, 4, COLORS.tongueDark);
    }
    if (drop >= 9) {
      rectangle(x + 9, y + drop - 3, width - 18, 4, COLORS.teeth);
      for (let tooth = x + 17; tooth < right - 10; tooth += 9) rectangle(tooth, y + drop - 3, 1, 4, COLORS.teethShade);
    }
  }

  function draw(drop) {
    if (!face) return;
    const d = Math.round(drop / 3) * 3;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(face, 0, 0, 240, MOUTH_Y, 0, 0, 240, MOUTH_Y);
    for (let row = 0; row < d; row++) ctx.drawImage(face, 0, MOUTH_Y - 1, 240, 1, 0, MOUTH_Y + row, 240, 1);
    ctx.drawImage(face, 0, MOUTH_Y, 240, FACE_H - MOUTH_Y, 0, MOUTH_Y + d, 240, FACE_H - MOUTH_Y);
    mouth(d);
  }

  function removeHa(node) {
    const timer = haTimers.get(node);
    if (timer !== undefined) win.clearTimeout(timer);
    haTimers.delete(node);
    node.remove();
  }

  function spawnHa(index) {
    const node = doc.createElement('span');
    node.className = 'fight-ha';
    node.textContent = words[index % words.length];
    const side = index % 2 ? 1 : -1;
    // Stay inside the illustration on narrow phones, including the longest word.
    node.style.left = `${50 + side * (22 + Math.random() * 5)}%`;
    node.style.top = `${48 + Math.random() * 30 - 10}%`;
    node.style.setProperty('--fight-rotation', `${side * (6 + Math.random() * 10)}deg`);
    root.appendChild(node);
    haTimers.set(node, win.setTimeout(() => removeHa(node), 1000));
  }

  function canAnimate() {
    return loaded && !destroyed && !userPaused && inView && !reduced.matches
      && doc.visibilityState !== 'hidden'
      && !doc.documentElement.classList.contains('motion-paused')
      && !doc.body?.classList.contains('motion-paused');
  }

  function stop() {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    laughStart = -1;
    lastBeat = -1;
    for (const node of [...haTimers.keys()]) removeHa(node);
    wrap.style.transform = '';
    title.style.transform = '';
    draw(0);
  }

  function refresh() {
    if (!canAnimate()) { stop(); return; }
    if (!frame) {
      nextAuto = win.performance.now() + delay;
      lastFrame = -Infinity;
      frame = win.requestAnimationFrame(loop);
    }
  }

  function startLaugh(now) {
    if (!canAnimate() || laughStart >= 0) return;
    laughStart = now;
    laughBeats = 7 + Math.floor(Math.random() * 3);
    lastBeat = -1;
  }

  function loop(now) {
    frame = 0;
    if (!canAnimate()) { stop(); return; }
    frame = win.requestAnimationFrame(loop);
    if (now - lastFrame < FRAME_MS) return;
    lastFrame = now;
    let drop = 0, y = 0, rotation = 0, x = 0, titleX = 0, titleY = 0;
    if (laughStart < 0 && now >= nextAuto) startLaugh(now);
    if (laughStart >= 0) {
      const elapsed = now - laughStart;
      const total = laughBeats * BEAT_MS;
      if (elapsed >= total + 250) {
        laughStart = -1;
        nextAuto = now + 2600 + Math.random() * 1500;
      } else {
        const beat = Math.floor(elapsed / BEAT_MS);
        const phase = (elapsed % BEAT_MS) / BEAT_MS;
        const envelope = Math.min(1, elapsed / 300) * Math.min(1, Math.max(0, (total + 250 - elapsed) / 350));
        if (beat < laughBeats) {
          const open = phase < 0.22 ? phase / 0.22 : 1 - (phase - 0.22) / 0.78 * 0.75;
          drop = MAX_DROP * open * envelope;
          y = -10 * (phase < 0.22 ? phase / 0.22 : 1 - (phase - 0.22) / 0.78) * envelope;
          rotation = (-5 + (beat % 2 ? 2.5 : -2.5)) * envelope;
          if (beat !== lastBeat) { lastBeat = beat; spawnHa(beat); }
          const shake = (1 - phase) * 3 * envelope;
          x = (Math.random() - 0.5) * shake;
          titleX = (Math.random() - 0.5) * shake * 1.5;
          titleY = (Math.random() - 0.5) * shake;
        }
      }
    } else y = Math.round(Math.sin(now / 500) * 1.5);
    draw(drop);
    wrap.style.transform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
    title.style.transform = `translate(${titleX}px, ${titleY}px)`;
  }

  function settle(ok) {
    if (settled) return;
    settled = true;
    win.clearTimeout(loadTimer);
    image.onload = image.onerror = title.onload = title.onerror = null;
    loaded = ok && !destroyed;
    if (loaded) {
      root.dataset.ready = 'true';
      draw(0);
      refresh();
    } else {
      stop();
      root.hidden = true;
    }
    resolveReady(loaded);
  }

  function checkLoaded() { if (faceLoaded && titleLoaded) settle(true); }
  image.onload = () => {
    try {
      face = doc.createElement('canvas');
      face.width = 240;
      face.height = FACE_H;
      const sprite = face.getContext('2d');
      if (!sprite) { settle(false); return; }
      sprite.drawImage(image, 0, 0);
      // Exact corner repairs from the supplied animation, before opening the jaw.
      sprite.drawImage(face, 72, 209, 10, 8, 84, 209, 10, 8);
      sprite.drawImage(face, 158, 209, 10, 8, 146, 209, 10, 8);
      faceLoaded = true;
      checkLoaded();
    } catch { settle(false); }
  };
  title.onload = () => { titleLoaded = true; checkLoaded(); };
  image.onerror = title.onerror = () => settle(false);

  const onInteraction = () => startLaugh(win.performance.now());
  const onAnimationEnd = (event) => { if (haTimers.has(event.target)) removeHa(event.target); };
  root.addEventListener('pointerenter', onInteraction);
  root.addEventListener('click', onInteraction);
  root.addEventListener('animationend', onAnimationEnd);
  doc.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  const observer = 'IntersectionObserver' in win ? new win.IntersectionObserver((entries) => {
    inView = entries.some((entry) => entry.isIntersecting);
    refresh();
  }) : null;
  observer?.observe(root);
  const classes = new win.MutationObserver(refresh);
  classes.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
  if (doc.body) classes.observe(doc.body, { attributes: true, attributeFilter: ['class'] });

  title.src = new URL('./assets/loading/title.png', import.meta.url).href;
  image.src = new URL('./assets/loading/face.png', import.meta.url).href;

  return {
    ready,
    play() { if (!destroyed) { userPaused = false; refresh(); } },
    pause() { if (!destroyed) { userPaused = true; stop(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settle(false);
      stop();
      win.clearTimeout(loadTimer);
      image.onload = image.onerror = title.onload = title.onerror = null;
      observer?.disconnect();
      classes.disconnect();
      doc.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
      root.removeEventListener('pointerenter', onInteraction);
      root.removeEventListener('click', onInteraction);
      root.removeEventListener('animationend', onAnimationEnd);
      root.remove();
      face = null;
    },
  };
}
