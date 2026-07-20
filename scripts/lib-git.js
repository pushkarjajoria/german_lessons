// lib-git.js — git that survives Frau Richter's sandbox (FR-003).
//
// THE PROBLEM she diagnosed precisely on 2026-07-20: the scheduled sandbox's
// mount permits CREATE and WRITE inside `.git/` but denies UNLINK. `touch
// .git/__probe` succeeds; `rm .git/__probe` returns *Operation not permitted*,
// on a file she owns at mode 600. It is a mount policy, not a permission bug,
// so `rm -f .git/index.lock` can never succeed there.
//
// Because git creates that lock with O_CREAT|O_EXCL, a single stale
// `.git/index.lock` makes EVERY index-touching command fail forever —
// `git add`, `git commit`, `git stash`. One appeared mid-session and a whole
// run of teaching (a lesson written specifically to correct false statements
// about the learner) was left stranded on disk, unpublishable.
//
// THE ROUTE OUT, which is the one she suggested: git honours GIT_INDEX_FILE.
// Point it at a path under the system temp dir — where unlink works — and the
// index lock is created and removed THERE. `.git/index.lock` is never opened,
// so a stale one becomes irrelevant litter rather than a permanent blockade.
// The index must be seeded from HEAD first (`git read-tree HEAD`), otherwise
// git sees an empty index and treats every tracked file as deleted.
//
// This is deliberately NOT a "clean up git's internals" workaround — nothing
// here deletes or rewrites anything inside `.git/`. It only moves the scratch
// index somewhere writable, which is a documented, supported git feature.

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Can we delete files inside .git/ on this mount? Her sandbox cannot; a Mac can.
export function canUnlinkInGitDir(root) {
  const probe = join(root, '.git', `__probe_${process.pid}`);
  try {
    writeFileSync(probe, '');
  } catch {
    return { writable: false, unlinkable: false };
  }
  try {
    unlinkSync(probe);
    return { writable: true, unlinkable: true };
  } catch {
    // Left behind on purpose — we cannot remove it, and saying so is the point.
    return { writable: true, unlinkable: false };
  }
}

// A git environment whose index lives where unlink is permitted.
export function withExternalIndex(root) {
  const indexPath = join(tmpdir(), `gl-index-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  // Seed from HEAD, or git considers everything deleted.
  execFileSync('git', ['read-tree', 'HEAD'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    env,
    indexPath,
    git(args, opts = {}) {
      return execFileSync('git', args, {
        cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
      });
    },
    dispose() {
      try { if (existsSync(indexPath)) rmSync(indexPath, { force: true }); } catch { /* temp litter */ }
    },
  };
}

// Dirty-check that NEVER touches `.git/index` — it seeds a throwaway external
// index from HEAD and diffs that against the working tree. Plain `git status`
// depends on the default index being in sync with HEAD, which is exactly what
// breaks once a commit has ever been made through withExternalIndex() (that
// path advances HEAD without touching the default index, so a later plain
// `git status` reports every changed file as BOTH staged and unstaged — real,
// observed, not hypothetical). Use this everywhere a script needs to know
// "is the tree actually dirty", so that staleness can never cause a wrong
// decision (skipping a rebase that was safe, or attempting one that wasn't).
export function changedFiles(root) {
  const g = withExternalIndex(root);
  try {
    g.git(['add', '-A']);
    const out = g.git(['diff', '--cached', '--name-status', 'HEAD']).trim();
    return out ? out.split('\n') : [];
  } finally {
    g.dispose();
  }
}

export function isDirty(root) {
  return changedFiles(root).length > 0;
}

// After a commit made through withExternalIndex(), the default `.git/index`
// still reflects the OLD HEAD. Best-effort bring it back in sync so a plain
// `git status` (run by a human, or a future script that forgets to use
// isDirty()) reports truthfully. Only attempted when this mount can actually
// write a lock file and rename it into place; failure here is silent and
// harmless — isDirty()/withExternalIndex() never depend on this having run.
export function resyncDefaultIndex(root) {
  try {
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// Best-effort removal of a stale lock; honest about failure (FR-003 part 1).
// A lock held by a live git process is left strictly alone.
export function clearStaleIndexLock(root) {
  const lock = join(root, '.git', 'index.lock');
  if (!existsSync(lock)) return { present: false, cleared: false };
  let held = false;
  try {
    held = execFileSync('/bin/sh', ['-c', 'pgrep -f "git (add|commit|rebase|merge|pull|stash)" || true'],
      { encoding: 'utf8' }).trim().length > 0;
  } catch { /* pgrep unavailable */ }
  if (held) return { present: true, cleared: false, held: true };
  try {
    unlinkSync(lock);
    return { present: true, cleared: true };
  } catch (e) {
    return { present: true, cleared: false, error: e.code || String(e.message) };
  }
}
