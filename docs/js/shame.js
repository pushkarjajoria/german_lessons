// shame.js — the cone's face. While Betragen sits in the cone, the learner's
// own photograph (docs/data/img/learner.enc, AES under the site password) is
// decrypted after unlock and displayed in ORIGINAL COLOR, full and clear:
// on the dashboard it replaces the cone glyph itself, and every other page
// pins it to the corner. There is no page without it — no hiding.

import { decryptString } from './crypto.js';

let cachedUrl = null;

export async function shamePhotoUrl(password) {
  if (cachedUrl) return cachedUrl;
  const res = await fetch('data/img/learner.enc');
  if (!res.ok) return null;
  const payload = JSON.parse(await decryptString(password, await res.json()));
  cachedUrl = `data:${payload.mime};base64,${payload.dataB64}`;
  return cachedUrl;
}

// The corner pin for every non-dashboard page (the dashboard hangs it bigger,
// in the rank badge itself — see dashboard.js).
export async function mountShameBanner(password) {
  if (document.querySelector('.shame-banner') || document.getElementById('conduct-panel')) return;
  try {
    const url = await shamePhotoUrl(password);
    if (!url) return;
    const fig = document.createElement('figure');
    fig.className = 'shame-banner';
    fig.innerHTML = '<img alt="The student, in the cone" /><figcaption>Der Schüler.<br/>Kegel der Schande</figcaption>';
    fig.querySelector('img').src = url;
    document.body.appendChild(fig);
  } catch { /* wrong password or missing asset — the walls still speak */ }
}
