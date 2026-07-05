#!/usr/bin/env node
// decrypt.js — decrypt a .enc envelope file to stdout or a file.
// Usage: node scripts/decrypt.js <infile.enc> [outfile]
//        (password prompted, or GL_PASSWORD env)

import { readFileSync, writeFileSync } from 'node:fs';
import { decryptString, promptPassword } from './lib-crypto.js';

const [infile, outfile] = process.argv.slice(2);
if (!infile) {
  console.error('Usage: node scripts/decrypt.js <infile.enc> [outfile]');
  process.exit(1);
}
const envelope = JSON.parse(readFileSync(infile, 'utf8'));
const password = await promptPassword('Password: ');
try {
  const plaintext = decryptString(password, envelope);
  if (outfile) {
    writeFileSync(outfile, plaintext);
    console.log(`Decrypted ${infile} → ${outfile}`);
  } else {
    process.stdout.write(plaintext + '\n');
  }
} catch {
  console.error('Decryption failed — wrong password or corrupted file.');
  process.exit(1);
}
