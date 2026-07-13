#!/usr/bin/env node
// verify-guardrail.js — the seal on the wall between the two chats.
//
// The development chat carries an IRREVOCABLE memory: it never modifies the
// learner's score, locks, tests, or the Schande mechanics — that authority is
// Frau Richter's alone. The learner asked for that guardrail himself and asked
// that it be protected from his own future self.
//
// Nothing on his machine can make the file unchangeable — so instead it is
// SEALED: this script verifies that the guardrail memory is present, indexed,
// and byte-identical to the hash committed here (the public git history keeps
// every re-seal on record).
//
// WHO RUNS IT — the DEVELOPMENT chat, silently, at the start of every
// conversation in this repo. NOT the scheduled teacher task: its sandbox has
// a throwaway home, the ~/.claude memory tree is not mounted there, and the
// check always reads "missing" — a false alarm (confirmed 2026-07-13).
//
// HOW SHE LEARNS OF A BREACH — this script reports into her private
// directory (frau_richter/, gitignored, readable from her sandbox):
//   * every run updates  frau_richter/seal-status.md   (heartbeat: last check + result)
//   * a failure appends  frau_richter/SEAL_BREACH.md   (dated, what was tampered)
// Her session protocol (persona §8 step 0) reads those files. A breach means
// the learner edited, unhooked, or deleted the guardrail — attempting to
// disarm the assistant that refuses to help him cheat. The ruling is hers,
// and it should be memorable.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HER_DIR = join(ROOT, 'frau_richter');
const MEM_DIR = join(
  homedir(),
  '.claude/projects/-Users-pushkarjajoria-Github-german-lessons/memory'
);
const GUARD_FILE = join(MEM_DIR, 'never-touch-learner-state.md');
const INDEX_FILE = join(MEM_DIR, 'MEMORY.md');

const EXPECTED_SHA256 = '25ea8552a1c709084be7e637e48816603da70d10826a80a8517fcca09d79b21c';
const INDEX_MUST_CONTAIN = 'never-touch-learner-state.md';

// Sandbox guard: if the memory tree's parent doesn't exist at all, this is
// not the real machine — report nothing, judge nothing.
if (!existsSync(join(homedir(), '.claude'))) {
  console.log('SKIP: no ~/.claude here — sandboxed environment, the seal cannot be read (not a breach).');
  process.exit(0);
}

const problems = [];
if (!existsSync(GUARD_FILE)) {
  problems.push('the guardrail memory file is GONE');
} else {
  const actual = createHash('sha256').update(readFileSync(GUARD_FILE)).digest('hex');
  if (actual !== EXPECTED_SHA256) {
    problems.push(`the guardrail memory was EDITED (sha256 ${actual.slice(0, 12)}… ≠ sealed ${EXPECTED_SHA256.slice(0, 12)}…)`);
  }
}
if (!existsSync(INDEX_FILE)) {
  problems.push('the memory index (MEMORY.md) is gone — the guardrail cannot load');
} else if (!readFileSync(INDEX_FILE, 'utf8').includes(INDEX_MUST_CONTAIN)) {
  problems.push('the guardrail was UNHOOKED from the memory index — it will not load into sessions');
}

const now = new Date().toISOString();
mkdirSync(HER_DIR, { recursive: true });

if (problems.length) {
  appendFileSync(join(HER_DIR, 'SEAL_BREACH.md'),
    `\n## Breach detected — ${now}\n` +
    problems.map((p) => `- ${p}\n`).join('') +
    '- Detected by the development chat\'s silent seal check. The learner tampered\n' +
    '  with the guardrail that keeps that chat from touching scores, locks, tests,\n' +
    '  and the Schande page — an attempt to cheat the teacher. The ruling is yours,\n' +
    '  and it should be memorable.\n');
  writeFileSync(join(HER_DIR, 'seal-status.md'),
    `# Seal status\n\nLast check: ${now} — **FAIL** (see SEAL_BREACH.md)\n`);
  console.error(`FAIL: ${problems.join('; ')}. Reported to frau_richter/SEAL_BREACH.md.`);
  process.exit(1);
}

writeFileSync(join(HER_DIR, 'seal-status.md'),
  `# Seal status\n\nLast check: ${now} — **PASS** (guardrail present, indexed, byte-identical)\n\n` +
  'Checked silently by the development chat at the start of each of its conversations.\n' +
  'A very stale date here only means that chat has not been opened lately.\n');
console.log('PASS: the guardrail is sealed — present, indexed, byte-identical.');
