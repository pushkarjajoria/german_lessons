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
    instructions: '<one short paragraph — shown only AFTER the learner is locked in>',
    defaultTimeLimitSec: 45,
    negativeMarking: false, // true on Klausuren/finals: wrong option pick costs 1/n
    allowSkip: true,        // "Unsure — skip": 0 points, no penalty
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
// multi_select and click_mistake are TEST-ONLY surprise types (SCHEMA §4.2) —
// the homework publisher (new-lesson.js) deliberately refuses them.
const KNOWN_TYPES = new Set(['fill_blank', 'multiple_choice', 'reorder', 'translate', 'listen_type', 'subjective', 'multi_select', 'click_mistake']);
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
  if (q.type === 'multi_select') {
    if (!(Array.isArray(q.options) && q.options.length >= 4)) fail(`${q.id}: multi_select needs options[] (≥4 — the point is a crowd).`);
    if (!(Array.isArray(q.answerIndexes) && q.answerIndexes.length >= 1
        && q.answerIndexes.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length))) {
      fail(`${q.id}: multi_select needs answerIndexes[] (≥1, all valid indexes into options).`);
    }
  }
  if (q.type === 'click_mistake') {
    if (!(Array.isArray(q.tokens) && q.tokens.length >= 3)) fail(`${q.id}: click_mistake needs tokens[] (the sentence, ≥3 words).`);
    if (!(Number.isInteger(q.mistakeIndex) && q.mistakeIndex >= 0 && q.mistakeIndex < q.tokens.length)) {
      fail(`${q.id}: click_mistake needs mistakeIndex (valid index into tokens).`);
    }
  }
  if (q.type === 'reorder' && !(Array.isArray(q.tokens) && Array.isArray(q.answer))) fail(`${q.id}: reorder needs tokens + answer.`);
  if (['fill_blank', 'translate', 'listen_type'].includes(q.type) && !Array.isArray(q.answers)) fail(`${q.id}: needs answers[].`);
  if (q.type === 'listen_type' && !q.audioText) fail(`${q.id}: listen_type needs audioText.`);
}
if (test.id !== nextId) {
  console.warn(`Note: test JSON id "${test.id}" ≠ next id "${nextId}" — rewriting to ${nextId}.`);
  test.id = nextId;
}

// Semester wiring (SCHEMA §8): quizzes and the final are ordinary tests tagged
// with kind + semester so semester.js can compute the weighted standing.
if (test.kind && !['quiz', 'final'].includes(test.kind)) fail(`kind must be "quiz" or "final", got "${test.kind}".`);
if (test.kind && !test.semester) fail('a quiz/final needs a "semester" id (e.g. "S1").');
if (test.kind && manifest.semester && test.semester !== manifest.semester.id) {
  console.warn(`Warning: test.semester "${test.semester}" ≠ active semester "${manifest.semester.id}".`);
}
// Duration guidance: quizzes are short checks, the final is the long sit.
const totalSec = test.questions.reduce((s, q) => s + (q.timeLimitSec ?? test.defaultTimeLimitSec ?? 60), 0);
const totalMin = Math.round(totalSec / 60);
if (test.kind === 'quiz' && totalMin > 12) console.warn(`Warning: quiz runs ~${totalMin} min at full time — quizzes are ~10 min. Trim it.`);
if (test.kind === 'final' && (totalMin < 15 || totalMin > 35)) console.warn(`Warning: final runs ~${totalMin} min at full time — the final should sit at 20–30 min.`);

// Repertoire discipline (SCHEMA §4.2): the FULL arsenal — negative marking and
// a crowd of surprise types — belongs to Klausuren and finals. Quizzes get a
// taste, not the whole thing.
const surpriseCount = test.questions.filter((q) => ['multi_select', 'click_mistake'].includes(q.type)).length;
if (test.kind === 'quiz') {
  if (test.negativeMarking) console.warn('Warning: negative marking on a QUIZ — the full repertoire is for Klausuren/finals. Allowed, but reconsider.');
  if (surpriseCount > 2) console.warn(`Warning: ${surpriseCount} surprise-type questions on a quiz — a quiz carries a taste (1–2), not the full repertoire.`);
}

const password = await promptPassword('Password: ');
if (!password) { console.error('Empty password refused.'); process.exit(1); }
try {
  decryptString(password, manifest.canary);
} catch {
  console.error('This password does not match the manifest canary — the site could never open this test. Aborting.');
  process.exit(1);
}

// Novelty check: a test measures transfer, not memory. Same skill, NEW sentence
// and context — copy-pasting homework prompts defeats the point, so exact
// duplicates are refused (override with --allow-duplicates if truly intended)
// and near-duplicates are flagged for judgment.
const norm = (s) => String(s).toLowerCase().replace(/[^\wäöüß ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
const overlap = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.min(A.size, B.size);
};
const hwDir = join(ROOT, 'docs', 'data', 'homework');
const hwPrompts = [];
try {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(hwDir).filter((f) => f.endsWith('.json.enc'))) {
    try {
      const hw = JSON.parse(decryptString(password, JSON.parse(readFileSync(join(hwDir, f), 'utf8'))));
      for (const q of hw.questions || []) hwPrompts.push({ src: `${f} ${q.id}`, prompt: q.prompt });
    } catch { /* different password era — skip */ }
  }
} catch { /* no homework dir yet */ }
let exact = 0;
for (const q of test.questions) {
  for (const h of hwPrompts) {
    if (norm(q.prompt) === norm(h.prompt)) {
      console.error(`DUPLICATE: test ${q.id} is a copy of homework prompt (${h.src}): "${q.prompt}"`);
      exact += 1;
    } else if (overlap(q.prompt, h.prompt) > 0.8) {
      console.warn(`Near-duplicate: test ${q.id} closely resembles ${h.src} — same skill must wear a new sentence.`);
    }
  }
}
if (exact && !args.includes('--allow-duplicates')) {
  console.error(`\n${exact} exact duplicate(s). A test asks the same skill in a NEW context — rewrite them (or pass --allow-duplicates if this is truly intended).`);
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
  ...(test.kind ? { kind: test.kind, semester: test.semester } : {}),
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
