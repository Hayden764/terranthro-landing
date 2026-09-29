/* =========================================================================
 *  Local copy editor · Vite dev-server plugin (never part of the build)
 *
 *   · marks every editable text block in the served HTML with
 *     data-edit="<innerStart>-<innerEnd>", the block's character range in
 *     the source file
 *   · POST /__edit/save   writes edited blocks back into the HTML source
 *   · GET  /__edit/status reports uncommitted changes
 *   · POST /__edit/push   builds, commits and pushes (this is what makes
 *                         terranthro.com update: Vercel builds this repo)
 *
 *  The endpoints change files and push to git, so they only answer
 *  loopback connections that carry our custom header. A page on another
 *  origin can't send that header without a CORS preflight, which is refused.
 * ========================================================================= */

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

// URL path → source file. Anything not listed can't be written.
const PAGES = {
  '/':          'index.html',
  '/about/':    'about/index.html',
  '/projects/': 'projects/index.html',
};

const BLOCKS  = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'dt', 'dd']);
const INLINE  = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'code', 'span']);
const SKIP_TAG = new Set(['script', 'style', 'noscript', 'canvas', 'svg', 'button', 'summary', 'head']);
const SKIP_CLASS = /\b(visually-hidden|skip-link|plate|readout|footer-meta|theme-toggle|status-dot|nav-index|site-nav|site-mark)\b/;
// list items that only wrap a link (chips, hero links): edit the words inside, not the item
const LINK_WRAP = /\b(chip|hero-link|nav-link)\b/;

const attr = (n, name) => n.attrs?.find((a) => a.name === name)?.value ?? '';
const kids = (n) => n.childNodes ?? [];
const elems = (n) => kids(n).filter((c) => c.tagName);

/** Find editable blocks in source HTML → [{ start, end, tagEnd }] */
export function findBlocks(html) {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const found = [];

  function visit(n) {
    if (SKIP_TAG.has(n.tagName) || SKIP_CLASS.test(attr(n, 'class'))) return;
    const loc = n.sourceCodeLocation;
    const ok = loc?.startTag && loc?.endTag;

    if (ok && n.tagName && editable(n)) {
      found.push({
        start: loc.startTag.endOffset,
        end: loc.endTag.startOffset,
        tagEnd: loc.startTag.startOffset + 1 + n.tagName.length,
      });
      return;                                   // don't descend into a block
    }
    kids(n).forEach(visit);
  }

  // A block is editable when it's a text container with only inline children,
  // or a text-only span (chips, links) that sits outside any block.
  function editable(n) {
    const tag = n.tagName;
    if (BLOCKS.has(tag)) {
      if (elems(n).some((c) => LINK_WRAP.test(attr(c, 'class')))) return false;
      return !elems(n).some((c) => !INLINE.has(c.tagName));
    }
    if (tag === 'span') {
      const letters = kids(n).some((c) => c.nodeName === '#text' && /[A-Za-z]/.test(c.value));
      return letters && elems(n).length === 0 && n.sourceCodeLocation?.endTag;
    }
    return false;
  }

  visit(doc);
  return found.sort((a, b) => a.start - b.start);
}

/** Add data-edit ranges to the tags (insert from the end so offsets hold). */
function annotate(html) {
  const blocks = findBlocks(html);
  let out = html;
  for (const b of [...blocks].reverse()) {
    out = out.slice(0, b.tagEnd) + ` data-edit="${b.start}-${b.end}"` + out.slice(b.tagEnd);
  }
  return out;
}

/* ── request guard ─────────────────────────────────────────────────────── */
function guard(req, res) {
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const origin = req.headers.origin;
  const sameOrigin = !origin || new URL(origin).host === req.headers.host;
  if (loopback && sameOrigin && req.headers['x-terranthro-edit'] === '1') return true;
  res.statusCode = 403;
  res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
  return false;
}

function body(req) {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 2_000_000) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { fail(e); } });
    req.on('error', fail);
  });
}

const json = (res, code, obj) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
};

// Edited markup is written into source, so keep it to plain inline HTML.
function unsafe(html) {
  return /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|form|img|svg)\b/i.test(html)
      || /\son\w+\s*=/i.test(html)
      || /javascript:/i.test(html);
}

/** Re-wrap an edited block like the hand-wrapped source: ≈76 columns. */
function wrap(html, indent) {
  const text = html.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // split on spaces that are outside <tags>
  const words = [];
  let cur = '', inTag = false;
  for (const ch of text) {
    if (ch === '<') inTag = true;
    if (ch === '>') inTag = false;
    if (ch === ' ' && !inTag) { words.push(cur); cur = ''; } else cur += ch;
  }
  words.push(cur);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (indent.length + line.length + 1 + w.length) > 76) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

async function git(...args) {
  return run('git', args, { cwd: ROOT, maxBuffer: 10_000_000 });
}

export default function copyEditor() {
  return {
    name: 'terranthro-copy-editor',
    apply: 'serve',

    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const rel = ctx.filename ? relative(ROOT, ctx.filename) : '';
        if (!Object.values(PAGES).includes(rel)) return html;
        return {
          html: annotate(html),
          tags: [{ tag: 'script', attrs: { type: 'module', src: '/tools/editor-client.js' }, injectTo: 'body' }],
        };
      },
    },

    configureServer(server) {
      server.middlewares.use('/__edit', async (req, res) => {
        try {
          const path = req.url.split('?')[0];

          if (req.method === 'GET' && path === '/status') {
            if (!guard(req, res)) return;
            const { stdout } = await git('status', '--porcelain');
            const files = stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
            const { stdout: last } = await git('log', '-1', '--format=%h %s');
            return json(res, 200, { ok: true, files, last: last.trim() });
          }

          if (req.method === 'POST' && path === '/save') {
            if (!guard(req, res)) return;
            const { page, edits } = await body(req);
            const rel = PAGES[page];
            if (!rel || !Array.isArray(edits)) return json(res, 400, { ok: false, error: 'Bad request' });

            const file = resolve(ROOT, rel);
            let src = await readFile(file, 'utf8');
            const valid = new Map(findBlocks(src).map((b) => [`${b.start}-${b.end}`, b]));

            const todo = [];
            for (const e of edits) {
              const b = valid.get(e.range);
              if (!b || typeof e.html !== 'string') {
                return json(res, 409, { ok: false, error: 'The file changed on disk. Reload the page and try again.' });
              }
              if (unsafe(e.html)) return json(res, 400, { ok: false, error: 'That markup isn\'t allowed.' });
              todo.push({ ...b, html: e.html });
            }

            // apply from the end so earlier offsets stay valid
            todo.sort((a, b) => b.start - a.start);
            for (const t of todo) {
              const lineStart = src.lastIndexOf('\n', t.start - 1) + 1;
              const openLine = src.slice(lineStart, t.start);
              const baseIndent = openLine.match(/^\s*/)[0];
              const multiline = src.slice(t.start, t.end).includes('\n');
              const replacement = multiline
                ? `\n${wrap(t.html, baseIndent + '  ')}\n${baseIndent}`
                : t.html.replace(/\s+/g, ' ').trim();
              src = src.slice(0, t.start) + replacement + src.slice(t.end);
            }
            await writeFile(file, src);
            return json(res, 200, { ok: true, saved: todo.length });
          }

          if (req.method === 'POST' && path === '/push') {
            if (!guard(req, res)) return;
            const { message } = await body(req);
            const msg = String(message || '').trim().slice(0, 200) || 'Update site copy';
            const log = [];

            await git('fetch', 'origin', 'main');
            const { stdout: st } = await git('status', '--porcelain');
            const { stdout: ahead0 } = await git('rev-list', '--count', 'origin/main..HEAD');
            if (!st.trim() && Number(ahead0) === 0) {
              return json(res, 200, { ok: true, log: ['Nothing to push: no changes.'] });
            }

            if (st.trim()) {
              // Never push something that doesn't build.
              await run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: ROOT, maxBuffer: 10_000_000 });
              log.push('Build passed.');
              await git('add', '-A');
              await git('commit', '-m', msg);
              log.push(`Committed: ${msg}`);
            } else {
              log.push('No new edits; pushing earlier commit(s) that never went out.');
            }

            const { stdout: behind } = await git('rev-list', '--count', 'HEAD..origin/main');
            if (Number(behind) > 0) {
              try {
                await git('rebase', 'origin/main');
              } catch (e) {
                await git('rebase', '--abort').catch(() => {});
                throw new Error(`origin/main has ${behind} newer commit(s) that conflict with your edits. Nothing was pushed; your edits are committed locally.`);
              }
              log.push(`Rebased onto ${behind} newer commit(s).`);
            }
            await git('push', 'origin', 'HEAD:main');
            log.push('Pushed to main. Vercel is publishing; terranthro.com updates in about a minute.');
            return json(res, 200, { ok: true, log });
          }

          json(res, 404, { ok: false, error: 'Not found' });
        } catch (err) {
          const detail = (err.stderr || err.message || String(err)).toString().split('\n').slice(-6).join('\n');
          json(res, 500, { ok: false, error: detail.trim() });
        }
      });
    },
  };
}
