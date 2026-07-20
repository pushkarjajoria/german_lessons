#!/usr/bin/env node
// session-end.js — the last thing Frau Richter runs, every session.
//
// Her sandbox can FETCH (the repo is public, plain HTTPS) but cannot PUSH:
// there is no SSH key and no known_hosts there, so `git push` dies with
// "Host key verification failed". Her work therefore has to reach origin one
// of two ways, and this script takes whichever is available:
//
//   * GL_GITHUB_TOKEN set (in the gitignored .env, beside GL_PASSWORD) →
//     it pushes over authenticated HTTPS itself, and the loop closes with no
//     human in it. The token is never written to the repo, never printed, and
//     never stored in git config — it lives only in the .env and in the URL
//     of a single push invocation.
//   * No token → it commits anyway and writes an exact, copy-pasteable
//     handoff into frau_richter/NEEDS_ATTENTION.md, so the Mac can publish
//     the run with one paste.
//
// Either way her work is COMMITTED, which is what stops the weekly divergence
// from getting worse.
//
// Usage:  node scripts/session-end.js --message "lesson 0007: … + conduct …"
//         node scripts/session-end.js --message "…" --dry-run

import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HER_DIR = join(ROOT, 'frau_richter');
const HTTPS_URL = 'https://github.com/pushkarjajoria/german_lessons.git';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitQuiet = (cmd) => { try { return git(cmd); } catch { return null; } };

const message = opt('--message') || opt('-m');
if (!message) {
  console.error('A commit needs a message: --message "lesson 0007: … + conduct …"');
  process.exit(1);
}

console.log('═══ SESSION END ═══');

// ---------- 1. what is there to publish? ----------
const dirty = git('status --porcelain');
if (!dirty) {
  console.log('  nothing new in the working tree.');
} else {
  console.log('  changes to publish:');
  for (const l of dirty.split('\n')) console.log(`    ${l}`);
}

if (args.includes('--dry-run')) {
  console.log('  --dry-run: stopping before commit.');
  process.exit(0);
}

// ---------- 2. commit ----------
// Only the published surface. Plaintext sources (scripts/templates/) and her
// private notes are gitignored and stay out by construction.
if (dirty) {
  try {
    git('add docs/data');
    // Her own notes are gitignored; add anything else she deliberately touched.
    const staged = git('diff --cached --name-only');
    if (!staged) {
      console.log('  nothing under docs/data changed — nothing to commit.');
    } else {
      execFileSync('git', ['commit', '-m', message], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      console.log(`  committed: ${message}`);
    }
  } catch (e) {
    const msg = String(e.stderr || e.message);
    console.error(`  COMMIT FAILED: ${msg.split('\n')[0]}`);
    if (msg.includes('index.lock')) {
      console.error('  → a stale .git/index.lock is in the way; session-start.js clears it when it can.');
    }
    writeHandoff(message, 'commit failed — the work is on disk but uncommitted');
    process.exit(1);
  }
}

const unpushed = Number(gitQuiet('rev-list --count @{u}..HEAD') || gitQuiet('rev-list --count origin/main..HEAD') || 0);
if (!unpushed) {
  console.log('  nothing to push. Done.');
  process.exit(0);
}

// ---------- 3. push, if we have a way ----------
const token = process.env.GL_GITHUB_TOKEN;
if (token) {
  try {
    // Token only ever appears in this one argv, never in config or the repo.
    const authUrl = HTTPS_URL.replace('https://', `https://x-access-token:${token}@`);
    execFileSync('git', ['push', authUrl, 'HEAD:main'], {
      cwd: ROOT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(`  pushed ${unpushed} commit(s) to origin over HTTPS. The site redeploys itself.`);
    clearHandoff();
    process.exit(0);
  } catch (e) {
    const msg = String(e.stderr || e.message).replace(token, '***');
    console.error(`  PUSH FAILED: ${msg.split('\n').slice(0, 2).join(' ')}`);
  }
} else {
  console.log('  no GL_GITHUB_TOKEN — cannot push from here (SSH is unavailable in this sandbox).');
}

writeHandoff(message, `${unpushed} commit(s) committed locally, not pushed`);
console.log('  → handoff written to frau_richter/NEEDS_ATTENTION.md');

// ---------- handoff ----------

function writeHandoff(msg, why) {
  mkdirSync(HER_DIR, { recursive: true });
  const when = new Date().toISOString();
  const log = gitQuiet('log --oneline origin/main..HEAD') || gitQuiet('log --oneline -3') || '';
  writeFileSync(join(HER_DIR, 'NEEDS_ATTENTION.md'),
`# NEEDS ATTENTION — ${when.slice(0, 10)}

**${why}.** The teaching work itself is done and correct on disk; only publishing is left.
The scheduled sandbox has no SSH key, so it cannot push.

## One paste from your Mac publishes it

\`\`\`bash
cd ~/Github/german_lessons
git push
\`\`\`

If that says the branches diverged, the learner's site pushed while I was writing.
Nothing is lost — this reconciles both sides and keeps my ruling and his work:

\`\`\`bash
git pull --rebase && git push
\`\`\`

## Commits waiting

\`\`\`
${log}
\`\`\`

## To stop seeing this file every week

Put a GitHub token with \`contents: write\` in the gitignored \`.env\`, beside GL_PASSWORD:

\`\`\`
GL_GITHUB_TOKEN=github_pat_…
\`\`\`

Then \`session-end.js\` pushes on its own and the loop closes with no human in it.
The token never enters the repo — \`.env\` is gitignored, and it is never written to
git config or printed.

_Last run's commit message: ${msg}_
`);
}

function clearHandoff() {
  const f = join(HER_DIR, 'NEEDS_ATTENTION.md');
  if (existsSync(f)) {
    writeFileSync(f, `# NEEDS ATTENTION\n\n_Nothing outstanding. Last run published itself at ${new Date().toISOString()}._\n`);
  }
}
