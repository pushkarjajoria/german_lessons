#!/usr/bin/env node
// grade-test.js — record Frau Richter's grade for a submitted test in the
// manifest (plaintext aggregate: score + one comment line, same policy as
// history entries). The full grading rationale belongs in the next lesson.
//
// Usage: node scripts/grade-test.js --id NNNN --score "12/15" [--comment "…"] [--push]

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

const id = opt('--id');
const score = opt('--score');
if (!id || !score || !/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(score)) {
  console.error('Usage: node scripts/grade-test.js --id NNNN --score "12/15" [--comment "…"] [--push]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const entry = (manifest.tests || []).find((t) => t.id === id);
if (!entry) { console.error(`No test ${id} in the manifest.`); process.exit(1); }
if (entry.status === 'forfeited') { console.error(`Test ${id} was forfeited — 0 points stands, nothing to grade.`); process.exit(1); }
if (entry.status === 'pending') { console.error(`Test ${id} has no submitted result yet.`); process.exit(1); }

entry.status = 'graded';
entry.score = score;
entry.gradedAt = new Date().toISOString();
if (opt('--comment')) entry.comment = opt('--comment');
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`Test ${id} graded: ${score}${entry.comment ? ` — "${entry.comment}"` : ''}`);
if (entry.kind && entry.semester) {
  console.log(`This was a semester ${entry.semester} ${entry.kind} — check the standing: node scripts/semester.js --status`);
  if (entry.kind === 'final') console.log('Final graded → run: node scripts/semester.js --evaluate --push');
}

const gitCmds = [
  'git add docs/data/manifest.json',
  `git commit -m "test ${id}: graded ${score}"`,
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
