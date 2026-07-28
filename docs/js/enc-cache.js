// enc-cache.js — make repeat decryption cheap, without ever weakening the
// at-rest model.
//
// The practice page rebuilds its archive from ~15 encrypted files (every past
// homework, every report, the vocab bank). Two costs made that slow:
//   * ~15 SEQUENTIAL fetches, each with cache:'no-store' — on GitHub Pages that
//     is ~15 network round trips in a row before anything renders.
//   * a PBKDF2 key derivation (210k iterations) per file, because every file
//     carries its own salt.
//
// This module fixes both: decryptions run concurrently, and the resulting
// plaintext is cached in **sessionStorage**, keyed by a hash of the ciphertext
// itself. Content-addressed means a republished file can never be served from a
// stale entry — the key changes with the bytes.
//
// SECURITY, deliberately: the cache holds DECRYPTED lesson/report content.
//   * sessionStorage only — same-origin, per-tab, wiped when the tab closes.
//     Not localStorage: plaintext should not outlive the session on disk.
//   * It is never uploaded, never sent anywhere, and never committed — nothing
//     here touches the network or the repo.
//   * Content .enc files are immutable once published, so they may use the
//     normal HTTP cache; manifest.json is mutable and must NOT be cached.

const PREFIX = 'gl_pt_';          // gl_pt_<hash> -> plaintext

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function cacheGet(key) {
  try { return sessionStorage.getItem(PREFIX + key); } catch { return null; }
}

function cacheSet(key, value) {
  try {
    sessionStorage.setItem(PREFIX + key, value);
  } catch {
    // Quota (or private mode). Drop our own entries and retry once; if it still
    // fails, run uncached — slower, never broken.
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
      sessionStorage.setItem(PREFIX + key, value);
    } catch { /* give up on caching, not on the drill */ }
  }
}

export function clearPlaintextCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch { /* nothing to clear */ }
}

// Fetch + decrypt one path, using the session cache when the bytes are known.
// `decryptString` is injected so this module stays free of crypto imports and
// can be unit-checked in isolation.
export async function decryptCached(path, password, decryptString) {
  // 'no-cache' (revalidate), NOT 'no-store' and NOT plain caching:
  //   * plain caching would serve stale ciphertext after a --republish, and the
  //     old bytes decrypt to the old lesson (or fail outright after a rotation);
  //   * 'no-store' forces a full re-download every time.
  // Revalidating gets a cheap 304 when unchanged and correct bytes when not.
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  const raw = await res.text();
  const key = await sha256Hex(raw);
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const plain = await decryptString(password, JSON.parse(raw));
  cacheSet(key, plain);
  return plain;
}

// Decrypt many paths CONCURRENTLY. Individually failing files resolve to null
// rather than sinking the whole load (a missing report must not kill practice).
// `onProgress(done, total)` drives the loading indicator.
export async function decryptAllCached(paths, password, decryptString, onProgress) {
  let done = 0;
  const total = paths.length;
  if (onProgress) onProgress(0, total);
  return Promise.all(paths.map(async (p) => {
    try {
      const text = await decryptCached(p, password, decryptString);
      return { path: p, text };
    } catch {
      return { path: p, text: null };
    } finally {
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  }));
}
