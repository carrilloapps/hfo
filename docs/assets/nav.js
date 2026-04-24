/*
 * Minimal nav-toggle + one-shot copy-button handler for hfo sub-pages.
 * Shared across /install, /cli, /keyboard, /privacy, /faq, /benchmarks.
 *
 * Nav toggle
 *   • Mobile-only (desktop hides .nav-toggle via CSS).
 *   • Uses a proper <button> so no ghost form controls render on desktop.
 *   • Flips aria-expanded and toggles .is-open on the <nav>.
 *   • Closes on outside-click and Escape.
 *
 * Copy buttons
 *   • Any element with [data-copy] inside the page copies its attribute
 *     to the clipboard on click and flashes "copied" for 1.2 s. Works
 *     for the legacy .terminal-copy button and the new <hfo-terminal>.
 */

(function wireNav() {
  const btn = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!btn || !nav) return;

  const close = () => {
    btn.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  };
  const open = () => {
    btn.setAttribute('aria-expanded', 'true');
    nav.classList.add('is-open');
  };

  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    isOpen ? close() : open();
  });
  document.addEventListener('click', (e) => {
    if (btn.contains(e.target) || nav.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();

(function wireCopy() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      const prev = btn.textContent;
      const prevColor = btn.style.color;
      btn.textContent = 'copied';
      btn.style.color = 'var(--success)';
      setTimeout(() => { btn.textContent = prev; btn.style.color = prevColor; }, 1200);
    });
  });
})();
