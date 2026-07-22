// shame.js — the cone's face. While Betragen sits in the cone, the Schande
// image (docs/data/img/schande.enc, AES under the site password) is decrypted
// after unlock and hung at the TOP of the main frame on EVERY page — the first
// thing seen, not a corner pin, not a backdrop watermark. There is no page
// without it — no hiding.

import { decryptString } from './crypto.js';

// One decrypt-and-cache helper per encrypted image asset.
const imgCache = {};
async function encImageUrl(path, key, password) {
  if (imgCache[key]) return imgCache[key];
  const res = await fetch(path);
  if (!res.ok) return null;
  const payload = JSON.parse(await decryptString(password, await res.json()));
  imgCache[key] = `data:${payload.mime};base64,${payload.dataB64}`;
  return imgCache[key];
}

// The learner's own photograph — still used by the dashboard rank badge itself.
export function shamePhotoUrl(password) { return encImageUrl('data/img/learner.enc', 'learner', password); }

// The Schande banner image (curtsy) hung at the top of every page in the cone.
export function schandePhotoUrl(password) { return encImageUrl('data/img/schande.enc', 'schande', password); }

// The Betragen-lockdown image (below 60), full-size on the lockdown screen.
export function lockdownPhotoUrl(password) { return encImageUrl('data/img/lockdown.enc', 'lockdown', password); }

// The discipline (Nachweis / no-practice) lockdown image — its own asset.
export function disciplinePhotoUrl(password) { return encImageUrl('data/img/no-entry.enc', 'no-entry', password); }

// Hang the Schande image at the top of the main frame — the first thing seen on
// every page, cone tier only. Sits directly under the topbar so navigation
// still works; the picture dominates the fold.
export async function mountShameBanner(password) {
  const main = document.querySelector('main');
  if (!main || main.querySelector('.schande-banner')) return;
  try {
    const url = await schandePhotoUrl(password);
    if (!url) return;
    const fig = document.createElement('figure');
    fig.className = 'schande-banner';
    fig.innerHTML = '<img alt="Kegel der Schande" /><figcaption>Kegel der Schande — bis das Betragen wieder steigt.</figcaption>';
    fig.querySelector('img').src = url;
    const topbar = main.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', fig);
    else main.insertAdjacentElement('afterbegin', fig);
  } catch { /* wrong password or missing asset — the walls still speak */ }
}

// The no-entry image, hung at the top of the main frame while the Nachweis
// (no-practice) lockdown is active — so the picture stays on the Lessons page
// and any barred page, not only the dashboard ritual. Portrait, contained.
export async function mountDisciplineBanner(password) {
  const main = document.querySelector('main');
  if (!main || main.querySelector('.schande-banner')) return;
  try {
    const url = await disciplinePhotoUrl(password);
    if (!url) return;
    const fig = document.createElement('figure');
    fig.className = 'schande-banner discipline-banner';
    fig.innerHTML = '<img alt="Kurs gesperrt — kein Üben" /><figcaption>Kurs gesperrt — bis die Prüfung bestanden ist.</figcaption>';
    fig.querySelector('img').src = url;
    const topbar = main.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', fig);
    else main.insertAdjacentElement('afterbegin', fig);
  } catch { /* wrong password or missing asset */ }
}
