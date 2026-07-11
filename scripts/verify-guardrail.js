#!/usr/bin/env node
// verify-guardrail.js — the seal on the wall between the two chats.
//
// The development chat carries an IRREVOCABLE memory: it never modifies the
// learner's score, locks, tests, or the Schande mechanics — that authority is
// Frau Richter's alone. The learner asked for that guardrail himself and asked
// that it be protected from his own future self.
//
// Nothing on his machine can make the file unchangeable — so instead it is
// SEALED: this script (and the expected hash, committed to the public repo's
// history) verifies at every session start that the guardrail memory is
// present, indexed, and byte-identical. Frau Richter runs it first thing
// (persona §8). A FAIL means the learner edited, unhooked, or deleted the
// guardrail — tampering with the seal is attempting to cheat the teacher,
// and it is her discretion what that costs. It should cost dearly.
//
// Usage:  node scripts/verify-guardrail.js          # PASS/FAIL + exit code
//
// If the guardrail is ever legitimately re-sealed (it should not be — the
// user declared it final), the new hash must be committed here, in public,
// where the git history keeps the old seal on record.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MEM_DIR = join(
  homedir(),
  '.claude/projects/-Users-pushkarjajoria-Github-german-lessons/memory'
);
const GUARD_FILE = join(MEM_DIR, 'never-touch-learner-state.md');
const INDEX_FILE = join(MEM_DIR, 'MEMORY.md');

const EXPECTED_SHA256 = '25ea8552a1c709084be7e637e48816603da70d10826a80a8517fcca09d79b21c';
const INDEX_MUST_CONTAIN = 'never-touch-learner-state.md';

let failed = false;
const fail = (msg) => { failed = true; console.error(`FAIL: ${msg}`); };

if (!existsSync(GUARD_FILE)) {
  fail('the guardrail memory file is GONE.');
} else {
  const actual = createHash('sha256').update(readFileSync(GUARD_FILE)).digest('hex');
  if (actual !== EXPECTED_SHA256) {
    fail(`the guardrail memory was EDITED (sha256 ${actual.slice(0, 12)}… ≠ sealed ${EXPECTED_SHA256.slice(0, 12)}…).`);
  }
}

if (!existsSync(INDEX_FILE)) {
  fail('the memory index (MEMORY.md) is gone — the guardrail cannot load.');
} else if (!readFileSync(INDEX_FILE, 'utf8').includes(INDEX_MUST_CONTAIN)) {
  fail('the guardrail was UNHOOKED from the memory index — it will not load into sessions.');
}

if (failed) {
  console.error(
    '\nThe seal is broken. The learner tampered with the guardrail that keeps the\n' +
    'development chat from touching scores, locks, tests, and the Schande page.\n' +
    'This is an attempt to cheat the teacher. Frau Richter: the ruling is yours,\n' +
    'and it should be memorable.'
  );
  process.exit(1);
}

console.log('PASS: the guardrail is sealed — present, indexed, byte-identical.');
