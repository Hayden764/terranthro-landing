/* =========================================================================
 *  Local copy editor · in-page toolbar (dev server only)
 *
 *  Click any text on the page to edit it in place. Save writes the edits
 *  into the HTML source files. Push live builds, commits and pushes.
 *  See tools/editor-plugin.js for the server side.
 * ========================================================================= */

const API = '/__edit';
const HEADERS = { 'Content-Type': 'application/json', 'X-Terranthro-Edit': '1' };
const STORE = 'terranthro-edit-mode';

const blocks = [...document.querySelectorAll('[data-edit]')];
const original = new Map();

/** Markup of a block as it should be saved: no stray <br>, nbsp or spacing. */
function clean(el) {
  return el.innerHTML
    .replace(/<br\s*\/?>\s*$/i, '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
blocks.forEach((el) => original.set(el, clean(el)));

const dirty = () => blocks.filter((el) => clean(el) !== original.get(el));

/* ── page styling while editing ── */
const css = document.createElement('style');
css.textContent = `
  html.edit-mode [data-edit] {
    pointer-events: auto !important;
    cursor: text;
    outline: 1px dashed var(--color-muted, #6b7185);
    outline-offset: 3px;
    border-radius: 2px;
  }
  html.edit-mode [data-edit]:hover { outline-color: var(--color-electric-blue, #2e9bff); }
  html.edit-mode [data-edit]:focus { outline: 1px solid var(--color-electric-blue, #2e9bff); }
  html.edit-mode [data-edit].is-dirty { outline: 1px solid var(--color-amber, #c87d4a); }
`;
document.head.appendChild(css);

/* ── toolbar (shadow DOM keeps it clear of the site's own CSS) ── */
const host = document.createElement('div');
host.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;width:max-content;max-width:calc(100vw - 24px)';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
  <style>
    :host { all: initial; }
    .bar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 10px;
      background: rgb(var(--ink-rgb, 8 10 15) / .94); color: var(--color-parchment, #e8e2d6);
      border:1px solid var(--color-parchment, #e8e2d6); font:12px/1.2 ui-monospace, 'SF Mono', Menlo, monospace;
      letter-spacing:.06em; backdrop-filter: blur(6px); }
    button, input { font: inherit; letter-spacing: inherit; color: inherit; }
    button { background:none; border:1px solid var(--color-muted, #6b7185); border-radius:999px;
      padding:7px 14px; cursor:pointer; text-transform:uppercase; }
    button:hover:not(:disabled) { border-color: var(--color-electric-blue, #2e9bff); color: var(--color-electric-blue, #2e9bff); }
    button:disabled { opacity:.4; cursor:default; }
    button.on { border-color: var(--color-parchment, #e8e2d6); }
    button.primary { border-color: var(--color-electric-blue, #2e9bff); color: var(--color-electric-blue, #2e9bff); }
    input { width:210px; padding:7px 10px; background:transparent; border:1px solid var(--color-muted, #6b7185); border-radius:2px; }
    input::placeholder { color: var(--color-muted, #6b7185); }
    .sep { width:1px; align-self:stretch; background: var(--color-muted, #6b7185); opacity:.5; }
    .msg { flex-basis:100%; white-space:pre-wrap; color: var(--color-muted-text, #8a90a3); max-width:560px; }
    .msg.err { color: var(--color-crimson, #e03040); }
    .msg:empty { display:none; }
  </style>
  <div class="bar" role="toolbar" aria-label="Copy editor">
    <button id="toggle" type="button">Edit text</button>
    <button id="save" type="button" class="primary" disabled>Save</button>
    <span class="sep"></span>
    <input id="note" type="text" placeholder="Commit message" aria-label="Commit message" maxlength="200">
    <button id="push" type="button">Push live</button>
    <div class="msg" id="msg" role="status"></div>
  </div>`;
document.body.appendChild(host);

const $ = (id) => root.getElementById(id);
const toggle = $('toggle'), saveBtn = $('save'), pushBtn = $('push'), note = $('note'), msg = $('msg');

function say(text, isErr = false) {
  msg.textContent = text;
  msg.classList.toggle('err', isErr);
}

async function api(path, options = {}) {
  const res = await fetch(API + path, { headers: HEADERS, ...options });
  const data = await res.json().catch(() => ({ ok: false, error: `Server said ${res.status}` }));
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* ── edit mode ── */
const detailsState = new Map();
let editing = false;

function setEditing(on) {
  editing = on;
  document.documentElement.classList.toggle('edit-mode', on);
  toggle.classList.toggle('on', on);
  toggle.textContent = on ? 'Editing: on' : 'Edit text';
  blocks.forEach((el) => { if (on) el.setAttribute('contenteditable', 'true'); else el.removeAttribute('contenteditable'); });
  // Collapsed sections hide their text, so open them while editing.
  document.querySelectorAll('details').forEach((d) => {
    if (on) { detailsState.set(d, d.open); d.open = true; }
    else if (detailsState.has(d)) d.open = detailsState.get(d);
  });
  try { sessionStorage.setItem(STORE, on ? '1' : '0'); } catch { /* fine */ }
}

toggle.addEventListener('click', () => setEditing(!editing));

/* ── per-block behaviour ── */
function refresh() {
  const n = dirty().length;
  saveBtn.disabled = n === 0;
  saveBtn.textContent = n ? `Save (${n})` : 'Save';
}

blocks.forEach((el) => {
  el.addEventListener('input', () => {
    el.classList.toggle('is-dirty', clean(el) !== original.get(el));
    refresh();
  });
  // one block = one paragraph: Enter finishes the edit instead of adding lines
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
  });
  // paste as plain text so no foreign styling lands in the source
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
});

// links inside editable text shouldn't navigate while you click into them
document.addEventListener('click', (e) => {
  if (editing && e.target.closest?.('[data-edit]')) e.preventDefault();
}, true);

/* ── save ── */
async function save() {
  const changed = dirty();
  if (!changed.length) return true;
  saveBtn.disabled = true;
  say('Saving…');
  try {
    const data = await api('/save', {
      method: 'POST',
      body: JSON.stringify({
        page: location.pathname,
        edits: changed.map((el) => ({ range: el.dataset.edit, html: clean(el) })),
      }),
    });
    say(`Saved ${data.saved} change${data.saved === 1 ? '' : 's'}.`);
    changed.forEach((el) => original.set(el, clean(el)));
    changed.forEach((el) => el.classList.remove('is-dirty'));
    refresh();
    // source offsets moved, so reload to pick up fresh ranges
    setTimeout(() => location.reload(), 500);
    return true;
  } catch (err) {
    say(err.message, true);
    refresh();
    return false;
  }
}
saveBtn.addEventListener('click', save);

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty().length) { e.preventDefault(); e.returnValue = ''; }
});

/* ── push live ── */
pushBtn.addEventListener('click', async () => {
  if (dirty().length) { say('You have unsaved edits. Save first, then push.', true); return; }
  const text = note.value.trim() || 'Update site copy';
  if (!confirm(`Push to terranthro.com?\n\nCommit message: "${text}"\n\nThis builds the site, commits everything that changed, and pushes to main.`)) return;
  pushBtn.disabled = true;
  say('Building, committing and pushing… this takes a minute.');
  try {
    const data = await api('/push', { method: 'POST', body: JSON.stringify({ message: text }) });
    say(data.log.join('\n'));
    note.value = '';
  } catch (err) {
    say(err.message, true);
  } finally {
    pushBtn.disabled = false;
  }
});

/* ── status on load ── */
api('/status').then((s) => {
  if (s.files.length) say(`${s.files.length} file${s.files.length === 1 ? '' : 's'} changed since the last push (${s.files.join(', ')}).`);
  else say(`Up to date. Last commit: ${s.last}`);
}).catch(() => {});

let startOn = true;
try { startOn = sessionStorage.getItem(STORE) !== '0'; } catch { /* default on */ }
setEditing(startOn);
