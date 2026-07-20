#!/usr/bin/env node
// new-lesson.js — package the next lesson + homework into the encrypted repo layout.
// Run by the assistant (or you) after writing the teaching markdown and quiz JSON.
//
// Usage:
//   node scripts/new-lesson.js --lesson path/to/lesson.md --homework path/to/homework.json \
//        [--interleave 0002:q7,0002:q3] [--push]
//   node scripts/new-lesson.js --scaffold          # create empty templates for the next id
//   node scripts/new-lesson.js --republish NNNN --lesson <file.md> --homework <file.json> \
//        [--interleave 0002:q7] [--push]           # FR-002: correct an already-published lesson
//
// --interleave buries copies of old questions in today's homework at random
// positions (marked `interleaved` in the report, invisible to the learner) —
// the "you thought this was settled" trap.
// Question fields: any question may set "justify": true to demand a typed
// one-line reason on the first attempt (stored in the report for her red pen).
//
// What it does:
//   1. Reads docs/data/manifest.json, computes the next 4-digit id.
//   2. Encrypts lesson + homework (password prompted, or GL_PASSWORD env).
//   3. Writes docs/data/lessons/lesson-<id>.md.enc and docs/data/homework/homework-<id>.json.enc.
//   4. Bumps currentLessonId / currentHomeworkId in the manifest.
//   5. Prints the git commands (or runs them with --push).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptString, promptPassword, decryptString } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const republishId = opt('--republish');
const nextId = republishId || String(Number(manifest.currentLessonId) + 1).padStart(4, '0');

// FR-002: republishing is for CORRECTING already-published content — a
// lesson that stated something false about the learner's record, a homework
// question with a factual error. It is not a way to reopen finished work.
// Refuse outright if a report already exists for this id: republishing under
// completed work would rewrite the very thing the report is a record of.
if (republishId) {
  const reportPath = join(ROOT, 'docs', 'data', 'reports', `report-${republishId}.json.enc`);
  const inHistory = (manifest.history || []).some((h) => String(h.reportId) === republishId);
  if (existsSync(reportPath) || inHistory) {
    console.error(`Refusing: a report already exists for ${republishId} (${inHistory ? 'in manifest.history' : 'report file on disk'}).`);
    console.error('Republishing under completed work would corrupt the record. If this really needs to change, that is a deliberate, separate, manual act — not this script.');
    process.exit(1);
  }
  if (!(manifest.lessons || []).some((l) => l.id === republishId)) {
    console.error(`No lesson ${republishId} is indexed in the manifest — nothing to republish. Use the normal mode (without --republish) to publish it for the first time.`);
    process.exit(1);
  }
}

if (args.includes('--scaffold')) {
  const lessonPath = join(ROOT, 'scripts', 'templates', `lesson-${nextId}.md`);
  const hwPath = join(ROOT, 'scripts', 'templates', `homework-${nextId}.json`);
  if (existsSync(lessonPath) || existsSync(hwPath)) {
    console.error('Templates for the next id already exist — edit those instead:');
    console.error(`  ${lessonPath}\n  ${hwPath}`);
    process.exit(1);
  }
  writeFileSync(lessonPath, `---
title: <Titel>
section: <Major section — e.g. "Phase 1 — Survival Deutsch">
subsection: <Subsection — e.g. "Kaffee" (optional, delete line to place directly under the section)>
---

**Zielt auf:** <weak areas from the latest report>

<teaching content, Frau Richter's register — start headings at ## level>
`);
  writeFileSync(hwPath, JSON.stringify({
    id: nextId,
    lessonId: nextId,
    title: '<Titel>',
    createdAt: new Date().toISOString().slice(0, 10),
    targetsWeakAreas: [],
    questions: [],
  }, null, 2));
  console.log(`Scaffolded:\n  ${lessonPath}\n  ${hwPath}\nFill them in, then run:\n  node scripts/new-lesson.js --lesson ${lessonPath} --homework ${hwPath}`);
  process.exit(0);
}

const lessonFile = opt('--lesson');
const hwFile = opt('--homework');
if (!lessonFile || !hwFile) {
  console.error('Usage: node scripts/new-lesson.js --lesson <file.md> --homework <file.json> [--push]');
  console.error('       node scripts/new-lesson.js --scaffold');
  process.exit(1);
}

const lessonText = readFileSync(lessonFile, 'utf8');
const hwText = readFileSync(hwFile, 'utf8');

// Lesson front matter drives the curriculum tree on the site's Lessons page.
// Frau Richter decides section/subsection placement here, at her discretion.
function parseFrontMatter(md) {
  const meta = {};
  if (!md.startsWith('---')) return meta;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return meta;
  for (const line of md.slice(3, end).split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/);
    if (m) meta[m[1]] = m[2];
  }
  return meta;
}
const lessonMeta = parseFrontMatter(lessonText);
if (!lessonMeta.title || lessonMeta.title.startsWith('<')) {
  console.error('Lesson needs front matter with at least a real "title:" (see SCHEMA.md §3). Found none.');
  process.exit(1);
}
if (!lessonMeta.section || lessonMeta.section.startsWith('<')) {
  console.error('Lesson front matter needs a real "section:" — that is where it appears in the curriculum tree.');
  process.exit(1);
}
if (lessonMeta.subsection && lessonMeta.subsection.startsWith('<')) delete lessonMeta.subsection;

// Validate homework JSON before it gets sealed
const hw = JSON.parse(hwText);
const KNOWN_TYPES = new Set(['fill_blank', 'multiple_choice', 'reorder', 'translate', 'listen_type']);
if (!Array.isArray(hw.questions) || !hw.questions.length) {
  console.error('Homework has no questions.');
  process.exit(1);
}
for (const q of hw.questions) {
  if (!KNOWN_TYPES.has(q.type)) { console.error(`Unknown question type "${q.type}" (${q.id})`); process.exit(1); }
  if (!q.id || !q.prompt || !q.category) { console.error(`Question missing id/prompt/category: ${JSON.stringify(q).slice(0, 80)}`); process.exit(1); }
}
if (hw.id !== nextId) {
  console.warn(`Note: homework JSON id "${hw.id}" ≠ next id "${nextId}" — rewriting to ${nextId}.`);
  hw.id = nextId;
  hw.lessonId = nextId;
}

const password = await promptPassword('Password: ');
if (!password) { console.error('Empty password refused.'); process.exit(1); }

// Guard: password must match the current canary, otherwise the site can't decrypt
// the new files after login.
try {
  decryptString(password, manifest.canary);
} catch {
  console.error('This password does not match the manifest canary — the site would never be able to open these files. Aborting.');
  process.exit(1);
}

// Buried interleaving: --interleave 0002:q7,0002:q3 copies old questions into
// today's homework at random positions, outside the normal spaced-review flow —
// a deliberate "you thought this was settled" trap. The copies are marked
// `interleaved` so the report shows her how the trap went; the learner sees
// nothing special.
function applyInterleave(refs) {
  const srcCache = new Map();
  let xn = 1;
  for (const ref of refs) {
    const m = ref.match(/^(\d{4}):(\S+)$/);
    if (!m) { console.error(`--interleave expects hwId:qid refs, got "${ref}".`); process.exit(1); }
    const [, srcId, qid] = m;
    if (!srcCache.has(srcId)) {
      const p = join(ROOT, 'docs', 'data', 'homework', `homework-${srcId}.json.enc`);
      if (!existsSync(p)) { console.error(`No homework ${srcId} to interleave from.`); process.exit(1); }
      srcCache.set(srcId, JSON.parse(decryptString(password, JSON.parse(readFileSync(p, 'utf8')))));
    }
    const src = srcCache.get(srcId).questions.find((x) => x.id === qid);
    if (!src) { console.error(`No question ${qid} in homework ${srcId}.`); process.exit(1); }
    const copy = structuredClone(src);
    copy.interleaved = ref;
    copy.id = `x${xn++}`; // fresh id — no collision with today's q1..qN
    const pos = 1 + Math.floor(Math.random() * hw.questions.length); // buried, never first
    hw.questions.splice(pos, 0, copy);
    console.log(`Buried ${ref} (${copy.category}) at position ${pos + 1} as ${copy.id}.`);
  }
}

const interleaveOpt = opt('--interleave');
if (interleaveOpt) {
  applyInterleave(interleaveOpt.split(',').map((s) => s.trim()).filter(Boolean));
} else if (republishId) {
  // FR-002: no --interleave given on a republish — carry over whatever the
  // LIVE version had, so correcting the prose doesn't silently drop the trap.
  const livePath = join(ROOT, 'docs', 'data', 'homework', `homework-${republishId}.json.enc`);
  const live = JSON.parse(decryptString(password, JSON.parse(readFileSync(livePath, 'utf8'))));
  const carried = (live.questions || []).filter((q) => q.interleaved).map((q) => q.interleaved);
  if (carried.length) {
    console.log(`Republish: carrying over ${carried.length} buried interleave(s) from the live version: ${carried.join(', ')}`);
    applyInterleave(carried);
  }
}

const lessonOut = join(ROOT, 'docs', 'data', 'lessons', `lesson-${nextId}.md.enc`);
const hwOut = join(ROOT, 'docs', 'data', 'homework', `homework-${nextId}.json.enc`);
writeFileSync(lessonOut, JSON.stringify(encryptString(password, lessonText), null, 2));
writeFileSync(hwOut, JSON.stringify(encryptString(password, JSON.stringify(hw, null, 2)), null, 2));

let manifestTouched = false;
if (republishId) {
  // FR-002: pointers and the lessons[] index entry stay exactly as they
  // were — a republish corrects content, not curriculum placement. If the
  // rewritten front matter disagrees with the indexed section/subsection,
  // say so rather than silently drifting out of sync or silently applying it.
  const indexed = manifest.lessons.find((l) => l.id === republishId);
  if (indexed && (indexed.section !== lessonMeta.section || (indexed.subsection || '') !== (lessonMeta.subsection || ''))) {
    console.warn(`Note: front matter now says section="${lessonMeta.section}"` +
      `${lessonMeta.subsection ? `/subsection="${lessonMeta.subsection}"` : ''}, ` +
      `but the index still has "${indexed.section}"${indexed.subsection ? `/"${indexed.subsection}"` : ''} — left untouched. ` +
      'Edit manifest.lessons by hand if the placement itself needs to move.');
  }
  if (indexed && indexed.title !== lessonMeta.title) {
    console.warn(`Note: front matter title changed ("${indexed.title}" → "${lessonMeta.title}") — index entry left untouched.`);
  }
} else {
  manifest.currentLessonId = nextId;
  manifest.currentHomeworkId = nextId;
  manifest.lessons ||= [];
  manifest.lessons.push({
    id: nextId,
    title: lessonMeta.title,
    section: lessonMeta.section,
    ...(lessonMeta.subsection ? { subsection: lessonMeta.subsection } : {}),
  });
  manifestTouched = true;
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

console.log(`Encrypted and ${republishId ? 're' : ''}staged lesson ${nextId}:`);
console.log(`  ${lessonOut}`);
console.log(`  ${hwOut}`);
console.log(manifestTouched ? `  manifest: current pointers → ${nextId}` : '  manifest: pointers and index entry left untouched (republish).');

const gitPaths = ['docs/data/lessons', 'docs/data/homework', ...(manifestTouched ? ['docs/data/manifest.json'] : [])];
const gitCmds = [
  `git add ${gitPaths.join(' ')}`,
  `git commit -m "lesson ${nextId}: ${republishId ? 'republished — content correction' : 'new lesson + homework'}"`,
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
