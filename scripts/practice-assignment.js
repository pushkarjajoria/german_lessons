#!/usr/bin/env node
// practice-assignment.js — assign an ordinary practice goal (not a consequence).
//
// Distinct from `deed.js` (self-reported, honor system) and `detention.js` (a
// lockdown consequence for genuine failure): this is the boring middle —
// "the Artikel drill until 3 clean rounds" — visible on his dashboard AND on
// the practice page itself, and CLOSED AUTOMATICALLY the moment the drill
// result meets the criterion. He never reports completion; the drill result
// IS the evidence (docs/js/practice.js logPractice wires this).
//
// A "clean round" = a first-try score of items/items on that drill mode.
// Rounds do NOT need to be consecutive — "until you have three clean rounds"
// counts every clean round that happens while the assignment is open.
//
// Usage:
//   node scripts/practice-assignment.js --assign --mode artikel --clean-rounds 3 \
//        --reason "…" [--due 2026-08-05]
//   node scripts/practice-assignment.js --status         # every assignment, open + done, with round history
//   node scripts/practice-assignment.js --clear --id <id>   # cancel one, manually
// Publish with the run: node scripts/session-end.js --message "…" (this writes
// straight to GitHub over the API — no local git, so the sandbox's unlink-denied
// .git can't strand it; see lib-publish.js).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const VALID_MODES = ['mistakes', 'weak', 'grammar', 'harder', 'mixed', 'vocab', 'artikel'];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.practiceAssignments ||= [];

if (args.includes('--status')) {
  if (!manifest.practiceAssignments.length) { console.log('No practice assignments on file.'); process.exit(0); }
  for (const a of manifest.practiceAssignments) {
    const rounds = a.rounds || [];
    const clean = rounds.filter((r) => r.firstTry === r.total).length;
    console.log(`\n[${a.id}] ${a.status.toUpperCase()} — ${a.mode} — ${clean}/${a.requireCleanRounds} clean`);
    console.log(`  assigned ${a.assignedAt.slice(0, 10)}${a.dueAt ? `, due ${a.dueAt.slice(0, 10)}` : ''}${a.reason ? ` — ${a.reason}` : ''}`);
    if (a.completedAt) console.log(`  completed ${a.completedAt.slice(0, 10)}`);
    if (rounds.length) {
      console.log('  rounds:');
      for (const r of rounds) console.log(`    ${r.at.slice(0, 16).replace('T', ' ')} — ${r.firstTry}/${r.total}${r.firstTry === r.total ? '  ✓ clean' : ''}`);
    } else {
      console.log('  no rounds played yet.');
    }
  }
  process.exit(0);
}

let commitMsg;
if (args.includes('--clear')) {
  const id = opt('--id');
  if (!id) { console.error('Usage: --clear --id <id>'); process.exit(1); }
  const a = manifest.practiceAssignments.find((x) => x.id === id);
  if (!a) { console.error(`No assignment with id ${id}. Use --status to list.`); process.exit(1); }
  if (a.status !== 'open') { console.log(`Assignment ${id} is already ${a.status} — nothing to clear.`); process.exit(0); }
  a.status = 'cancelled';
  a.completedAt = new Date().toISOString();
  commitMsg = `practice-assignment: cancelled ${id} (${a.mode})`;
  console.log(`Cancelled [${id}] ${a.mode}.`);
} else if (args.includes('--assign')) {
  const mode = opt('--mode');
  const cleanRounds = opt('--clean-rounds') ? Number(opt('--clean-rounds')) : null;
  const reason = opt('--reason');
  if (!mode || !VALID_MODES.includes(mode)) {
    console.error(`--mode must be one of: ${VALID_MODES.join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(cleanRounds) || cleanRounds < 1 || cleanRounds > 10) {
    console.error('--clean-rounds must be a whole number 1–10.');
    process.exit(1);
  }
  if (!reason) {
    console.error('Usage: --assign --mode <mode> --clean-rounds N --reason "…" [--due YYYY-MM-DD]');
    process.exit(1);
  }
  const dueOpt = opt('--due');
  const due = dueOpt ? new Date(`${dueOpt}T22:00:00Z`) : null;
  if (dueOpt && Number.isNaN(due?.getTime())) { console.error('--due must be YYYY-MM-DD.'); process.exit(1); }

  const already = manifest.practiceAssignments.find((a) => a.status === 'open' && a.mode === mode);
  if (already) {
    console.error(`An OPEN assignment already exists for "${mode}" (id ${already.id}) — clear it first or let it complete.`);
    process.exit(1);
  }

  const entry = {
    id: `pa${Date.now()}`,
    mode,
    requireCleanRounds: cleanRounds,
    reason,
    assignedAt: new Date().toISOString(),
    dueAt: due ? due.toISOString() : null,
    rounds: [],
    status: 'open',
    completedAt: null,
  };
  manifest.practiceAssignments.push(entry);
  commitMsg = `practice-assignment: ${mode} until ${cleanRounds} clean round(s)`;
  console.log(`Assigned [${entry.id}] ${mode} — until ${cleanRounds} clean round(s).`);
  console.log(`  Shows on his dashboard and on the drill's own card, and closes itself the`);
  console.log(`  moment the site records a clean round for that mode — no self-report needed.`);
} else {
  console.error('Usage: --assign … | --status | --clear --id <id>   (see file header)');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\nWrote manifest. Publish with the run:  node scripts/session-end.js --message "${commitMsg}"`);
