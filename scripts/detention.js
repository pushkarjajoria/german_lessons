#!/usr/bin/env node
// detention.js — assign the weekend detention (performance remediation), issued
// ONLY in the Friday session. The point is TIME, not a checklist — a real 1–2
// hour sit, tedious and repetitive, "if you will not learn, you will drill
// until you have." It writes manifest.detention; the run's session-end.js
// publishes it (over the API). The site locks the whole thing from Friday
// 17:00 through Monday 00:00 and goes inert then, finished or not.
//
// The target is a FLOOR, not a fixed session: doing badly makes it worse two
// ways at once — each wrong item costs more reproduction reps (repsMin..Max),
// AND the overall target extends (extensionPerWrongMinutes per wrong item,
// capped at maxExtensionMinutes so it's harsh but finite, never open-ended).
//
// Record-only by design: the site stores what was completed and the time
// spent, and reads it back with --status on Monday — SHE rules the ±Betragen
// herself (persona §6.5, "only her hand moves it"). No automatic score change.
//
// Usage:
//   node scripts/detention.js --assign --reason "…" \
//        --mode weak [--mode "cat:Kasus"] --minutes 90 \
//        [--extension-per-wrong 2] [--max-extension 45] \
//        [--reps-min 4] [--reps-max 10] [--force]
//   node scripts/detention.js --status        # progress + time spent (for Monday's ruling)
//   node scripts/detention.js --clear         # remove it (Monday cleanup / manual lift)
//
// --mode is repeatable; mode ∈ weak | mistakes | mixed | vocab | cat:<Kategorie>
//                              | lesson:<NNNN>  (reproduce that lesson's own chunks
//                                from their English meaning — for when the lesson
//                                plainly did not stick, or was not read with care).
// List a mode twice for emphasis — items are drawn round-robin in list order,
// recycling (reshuffled) once a pool is exhausted, since repetition is the point.
// Publish it with the run: node scripts/session-end.js --message "…".

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

// Only asked for when a lesson: mode needs validating (reads the lesson text).
let _pw = null;
const password = async () => (_pw ??= await promptPassword('Password (to read the lesson): '));

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

// The active window: from Friday 17:00 (after work) to the Monday 00:00 lift.
function detentionWindow(now) {
  const monday = nextMonday(now);
  const friday = new Date(monday);
  friday.setDate(friday.getDate() - 3); // the Friday before that Monday
  friday.setHours(17, 0, 0, 0);         // 17:00, after work hours
  return { startsAt: friday.toISOString(), expiresAt: monday.toISOString() };
}

function extensionMinutesFor(d) {
  const wrong = d.record?.wrongCount || 0;
  return Math.min(d.maxExtensionMinutes ?? 45, wrong * (d.extensionPerWrongMinutes ?? 2));
}

if (args.includes('--status')) {
  const d = manifest.detention;
  if (!d || !d.active) { console.log('No detention on file.'); process.exit(0); }
  const rec = d.record || { secondsSpent: 0, itemsSeen: 0, correctCount: 0, wrongCount: 0 };
  const extra = extensionMinutesFor(d);
  const effective = (d.targetMinutes ?? 90) + extra;
  const elapsed = Math.round((rec.secondsSpent || 0) / 60);
  console.log(`DETENTION — locks ${d.startsAt ? d.startsAt.slice(0, 16).replace('T', ' ') + ' (Fri 5pm)' : d.assignedAt?.slice(0, 10)} → ${d.expiresAt?.slice(0, 10)} (Mon 00:00)`);
  console.log(`  reason: ${d.reason}`);
  console.log(`  modes: ${(d.modes || []).join(', ') || '(none)'}`);
  console.log(`  target: ${d.targetMinutes ?? 90} min floor${extra ? ` + ${extra} min earned by ${rec.wrongCount} wrong item(s) = ${effective} min effective` : ''}`);
  console.log(`  progress: ${elapsed}/${effective} min · ${rec.itemsSeen || 0} items (${rec.correctCount || 0} right, ${rec.wrongCount || 0} wrong)${rec.completedAt ? ' — COMPLETED ' + rec.completedAt.slice(0, 16) : ''}`);
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
  const modes = multi('--mode');
  if (!reason || !modes.length) {
    console.error('Usage: --assign --reason "…" --mode weak [--mode "cat:Kasus"] [--mode "lesson:0008"] --minutes 90 [--extension-per-wrong 2] [--max-extension 45] [--reps-min 4] [--reps-max 10]');
    process.exit(1);
  }
  // A lesson: mode is only usable if that lesson actually has chunk lines with
  // English glosses. Check now — a silent empty mode would quietly shrink the
  // detention to the other modes and you would never know it did nothing.
  for (const mode of modes.filter((m) => m.startsWith('lesson:'))) {
    const id = mode.slice(7);
    const file = join(ROOT, 'docs', 'data', 'lessons', `lesson-${id}.md.enc`);
    if (!existsSync(file)) { console.error(`--mode ${mode}: no such lesson published (${file}).`); process.exit(1); }
    let lines = [];
    try {
      const md = decryptString(await password(), JSON.parse(readFileSync(file, 'utf8')));
      const CHUNK = /^\s*[-*]\s*(?:\*\*)?\s*[„"“]([^"“”]+)[""”]\s*(?:\*\*)?\s*[—–]\s*(.+)$/gm;
      let m; while ((m = CHUNK.exec(md))) if (m[1].trim().split(/\s+/).length >= 2 && m[2].trim()) lines.push(m[1].trim());
    } catch (e) {
      console.error(`--mode ${mode}: could not read lesson ${id} (${e.message}).`); process.exit(1);
    }
    if (!lines.length) {
      console.error(`--mode ${mode}: lesson ${id} has no drillable chunk lines.`);
      console.error('  Expected the SCHEMA "Die Chunks" form, German in quotes + an English gloss:');
      console.error('    - **„Ja, das ist für mich."** — Yes, that is for me.');
      console.error('  Without a gloss there is no cue to drill from. Fix the lesson or drop this mode.');
      process.exit(1);
    }
    console.log(`  ${mode}: ${lines.length} line(s) available.`);
  }
  const targetMinutes = opt('--minutes') ? Number(opt('--minutes')) : 90;
  const extensionPerWrongMinutes = opt('--extension-per-wrong') ? Number(opt('--extension-per-wrong')) : 2;
  const maxExtensionMinutes = opt('--max-extension') ? Number(opt('--max-extension')) : 45;
  const repsMin = opt('--reps-min') ? Number(opt('--reps-min')) : 4;
  const repsMax = opt('--reps-max') ? Number(opt('--reps-max')) : 10;
  if (!(targetMinutes >= 15 && targetMinutes <= 240)) { console.error('--minutes should be a real sit, 15–240.'); process.exit(1); }
  if (!(extensionPerWrongMinutes >= 0 && maxExtensionMinutes >= 0)) { console.error('--extension-per-wrong/--max-extension must be ≥ 0.'); process.exit(1); }
  if (!(repsMin >= 1 && repsMax >= repsMin && repsMax <= 20)) { console.error('--reps-min/--reps-max must satisfy 1 ≤ min ≤ max ≤ 20.'); process.exit(1); }
  const { startsAt, expiresAt } = detentionWindow(now);
  manifest.detention = {
    active: true,
    assignedAt: now.toISOString(),
    startsAt,
    expiresAt,
    reason,
    modes,
    targetMinutes,
    extensionPerWrongMinutes,
    maxExtensionMinutes,
    repsMin,
    repsMax,
    record: null,
  };
  commitMsg = `detention: assigned (${targetMinutes} min floor, ${modes.length} mode(s))`;
  console.log(`Detention assigned — locks the site from Fri ${startsAt.slice(0, 16).replace('T', ' ')} (5pm) until Mon ${expiresAt.slice(0, 10)} 00:00.`);
  console.log(`  ${targetMinutes} min floor, drawing from: ${modes.join(', ')}`);
  console.log(`  wrong items add ${extensionPerWrongMinutes} min each (cap +${maxExtensionMinutes} min) — a bad session runs longer, not just harder.`);
  console.log(`  wrong answers reproduced ${repsMin}–${repsMax}× from memory (escalating).`);
} else {
  console.error('Usage: --assign … | --status | --clear   (see file header)');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\nWrote manifest. Publish with the run:  node scripts/session-end.js --message "${commitMsg}"`);
