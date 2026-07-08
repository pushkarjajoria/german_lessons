#!/usr/bin/env node
// read-upload.js — decrypt a Nachweis proof upload (docs/data/uploads/*.enc)
// so Frau Richter can verify it before clearing a discipline block.
// Verification order stays hers: token and date first, German second.
//
// Usage:
//   node scripts/read-upload.js --list           # uploads + which task they claim
//   node scripts/read-upload.js --open <file>    # decrypt to a temp dir and open it
//   node scripts/read-upload.js --open latest    # newest upload

import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPLOADS = join(ROOT, 'docs', 'data', 'uploads');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

let files = [];
try {
  files = readdirSync(UPLOADS).filter((f) => f.endsWith('.enc')).sort();
} catch { /* no uploads dir yet */ }

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const taskFor = (f) => (manifest.discipline?.tasks || []).find((t) => t.upload?.endsWith(f));

if (args.includes('--list') || !args.length) {
  if (!files.length) { console.log('No uploads.'); process.exit(0); }
  for (const f of files) {
    const t = taskFor(f);
    console.log(`- ${f}${t ? `  → task ${t.id} [${t.type}] claimed ${t.claimedAt}` : ''}`);
  }
  console.log('\nOpen one: node scripts/read-upload.js --open <file|latest>');
  process.exit(0);
}

let wanted = opt('--open');
if (!wanted) { console.error('Usage: --list | --open <file|latest>'); process.exit(1); }
if (wanted === 'latest') {
  if (!files.length) { console.error('No uploads.'); process.exit(1); }
  wanted = files[files.length - 1];
}
const path = wanted.includes('/') ? wanted : join(UPLOADS, wanted);

const password = await promptPassword('Password: ');
let payload;
try {
  payload = JSON.parse(decryptString(password, JSON.parse(readFileSync(path, 'utf8'))));
} catch (e) {
  console.error(`Could not decrypt ${basename(path)} — wrong password, or not an upload envelope.`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'nachweis-'));
const out = join(dir, payload.filename || 'upload.bin');
writeFileSync(out, Buffer.from(payload.dataB64, 'base64'));
console.log(`Decrypted: ${out} (${payload.mime || 'unknown type'})`);
console.log('Check the anti-spoof elements FIRST (token + date), then the German.');
console.log('If it holds: node scripts/discipline.js --clear --push');
if (process.platform === 'darwin') {
  try { execSync(`open "${out}"`); } catch { /* leave the path on screen */ }
}
