#!/usr/bin/env node
// session-end.js — the last thing Frau Richter runs, every session.
//
// It publishes the run and closes it out. The scheduled sandbox mounts `.git/`
// so that writes succeed but UNLINK is denied — `git commit` can never finish
// there (it must delete lock files and temp objects; FR-003). The external-index
// trick dodged `.git/index.lock`, but the loose-object unlink in `.git/objects`
// still killed the commit. So this no longer uses local git to commit or push:
// it publishes the changed files under docs/data straight to GitHub over HTTPS
// via the Git Data API (lib-publish.js), which never touches `.git/`. With
// GL_GITHUB_TOKEN in the gitignored .env the loop closes with nobody in it;
// without one it writes an exact one-paste hand-off. On a normal machine it also
// best-effort syncs the local repo to the just-published commit so `git status`
// stays truthful (harmless if the sandbox refuses those git writes too).
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
import { publishViaApi } from './lib-publish.js';
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

const message = opt('--message') || opt('-m');
if (!message) { console.error('A commit needs a message: --message "lesson 0007: … + conduct …"'); process.exit(1); }

console.log('═══ SESSION END ═══');

const token = process.env.GL_GITHUB_TOKEN;

// --dry-run: show what WOULD publish (docs/data diffed against origin) and stop,
// mutating nothing.
if (args.includes('--dry-run')) {
  if (!token) { console.log('  --dry-run: no GL_GITHUB_TOKEN, cannot diff against origin.'); process.exit(0); }
  try {
    const dry = await publishViaApi({ root: ROOT, subdir: 'docs/data', message, token, dryRun: true });
    if (dry.files?.length) { console.log('  would publish:'); for (const f of dry.files) console.log(`    ${f}`); }
    else console.log('  nothing to publish — docs/data already matches origin.');
  } catch (e) { console.error(`  --dry-run diff failed: ${String(e.message).split('\n')[0]}`); }
  process.exit(0);
}

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

// ---------- 2. publish over the GitHub API (no local git; see lib-publish.js) ----------
if (!token) {
  console.log('  no GL_GITHUB_TOKEN — cannot publish from here.');
  writeHandoff(message, 'no token to publish with — the work is on disk');
  closeClaim('unpublished-no-token');
  console.log('  → hand-off written to frau_richter/NEEDS_ATTENTION.md');
  process.exit(1);
}

let result;
try {
  result = await publishViaApi({ root: ROOT, subdir: 'docs/data', message, token });
} catch (e) {
  const msg = String(e.message).replaceAll(token, '***').split('\n').filter(Boolean)[0];
  console.error(`  PUBLISH FAILED: ${msg}`);
  if (/not a fast|\b(409|422)\b/.test(msg)) console.error('  → origin moved while you were teaching. Re-run session-start.js to pull, then this again.');
  writeHandoff(message, 'API publish failed — the work is on disk, unpublished', msg);
  closeClaim('publish-failed');
  console.log('  → hand-off written to frau_richter/NEEDS_ATTENTION.md');
  process.exit(1);
}

if (!result.published) {
  console.log(`  ${result.reason} — nothing to publish. Done.`);
  clearHandoff();
  closeClaim('published');
  process.exit(0);
}

console.log(`  published ${result.files.length} file(s) as ${result.commit.slice(0, 7)} on ${result.parent.slice(0, 7)} → main. The site redeploys itself.`);
for (const f of result.files) console.log(`    ${f}`);
syncLocalToRemote(result.commit);
clearHandoff();
closeClaim('published');
process.exit(0);

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
  writeFileSync(join(HER_DIR, 'NEEDS_ATTENTION.md'),
`# NEEDS ATTENTION — ${new Date().toISOString().slice(0, 10)}

**${why}.** The teaching work is done and correct on disk; only publishing is left. Nothing is
committed locally (the run publishes over the GitHub API, not local git), so the paste commits
docs/data and pushes it.

${detail ? `Reported error:\n\n\`\`\`\n${detail}\n\`\`\`\n` : ''}
## One paste from your Mac publishes it

\`\`\`bash
cd ~/Github/german_lessons
git add docs/data
git commit -m "${msg.replace(/"/g, '\\"')}"
git push
\`\`\`

If it says the branches diverged, the site moved while I was writing. Nothing is lost —
this reconciles both sides, keeping my ruling and his work:

\`\`\`bash
git pull --rebase && git push
\`\`\`
`);
}

// Best-effort: after an API publish, bring the LOCAL repo to the published commit
// so a human's `git status` tells the truth. Never fatal — the publish is already
// live, and in the scheduled sandbox these git writes may themselves be refused
// (unlink-denied), which is the whole reason we publish over the API. On a normal
// machine it cleans up fully.
function syncLocalToRemote(commit) {
  try {
    execFileSync('git', ['fetch', '--quiet', HTTPS_URL, 'main'], { cwd: ROOT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['reset', '--hard', commit], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', commit], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`  local repo synced to ${commit.slice(0, 7)} — git status is truthful.`);
  } catch {
    console.log('  (local git not synced — expected in the sandbox; the publish is live regardless. `git fetch && git reset --hard origin/main` tidies it on a real machine.)');
  }
}

function clearHandoff() {
  const f = join(HER_DIR, 'NEEDS_ATTENTION.md');
  if (existsSync(f)) writeFileSync(f, `# NEEDS ATTENTION\n\n_Nothing outstanding. The last run published itself at ${new Date().toISOString()}._\n`);
}
