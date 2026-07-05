#!/usr/bin/env node
// save-password.js — one-time setup so the loop can run unattended (scheduled
// tasks, cron). Prompts for the password with hidden input and writes it in
// plaintext to a gitignored .env at the repo root as GL_PASSWORD=...
//
// This is a deliberate choice, not an oversight: the password never enters git
// (already covered by .gitignore), never appears in chat/tool logs (typed
// directly into the terminal), and this repo's password is not reused
// elsewhere — so a local-disk leak on your own machine is an acceptable risk
// for the convenience of a fully automated daily lesson. If that stops being
// true, delete .env and go back to typing the password per run.
//
// Usage: node scripts/save-password.js

import { writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promptPassword, decryptString } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

delete process.env.GL_PASSWORD; // ignore any existing .env for this run — we want a fresh prompt
const password = await promptPassword('Password to save for automated runs: ');
if (!password) {
  console.error('Empty password refused.');
  process.exit(1);
}

// Verify it actually opens the current manifest's canary before saving it, so a
// typo doesn't get silently baked into every scheduled run.
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
try {
  decryptString(password, manifest.canary);
} catch {
  console.error('That password does not open this repo\'s canary — not saved. Check for typos and try again.');
  process.exit(1);
}

writeFileSync(ENV_FILE, `GL_PASSWORD=${password}\n`, { mode: 0o600 });
chmodSync(ENV_FILE, 0o600);
console.log(`Saved to ${ENV_FILE} (mode 600, gitignored). Every script and scheduled run will now use it automatically.`);
console.log('To stop automated runs from being able to decrypt anything, delete this file.');
