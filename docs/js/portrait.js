// portrait.js — swap the line-art SVG for Frau Richter's real (encrypted)
// portrait once the session is unlocked. The image ships as an AES-GCM
// envelope over the PNG's base64 (docs/data/portrait.png.enc — PNG, not JPEG,
// so the transparent background survives), so it is only visible after login
// like every other piece of content. Fails silently — the SVG stays as the
// fallback.

import { decryptString } from './crypto.js';
import { getPassword } from './auth.js';
import { readText } from './github.js';

let cached = null;

export async function portraitDataUrl() {
  if (cached) return cached;
  const { text } = await readText('data/portrait.png.enc');
  const b64 = await decryptString(getPassword(), JSON.parse(text));
  cached = 'data:image/png;base64,' + b64;
  return cached;
}

export async function loadPortrait(imgEl) {
  if (!imgEl) return;
  try {
    imgEl.src = await portraitDataUrl();
    imgEl.classList.add('portrait-photo');
  } catch (e) {
    console.warn('Portrait unavailable, keeping the line art:', e.message);
  }
}
