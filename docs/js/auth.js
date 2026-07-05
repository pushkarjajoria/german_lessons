// auth.js — login is decryption. There is no password hash anywhere: the entered
// password either decrypts the manifest canary or it doesn't. By default the
// password lives only in this page's memory. The user may opt in ("stay unlocked
// while this tab is open"), which keeps it in sessionStorage — cleared when the
// tab closes, never localStorage, never the repo.

import { decryptString } from './crypto.js';
import { readJson } from './github.js';

export const CANARY_VALUE = 'german-lessons-canary-v1';
const SESSION_KEY = 'gl_session_pw';

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
export async function unlock(password, remember = false) {
  const manifest = cachedManifest || (await loadManifest());
  const canary = await decryptString(password, manifest.canary); // throws if wrong
  if (canary !== CANARY_VALUE) throw new Error('Canary mismatch.');
  sessionPassword = password;
  if (remember) sessionStorage.setItem(SESSION_KEY, password);
  return manifest;
}

export function lockNow() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

// Render the lock screen into #lock, hide it on success, then call onUnlock(manifest).
// If the user opted to stay unlocked in this tab, try that silently first.
export function initLock(onUnlock) {
  const el = document.getElementById('lock');
  el.innerHTML = `
    <div class="lock-card">
      <p class="lock-kicker">German · Pushkar</p>
      <h1 class="lock-title">German lessons await you.</h1>
      <form id="lock-form" autocomplete="off">
        <input type="password" id="lock-pw" placeholder="Password" autocomplete="current-password" autofocus />
        <button type="submit" class="btn btn-primary">Unlock</button>
      </form>
      <label class="lock-remember">
        <input type="checkbox" id="lock-remember" />
        Stay unlocked while this tab is open
      </label>
      <p class="lock-error" id="lock-error" hidden></p>
      <p class="lock-note">The password is the key, not just the door: nothing here decrypts
      without it, and <strong>if you lose it, the content is unrecoverable</strong>. Back it up.</p>
    </div>`;

  const form = document.getElementById('lock-form');
  const pwInput = document.getElementById('lock-pw');
  const errEl = document.getElementById('lock-error');

  const succeed = async (manifest) => {
    el.hidden = true;
    document.querySelector('main').hidden = false;
    await onUnlock(manifest);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const remember = document.getElementById('lock-remember').checked;
      const manifest = await unlock(pwInput.value, remember);
      await succeed(manifest);
    } catch (err) {
      const isCrypto = !(err && /Could not load|Not found|fetch/i.test(String(err.message)));
      errEl.textContent = isCrypto
        ? 'Wrong. A wrong password decrypts nothing here. Again — slower this time.'
        : `The manifest could not be loaded: ${err.message}`;
      errEl.hidden = false;
      pwInput.select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });

  // Silent unlock if this tab was left unlocked on purpose.
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    unlock(saved, false)
      .then(succeed)
      .catch(() => sessionStorage.removeItem(SESSION_KEY));
  }
}

// Wire the "Lock" button in the top bar, if the page has one.
export function initLockButton() {
  const btn = document.getElementById('lock-now');
  if (btn) btn.addEventListener('click', lockNow);
}
