#!/usr/bin/env node
// teacher-note.js — publish Frau Richter's hand-written remark to the dashboard
// ("From her desk"), replacing the previous one. Run it in each session after
// reading the latest report, alongside (not instead of) the next lesson.
//
// Usage:
//   node scripts/teacher-note.js --text "One to three Richter sentences." \
//        [--weak "Kasus,Wortstellung"] [--push]
//   node scripts/teacher-note.js --clear [--push]
//
// NOTE: this lives in manifest.json, which is PLAINTEXT in a public repo.
// Keep it short and category-level (like a grade comment), never quote the
// learner's answers or personal details. Long-form feedback belongs in the
// next lesson, which is encrypted.

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

if (args.includes('--clear')) {
  delete manifest.teacherNote;
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log('Teacher note cleared.');
} else {
  const text = opt('--text');
  if (!text) {
    console.error('Usage: node scripts/teacher-note.js --text "…" [--weak "A,B"] [--push] | --clear [--push]');
    process.exit(1);
  }
  if (text.length > 400) {
    console.error(`Note is ${text.length} chars — keep it under 400. It sits in a plaintext manifest; long feedback goes into the (encrypted) lesson.`);
    process.exit(1);
  }
  manifest.teacherNote = {
    date: new Date().toISOString(),
    text,
    weakAreas: (opt('--weak') || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`Teacher note set (${manifest.teacherNote.weakAreas.length} flagged area(s)).`);
}

const gitCmds = [
  'git add docs/data/manifest.json',
  `git commit -m "teacher note: ${args.includes('--clear') ? 'cleared' : 'updated'}"`,
  'git push',
];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
