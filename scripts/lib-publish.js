// lib-publish.js — publish changed files straight to GitHub over HTTPS via the
// Git Data API (blobs → tree → commit → ref), with NO local git at all.
//
// WHY (FR-003, the unsolved half): the scheduled sandbox mounts `.git/` so that
// CREATE/WRITE succeed but UNLINK is denied. lib-git.js's external GIT_INDEX_FILE
// dodged the `.git/index.lock` case, but `git commit` still writes loose objects
// into `.git/objects/` and then must delete the temp object — that unlink is
// refused ("unable to unlink '.git/objects/…/tmp_obj_…': Operation not permitted"),
// so the commit aborts and nothing publishes. Talking to the Git Data API never
// touches anything under `.git/`, so the mount policy is irrelevant.
//
// Auth: GL_GITHUB_TOKEN (the same token session-end.js pushes with; needs
// contents:write). Blobs are sent base64, so any file publishes byte-exact.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API = 'https://api.github.com';
export const DEFAULT_REPO = 'pushkarjajoria/german_lessons';

async function ghApi(token, repo, path, method = 'GET', body) {
  const res = await fetch(`${API}/repos/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'german-lessons-publish',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// git's blob object id, computed locally — it matches the SHAs the tree API
// returns, so we can tell which files actually changed without uploading them.
function gitBlobSha(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function walk(dir, root, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, root, out);
    else out.push(relative(root, abs).split(sep).join('/'));
  }
  return out;
}

// Publish every file under `subdir` (repo-relative, e.g. 'docs/data') that
// differs from `branch`, as a single commit on top of it. Additive/updating
// only — it never deletes remote files. Returns
//   { published:true, commit, parent, files:[…] }  or  { published:false, reason, files }.
// With `dryRun:true` it stops after change detection and returns the file list
// without creating anything. Throws on a non-fast-forward ref update (remote
// moved) so the caller can reconcile rather than clobber — force is never used.
export async function publishViaApi({ root, subdir, message, token, branch = 'main', repo = DEFAULT_REPO, dryRun = false }) {
  if (!token) throw new Error('no token (GL_GITHUB_TOKEN) — cannot publish over the API');

  // 1. base ref + its tree (recursive), for change detection
  const ref = await ghApi(token, repo, `/git/ref/heads/${branch}`);
  const baseSha = ref.object.sha;
  const baseCommit = await ghApi(token, repo, `/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;
  const remoteTree = await ghApi(token, repo, `/git/trees/${baseTreeSha}?recursive=1`);
  const remoteSha = new Map((remoteTree.tree || []).filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));

  // 2. changed/new local files under subdir
  const changed = [];
  for (const path of walk(join(root, subdir), root)) {
    const buf = readFileSync(join(root, path));
    if (remoteSha.get(path) !== gitBlobSha(buf)) changed.push({ path, buf });
  }
  if (!changed.length) return { published: false, reason: 'no changes vs remote', files: [] };
  if (dryRun) return { published: false, dryRun: true, files: changed.map((c) => c.path), parent: baseSha };

  // 3. blobs → tree → commit → ref (fast-forward only)
  const tree = [];
  for (const c of changed) {
    const blob = await ghApi(token, repo, '/git/blobs', 'POST', { content: c.buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await ghApi(token, repo, '/git/trees', 'POST', { base_tree: baseTreeSha, tree });
  const commit = await ghApi(token, repo, '/git/commits', 'POST', { message, tree: newTree.sha, parents: [baseSha] });
  await ghApi(token, repo, `/git/refs/heads/${branch}`, 'PATCH', { sha: commit.sha, force: false });

  return { published: true, commit: commit.sha, parent: baseSha, files: changed.map((c) => c.path) };
}

// Read-only: the current head SHA of a branch (same anonymous route session-start
// verifies with, but authenticated). Useful to confirm a publish went live.
export async function remoteHead(token, branch = 'main', repo = DEFAULT_REPO) {
  const ref = await ghApi(token, repo, `/git/ref/heads/${branch}`);
  return ref.object.sha;
}
