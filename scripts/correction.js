#!/usr/bin/env node
// correction.js — the counterpart to conduct.js's docking, for the other
// direction (FR-007). Twice her dashboard note stated something false about
// his conduct — "Berichte: still four" when all four had been filed the day
// before — and it sat there for days as the standing public judgement of
// him, correctable only by silently overwriting the note. The system could
// dock him in one command and had no equivalent for admitting it got him
// wrong. For an instrument whose authority rests on being exact, that
// asymmetry ran the wrong way.
//
// A correction notice posts where the wrong claim sat — the dashboard notes
// panel, not a Nachricht he has to go open — styled plainly, not in the red
// of a discipline panel. Plaintext, like teacherNote: category-level, in her
// register, nothing personal. Never deleted — the drawer keeps its history,
// same policy as everywhere else; the dashboard shows the most recent few.
//
// Usage:
//   node scripts/correction.js --text "…" [--push]
//   node scripts/correction.js --list

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.correctionNotices ||= [];

if (args.includes('--list')) {
  if (!manifest.correctionNotices.length) { console.log('No correction notices on file.'); process.exit(0); }
  for (const c of manifest.correctionNotices) {
    console.log(`[${c.id}] ${c.date.slice(0, 10)}: ${c.text}`);
  }
  process.exit(0);
}

const text = opt('--text');
if (!text) { console.error('Usage: --text "…" [--push] | --list'); process.exit(1); }
if (text.length > 300) { console.error('One correction, not a chapter. ≤300 characters.'); process.exit(1); }

manifest.correctionNotices.push({ id: `c${Date.now()}`, date: new Date().toISOString(), text });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`Correction posted: "${text}"`);
console.log('It sits on the dashboard next to the teacher note, plainly, not in discipline red.');

const gitCmds = ['git add docs/data/manifest.json', 'git commit -m "correction: notice posted"', 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
