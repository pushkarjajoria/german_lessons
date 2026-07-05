// auth.js — login is decryption. There is no password hash anywhere: the entered
// password either decrypts the manifest canary or it doesn't. The password is held
// in this module's memory for the current page only — never localStorage, never
// sessionStorage, gone on navigation/close (each page therefore asks again; that is
// deliberate).

import { decryptString } from './crypto.js';
import { readJson } from './github.js';

export const CANARY_VALUE = 'german-lessons-canary-v1';

let sessionPassword = null;
let cachedManifest = null;
let cachedManifestSha = null;

export function getPassword() {
  if (!sessionPassword) throw new Error('Not unlocked.');
  return sessionPassword;
}

export function getManifest() { return cachedManifest; }
export function getManifestSha() { return cachedManifestSha; }

export async function loadManifest() {
  const { data, sha } = await readJson('data/manifest.json');
  cachedManifest = data;
  cachedManifestSha = sha;
  return data;
}

// Attempt unlock. Returns the manifest on success, throws on failure.
export async function unlock(password) {
  const manifest = cachedManifest || (await loadManifest());
  const canary = await decryptString(password, manifest.canary); // throws if wrong
  if (canary !== CANARY_VALUE) throw new Error('Canary mismatch.');
  sessionPassword = password;
  return manifest;
}

// Render the lock screen into #lock, hide it on success, then call onUnlock(manifest).
// Pages keep their main content inside <main hidden> and reveal it in onUnlock.
export function initLock(onUnlock) {
  const el = document.getElementById('lock');
  el.innerHTML = `
    <div class="lock-card">
      <p class="lock-kicker">Deutsch · Pushkar × Frau Richter</p>
      <h1 class="lock-title">Schließ auf.</h1>
      <form id="lock-form" autocomplete="off">
        <input type="password" id="lock-pw" placeholder="Passwort" autocomplete="current-password" autofocus />
        <button type="submit" class="btn btn-primary">Entsperren</button>
      </form>
      <p class="lock-error" id="lock-error" hidden></p>
      <p class="lock-note">Das Passwort ist der Schlüssel, nicht nur die Tür: ohne ihn entschlüsselt sich hier
      nichts — und <strong>geht er verloren, sind die Inhalte unwiederbringlich weg</strong>. Sichere ihn.</p>
    </div>`;
  const form = document.getElementById('lock-form');
  const pwInput = document.getElementById('lock-pw');
  const errEl = document.getElementById('lock-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Prüfe…';
    try {
      const manifest = await unlock(pwInput.value);
      el.hidden = true;
      document.querySelector('main').hidden = false;
      await onUnlock(manifest);
    } catch (err) {
      const isCrypto = !(err && /Could not load|Not found|fetch/i.test(String(err.message)));
      errEl.textContent = isCrypto
        ? 'Falsch. Ein falsches Passwort entschlüsselt hier nichts. Noch einmal — langsamer.'
        : `Manifest nicht erreichbar: ${err.message}`;
      errEl.hidden = false;
      pwInput.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entsperren';
    }
  });
}
