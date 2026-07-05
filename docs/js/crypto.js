// crypto.js — PBKDF2 + AES-GCM via Web Crypto.
// Scheme must stay byte-identical to scripts/lib-crypto.js:
//   PBKDF2-SHA256, 210000 iterations, 32-byte key
//   AES-256-GCM, 16-byte salt, 12-byte IV, fresh per file
//   Envelope: { v: 1, salt: b64, iv: b64, ct: b64 }  (ct includes the 16-byte GCM tag at the end)

export const ITERATIONS = 210000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

const te = new TextEncoder();
const td = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw', te.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptString(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return { v: 1, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

// Throws on wrong password (GCM auth failure) or malformed envelope.
export async function decryptString(password, envelope) {
  if (!envelope || envelope.v !== 1 || !envelope.salt || !envelope.iv || !envelope.ct) {
    throw new Error('Not a valid encrypted envelope (expected {v:1, salt, iv, ct}).');
  }
  const salt = fromB64(envelope.salt);
  const iv = fromB64(envelope.iv);
  const ct = fromB64(envelope.ct);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return td.decode(pt);
}
