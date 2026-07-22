#!/usr/bin/env node
// conduct.js — Frau Richter's hand on the Betragen score (0–100, starts 65).
// The site renders it as the star ladder and closes below 60; only this
// script moves the number.
//
//   95-100  Goldener Stern      80+  Silberner Stern
//   65+     Schwarzer Stern     <65  Kegel der Schande
//   <60     site locked — two days straight of writing HER lines (her text, her
//           count), then on the third day the apology opens; a filed apology
//           buys a review on the next lecture day; accept → 65, reject → restart.
//
// Usage:
//   node scripts/conduct.js --show                     # score, tier, log, lock, lines, decrypted apology
//   node scripts/conduct.js --adjust +2 --reason "…" [--push]
//   node scripts/conduct.js --adjust -5 --reason "…" [--push]
//   node scripts/conduct.js --set-lines "Ich …" --times 20 [--translation "I …"] [--push]   # set the lines he must write (days 1–2)
//   node scripts/conduct.js --review --accept [--push]                 # apology accepted → score 65, unlock
//   node scripts/conduct.js --review --reject --tasks "…" [--push]    # rejected → sequence restarts, conditions shown
//
// Ruling guidance (persona §6.5 has the full economy): ASYMMETRIC BY DESIGN.
// Required work done properly = +0 — meeting the contract earns nothing.
// +1..2 only for genuinely beyond the requirement, +3..5 for the rare
// exceptional. Deductions come without hesitation: −1..3 ordinary lapses,
// −2..5 demands/rudeness, −5..10 ghosting/complacency. The flattery gambit
// (a letter praising her strictness) resolves HERE too: reward edge +1..3,
// or the strictness edge (tighten a policy, add a requirement — no points),
// or −2 for empty flattery. Vary unpredictably. Upward adjustments while
// locked are refused — the review is the only door back.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.conduct ||= { score: 65, log: [] };
const c = manifest.conduct;

const tierOf = (s) => (s >= 95 ? 'Goldener Stern' : s >= 80 ? 'Silberner Stern' : s >= 65 ? 'Schwarzer Stern' : 'Kegel der Schande');
const DEFAULT_LINES = { text: 'Ich vernachlässige meine Pflichten nicht wieder.', translation: 'I will not neglect my duties again.', times: 20 };

if (args.includes('--show')) {
  console.log(`Betragen: ${c.score}/100 — ${tierOf(c.score)}${c.score < 60 ? ' — SITE LOCKED' : ''}`);
  for (const l of (c.log || []).slice(-10)) {
    console.log(`  ${l.date.slice(0, 10)}  ${l.delta > 0 ? '+' : ''}${l.delta} → ${l.score}  ${l.reason}`);
  }
  if (c.lock) {
    const lines = c.lock.lines || DEFAULT_LINES;
    console.log(`\nLock since ${c.lock.since}` +
      `\n  lines: „${lines.text}“ ×${lines.times}${c.lock.lines ? '' : ' (default — set yours with --set-lines)'}` +
      `\n  translation: ${lines.translation ? `“${lines.translation}”` : '(none — add --translation "…")'}` +
      `\n  line-days written: ${(c.lock.lineDays || []).join(', ') || '(none yet)'}` +
      `\n  apology: ${(c.lock.apologies || []).length ? 'FILED' : 'not yet'}` +
      (c.lock.eligibleAt ? ` · eligible for review since ${c.lock.eligibleAt}` : '') +
      (c.lock.extraTasks ? `\n  conditions from last rejection: ${c.lock.extraTasks}` : ''));
    if ((c.lock.apologies || []).length) {
      const password = await promptPassword('Password (to read the apologies): ');
      for (const a of c.lock.apologies) {
        let text;
        try { text = decryptString(password, a.enc); } catch { text = '(cannot decrypt)'; }
        console.log(`\n--- ${a.date} ---\n${text}`);
      }
      console.log('\nJudge the sincerity AND the German. Then: --review --accept | --review --reject --tasks "…"');
    }
  }
  process.exit(0);
}

let commitMsg;

const setLines = opt('--set-lines');
if (setLines !== null) {
  if (!c.lock) { console.error('No active lock — lines are the lockdown regimen. Nothing to set.'); process.exit(1); }
  const times = Number(opt('--times'));
  const translation = opt('--translation');
  if (!setLines.trim()) { console.error('--set-lines needs the line text.'); process.exit(1); }
  if (!Number.isInteger(times) || times < 1) { console.error('--times needs a whole number ≥ 1, e.g. --times 20.'); process.exit(1); }
  c.lock.lines = { text: setLines.trim(), times, ...(translation && translation.trim() ? { translation: translation.trim() } : {}) };
  commitMsg = `conduct: lockdown lines set (×${times})`;
  console.log(`Lines set: „${setLines.trim()}“ ×${times}${translation && translation.trim() ? ` — “${translation.trim()}”` : ' (no translation — add --translation "…" so he understands it)'}. He writes them out on days 1 and 2; the apology opens on day 3.`);
} else {

const adj = opt('--adjust');
if (adj !== null) {
  const delta = Number(adj);
  const reason = opt('--reason');
  if (!Number.isFinite(delta) || !delta) { console.error('--adjust needs a non-zero number, e.g. +2 or -5.'); process.exit(1); }
  if (!reason) { console.error('Every ruling carries a reason — --reason "…" (plaintext, category-level).'); process.exit(1); }
  if (c.score < 60 && delta > 0) {
    console.error('The score is locked below 60. Upward movement goes through the apology review, nothing else.');
    process.exit(1);
  }
  c.score = Math.max(0, Math.min(100, c.score + delta));
  c.updatedAt = new Date().toISOString();
  c.log = [...(c.log || []).slice(-19), { date: c.updatedAt, delta, score: c.score, reason }];
  if (c.score < 60 && !c.lock) {
    c.lock = { active: true, since: c.updatedAt, lines: DEFAULT_LINES, lineDays: [], apologies: [] };
    console.log('The score fell below 60 — the site locks. Two days of lines, then the apology.');
    console.log(`Lines default to „${DEFAULT_LINES.text}“ ×${DEFAULT_LINES.times} — set yours: conduct.js --set-lines "…" --times N`);
  }
  commitMsg = `conduct: ${delta > 0 ? '+' : ''}${delta} → ${c.score} (${tierOf(c.score)})`;
  console.log(`Betragen ${delta > 0 ? '+' : ''}${delta} → ${c.score}/100 — ${tierOf(c.score)}.`);
} else if (args.includes('--review')) {
  if (!c.lock) { console.error('No lock, nothing to review.'); process.exit(1); }
  if (args.includes('--accept')) {
    c.score = 65;
    c.updatedAt = new Date().toISOString();
    c.log = [...(c.log || []).slice(-19), { date: c.updatedAt, delta: 65 - (c.log?.[c.log.length - 1]?.score ?? c.score), score: 65, reason: 'apology accepted — score restored to the starting line' }];
    delete c.lock;
    commitMsg = 'conduct: apology accepted — restored to 65, site unlocked';
    console.log('Accepted. Betragen restored to 65/100. The site reopens. The starting line is not a reward — it is a second chance.');
  } else if (args.includes('--reject')) {
    const tasks = opt('--tasks');
    if (!tasks) { console.error('A rejection carries conditions — --tasks "…" (plaintext, category-level).'); process.exit(1); }
    c.lock.lineDays = [];
    c.lock.apologies = [];
    c.lock.eligibleAt = null;
    c.lock.extraTasks = tasks;
    commitMsg = 'conduct: apology rejected — sequence restarts with conditions';
    console.log('Rejected. The whole sequence restarts — two days of lines, then the apology — with your conditions shown on the lockdown screen.');
  } else {
    console.error('--review needs --accept or --reject --tasks "…".');
    process.exit(1);
  }
} else {
  console.error('Usage: --show | --adjust ±N --reason "…" | --set-lines "…" --times N | --review --accept | --review --reject --tasks "…"');
  process.exit(1);
}
} // end: not --set-lines

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "${commitMsg}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
