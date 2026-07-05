// lib-crypto.js — Node twin of docs/js/crypto.js. Same scheme, byte-for-byte:
//   PBKDF2-SHA256, 210000 iterations, 32-byte key
//   AES-256-GCM, 16-byte salt, 12-byte IV, fresh per file
//   Envelope: { v: 1, salt: b64, iv: b64, ct: b64 }  (ct includes the 16-byte GCM tag at the end)
// Browser-written files decrypt here and vice versa. If you change any parameter,
// change it in BOTH files and re-encrypt everything.

import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const ITERATIONS = 210000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export function deriveKey(password, salt) {
  return pbkdf2Sync(Buffer.from(password, 'utf8'), salt, ITERATIONS, KEY_BYTES, 'sha256');
}

export function encryptString(password, plaintext) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}

// Throws on wrong password (GCM auth failure) or malformed envelope.
export function decryptString(password, envelope) {
  if (!envelope || envelope.v !== 1 || !envelope.salt || !envelope.iv || !envelope.ct) {
    throw new Error('Not a valid encrypted envelope (expected {v:1, salt, iv, ct}).');
  }
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const data = Buffer.from(envelope.ct, 'base64');
  const tag = data.subarray(data.length - TAG_BYTES);
  const ct = data.subarray(0, data.length - TAG_BYTES);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Hidden-input password prompt for the CLI scripts. Honors GL_PASSWORD env var
// so the loop can run non-interactively without ever writing the password to disk.
export function promptPassword(promptText = 'Password: ') {
  if (process.env.GL_PASSWORD) return Promise.resolve(process.env.GL_PASSWORD);
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(promptText);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (d) => { buf += d; });
      stdin.on('end', () => resolve(buf.split('\n')[0].trim()));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    let pw = '';
    const onData = (chunk) => {
      const ch = chunk.toString('utf8');
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(pw);
      } else if (ch === '\u0003') { // Ctrl-C
        stdin.setRawMode(false);
        stdout.write('\n');
        process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') {
        pw = pw.slice(0, -1);
      } else {
        pw += ch;
      }
    };
    stdin.on('data', onData);
  });
}
