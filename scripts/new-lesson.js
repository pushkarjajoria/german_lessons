#!/usr/bin/env node
// new-lesson.js — package the next lesson + homework into the encrypted repo layout.
// Run by the assistant (or you) after writing the teaching markdown and quiz JSON.
//
// Usage:
//   node scripts/new-lesson.js --lesson path/to/lesson.md --homework path/to/homework.json [--push]
//   node scripts/new-lesson.js --scaffold          # create empty templates for the next id
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
const nextId = String(Number(manifest.currentLessonId) + 1).padStart(4, '0');

if (args.includes('--scaffold')) {
  const lessonPath = join(ROOT, 'scripts', 'templates', `lesson-${nextId}.md`);
  const hwPath = join(ROOT, 'scripts', 'templates', `homework-${nextId}.json`);
  if (existsSync(lessonPath) || existsSync(hwPath)) {
    console.error('Templates for the next id already exist — edit those instead:');
    console.error(`  ${lessonPath}\n  ${hwPath}`);
    process.exit(1);
  }
  writeFileSync(lessonPath, `# Lektion ${nextId} — <Titel>\n\n**Zielt auf:** <weak areas from the latest report>\n\n---\n\n<teaching content, Frau Richter's register>\n`);
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

const lessonOut = join(ROOT, 'docs', 'data', 'lessons', `lesson-${nextId}.md.enc`);
const hwOut = join(ROOT, 'docs', 'data', 'homework', `homework-${nextId}.json.enc`);
writeFileSync(lessonOut, JSON.stringify(encryptString(password, lessonText), null, 2));
writeFileSync(hwOut, JSON.stringify(encryptString(password, JSON.stringify(hw, null, 2)), null, 2));

manifest.currentLessonId = nextId;
manifest.currentHomeworkId = nextId;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

console.log(`Encrypted and staged lesson ${nextId}:`);
console.log(`  ${lessonOut}`);
console.log(`  ${hwOut}`);
console.log(`  manifest: current pointers → ${nextId}`);

const gitCmds = [
  'git add docs/data/lessons docs/data/homework docs/data/manifest.json',
  `git commit -m "lesson ${nextId}: new lesson + homework"`,
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
