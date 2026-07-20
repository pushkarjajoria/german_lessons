#!/usr/bin/env node
// session-start.js — the first thing Frau Richter runs, every session.
//
// It exists because of two failures that cost a real week of teaching:
//
//   1. STALE READ (2026-07-15). The run judged "homework 0005 not done" from a
//      manifest that was behind origin, withheld a lesson, and published a note
//      instructing work already finished. The report file was sitting on disk
//      the whole time. Standing rule since: the REPORT FILES are the truth,
//      the manifest is a cache. This script enforces that rule in code.
//
//   2. DIVERGENCE. Her scheduled sandbox cannot push (no SSH key, no known
//      hosts), so her commits pile up locally while the website pushes the
//      learner's work to origin. Every few days the two histories diverge and
//      someone has to untangle them by hand. Rebasing her local work onto
//      origin at the START of each session keeps her commits on top, so the
//      learner's eventual push is always a clean fast-forward.
//
// The repo is PUBLIC, so fetching needs no credentials at all — plain HTTPS,
// no SSH, no token. That is what makes this work inside the sandbox.
//
// Usage:  node scripts/session-start.js            # sync + report
//         node scripts/session-start.js --no-sync  # report only (offline)

import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const REPORTS_DIR = join(ROOT, 'docs', 'data', 'reports');
const HTTPS_URL = 'https://github.com/pushkarjajoria/german_lessons.git';

const args = process.argv.slice(2);
const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gitQuiet = (cmd) => { try { return git(cmd); } catch (e) { return null; } };

const line = (s = '') => console.log(s);
const warn = (s) => console.log(`  !! ${s}`);

line('═══ SESSION START ═══');

// ---------- 1. stale index.lock ----------
// The sandbox has repeatedly hit an index.lock it could not remove, which makes
// every `git add` fail. A lock with no git process behind it is just litter —
// remove it. If it will not go, say so plainly rather than failing later.
const LOCK = join(ROOT, '.git', 'index.lock');
if (existsSync(LOCK)) {
  let held = false;
  try {
    // gitstatusd (shell prompt daemon) is read-only and does not count.
    held = execSync('pgrep -f "git (add|commit|rebase|merge|pull)" || true', { encoding: 'utf8' }).trim().length > 0;
  } catch { /* pgrep unavailable — assume not held */ }
  if (held) {
    warn('.git/index.lock is held by a running git process — leaving it alone.');
  } else {
    try {
      const age = Math.round((Date.now() - statSync(LOCK).mtimeMs) / 1000);
      unlinkSync(LOCK);
      line(`  cleared a stale .git/index.lock (${age}s old, no git process behind it)`);
    } catch (e) {
      warn(`.git/index.lock exists and cannot be removed (${e.code}). ` +
           'git add/commit will fail this run — your work still lands on disk; ' +
           'the handoff in frau_richter/NEEDS_ATTENTION.md will carry it.');
    }
  }
}

// ---------- 2. sync with origin ----------
let synced = false;
if (!args.includes('--no-sync')) {
  try {
    // Anonymous HTTPS: public repo, no SSH key, no token, no prompt.
    execFileSync('git', ['fetch', '--quiet', HTTPS_URL, 'main'], {
      cwd: ROOT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    synced = true;
    const remote = git('rev-parse FETCH_HEAD');
    const local = git('rev-parse HEAD');
    const behind = Number(gitQuiet(`rev-list --count HEAD..${remote}`) || 0);
    const ahead = Number(gitQuiet(`rev-list --count ${remote}..HEAD`) || 0);

    if (remote === local) {
      line('  in sync with origin.');
    } else if (behind && !ahead) {
      const dirty = git('status --porcelain').length > 0;
      if (dirty) {
        warn(`${behind} new commit(s) on origin, but the working tree is dirty — not touching it. Commit or stash, then re-run.`);
      } else {
        git(`merge --ff-only ${remote}`);
        line(`  fast-forwarded ${behind} commit(s) from origin — you are now reading current state.`);
      }
    } else if (ahead) {
      const dirty = git('status --porcelain').length > 0;
      if (dirty) {
        warn(`${ahead} unpushed local commit(s) and a dirty tree — not rebasing. Commit first, then re-run.`);
      } else if (behind) {
        // The weekly collision: her commits vs the learner's pushed work.
        // Replay hers on top so the eventual push is a fast-forward.
        try {
          git(`rebase ${remote}`);
          line(`  rebased ${ahead} local commit(s) onto ${behind} new commit(s) from origin — histories reconciled.`);
        } catch (e) {
          gitQuiet('rebase --abort');
          warn('REBASE CONFLICT — aborted, nothing changed. The two sides touched the same lines. ' +
               'Do not hand-resolve blind: note it in frau_richter/NEEDS_ATTENTION.md for the Mac.');
        }
      } else {
        line(`  ${ahead} local commit(s) waiting to be pushed (origin has nothing new).`);
      }
    }
  } catch (e) {
    warn('could not reach origin (offline?) — reading the local copy. ' +
         'Treat the manifest as possibly stale and trust the report files below.');
  }
}

// ---------- 3. the authoritative record ----------
// Files first, manifest second. If they disagree, the files win — that is the
// standing rule adopted after the Jul-15 misjudgement.
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const history = manifest.history || [];
const inHistory = new Set(history.map((h) => String(h.reportId)));

const reportFiles = existsSync(REPORTS_DIR)
  ? readdirSync(REPORTS_DIR).filter((f) => /^report-\d+\.json\.enc$/.test(f)).sort()
  : [];
const reportIds = reportFiles.map((f) => f.match(/report-(\d+)\./)[1]);
const unrecorded = reportIds.filter((id) => !inHistory.has(id));

line();
line('── THE RECORD (files first, manifest second) ──');
line(`  report files on disk : ${reportIds.length ? reportIds.join(', ') : '(none)'}`);
line(`  recorded in manifest : ${history.length ? history.map((h) => h.reportId).join(', ') : '(none)'}`);
if (unrecorded.length) {
  warn(`REPORT FILE(S) NOT IN THE MANIFEST: ${unrecorded.join(', ')}. ` +
       'The work WAS done — read those files before judging. Do not conclude "not practised".');
} else if (reportIds.length) {
  line('  ✓ files and manifest agree.');
}

const current = manifest.currentHomeworkId;
line();
line(`  current lesson/homework : ${manifest.currentLessonId} / ${current}` +
     (inHistory.has(String(current)) ? '  (report is IN — it was done)' : '  (no report yet)'));
line(`  last practised          : ${manifest.counters?.lastPracticed || '—'}`);
line(`  Betragen                : ${manifest.conduct?.score ?? 65}/100`);

const open = (manifest.corrections || []).filter((c) => c.status === 'open');
line(`  Korrektur open          : ${open.length}${open.length ? ' — ' + open.map((c) => c.key).join(', ') : ''}`);

const done = new Set(history.map((h) => String(h.homeworkId)));
const filed = Object.keys(manifest.assignmentReports || {});
const owed = [...done].filter((id) => !filed.includes(id)).sort();
line(`  Berichte filed          : ${filed.length ? filed.join(', ') : '(none)'}`);
line(`  Berichte owed           : ${owed.length ? owed.join(', ') : 'none'}`);

const pending = (manifest.requests || []).filter((r) => r.status === 'pending');
line(`  Anträge pending         : ${pending.length}`);
const unread = (manifest.messages || []).filter((m) => m.from === 'learner' && !m.readByTeacher);
line(`  Messages from him       : ${(manifest.messages || []).filter((m) => m.from === 'learner').length}`);

// ---------- 4. the seal ----------
line();
if (existsSync(join(ROOT, 'frau_richter', 'SEAL_BREACH.md'))) {
  line('  ⚠ frau_richter/SEAL_BREACH.md EXISTS — the guardrail was tampered with. Read it and rule.');
} else {
  line('  seal: no breach reported.');
}

line();
line(synced ? '═══ synced. Teach. ═══' : '═══ NOT synced — state may be stale. ═══');
