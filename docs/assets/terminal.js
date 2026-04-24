/*
 * <hfo-terminal> — a single shared Web Component that renders the
 * terminal-styled code block used across every page on hfo.carrillo.app
 * (except the hero, which has its own one-of-a-kind markup).
 *
 * Author writes:
 *   <hfo-terminal title="bash" copy="npm i -g hfo-cli">
 *   <span class="tok-prompt">$</span> <span class="tok-cmd">npm</span> i -g hfo-cli
 *   </hfo-terminal>
 *
 * The element upgrades on connect to the full .terminal structure:
 *   <div class="terminal">
 *     <div class="terminal-bar">…red/yellow/green dots, title, optional copy…</div>
 *     <pre><code>…content…</code></pre>
 *   </div>
 *
 * Rules:
 *   • `title` is plain text, HTML-escaped before insertion.
 *   • `copy` (optional) adds a copy button with data-copy; the copy
 *     handler lives in nav.js so both legacy `.terminal-copy` buttons
 *     and the ones inside this component share one listener.
 *   • The inner HTML is preserved verbatim (including tok-* spans).
 *   • Leading/trailing newlines inside the element are trimmed so the
 *     rendered <pre> doesn't start with a blank line.
 *   • Double-connection is guarded via [data-hydrated].
 */

class HfoTerminal extends HTMLElement {
  connectedCallback() {
    if (this.dataset.hydrated === 'true') return;
    this.dataset.hydrated = 'true';

    const title = this.getAttribute('title') || '';
    const copy  = this.getAttribute('copy');

    const content = this.innerHTML
      .replace(/^[ \t]*\r?\n+/, '')   // drop leading newlines + their indent
      .replace(/\r?\n[ \t]*$/, '');   // drop trailing newlines + their indent

    const copyBtn = copy
      ? `<button type="button" class="terminal-copy" data-copy="${escapeAttr(copy)}" aria-label="Copy command">copy</button>`
      : '';

    this.innerHTML =
      '<div class="terminal">' +
        '<div class="terminal-bar">' +
          '<span class="terminal-dot red"    aria-hidden="true"></span>' +
          '<span class="terminal-dot yellow" aria-hidden="true"></span>' +
          '<span class="terminal-dot green"  aria-hidden="true"></span>' +
          '<span class="terminal-title">' + escapeText(title) + '</span>' +
          copyBtn +
        '</div>' +
        '<pre><code>' + content + '</code></pre>' +
      '</div>';
  }
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/&/g, '&amp;');
}

customElements.define('hfo-terminal', HfoTerminal);
