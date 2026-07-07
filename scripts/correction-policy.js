#!/usr/bin/env node
// correction-policy.js — Frau Richter's control panel for the Korrektur system
// (persona §2.5: ASR model-repeat / spaced forced re-production; see SCHEMA.md).
// Every hyperparameter is hers. The site only executes.
//
// Usage:
//   node scripts/correction-policy.js --show
//   node scripts/correction-policy.js --set modelRepeat=3 --set requiredPasses=5 [--push]
//   node scripts/correction-policy.js --add 0002:q4 [--require 5] [--reason "test miss"] [--push]
//   node scripts/correction-policy.js --remove 0002:q4 [--push]      # delete entry entirely
//   node scripts/correction-policy.js --clear-item 0002:q4 [--push]  # mark cleared (verified live in session)
//
// Settable keys (manifest.correctionPolicy; defaults in docs/js/corrections.js):
//   enabled=true|false        modelRepeat=2        requiredPasses=3
//   minGapMinutes=180         resetOnMiss=true     gateHomework=true
//   graceHours=48             autoEnroll=firstTryMiss|off    maxOpen=12

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const DEFAULTS = {
  enabled: true, modelRepeat: 2, requiredPasses: 3, minGapMinutes: 180,
  resetOnMiss: true, gateHomework: true, graceHours: 48, autoEnroll: 'firstTryMiss', maxOpen: 12,
};

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const multi = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[i + 1]);
  return out;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.corrections ||= [];
const policy = { ...DEFAULTS, ...(manifest.correctionPolicy || {}) };

if (args.includes('--show')) {
  console.log('Policy (defaults + overrides):');
  for (const [k, v] of Object.entries(policy)) console.log(`  ${k} = ${v}`);
  const open = manifest.corrections.filter((c) => c.status === 'open');
  console.log(`\n${open.length} open / ${manifest.corrections.length} total correction item(s):`);
  for (const c of manifest.corrections) {
    console.log(`  [${c.status}] ${c.key} (${c.category}) ${c.doneCount}/${c.required} passes` +
      `${c.missedCount > 1 ? ` · missed ${c.missedCount}×` : ''} · added ${c.addedAt}` +
      `${c.lastPassedAt ? ` · last pass ${c.lastPassedAt}` : ''}`);
  }
  process.exit(0);
}

let dirty = false;
let commitBits = [];

const sets = multi('--set');
if (sets.length) {
  manifest.correctionPolicy ||= {};
  for (const s of sets) {
    const m = s.match(/^(\w+)=(.+)$/);
    if (!m || !(m[1] in DEFAULTS)) { console.error(`Unknown setting: ${s}. Keys: ${Object.keys(DEFAULTS).join(', ')}`); process.exit(1); }
    const [, key, raw] = m;
    let v = raw;
    if (raw === 'true') v = true;
    else if (raw === 'false') v = false;
    else if (/^\d+$/.test(raw)) v = Number(raw);
    if (key === 'autoEnroll' && !['firstTryMiss', 'off'].includes(v)) { console.error('autoEnroll must be firstTryMiss|off'); process.exit(1); }
    manifest.correctionPolicy[key] = v;
    console.log(`policy.${key} = ${v}`);
  }
  dirty = true;
  commitBits.push('policy updated');
}

const addKey = opt('--add');
if (addKey) {
  const m = addKey.match(/^(\d{4}):(\S+)$/);
  if (!m) { console.error('--add expects hwId:qid, e.g. 0002:q4'); process.exit(1); }
  const [, hwId, qid] = m;
  // Validate against the actual homework and pull the category (needs the password / .env).
  const hwPath = join(ROOT, 'docs', 'data', 'homework', `homework-${hwId}.json.enc`);
  if (!existsSync(hwPath)) { console.error(`No homework ${hwId} published.`); process.exit(1); }
  const password = await promptPassword('Password: ');
  let q;
  try {
    const hw = JSON.parse(decryptString(password, JSON.parse(readFileSync(hwPath, 'utf8'))));
    q = hw.questions.find((x) => x.id === qid);
  } catch {
    console.error('Could not decrypt that homework — wrong password?');
    process.exit(1);
  }
  if (!q) { console.error(`No question ${qid} in homework ${hwId}.`); process.exit(1); }
  const required = Number(opt('--require')) || policy.requiredPasses;
  const existing = manifest.corrections.find((c) => c.key === addKey);
  if (existing) {
    Object.assign(existing, { status: 'open', required, doneCount: 0, lastPassedAt: null, addedAt: new Date().toISOString(), reason: opt('--reason') || existing.reason });
    console.log(`Reopened ${addKey} (${q.category}) — ${required} passes required.`);
  } else {
    manifest.corrections.push({
      key: addKey, hwId, qid, category: q.category || 'Allgemein',
      reason: opt('--reason') || 'assigned by Frau Richter',
      missedCount: 1, addedAt: new Date().toISOString(),
      required, doneCount: 0, lastPassedAt: null, status: 'open',
    });
    console.log(`Enrolled ${addKey} (${q.category}) — ${required} passes required.`);
  }
  dirty = true;
  commitBits.push(`add ${addKey}`);
}

for (const [flag, action] of [['--remove', 'removed'], ['--clear-item', 'cleared']]) {
  const key = opt(flag);
  if (!key) continue;
  const idx = manifest.corrections.findIndex((c) => c.key === key);
  if (idx === -1) { console.error(`No correction item ${key}.`); process.exit(1); }
  if (flag === '--remove') manifest.corrections.splice(idx, 1);
  else Object.assign(manifest.corrections[idx], { status: 'cleared', clearedAt: new Date().toISOString() });
  console.log(`${key} ${action}.`);
  dirty = true;
  commitBits.push(`${action} ${key}`);
}

if (!dirty) {
  console.error('Nothing to do. Use --show | --set k=v | --add hwId:qid | --remove | --clear-item');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "korrektur: ${commitBits.join(', ')}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
