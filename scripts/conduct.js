#!/usr/bin/env node
// conduct.js — Frau Richter's hand on the Betragen score (0–100, starts 65).
// The site renders it as the star ladder and closes below 60; only this
// script moves the number.
//
//   100     Goldener Stern      95+  Silberner Stern
//   88+     Schwarzer Stern     <88  Kegel der Schande
//   <60     site locked — 3 consecutive daily apologies (German) buy a
//           review on the next lecture day; accept → 65, reject → conditions.
//
// Usage:
//   node scripts/conduct.js --show                     # score, tier, log, lock, decrypted apologies
//   node scripts/conduct.js --adjust +2 --reason "…" [--push]
//   node scripts/conduct.js --adjust -5 --reason "…" [--push]
//   node scripts/conduct.js --review --accept [--push]                 # apology accepted → score 65, unlock
//   node scripts/conduct.js --review --reject --tasks "…" [--push]    # rejected → apologies reset, conditions shown
//
// Ruling guidance (persona §4 tempers everything): ±1..3 for ordinary good/poor
// sessions, +4..5 only for the exceptional, −5..10 for ghosting or repeated
// complacency, −2..5 for demands/rudeness (the deference contract). Upward
// adjustments while locked are refused — the review is the only door back.

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

const tierOf = (s) => (s >= 100 ? 'Goldener Stern' : s >= 95 ? 'Silberner Stern' : s >= 88 ? 'Schwarzer Stern' : 'Kegel der Schande');

if (args.includes('--show')) {
  console.log(`Betragen: ${c.score}/100 — ${tierOf(c.score)}${c.score < 60 ? ' — SITE LOCKED' : ''}`);
  for (const l of (c.log || []).slice(-10)) {
    console.log(`  ${l.date.slice(0, 10)}  ${l.delta > 0 ? '+' : ''}${l.delta} → ${l.score}  ${l.reason}`);
  }
  if (c.lock) {
    console.log(`\nLock since ${c.lock.since} · apologies: ${(c.lock.apologies || []).length}` +
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
    c.lock = { active: true, since: c.updatedAt, apologies: [] };
    console.log('The score fell below 60 — the site locks. The apology regimen begins on his side.');
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
    c.lock.apologies = [];
    c.lock.eligibleAt = null;
    c.lock.extraTasks = tasks;
    commitMsg = 'conduct: apology rejected — count restarts with conditions';
    console.log('Rejected. The apology count restarts at 0/3, with your conditions shown on the lock panel.');
  } else {
    console.error('--review needs --accept or --reject --tasks "…".');
    process.exit(1);
  }
} else {
  console.error('Usage: --show | --adjust ±N --reason "…" | --review --accept | --review --reject --tasks "…"');
  process.exit(1);
}

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
