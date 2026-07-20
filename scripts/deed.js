#!/usr/bin/env node
// deed.js — Frau Richter's real-world spoken tasks, as first-class objects
// (FR-004). Before this, a deed's entire state lived in her private,
// gitignored ledger — invisible to the learner, and to the dashboard. A
// supermarket task sat unreported for seven days across three lessons before
// she learned (via a Bericht) that it had been deliberately declined.
//
// No proof, no upload, no recording — verification stays exactly what it
// always was, self-report. The only change is that it is now VISIBLE: a
// standing panel on the dashboard, closed by the learner with one of three
// buttons (done / not yet / declining) and a one-line note.
//
// Usage:
//   node scripts/deed.js --add "Ask 'Entschuldigung, wo finde ich ___?'" --due 0007 [--push]
//   node scripts/deed.js --list                    # full history, decrypts closing notes

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
manifest.deeds ||= [];

const STATUS_LABEL = { open: 'OPEN', done: 'DONE', not_yet: 'NOT YET', declined: 'DECLINED' };

if (args.includes('--list')) {
  if (!manifest.deeds.length) { console.log('No deeds on file.'); process.exit(0); }
  const needsPassword = manifest.deeds.some((d) => d.noteEnc);
  const password = needsPassword ? await promptPassword('Password (to read closing notes): ') : null;
  for (const d of manifest.deeds) {
    console.log(`\n[${d.id}] ${STATUS_LABEL[d.status]} — assigned ${d.assignedAt.slice(0, 10)}${d.due ? `, due ${d.due}` : ''}`);
    console.log(`  ${d.text}`);
    if (d.noteEnc) {
      let note;
      try { note = decryptString(password, d.noteEnc); } catch { note = '(cannot decrypt)'; }
      console.log(`  → closed ${d.closedAt.slice(0, 10)}: "${note}"`);
    }
  }
  process.exit(0);
}

const text = opt('--add');
if (!text) { console.error('Usage: --add "text" [--due NNNN] [--push] | --list'); process.exit(1); }

manifest.deeds.push({
  id: `d${Date.now()}`,
  text,
  assignedAt: new Date().toISOString(),
  due: opt('--due') || null,
  status: 'open',
  closedAt: null,
  noteEnc: null,
});
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`Deed assigned. Open on the dashboard: "${text}"`);

const gitCmds = ['git add docs/data/manifest.json', 'git commit -m "deed: assigned"', 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
