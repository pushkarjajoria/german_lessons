#!/usr/bin/env node
// new-test.js — package a test (Klausur) into the encrypted repo layout.
// Run by the assistant (Frau Richter) after writing the test JSON.
//
// Usage:
//   node scripts/new-test.js --test path/to/test.json [--push]
//   node scripts/new-test.js --scaffold        # template for the next test id
//
// Test JSON shape (before encryption):
//   {
//     "id": "0001", "title": "…", "createdAt": "YYYY-MM-DD",
//     "deadline": "2026-07-12T20:00:00Z",       // ISO, must be in the future
//     "instructions": "one short paragraph shown before the start button",
//     "defaultTimeLimitSec": 45,
//     "questions": [ …homework types, each may add "timeLimitSec"…,
//       { "id":"q9", "type":"subjective", "prompt":"Beschreibe dein letztes
//         Training im Fitnessstudio.", "minWords": 25, "timeLimitSec": 300,
//         "category":"Produktion" } ]
//   }
// Subjective questions are graded by Frau Richter (scripts/read-test.js to
// read answers, scripts/grade-test.js to record the grade).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptString, promptPassword, decryptString } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const TESTS_DIR = join(ROOT, 'docs', 'data', 'tests');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.tests ||= [];

// Reconcile: any pending test whose deadline has passed is forfeited — this
// covers the no-PAT case where the site could only display it, not persist it.
let reconciled = 0;
for (const t of manifest.tests) {
  if (t.status === 'pending' && t.deadline && Date.now() > new Date(t.deadline).getTime()) {
    t.status = 'forfeited';
    t.forfeitReason = 'deadline';
    t.forfeitedAt = new Date().toISOString();
    reconciled += 1;
  }
}
if (reconciled) console.log(`Reconciled ${reconciled} expired pending test(s) → forfeited.`);

const nextId = String(
  manifest.tests.reduce((max, t) => Math.max(max, Number(t.id)), 0) + 1
).padStart(4, '0');

if (args.includes('--scaffold')) {
  const p = join(ROOT, 'scripts', 'templates', `test-${nextId}.json`);
  if (existsSync(p)) {
    console.error(`Template already exists — edit it instead:\n  ${p}`);
    process.exit(1);
  }
  const inThreeDays = new Date(Date.now() + 3 * 86400000);
  inThreeDays.setHours(22, 0, 0, 0);
  writeFileSync(p, JSON.stringify({
    id: nextId,
    title: '<Titel>',
    createdAt: new Date().toISOString().slice(0, 10),
    deadline: inThreeDays.toISOString(),
    instructions: '<one short paragraph — what this test covers>',
    defaultTimeLimitSec: 45,
    questions: [],
  }, null, 2));
  console.log(`Scaffolded:\n  ${p}\nFill it in, then run:\n  node scripts/new-test.js --test ${p}`);
  process.exit(0);
}

const testFile = opt('--test');
if (!testFile) {
  console.error('Usage: node scripts/new-test.js --test <file.json> [--push]');
  console.error('       node scripts/new-test.js --scaffold');
  process.exit(1);
}

const test = JSON.parse(readFileSync(testFile, 'utf8'));

// ---- validation ----
const KNOWN_TYPES = new Set(['fill_blank', 'multiple_choice', 'reorder', 'translate', 'listen_type', 'subjective']);
const fail = (msg) => { console.error(`Invalid test: ${msg}`); process.exit(1); };

if (!test.title || test.title.startsWith('<')) fail('title missing.');
if (!test.deadline || isNaN(new Date(test.deadline))) fail('deadline missing or not ISO.');
if (new Date(test.deadline).getTime() <= Date.now()) fail('deadline is in the past.');
if (!Array.isArray(test.questions) || !test.questions.length) fail('no questions.');
for (const q of test.questions) {
  if (!KNOWN_TYPES.has(q.type)) fail(`unknown type "${q.type}" (${q.id}).`);
  if (!q.id || !q.prompt || !q.category) fail(`question missing id/prompt/category: ${JSON.stringify(q).slice(0, 80)}`);
  const limit = q.timeLimitSec ?? test.defaultTimeLimitSec;
  if (!limit || limit < 5) fail(`question ${q.id} has no usable time limit (need timeLimitSec or defaultTimeLimitSec ≥ 5).`);
  if (q.type === 'multiple_choice' && !(Array.isArray(q.options) && Number.isInteger(q.answerIndex))) fail(`${q.id}: multiple_choice needs options + answerIndex.`);
  if (q.type === 'reorder' && !(Array.isArray(q.tokens) && Array.isArray(q.answer))) fail(`${q.id}: reorder needs tokens + answer.`);
  if (['fill_blank', 'translate', 'listen_type'].includes(q.type) && !Array.isArray(q.answers)) fail(`${q.id}: needs answers[].`);
  if (q.type === 'listen_type' && !q.audioText) fail(`${q.id}: listen_type needs audioText.`);
}
if (test.id !== nextId) {
  console.warn(`Note: test JSON id "${test.id}" ≠ next id "${nextId}" — rewriting to ${nextId}.`);
  test.id = nextId;
}

const password = await promptPassword('Password: ');
if (!password) { console.error('Empty password refused.'); process.exit(1); }
try {
  decryptString(password, manifest.canary);
} catch {
  console.error('This password does not match the manifest canary — the site could never open this test. Aborting.');
  process.exit(1);
}

mkdirSync(TESTS_DIR, { recursive: true });
const outPath = join(TESTS_DIR, `test-${nextId}.json.enc`);
writeFileSync(outPath, JSON.stringify(encryptString(password, JSON.stringify(test, null, 2)), null, 2));

manifest.tests.push({
  id: nextId,
  title: test.title,
  deadline: test.deadline,
  status: 'pending',
  createdAt: new Date().toISOString(),
  questionCount: test.questions.length,
});
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

console.log(`Encrypted and staged test ${nextId} ("${test.title}"):`);
console.log(`  ${outPath}`);
console.log(`  deadline: ${test.deadline}`);

const gitCmds = [
  'git add docs/data/tests docs/data/manifest.json',
  `git commit -m "test ${nextId}: assigned, due ${test.deadline.slice(0, 10)}"`,
  'git push',
];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('\nTo publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
