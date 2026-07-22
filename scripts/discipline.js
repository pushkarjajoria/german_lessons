#!/usr/bin/env node
// discipline.js — halt or reopen the course with the Nachweis (no-practice)
// lockdown. This is the persona's §4 Tier 3/4 consequence for long silence or
// consistent complacency, issued entirely at Frau Richter's discretion. While
// active, the site closes to the Lessons page alone and the dashboard runs a
// single-session ritual the learner must complete to reopen the course:
//
//   1. write her line, typed, N times
//   2. a typed explanation/apology (English or German) — why practice lapsed
//      and why it will not happen again
//   3. a short recall quiz drawn from the vocabulary bank. PASS reopens the
//      course automatically; a FAIL bars the ritual for two days, then resets it.
//
// The no-entry image (docs/data/img/no-entry.enc) stays until the quiz is passed.
//
// Usage:
//   node scripts/discipline.js --issue --reason "…" \
//        --line "Ich übe jeden Tag, ohne Ausnahme." [--translation "I practice every day…"] \
//        [--times 15] [--quiz-count 6] [--pass 70] [--push]
//   node scripts/discipline.js --status
//   node scripts/discipline.js --clear [--push]
//
// The learner clears the block by passing the quiz — you do NOT need to --clear
// for that; --clear is the manual override (lift it early, or after a real-world
// conversation). NOTE: reason/line live in the PLAINTEXT manifest of a public
// repo — category-level wording only, no quoted answers or personal details.

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

const fmtAttempt = (a) => {
  if (!a) return 'not started';
  const bits = [];
  bits.push(a.linesDoneAt ? `lines ✓ (${a.linesDoneAt.slice(0, 10)})` : 'lines pending');
  bits.push(a.apology ? 'apology ✓ (filed, encrypted)' : 'apology pending');
  bits.push(a.quiz ? `quiz ${a.quiz.score}/${a.quiz.total} — ${a.quiz.passed ? 'PASSED' : 'failed'}` : 'quiz pending');
  return bits.join(' · ');
};

if (args.includes('--status')) {
  const d = manifest.discipline;
  if (!d || !d.active) { console.log('Course open. No discipline block active.'); process.exit(0); }
  const l = d.lines || {};
  console.log(`HALTED since ${d.issuedAt} — ${d.reason}`);
  console.log(`  line: „${l.text || '(default)'}“ ×${l.times || 15}${l.translation ? ` — “${l.translation}”` : ''}`);
  console.log(`  quiz: ${(d.quiz?.count) || 6} vocab items · pass ${(d.quiz?.passPct) || 70}%`);
  console.log(`  progress: ${fmtAttempt(d.attempt)}`);
  if (d.retryAfter) console.log(`  BARRED after a failed quiz — ritual resets and reopens on ${d.retryAfter.slice(0, 10)}`);
  console.log(`  (the learner clears this by passing the quiz — no --clear needed for that)`);
  process.exit(0);
}

let commitMsg;
if (args.includes('--clear')) {
  if (!manifest.discipline?.active) { console.log('Nothing to clear — course is already open.'); process.exit(0); }
  manifest.discipline = {
    active: false,
    clearedAt: new Date().toISOString(),
    previous: { issuedAt: manifest.discipline.issuedAt, reason: manifest.discipline.reason },
  };
  commitMsg = 'discipline: cleared — course reopened';
  console.log('Cleared. The course is open again.');
} else if (args.includes('--issue')) {
  const reason = opt('--reason');
  const line = opt('--line');
  if (!reason || !line || !line.trim()) {
    console.error('Usage: node scripts/discipline.js --issue --reason "…" --line "Ich übe jeden Tag…" [--translation "…"] [--times 15] [--quiz-count 6] [--pass 70] [--push]');
    process.exit(1);
  }
  const times = opt('--times') ? Number(opt('--times')) : 15;
  const translation = opt('--translation');
  const count = opt('--quiz-count') ? Number(opt('--quiz-count')) : 6;
  const passPct = opt('--pass') ? Number(opt('--pass')) : 70;
  if (!Number.isInteger(times) || times < 1) { console.error('--times needs a whole number ≥ 1.'); process.exit(1); }
  if (!Number.isInteger(count) || count < 1) { console.error('--quiz-count needs a whole number ≥ 1.'); process.exit(1); }
  if (!(passPct >= 1 && passPct <= 100)) { console.error('--pass needs a percentage 1–100.'); process.exit(1); }
  manifest.discipline = {
    active: true,
    issuedAt: new Date().toISOString(),
    reason,
    lines: { text: line.trim(), times, ...(translation && translation.trim() ? { translation: translation.trim() } : {}) },
    quiz: { count, passPct },
    attempt: null,
    retryAfter: null,
  };
  commitMsg = 'discipline: course halted (no-practice lockdown)';
  console.log(`Issued. Course closed to the Lessons page alone.`);
  console.log(`  line „${line.trim()}“ ×${times}${translation && translation.trim() ? ` — “${translation.trim()}”` : ' (no translation — add --translation "…")'}`);
  console.log(`  then a typed apology, then a ${count}-item vocab quiz at ${passPct}% to pass. Passing reopens the course.`);
} else {
  console.error('Usage: --issue … | --clear | --status   (see file header)');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "${commitMsg}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
