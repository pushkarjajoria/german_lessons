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
  $('gh-token').placeholder = store.getToken() ? '•••••••• (token saved)' : 'github_pat_…';

  $('gh-save').addEventListener('click', async () => {
    store.setRepo($('gh-repo').value);
    store.setBranch($('gh-branch').value || 'main');
    if ($('gh-token').value.trim()) store.setToken($('gh-token').value.trim());
    $('gh-token').value = '';
    $('gh-token').placeholder = store.getToken() ? '•••••••• (token saved)' : 'github_pat_…';
    const check = await gh.checkAccess();
    setStatus('gh-status', check.ok
      ? 'Saved. Repo access confirmed.'
      : `Saved, but the access test failed: ${check.error}`, check.ok);
  });

  $('gh-clear').addEventListener('click', () => {
    store.setToken('');
    $('gh-token').value = '';
    $('gh-token').placeholder = 'github_pat_…';
    setStatus('gh-status', 'Token removed from this browser.');
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
      if (!newPw || newPw.length < 8) throw new Error('New password: at least 8 characters.');
      if (newPw !== newPw2) throw new Error('The new passwords do not match.');
      setStatus('pw-status', 'Checking the old password…');
      const manifest = await loadManifestFresh();
      await verifyOld(oldPw, manifest).catch(() => { throw new Error('The old password is wrong — it does not decrypt the canary.'); });
      manifest.canary = await encryptString(newPw, CANARY_VALUE);
      const text = JSON.stringify(manifest, null, 2);
      if (gh.isConfigured()) {
        await gh.writeText('data/manifest.json', text, 'settings: rotate canary (password change)');
        setStatus('pw-status', 'Password changed (canary re-encrypted and committed). IMPORTANT: existing content stays under the old password until you run "Re-encrypt everything" below.');
      } else {
        const a = document.createElement('a');
        a.download = 'manifest.json';
        a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        a.click();
        setStatus('pw-status', 'No token: manifest.json was downloaded — commit it to docs/data/. Existing content stays under the old password (see "Re-encrypt everything").');
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
      if (!gh.isConfigured()) throw new Error('This needs token + repo (above) — it reads and rewrites the whole data directory in the repo.');
      if (!newPw || newPw.length < 8) throw new Error('New password: at least 8 characters.');
      const manifest = await loadManifestFresh();
      await verifyOld(oldPw, manifest).catch(() => { throw new Error('The old password is wrong.'); });
      line('Old password confirmed. Collecting files…');
      // 'data' itself covers top-level .enc files like the portrait;
      // listDir returns files only and the loop skips non-.enc entries.
      const dirs = ['data', 'data/lessons', 'data/homework', 'data/reports', 'data/tests'];
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
      line('Done. All content and the canary are now under the new password.');
      setStatus('re-status', 'Everything re-encrypted. From now on only the new password works.');
      $('re-old').value = $('re-new').value = '';
    } catch (e) {
      line(`ERROR: ${e.message}`);
      setStatus('re-status', e.message, false);
    }
  });
}

initGithub();
initPassword();
initReencrypt();
