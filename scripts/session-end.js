#!/usr/bin/env node
// session-end.js — the last thing Frau Richter runs, every session.
//
// It commits the run and publishes it. Two sandbox facts shape the whole file:
//
//   * COMMIT: the mount denies unlink inside `.git/`, so a stale index.lock
//     would otherwise block `git add` forever (FR-003). We commit through an
//     index held in the system temp dir, where locks can be created AND
//     removed, so `.git/index.lock` is irrelevant. See lib-git.js.
//   * PUSH: there is no SSH key there. With GL_GITHUB_TOKEN in the gitignored
//     .env it pushes over authenticated HTTPS and the loop closes with nobody
//     in it; without one it writes an exact one-paste hand-off.
//
// It also closes the run claim (FR-006) and marks the Berichte that
// session-start.js printed as read (FR-001) — "filed" is not "read", and it is
// the reading that changes the teaching.
//
// Usage:  node scripts/session-end.js --message "lesson 0007: … + conduct …"
//         node scripts/session-end.js --message "…" --dry-run

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canUnlinkInGitDir, withExternalIndex, changedFiles, resyncDefaultIndex } from './lib-git.js';
// Side-effect import: lib-crypto.js loads the gitignored .env (GL_PASSWORD,
// GL_GITHUB_TOKEN) on module load. Without this, GL_GITHUB_TOKEN is never
// populated here even when it's sitting in .env, and every run silently
// falls back to the hand-off instead of pushing.
import './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HER_DIR = join(ROOT, 'frau_richter');
const CLAIM = join(HER_DIR, 'RUN_CLAIM.json');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const HTTPS_URL = 'https://github.com/pushkarjajoria/german_lessons.git';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const gitQ = (a) => {
  try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
};

const message = opt('--message') || opt('-m');
if (!message) { console.error('A commit needs a message: --message "lesson 0007: … + conduct …"'); process.exit(1); }

console.log('═══ SESSION END ═══');

// changedFiles(), not raw `git status`: the default index can be stale from
// an earlier withExternalIndex() commit, and raw status would then lie
// (observed: every already-committed file reported as both staged AND
// unstaged). This reports the true diff against HEAD.
const toPublish = changedFiles(ROOT);
if (toPublish.length) { console.log('  changes to publish:'); for (const l of toPublish) console.log(`    ${l}`); }
else console.log('  nothing new in the working tree.');

if (args.includes('--dry-run')) { console.log('  --dry-run: stopping before commit.'); process.exit(0); }

// ---------- 1. mark the Berichte she was shown as read (FR-001) ----------
// Done before the commit so it rides along in the same publish.
let claim = null;
try { claim = existsSync(CLAIM) ? JSON.parse(readFileSync(CLAIM, 'utf8')) : null; } catch { /* ignore */ }
if (claim?.berichteShown?.length) {
  try {
    const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const stamp = new Date().toISOString();
    let n = 0;
    for (const id of claim.berichteShown) {
      if (m.assignmentReports?.[id] && !m.assignmentReports[id].readByTeacher) {
        m.assignmentReports[id].readByTeacher = stamp;
        n += 1;
      }
    }
    if (n) { writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); console.log(`  marked ${n} Bericht(e) read: ${claim.berichteShown.join(', ')}`); }
  } catch (e) { console.log(`  (could not mark Berichte read: ${e.message})`); }
}

// ---------- 2. commit, through an index that cannot be locked out ----------
const mount = canUnlinkInGitDir(ROOT);
let committed = false;
if (toPublish.length) {
  let g = null;
  try {
    g = withExternalIndex(ROOT);
    g.git(['add', 'docs/data']);
    const staged = g.git(['diff', '--cached', '--name-only']).trim();
    if (!staged) console.log('  nothing under docs/data changed — nothing to commit.');
    else {
      g.git(['commit', '-m', message]);
      committed = true;
      console.log(`  committed${mount.unlinkable ? '' : ' (external index — the stale .git/index.lock was bypassed)'}: ${message}`);
    }
  } catch (e) {
    const msg = String(e.stderr || e.message).split('\n').filter(Boolean)[0] || String(e.message);
    console.error(`  COMMIT FAILED: ${msg}`);
    writeHandoff(message, 'commit failed — the work is on disk but uncommitted', msg);
    closeClaim('commit-failed');
    console.log('  → hand-off written to frau_richter/NEEDS_ATTENTION.md');
    process.exit(1);
  } finally {
    if (g) g.dispose();
  }
  // Best-effort: bring the default index back in sync with the new HEAD so a
  // plain `git status` (run by a human, or any script that forgets to use
  // changedFiles()/isDirty()) reports truthfully afterward. Silent failure
  // is fine — nothing in this file depends on it having worked.
  if (committed) resyncDefaultIndex(ROOT);
}

const unpushed = Number(gitQ(['rev-list', '--count', 'origin/main..HEAD']) || 0);
if (!unpushed) { console.log('  nothing to push. Done.'); closeClaim('published'); process.exit(0); }

// ---------- 3. push ----------
const token = process.env.GL_GITHUB_TOKEN;
if (token) {
  try {
    const authUrl = HTTPS_URL.replace('https://', `https://x-access-token:${token}@`);
    execFileSync('git', ['push', authUrl, 'HEAD:main'], {
      cwd: ROOT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`  pushed ${unpushed} commit(s) to origin. The site redeploys itself.`);
    // FR-008: this push went straight to HTTPS, bypassing the `origin` remote
    // entirely (it's an SSH URL, unreachable here) — so refs/remotes/origin/main
    // never moves, and a plain `git status` right after a genuinely successful
    // push falsely reports "ahead N". Verify what's actually live (same
    // anonymous-HTTPS route session-start.js fetches with) and correct the
    // local tracking ref to match, so raw git stops disagreeing with reality.
    try {
      const lsRemote = execFileSync('git', ['ls-remote', HTTPS_URL, 'refs/heads/main'], {
        encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const remoteHead = lsRemote.split('\t')[0].trim();
      const localHead = gitQ(['rev-parse', 'HEAD']);
      if (remoteHead && remoteHead === localHead) {
        execFileSync('git', ['update-ref', 'refs/remotes/origin/main', remoteHead], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        console.log(`  verified live: origin/main is ${remoteHead.slice(0, 7)}, matches HEAD. Tracking ref corrected — git status will tell the truth now.`);
      } else {
        console.error(`  WARNING: origin/main (${(remoteHead || '?').slice(0, 7)}) does not match local HEAD (${(localHead || '?').slice(0, 7)}) after a "successful" push — do not trust this run's publish without checking by hand.`);
      }
    } catch (e) {
      console.error(`  could not verify the remote head after pushing (${String(e.message).split('\n')[0]}) — the push itself succeeded, but confirm with 'git ls-remote' before assuming git status is trustworthy.`);
    }
    clearHandoff();
    closeClaim('published');
    process.exit(0);
  } catch (e) {
    const msg = String(e.stderr || e.message).replaceAll(token, '***');
    console.error(`  PUSH FAILED: ${msg.split('\n').filter(Boolean).slice(0, 2).join(' ')}`);
    if (/non-fast-forward|rejected/.test(msg)) {
      console.error('  → origin moved while you were teaching. Re-run session-start.js (it rebases), then this again.');
    }
  }
} else {
  console.log('  no GL_GITHUB_TOKEN — cannot push from here (no SSH key in this sandbox).');
}

writeHandoff(message, `${unpushed} commit(s) committed locally, not pushed`);
closeClaim('committed-not-pushed');
console.log('  → hand-off written to frau_richter/NEEDS_ATTENTION.md');

// ---------- helpers ----------

function closeClaim(outcome) {
  if (!claim) return;
  try {
    claim.closedAt = new Date().toISOString();
    claim.outcome = outcome;
    writeFileSync(CLAIM, JSON.stringify(claim, null, 2));
  } catch { /* not worth failing the run over */ }
}

function writeHandoff(msg, why, detail = '') {
  mkdirSync(HER_DIR, { recursive: true });
  const log = gitQ(['log', '--oneline', 'origin/main..HEAD']) || gitQ(['log', '--oneline', '-3']) || '';
  writeFileSync(join(HER_DIR, 'NEEDS_ATTENTION.md'),
`# NEEDS ATTENTION — ${new Date().toISOString().slice(0, 10)}

**${why}.** The teaching work is done and correct on disk; only publishing is left.

${detail ? `Reported error:\n\n\`\`\`\n${detail}\n\`\`\`\n` : ''}
## One paste from your Mac publishes it

\`\`\`bash
cd ~/Github/german_lessons
git push
\`\`\`

If it says the branches diverged, the site pushed while I was writing. Nothing is lost —
this reconciles both sides, keeping my ruling and his work:

\`\`\`bash
git pull --rebase && git push
\`\`\`

## Commits waiting

\`\`\`
${log}
\`\`\`

_Last run's commit message: ${msg}_
`);
}

function clearHandoff() {
  const f = join(HER_DIR, 'NEEDS_ATTENTION.md');
  if (existsSync(f)) writeFileSync(f, `# NEEDS ATTENTION\n\n_Nothing outstanding. The last run published itself at ${new Date().toISOString()}._\n`);
}
