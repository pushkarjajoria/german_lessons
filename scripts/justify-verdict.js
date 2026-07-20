#!/usr/bin/env node
// justify-verdict.js — send her judgement of a `justify: true` answer back to
// the learner (FR-004... FR-005). SCHEMA §3.3 already told her to grade the
// reasoning subjectively "in her read of the report" — and there the verdict
// used to stop. He typed a reason, the app said "Richtig", and the one thing
// she actually wanted to correct (a right answer for the wrong reason) never
// reached him — only her private notes, and weeks later, a lesson paragraph.
//
// The verdict is a plaintext aggregate in the manifest (manifest.justifyVerdicts,
// same policy as history/teacherNote — category-level judgement, not raw
// content), keyed by report id + question id. It does NOT touch the encrypted
// report file itself — that stays exactly as the learner submitted it, and the
// verdict is looked up alongside it, not written into it.
//
// Usage:
//   node scripts/justify-verdict.js --report 0006 --qid q2 \
//        --verdict sound|pattern-matching --note "one line" [--push]
//   node scripts/justify-verdict.js --list [--report NNNN]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const VALID_VERDICTS = new Set(['sound', 'pattern-matching']);

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.justifyVerdicts ||= {};

if (args.includes('--list')) {
  const only = opt('--report');
  const entries = only ? { [only]: manifest.justifyVerdicts[only] } : manifest.justifyVerdicts;
  let any = false;
  for (const [reportId, byQid] of Object.entries(entries)) {
    if (!byQid) continue;
    for (const [qid, v] of Object.entries(byQid)) {
      any = true;
      console.log(`[${reportId}:${qid}] ${v.verdict} — "${v.note}" (${v.date.slice(0, 10)})`);
    }
  }
  if (!any) console.log('No verdicts recorded.');
  process.exit(0);
}

const reportId = opt('--report');
const qid = opt('--qid');
const verdict = opt('--verdict');
const note = opt('--note');

if (!reportId || !qid || !verdict || !note) {
  console.error('Usage: --report NNNN --qid qN --verdict sound|pattern-matching --note "…" [--push]');
  console.error('       --list [--report NNNN]');
  process.exit(1);
}
if (!VALID_VERDICTS.has(verdict)) {
  console.error(`--verdict must be one of: ${[...VALID_VERDICTS].join(', ')}`);
  process.exit(1);
}
if (note.length > 200) { console.error('One line, not a lecture. ≤200 characters.'); process.exit(1); }

// Confirm this actually was a justify: true question that he answered — so a
// typo'd --qid doesn't silently create a verdict for nothing.
const reportPath = join(ROOT, 'docs', 'data', 'reports', `report-${reportId}.json.enc`);
if (!existsSync(reportPath)) { console.error(`No report file for ${reportId}.`); process.exit(1); }
const password = await promptPassword('Password: ');
let report;
try {
  report = JSON.parse(decryptString(password, JSON.parse(readFileSync(reportPath, 'utf8'))));
} catch {
  console.error('Wrong password, or the report will not decrypt.');
  process.exit(1);
}
const pq = (report.perQuestion || []).find((p) => p.qid === qid);
if (!pq) { console.error(`No question ${qid} in report ${reportId}.`); process.exit(1); }
if (pq.justification === undefined) {
  console.error(`Question ${qid} was not flagged justify:true in this report (no justification field) — refusing.`);
  process.exit(1);
}
if (!pq.justification) {
  console.warn(`Note: ${qid} has no justification text recorded (he left it blank or it wasn't captured) — filing the verdict anyway.`);
}

manifest.justifyVerdicts[reportId] ||= {};
manifest.justifyVerdicts[reportId][qid] = { verdict, note, date: new Date().toISOString() };
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`Verdict filed: [${reportId}:${qid}] ${verdict} — "${note}"`);
console.log(`His answer: "${pq.given}" · his reasoning: "${pq.justification || '(none given)'}"`);

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "justify-verdict: ${reportId}:${qid} ${verdict}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
