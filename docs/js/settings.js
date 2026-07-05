// settings.js — GitHub token management (localStorage only), password change,
// and full re-encryption. The GitHub section works without unlocking; anything
// touching encrypted content asks for the password(s) right where it's needed.

import { encryptString, decryptString } from './crypto.js';
import { CANARY_VALUE } from './auth.js';
import * as gh from './github.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

function setStatus(id, msg, ok = true) {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${ok ? 'status-ok' : 'status-bad'}`;
  el.hidden = false;
}

// ---------- GitHub section ----------

function initGithub() {
  $('gh-repo').value = store.getRepo();
  $('gh-branch').value = store.getBranch();
  $('gh-token').placeholder = store.getToken() ? '•••••••• (Token gespeichert)' : 'github_pat_…';

  $('gh-save').addEventListener('click', async () => {
    store.setRepo($('gh-repo').value);
    store.setBranch($('gh-branch').value || 'main');
    if ($('gh-token').value.trim()) store.setToken($('gh-token').value.trim());
    $('gh-token').value = '';
    $('gh-token').placeholder = store.getToken() ? '•••••••• (Token gespeichert)' : 'github_pat_…';
    const check = await gh.checkAccess();
    setStatus('gh-status', check.ok
      ? 'Gespeichert. Zugriff auf das Repo bestätigt.'
      : `Gespeichert, aber Zugriff fehlgeschlagen: ${check.error}`, check.ok);
  });

  $('gh-clear').addEventListener('click', () => {
    store.setToken('');
    $('gh-token').value = '';
    $('gh-token').placeholder = 'github_pat_…';
    setStatus('gh-status', 'Token aus diesem Browser gelöscht.');
  });
}

// ---------- password change ----------

async function loadManifestFresh() {
  const { data, sha } = await gh.readJson('data/manifest.json');
  return data;
}

async function verifyOld(oldPw, manifest) {
  const canary = await decryptString(oldPw, manifest.canary); // throws if wrong
  if (canary !== CANARY_VALUE) throw new Error('Canary mismatch');
}

function initPassword() {
  $('pw-change').addEventListener('click', async () => {
    const oldPw = $('pw-old').value;
    const newPw = $('pw-new').value;
    const newPw2 = $('pw-new2').value;
    try {
      if (!newPw || newPw.length < 8) throw new Error('Neues Passwort: mindestens 8 Zeichen.');
      if (newPw !== newPw2) throw new Error('Die neuen Passwörter stimmen nicht überein.');
      setStatus('pw-status', 'Prüfe altes Passwort…');
      const manifest = await loadManifestFresh();
      await verifyOld(oldPw, manifest).catch(() => { throw new Error('Altes Passwort ist falsch — es entschlüsselt den Canary nicht.'); });
      manifest.canary = await encryptString(newPw, CANARY_VALUE);
      const text = JSON.stringify(manifest, null, 2);
      if (gh.isConfigured()) {
        await gh.writeText('data/manifest.json', text, 'settings: rotate canary (password change)');
        setStatus('pw-status', 'Passwort geändert (Canary neu verschlüsselt und committet). WICHTIG: Alte Inhalte bleiben unter dem alten Passwort, bis du unten „Alles neu verschlüsseln“ ausführst.');
      } else {
        const a = document.createElement('a');
        a.download = 'manifest.json';
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.click();
        setStatus('pw-status', 'Kein Token: manifest.json wurde heruntergeladen — committe sie nach docs/data/. Alte Inhalte bleiben unter dem alten Passwort (siehe „Alles neu verschlüsseln“).');
      }
      $('pw-old').value = $('pw-new').value = $('pw-new2').value = '';
    } catch (e) {
      setStatus('pw-status', e.message, false);
    }
  });
}

// ---------- re-encrypt all content ----------

function initReencrypt() {
  $('re-run').addEventListener('click', async () => {
    const oldPw = $('re-old').value;
    const newPw = $('re-new').value;
    const log = $('re-log');
    log.hidden = false;
    log.textContent = '';
    const line = (s) => { log.textContent += s + '\n'; };
    try {
      if (!gh.isConfigured()) throw new Error('Dafür braucht es Token + Repo (oben) — es liest und schreibt das ganze Repo-Datenverzeichnis.');
      if (!newPw || newPw.length < 8) throw new Error('Neues Passwort: mindestens 8 Zeichen.');
      const manifest = await loadManifestFresh();
      await verifyOld(oldPw, manifest).catch(() => { throw new Error('Altes Passwort ist falsch.'); });
      line('Altes Passwort bestätigt. Sammle Dateien…');
      const dirs = ['data/lessons', 'data/homework', 'data/reports'];
      for (const dir of dirs) {
        const files = await gh.listDir(dir);
        for (const f of files) {
          if (!f.name.endsWith('.enc')) continue;
          const path = `${dir}/${f.name}`;
          line(`→ ${path}`);
          const { text } = await gh.readText(path);
          const plain = await decryptString(oldPw, JSON.parse(text));
          const reenc = JSON.stringify(await encryptString(newPw, plain), null, 2);
          await gh.writeText(path, reenc, `re-encrypt ${f.name}`);
        }
      }
      manifest.canary = await encryptString(newPw, CANARY_VALUE);
      await gh.writeText('data/manifest.json', JSON.stringify(manifest, null, 2), 're-encrypt: rotate canary');
      line('Fertig. Alle Inhalte und der Canary liegen jetzt unter dem neuen Passwort.');
      setStatus('re-status', 'Alles neu verschlüsselt. Ab jetzt gilt nur noch das neue Passwort.');
      $('re-old').value = $('re-new').value = '';
    } catch (e) {
      line(`FEHLER: ${e.message}`);
      setStatus('re-status', e.message, false);
    }
  });
}

initGithub();
initPassword();
initReencrypt();
