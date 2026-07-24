// auth.js — login is decryption. There is no password hash anywhere: the entered
// password either decrypts the manifest canary or it doesn't. By default the
// password lives only in this page's memory. The user may opt in ("stay unlocked
// while this tab is open"), which keeps it in sessionStorage — cleared when the
// tab closes, never localStorage, never the repo.

import { decryptString } from './crypto.js';
import { readJson } from './github.js';
import { conductScore, conductTier, conductLocked } from './conduct.js';
import { disciplineActive } from './discipline.js';
import { detentionActive } from './detention.js';
import { navBadge } from './inbox.js';
import { mountShameBanner, mountDisciplineBanner } from './shame.js';

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

// A quiet version stamp at the bottom of the lock card, so a deploy is
// verifiable at a glance. docs/version.json is generated fresh by the Pages
// workflow on every push (short commit sha + UTC deploy time); locally,
// where that file doesn't exist, the line is simply omitted.
async function renderVersionFooter(container) {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { sha, deployedAt } = await res.json();
    if (!sha) return;
    const p = document.createElement('p');
    p.className = 'lock-version';
    p.textContent = `v${sha}${deployedAt ? ` · ${deployedAt.slice(0, 10)}` : ''}`;
    container.appendChild(p);
  } catch { /* no version.json (local dev) — say nothing */ }
}

// Render the lock screen into #lock, hide it on success, then call onUnlock(manifest).
// If the user opted to stay unlocked in this tab, the password is already in
// sessionStorage — then the login form never appears: a quiet loading card
// covers the silent unlock (key derivation takes a moment by design), and the
// While the Nachweis lockdown is active, every page but the dashboard and the
// Lessons is barred: hide the page's own content and stand a block in its place
// with the way back. The topbar (and its two live links) stays.
function showDisciplineBlock(password) {
  const main = document.querySelector('main');
  const topbar = main.querySelector('.topbar');
  for (const el of [...main.children]) if (el !== topbar) el.hidden = true;
  if (!main.querySelector('.discipline-block')) {
    const block = document.createElement('section');
    block.className = 'panel discipline-block';
    block.innerHTML = `
      <h2>Kurs gesperrt. Kein Üben.</h2>
      <p>Practice lapsed — the course is closed to everything but the Lessons.
      Complete the ritual on the <a href="index.html">dashboard</a>, or
      <a href="lessons.html">study the lessons</a> first.</p>`;
    (topbar || main).insertAdjacentElement(topbar ? 'afterend' : 'afterbegin', block);
  }
  mountDisciplineBanner(password); // the image stays here too
}

// Weekend detention bars every page but the dashboard. Stand a block with the
// one way back; the detention screen and its drills live on the dashboard.
function showDetentionBlock() {
  const main = document.querySelector('main');
  const topbar = main.querySelector('.topbar');
  for (const el of [...main.children]) if (el !== topbar) el.hidden = true;
  if (!main.querySelector('.detention-block')) {
    const block = document.createElement('section');
    block.className = 'panel detention-block';
    block.innerHTML = `
      <h2>Nachsitzen.</h2>
      <p>You are in detention for the weekend — the site is closed to everything else.
      Serve it on the <a href="index.html">dashboard</a>. It lifts on Monday.</p>`;
    (topbar || main).insertAdjacentElement(topbar ? 'afterend' : 'afterbegin', block);
  }
}

// form only renders if that unlock fails.
export function initLock(onUnlock) {
  const el = document.getElementById('lock');

  const succeed = async (manifest) => {
    el.hidden = true;
    document.querySelector('main').hidden = false;
    // The room wears the rank (styles.css, body[data-tier]): gold is earned
    // light, silver a cool polish, black the austere baseline — and the Kegel
    // der Schande drains every page and writes the lines into the walls.
    document.body.dataset.tier = conductTier(conductScore(manifest));
    navBadge(manifest); // unread messages/rulings, on every page's nav
    // In the cone, the Schande image (curtsy) hangs at the top of every page —
    // but NOT while a lock is up: the Betragen lock shows its own image, and the
    // discipline lock shows the no-entry image. One image per screen.
    if (document.body.dataset.tier === 'cone' && !conductLocked(manifest) && !disciplineActive(manifest) && !detentionActive(manifest)) {
      mountShameBanner(sessionPassword);
    }
    // Nachweis (no-practice) lockdown: the course closes to the Lessons page and
    // the dashboard ritual alone. Every other page is barred; the nav keeps only
    // those two live. The dashboard runs the ritual itself (dashboard.js).
    if (disciplineActive(manifest)) {
      document.querySelector('.topbar nav')?.classList.add('nav-discipline');
      const page = location.pathname.split('/').pop() || 'index.html';
      const onDashboard = page === '' || page === 'index.html';
      const onLessons = page === 'lessons.html';
      if (onLessons) mountDisciplineBanner(sessionPassword); // the image stays while you study
      if (!onDashboard && !onLessons) { showDisciplineBlock(sessionPassword); return; }
    }
    // Weekend detention: the whole site closes to the dashboard detention screen.
    // Every other page is barred outright; the nav goes fully dead.
    if (detentionActive(manifest)) {
      document.querySelector('.topbar nav')?.classList.add('nav-dead');
      const page = location.pathname.split('/').pop() || 'index.html';
      if (page !== '' && page !== 'index.html') { showDetentionBlock(); return; }
    }
    await onUnlock(manifest);
  };

  const renderForm = () => {
    el.innerHTML = `
    <div class="lock-card">
      <p class="lock-kicker">German · Pushkar</p>
      <h1 class="lock-title">German lessons await you.</h1>
      <form id="lock-form" autocomplete="off">
        <input type="password" id="lock-pw" placeholder="Password" autocomplete="current-password" autofocus />
        <button type="submit" class="btn btn-primary">Unlock</button>
      </form>
      <label class="lock-remember">
        <input type="checkbox" id="lock-remember" checked />
        <span>Remember me</span>
      </label>
      <p class="lock-error" id="lock-error" hidden></p>
    </div>`;
    renderVersionFooter(el.querySelector('.lock-card'));

    const form = document.getElementById('lock-form');
    const pwInput = document.getElementById('lock-pw');
    const errEl = document.getElementById('lock-error');

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
  };

  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    // Already unlocked in this tab — no login page, just a beat of quiet.
    el.innerHTML = `
      <div class="lock-card lock-loading" aria-busy="true">
        <div class="lock-spinner" role="status" aria-label="Unlocking"></div>
        <p class="lock-note">Unlocking…</p>
      </div>`;
    unlock(saved, false)
      .then(succeed)
      .catch(() => {
        // Stale or wrong saved password (e.g. rotated) — back to the door.
        sessionStorage.removeItem(SESSION_KEY);
        renderForm();
      });
  } else {
    renderForm();
  }
}

// Wire the "Lock" button in the top bar, if the page has one.
export function initLockButton() {
  const btn = document.getElementById('lock-now');
  if (btn) btn.addEventListener('click', lockNow);
}
