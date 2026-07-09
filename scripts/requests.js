#!/usr/bin/env node
// requests.js — Frau Richter's desk for Anträge (formal written requests from
// the site). She holds lecture Monday and Wednesday 10:00–12:00; everything
// outside those hours arrives here, in writing, politely — and she rules on
// each at the start of a session.
//
// Usage:
//   node scripts/requests.js --list                       # decrypt + show pending (and recent ruled)
//   node scripts/requests.js --respond <id> --grant  --note "one Richter sentence" [--push]
//   node scripts/requests.js --respond <id> --decline --note "one Richter sentence" [--push]
//
// The ruling note is PLAINTEXT in the manifest (public repo): category-level,
// in her register, no personal details. Tone of the request counts toward
// Betragen — a demand dressed as a request earns a conduct.js --adjust.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.requests ||= [];

if (args.includes('--list') || !args.length) {
  if (!manifest.requests.length) { console.log('No requests on file.'); process.exit(0); }
  const password = await promptPassword('Password: ');
  for (const r of manifest.requests.slice(-10)) {
    let text;
    try { text = decryptString(password, r.enc); } catch { text = '(cannot decrypt)'; }
    console.log(`\n[${r.id}] ${r.date.slice(0, 16)} — ${r.status.toUpperCase()}${r.response ? ` — "${r.response}"` : ''}`);
    console.log(`  „${text}“`);
  }
  console.log('\nRule on one: node scripts/requests.js --respond <id> --grant|--decline --note "…" [--push]');
  process.exit(0);
}

const id = opt('--respond');
if (!id) { console.error('Usage: --list | --respond <id> --grant|--decline --note "…"'); process.exit(1); }
const r = manifest.requests.find((x) => x.id === id);
if (!r) { console.error(`No request ${id}.`); process.exit(1); }
const grant = args.includes('--grant');
const decline = args.includes('--decline');
if (grant === decline) { console.error('Exactly one of --grant / --decline.'); process.exit(1); }
const note = opt('--note');
if (!note) { console.error('A ruling carries a sentence — --note "…" (plaintext, category-level).'); process.exit(1); }
if (note.length > 200) { console.error('One sentence, not a lecture. ≤200 characters.'); process.exit(1); }

r.status = grant ? 'granted' : 'declined';
r.response = note;
r.respondedAt = new Date().toISOString();
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`${id} ${r.status}: "${note}"`);

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "antrag ${id}: ${r.status}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
