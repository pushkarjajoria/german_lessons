// github.js — GitHub Contents API via fetch, plus a relative-fetch fallback for reads.
// Site paths are relative to docs/ (e.g. "data/manifest.json"); in the repo they live
// under "docs/". Writes require a fine-grained PAT (Contents read/write, this repo only)
// stored in localStorage via the Settings page.

import { getToken, getRepo, getBranch } from './storage.js';

const API = 'https://api.github.com';

export function isConfigured() {
  return Boolean(getToken() && getRepo());
}

function repoPath(sitePath) {
  return 'docs/' + sitePath.replace(/^\/+/, '');
}

function headers() {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Read a text file. Prefers the API when a token is configured (always fresh, and
// returns the sha needed for writes); otherwise fetches relative to the deployed site.
// Returns { text, sha } — sha is null for relative reads. Throws on 404/network errors.
export async function readText(sitePath) {
  if (isConfigured()) {
    try {
      const res = await fetch(
        `${API}/repos/${getRepo()}/contents/${repoPath(sitePath)}?ref=${getBranch()}`,
        { headers: headers(), cache: 'no-store' }
      );
      if (res.ok) {
        const json = await res.json();
        return { text: b64ToUtf8(json.content), sha: json.sha };
      }
      if (res.status !== 404) console.warn(`GitHub API read failed (${res.status}), falling back to site fetch.`);
      if (res.status === 404) throw new Error(`Not found in repo: ${repoPath(sitePath)}`);
    } catch (e) {
      if (String(e.message).startsWith('Not found')) throw e;
      // network/auth problem — fall through to relative fetch
    }
  }
  const res = await fetch(sitePath, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${sitePath} (${res.status})`);
  return { text: await res.text(), sha: null };
}

export async function readJson(sitePath) {
  const { text, sha } = await readText(sitePath);
  return { data: JSON.parse(text), sha };
}

// Create or update a file in the repo. Fetches the current sha automatically.
export async function writeText(sitePath, text, message) {
  if (!isConfigured()) throw new Error('No GitHub token/repo configured (Settings).');
  const path = repoPath(sitePath);
  let sha;
  const probe = await fetch(`${API}/repos/${getRepo()}/contents/${path}?ref=${getBranch()}`, {
    headers: headers(), cache: 'no-store',
  });
  if (probe.ok) sha = (await probe.json()).sha;
  const body = { message, content: utf8ToB64(text), branch: getBranch() };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${getRepo()}/contents/${path}`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub write failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

// List files in a docs/-relative directory via the API. Returns [{name, path, sha}].
export async function listDir(siteDir) {
  if (!isConfigured()) throw new Error('No GitHub token/repo configured (Settings).');
  const res = await fetch(
    `${API}/repos/${getRepo()}/contents/${repoPath(siteDir)}?ref=${getBranch()}`,
    { headers: headers(), cache: 'no-store' }
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list failed (${res.status})`);
  const items = await res.json();
  return items.filter((i) => i.type === 'file').map((i) => ({ name: i.name, sha: i.sha }));
}

// Verify the token can see the repo. Returns { ok, error? }.
export async function checkAccess() {
  if (!isConfigured()) return { ok: false, error: 'Token or repo missing.' };
  try {
    const res = await fetch(`${API}/repos/${getRepo()}`, { headers: headers(), cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} — check token scope and repo name.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
