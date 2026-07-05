#!/usr/bin/env node
// encrypt.js — encrypt any file into the .enc envelope format.
// Usage: node scripts/encrypt.js <infile> [outfile]
//        (outfile defaults to <infile>.enc; password prompted, or GL_PASSWORD env)

import { readFileSync, writeFileSync } from 'node:fs';
import { encryptString, promptPassword } from './lib-crypto.js';

const [infile, outArg] = process.argv.slice(2);
if (!infile) {
  console.error('Usage: node scripts/encrypt.js <infile> [outfile]');
  process.exit(1);
}
const outfile = outArg || `${infile}.enc`;
const plaintext = readFileSync(infile, 'utf8');
const password = await promptPassword('Password: ');
if (!password) { console.error('Empty password refused.'); process.exit(1); }
writeFileSync(outfile, JSON.stringify(encryptString(password, plaintext), null, 2));
console.log(`Encrypted ${infile} → ${outfile}`);
