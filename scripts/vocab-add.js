#!/usr/bin/env node
// vocab-add.js — maintain the encrypted vocabulary bank (docs/data/vocab.json.enc)
// that feeds the site's Vocabulary Gauntlet. Frau Richter adds the words of each
// lesson here, with deliberately confusing distractors.
//
// Usage:
//   node scripts/vocab-add.js --file words.json [--push]   # merge an array of entries
//   node scripts/vocab-add.js --list                       # decrypt and print the bank
//
// Entry shape:
//   { "de": "das Pfand", "en": "the deposit", "category": "Supermarkt",
//     "confusers": ["der Pfanne-Trick…"],   // OPTIONAL: German words the learner
//                                            // is likely to mix this up with —
//                                            // ideally other bank entries (their
//                                            // translation is used as a distractor)
//     "note": "one dry Richter line shown on a correct answer" }  // optional
//
// Merging is by exact "de" — an existing entry with the same German word is
// replaced, everything else is appended. The site adds its own cruelty on top:
// the learner's past wrong picks are re-offered as distractors automatically.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptString, decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANK = join(ROOT, 'docs', 'data', 'vocab.json.enc');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const password = await promptPassword('Password: ');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
try {
  decryptString(password, manifest.canary);
} catch {
  console.error('Password does not match the canary — the site could never open this bank. Aborting.');
  process.exit(1);
}

let bank = { words: [] };
if (existsSync(BANK)) {
  bank = JSON.parse(decryptString(password, JSON.parse(readFileSync(BANK, 'utf8'))));
}

if (args.includes('--list')) {
  console.log(`${bank.words.length} word(s) in the bank:\n`);
  for (const w of bank.words) {
    console.log(`- ${w.de} = ${w.en}${w.category ? `  [${w.category}]` : ''}${w.confusers?.length ? `  (confusers: ${w.confusers.join(', ')})` : ''}`);
  }
  process.exit(0);
}

const file = opt('--file');
if (!file) {
  console.error('Usage: node scripts/vocab-add.js --file words.json [--push] | --list');
  process.exit(1);
}

const incoming = JSON.parse(readFileSync(file, 'utf8'));
const entries = Array.isArray(incoming) ? incoming : incoming.words;
if (!Array.isArray(entries) || !entries.length) {
  console.error('Expected a JSON array of entries (or {words:[…]}).');
  process.exit(1);
}
let added = 0;
let replaced = 0;
for (const e of entries) {
  if (!e.de || !e.en) { console.error(`Entry missing de/en: ${JSON.stringify(e).slice(0, 60)}`); process.exit(1); }
  const idx = bank.words.findIndex((w) => w.de === e.de);
  if (idx >= 0) { bank.words[idx] = e; replaced += 1; } else { bank.words.push(e); added += 1; }
}

writeFileSync(BANK, JSON.stringify(encryptString(password, JSON.stringify(bank, null, 2)), null, 2));
console.log(`Bank updated: +${added} added, ${replaced} replaced — ${bank.words.length} total.`);

const gitCmds = ['git add docs/data/vocab.json.enc', `git commit -m "vocab: ${added} added, ${replaced} replaced (${bank.words.length} total)"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
