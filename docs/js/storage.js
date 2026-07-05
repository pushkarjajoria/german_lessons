// storage.js — localStorage helpers. The ONLY secret allowed here is the GitHub PAT
// (user's explicit choice, with a download fallback). The learning password and the
// derived key must NEVER touch localStorage or sessionStorage.

const KEYS = {
  token: 'gl_github_token',
  repo: 'gl_github_repo',     // "owner/name"
  branch: 'gl_github_branch',
};

export function getToken() { return localStorage.getItem(KEYS.token) || ''; }
export function setToken(t) {
  if (t) localStorage.setItem(KEYS.token, t);
  else localStorage.removeItem(KEYS.token);
}

export function getRepo() { return localStorage.getItem(KEYS.repo) || ''; }
export function setRepo(r) {
  if (r) localStorage.setItem(KEYS.repo, r.trim());
  else localStorage.removeItem(KEYS.repo);
}

export function getBranch() { return localStorage.getItem(KEYS.branch) || 'main'; }
export function setBranch(b) {
  if (b) localStorage.setItem(KEYS.branch, b.trim());
  else localStorage.removeItem(KEYS.branch);
}

export function clearAll() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
