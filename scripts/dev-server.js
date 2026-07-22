#!/usr/bin/env node
// dev-server.js — a local TESTING harness (not used in production; the live site
// is the plain static docs/). It serves docs/ and injects a floating "DEV state"
// dropdown so you can flip the site through every conduct / lockdown state
// without editing any data.
//
//   • Only GET /data/manifest.json is overridden — per a cookie the dropdown sets.
//     Every encrypted asset (images, vocab) stays REAL, so unlock with the REAL
//     password and everything decrypts.
//   • The injected script blocks all api.github.com traffic in the page, so nothing
//     you click can write to the real repo — reads fall back to the local override.
//
// Run:  node scripts/dev-server.js [port]      (default 4174)
//   or: preview the ".claude/launch.json" config named "dev".

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const MANIFEST = join(DOCS, 'data', 'manifest.json');
const PORT = Number(process.argv[2]) || 4174;

const iso = (days = 0) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString(); };
const day = (days = 0) => iso(days).slice(0, 10);

// Small lines + a short quiz everywhere, so the rituals are quick to test.
const LINES = { text: 'Ich übe jeden Tag.', translation: 'I practice every day.', times: 2 };
const fakeEnc = { v: 1, salt: 'x', iv: 'y', ct: 'z' };          // a filed-but-opaque envelope
const disc = (attempt) => ({ active: true, issuedAt: iso(), reason: 'Testing the no-practice lockdown.', lines: LINES, quiz: { count: 4, passPct: 70 }, attempt, retryAfter: null });
const conduct = (score) => ({ score, updatedAt: iso(), log: [] });

// Each state is an override applied to a fresh copy of the real manifest.
const STATES = {
  'real (untouched)': null,
  'black — normal (74)': (m) => { m.conduct = conduct(74); delete m.discipline; },
  'silver (88)': (m) => { m.conduct = conduct(88); delete m.discipline; },
  'gold (97)': (m) => { m.conduct = conduct(97); delete m.discipline; },
  'cone (62) — Schande banner': (m) => { m.conduct = conduct(62); delete m.discipline; },
  'Betragen lock — lines': (m) => { m.conduct = { ...conduct(54), lock: { active: true, since: iso(), lines: LINES, lineDays: [], apologies: [] } }; delete m.discipline; },
  'Betragen lock — apology': (m) => { m.conduct = { ...conduct(54), lock: { active: true, since: iso(), lines: LINES, lineDays: [day(-2), day(-1)], apologies: [] } }; delete m.discipline; },
  'Betragen lock — submitted': (m) => { m.conduct = { ...conduct(54), lock: { active: true, since: iso(), lines: LINES, lineDays: [day(-2), day(-1)], apologies: [{ date: day(), enc: fakeEnc }] } }; delete m.discipline; },
  'Discipline — lines': (m) => { m.conduct = conduct(74); m.discipline = disc(null); },
  'Discipline — apology': (m) => { m.conduct = conduct(74); m.discipline = disc({ linesDoneAt: iso() }); },
  'Discipline — quiz': (m) => { m.conduct = conduct(74); m.discipline = disc({ linesDoneAt: iso(), apology: fakeEnc }); },
  'Discipline — cooldown': (m) => { m.conduct = conduct(74); m.discipline = { ...disc(null), retryAfter: iso(2) }; },
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.enc': 'application/json', '.woff2': 'font/woff2' };

const cookieOf = (req, name) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
};

function manifestFor(state) {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const fn = STATES[state];
  if (fn) fn(m);
  return JSON.stringify(m, null, 2);
}

// The floating dropdown + the github blocker, injected into every page as an
// early classic script (runs before the app's deferred modules).
function injection(current) {
  return `<script>(function(){
  var of=window.fetch;
  window.fetch=function(u){try{var s=(typeof u==='string')?u:(u&&u.url)||'';if(s.indexOf('api.github.com')>=0)return Promise.reject(new Error('dev: github blocked'));}catch(e){}return of.apply(this,arguments);};
  var STATES=${JSON.stringify(Object.keys(STATES))},cur=${JSON.stringify(current)};
  addEventListener('DOMContentLoaded',function(){
    var b=document.createElement('div');
    b.style.cssText='position:fixed;z-index:99999;bottom:10px;left:10px;background:#111;color:#eee;font:12px/1.4 system-ui,sans-serif;padding:6px 9px;border:1px solid #555;border-radius:6px;opacity:.92;box-shadow:0 2px 10px rgba(0,0,0,.5)';
    var s=document.createElement('select');
    s.style.cssText='margin-left:6px;background:#222;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 4px;font:12px system-ui';
    STATES.forEach(function(n){var o=document.createElement('option');o.value=o.textContent=n;if(n===cur)o.selected=true;s.appendChild(o);});
    s.onchange=function(){document.cookie='gl_dev_state='+encodeURIComponent(s.value)+';path=/;max-age=86400';location.reload();};
    b.appendChild(document.createTextNode('🔧 DEV state:'));b.appendChild(s);document.body.appendChild(b);
  });
})();</script>`;
}

createServer(async (req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';

  // The one override: the manifest, per the chosen state.
  if (pathname === '/data/manifest.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(manifestFor(cookieOf(req, 'gl_dev_state') || 'real (untouched)'));
    return;
  }

  // Everything else: static from docs/, with the dropdown injected into HTML.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(DOCS, safe);
  if (!file.startsWith(DOCS)) { res.writeHead(403); res.end('forbidden'); return; }
  try {
    const buf = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    if (type === 'text/html') {
      const state = cookieOf(req, 'gl_dev_state') || 'real (untouched)';
      let html = buf.toString('utf8');
      html = html.includes('</head>') ? html.replace('</head>', injection(state) + '</head>') : injection(state) + html;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } else {
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    }
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`dev harness on http://localhost:${PORT}  — unlock with the real password; use the "DEV state" dropdown (bottom-left) to switch states.`);
  console.log(`states: ${Object.keys(STATES).join(' · ')}`);
});
