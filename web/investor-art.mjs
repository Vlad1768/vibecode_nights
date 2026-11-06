// The supplied character portraits are decoration, not a character selector.
// Conversation/persona/scoring remain entirely owned by the shared API.
const portraits = ['burgundy-investor', 'corporate-investor', 'green-coat-investor'];

export function mountInvestorArt() {
  if (typeof document === 'undefined') return;
  const hero = document.querySelector('.hero');
  if (!hero || hero.querySelector('.investor-art-stage')) return;
  const stage = document.createElement('div');
  stage.className = 'investor-art-stage';
  stage.setAttribute('aria-hidden', 'true');
  for (const [index, name] of portraits.entries()) {
    const figure = document.createElement('div');
    figure.className = `investor-art__figure investor-art__figure--${index + 1}`;
    const image = document.createElement('img');
    image.src = new URL(`./assets/investors/${name}.jpg`, import.meta.url).href;
    image.alt = '';
    image.width = 1024;
    image.height = 1024;
    image.decoding = 'async';
    image.draggable = false;
    figure.append(image);
    stage.append(figure);
  }
  hero.append(stage);
  hero.classList.add('has-investor-art');

  // Pause offscreen and in background tabs; the existing motion control and
  // reduced-motion preference are handled directly by the CSS below.
  let inView = true;
  const syncVisibility = () => stage.classList.toggle('investor-art--idle', document.hidden || !inView);
  const abort = new AbortController();
  document.addEventListener('visibilitychange', syncVisibility, { signal: abort.signal });
  let observer;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncVisibility();
    }, { threshold: 0 });
    observer.observe(hero);
  }
  syncVisibility();
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    abort.abort();
    observer?.disconnect();
  }, { once: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountInvestorArt, { once: true });
  else mountInvestorArt();
}
