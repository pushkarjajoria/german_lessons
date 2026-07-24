#!/usr/bin/env node
// detention.js — assign the weekend detention (performance remediation), issued
// ONLY in the Friday session, sized to the week's test/homework results. It
// writes manifest.detention; the run's session-end.js publishes it (over the
// API). The site locks the whole thing to a single detention screen on Sat/Sun
// and goes inert Monday, finished or not.
//
// Record-only by design: the site stores what was completed and the time spent,
// and reads it back with --status on Monday — SHE rules the ±Betragen herself
// (persona §6.5, "only her hand moves it"). No automatic score change.
//
// Usage:
//   node scripts/detention.js --assign --reason "…" \
//        --drill "weak:8" --drill "cat:Kasus:10" [--reps-min 4] [--reps-max 10] [--force]
//   node scripts/detention.js --status        # progress + time spent (for Monday's ruling)
//   node scripts/detention.js --clear         # remove it (Monday cleanup / manual lift)
//
// A drill is "mode:count": mode ∈ weak | mistakes | mixed | vocab | cat:<Kategorie>.
// Publish it with the run: node scripts/session-end.js --message "…".

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const multi = (n) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === n && args[i + 1]) out.push(args[i + 1]); return out; };

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// The Monday 00:00 (local) after `d` — when detention lifts.
function nextMonday(d) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  do { t.setDate(t.getDate() + 1); } while (t.getDay() !== 1);
  return t;
}

if (args.includes('--status')) {
  const d = manifest.detention;
  if (!d || !d.active) { console.log('No detention on file.'); process.exit(0); }
  const rec = d.record || { doneIndexes: [] };
  console.log(`DETENTION since ${d.assignedAt?.slice(0, 10)} — lifts ${d.expiresAt?.slice(0, 10)} (Monday)`);
  console.log(`  reason: ${d.reason}`);
  (d.drills || []).forEach((dr, i) => console.log(`  ${rec.doneIndexes?.includes(i) ? '✓' : '·'} drill ${i + 1}: ${dr.mode} ×${dr.count}`));
  const done = rec.doneIndexes?.length || 0;
  console.log(`  progress: ${done}/${(d.drills || []).length} drills${rec.completedAt ? ' — COMPLETED ' + rec.completedAt.slice(0, 16) : ''}`);
  if (rec.secondsSpent) console.log(`  time spent: ${Math.round(rec.secondsSpent / 60)} min`);
  console.log(`  → YOUR ruling on Monday: complete = a few points back, skipped = a few off (conduct.js). The site never moved the score.`);
  process.exit(0);
}

let commitMsg;
if (args.includes('--clear')) {
  if (!manifest.detention?.active) { console.log('Nothing to clear.'); process.exit(0); }
  manifest.detention = { active: false, clearedAt: new Date().toISOString(), previous: { assignedAt: manifest.detention.assignedAt, reason: manifest.detention.reason, record: manifest.detention.record || null } };
  commitMsg = 'detention: cleared';
  console.log('Detention cleared.');
} else if (args.includes('--assign')) {
  const now = new Date();
  if (now.getDay() !== 5 && !args.includes('--force')) {
    console.error(`Detention is assigned in the FRIDAY session only (today is ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()]}). Use --force to override deliberately.`);
    process.exit(1);
  }
  const reason = opt('--reason');
  const rawDrills = multi('--drill');
  if (!reason || !rawDrills.length) {
    console.error('Usage: --assign --reason "…" --drill "weak:8" [--drill "cat:Kasus:10"] [--reps-min 4] [--reps-max 10]');
    process.exit(1);
  }
  const drills = rawDrills.map((raw) => {
    const i = raw.lastIndexOf(':');
    const mode = raw.slice(0, i), count = Number(raw.slice(i + 1));
    if (!mode || !Number.isInteger(count) || count < 1) { console.error(`Bad drill "${raw}" — expected "mode:count", e.g. "weak:8" or "cat:Kasus:10".`); process.exit(1); }
    return { mode, count };
  });
  const repsMin = opt('--reps-min') ? Number(opt('--reps-min')) : 4;
  const repsMax = opt('--reps-max') ? Number(opt('--reps-max')) : 10;
  if (!(repsMin >= 1 && repsMax >= repsMin && repsMax <= 20)) { console.error('--reps-min/--reps-max must satisfy 1 ≤ min ≤ max ≤ 20.'); process.exit(1); }
  manifest.detention = {
    active: true,
    assignedAt: now.toISOString(),
    expiresAt: nextMonday(now).toISOString(),
    reason,
    drills,
    repsMin,
    repsMax,
    record: null,
  };
  commitMsg = `detention: assigned (${drills.length} drill(s))`;
  console.log(`Detention assigned — locks the site Sat/Sun, lifts ${nextMonday(now).toISOString().slice(0, 10)} (Monday).`);
  drills.forEach((d, i) => console.log(`  drill ${i + 1}: ${d.mode} ×${d.count}`));
  console.log(`  wrong answers reproduced ${repsMin}–${repsMax}× from memory (escalating).`);
} else {
  console.error('Usage: --assign … | --status | --clear   (see file header)');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\nWrote manifest. Publish with the run:  node scripts/session-end.js --message "${commitMsg}"`);
