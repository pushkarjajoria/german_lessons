#!/usr/bin/env node
// read-test.js — decrypt a test and its result side by side so Frau Richter can
// grade it: objective answers with silent auto-grades, subjective answers in
// full, plus timing/blur/replay markers.
//
// Usage: node scripts/read-test.js [--id NNNN | --latest] [--json]
//        (default: latest test that has a result; password from .env or prompt)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = join(ROOT, 'docs', 'data', 'tests');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const idIdx = args.indexOf('--id');
const wantedId = idIdx >= 0 ? args[idIdx + 1] : null;

let resultFiles;
try {
  resultFiles = readdirSync(TESTS).filter((f) => /^test-result-\d+\.json\.enc$/.test(f)).sort();
} catch {
  resultFiles = [];
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const entryFor = (id) => (manifest.tests || []).find((t) => t.id === id);

let id = wantedId;
if (!id) {
  if (!resultFiles.length) {
    console.error('No test results in docs/data/tests/. Pending tests:');
    for (const t of manifest.tests || []) {
      if (t.status === 'pending') console.error(`  - ${t.id} "${t.title}" · due ${t.deadline}`);
    }
    process.exit(2);
  }
  id = resultFiles[resultFiles.length - 1].match(/test-result-(\d+)/)[1];
}

const password = await promptPassword('Password: ');
const dec = (file) => JSON.parse(decryptString(password, JSON.parse(readFileSync(join(TESTS, file), 'utf8'))));

let test = null;
let result = null;
try { test = dec(`test-${id}.json.enc`); } catch { /* may not exist or wrong pw — checked below */ }
try { result = dec(`test-result-${id}.json.enc`); } catch { /* no result yet */ }

if (!test && !result) {
  console.error(`Nothing decryptable for test ${id} — wrong password, or no such test.`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify({ entry: entryFor(id), test, result }, null, 2));
  process.exit(0);
}

const entry = entryFor(id) || {};
console.log(`# Test ${id} — ${test?.title ?? entry.title ?? '(title unknown)'}`);
console.log(`- Status: ${entry.status ?? '(not in manifest)'} · deadline: ${entry.deadline ?? test?.deadline ?? '?'}`);

if (!result) {
  console.log('\nNo result yet — not taken (or the result was never committed).');
  process.exit(0);
}

if (result.status === 'forfeited') {
  console.log(`\nFORFEITED (${result.forfeitReason}) on ${result.date}. 0 points. Persona §4 applies.`);
  process.exit(0);
}

console.log(`- Taken: ${result.startedAt} → ${result.date} (${Math.floor(result.durationSec / 60)}m ${result.durationSec % 60}s)`);
console.log(`- Answered: ${result.answered}/${result.totalQuestions} · timed out: ${result.timedOut} · window blurs during test: ${result.totalBlurs}`);
console.log(`- Objective auto-score (verify before trusting): ${result.autoScore.correct}/${result.autoScore.total}`);
if (result.subjectiveCount) console.log(`- Subjective answers to grade: ${result.subjectiveCount}`);

const qById = new Map((test?.questions || []).map((q) => [q.id, q]));

console.log('\n## Objective questions');
for (const p of result.perQuestion.filter((x) => x.type !== 'subjective')) {
  const q = qById.get(p.qid) || {};
  const expected = q.type === 'multiple_choice' ? q.options?.[q.answerIndex]
    : q.type === 'reorder' ? q.answer?.join(' ')
    : q.answers?.[0];
  const mark = p.timedOut ? '⏱ TIMED OUT' : p.autoCorrect ? '✓' : '✗';
  const bits = [`${p.timeUsedSec}s`];
  if (p.replays) bits.push(`${p.replays} replay(s)`);
  if (p.blurCount) bits.push(`${p.blurCount} blur(s)`);
  if (p.matchType === 'fuzzy') bits.push('fuzzy match, not exact');
  console.log(`- [${p.qid}] ${mark} (${p.category}) "${q.prompt ?? '?'}"`);
  console.log(`    expected: ${expected ?? '?'}`);
  console.log(`    given:    ${p.given ?? '(nothing)'}  [${bits.join(', ')}]`);
}

const subj = result.perQuestion.filter((x) => x.type === 'subjective');
if (subj.length) {
  console.log('\n## Subjective answers — grade these');
  for (const p of subj) {
    const q = qById.get(p.qid) || {};
    console.log(`\n### [${p.qid}] (${p.category}) "${q.prompt ?? '?'}"${q.minWords ? ` (asked for ≥${q.minWords} words)` : ''}`);
    console.log(`Time used: ${p.timeUsedSec}s${p.timedOut ? ' — TIMED OUT before submitting' : ''}${p.blurCount ? ` · ${p.blurCount} blur(s)` : ''}`);
    console.log('```');
    console.log(p.given || '(nothing written)');
    console.log('```');
  }
  console.log('\nWhen graded, record it:');
  console.log(`  node scripts/grade-test.js --id ${id} --score "<points>/<max>" --comment "<one Richter sentence>"`);
}
