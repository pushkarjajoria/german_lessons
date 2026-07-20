#!/usr/bin/env node
// session-start.js — the first thing Frau Richter runs, every session.
//
// It exists because of failures that each cost real teaching:
//
//   1. STALE READ (2026-07-15, again 07-20). A run judged "homework not done"
//      from a manifest behind origin while the report sat on disk, withheld a
//      lesson, and published a note instructing work already finished.
//      Standing rule since: the FILES are the truth, the manifest is a cache.
//   2. DIVERGENCE. Her commits piled up locally while the site pushed his work.
//   3. UNREAD BERICHTE (FR-001). "Filed" is not "read". Twice she ruled on his
//      conduct while the decisive information sat unread in that channel, so
//      the unread ones are now printed IN FULL, not merely counted.
//   4. SILENT LOCK FAILURE (FR-003). When the sandbox could not clear a stale
//      index.lock this script said only "in sync with origin" — and a whole
//      session was taught believing it would publish. It never does that again.
//   5. COLLIDING TWINS (FR-006). Two scheduled tasks share this repo; the only
//      thing keeping them apart was prose. Now there is a claim file.
//
// Usage:  node scripts/session-start.js
//         node scripts/session-start.js --no-sync   # offline: report only
//         node scripts/session-start.js --intent "Wednesday consolidation"

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString } from './lib-crypto.js';
import { canUnlinkInGitDir, clearStaleIndexLock, isDirty } from './lib-git.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const REPORTS_DIR = join(ROOT, 'docs', 'data', 'reports');
const HER_DIR = join(ROOT, 'frau_richter');
const CLAIM = join(HER_DIR, 'RUN_CLAIM.json');
const HTTPS_URL = 'https://github.com/pushkarjajoria/german_lessons.git';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const git = (a, o = {}) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim();
const gitQ = (a) => { try { return git(a); } catch { return null; } };
const line = (s = '') => console.log(s);
const warn = (s) => console.log(`  !! ${s}`);

line('═══ SESSION START ═══');

// ---------- 1. can this mount publish at all? (FR-003) ----------
const mount = canUnlinkInGitDir(ROOT);
const lock = clearStaleIndexLock(ROOT);
let publishRoute = 'normal';

if (!mount.writable) {
  warn('.git/ IS NOT WRITABLE HERE. No commit is possible this session. ' +
       'Teach if you wish, but assume NOTHING will publish — session-end.js will write a hand-off.');
  publishRoute = 'blocked';
} else if (!mount.unlinkable) {
  // Her sandbox exactly: create/write allowed, unlink denied.
  publishRoute = 'external-index';
  line('  mount: .git/ is write-only (unlink denied) — using an external index so locks cannot block us.');
  if (lock.present && !lock.cleared) {
    line('         a stale .git/index.lock is present and cannot be removed — ' +
         'that is expected here and NO LONGER BLOCKS PUBLISHING.');
  }
} else {
  if (lock.present && lock.cleared) line('  cleared a stale .git/index.lock.');
  else if (lock.present && lock.held) warn('.git/index.lock is held by a live git process — left alone.');
  else if (lock.present) warn(`.git/index.lock present and unremovable (${lock.error}) — will use an external index.`);
  if (lock.present && !lock.cleared) publishRoute = 'external-index';
}

// ---------- 2. run claim (FR-006) ----------
mkdirSync(HER_DIR, { recursive: true });
const now = new Date();
const runId = `${now.toISOString().slice(0, 10)}-${now.toISOString().slice(11, 16).replace(':', '')}`;
if (existsSync(CLAIM)) {
  try {
    const prev = JSON.parse(readFileSync(CLAIM, 'utf8'));
    if (!prev.closedAt) {
      warn(`AN EARLIER RUN NEVER CLOSED ITS CLAIM: ${prev.runId} (${prev.weekday}, intent: ${prev.intent || 'unstated'}).`);
      warn('It may have died mid-session. Check whether its work published BEFORE authoring anything new — ' +
           'do not assume a lesson it started is either finished or absent.');
    }
  } catch { /* unreadable claim is not worth failing over */ }
}

// ---------- 3. sync with origin ----------
let synced = false;
if (!args.includes('--no-sync')) {
  try {
    execFileSync('git', ['fetch', '--quiet', HTTPS_URL, 'main'], {
      cwd: ROOT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    synced = true;
    const remote = git(['rev-parse', 'FETCH_HEAD']);
    const local = git(['rev-parse', 'HEAD']);
    const behind = Number(gitQ(['rev-list', '--count', `HEAD..${remote}`]) || 0);
    const ahead = Number(gitQ(['rev-list', '--count', `${remote}..HEAD`]) || 0);
    // isDirty(), not `git status --porcelain`: the latter reads the default
    // index, which goes stale the moment any commit is made through
    // withExternalIndex() (see lib-git.js) — HEAD moves, the default index
    // doesn't, and a truthful tree shows up as dirty forever after. isDirty()
    // never depends on the default index being in sync with anything.
    const dirty = isDirty(ROOT);
    // merge/rebase still touch the DEFAULT index directly (unlike the commit
    // path). On a mount that denies unlink AND still has an uncleared lock,
    // these can fail exactly as `git add` used to — that residual risk is
    // real and not yet routed around (FR-003 covers the commit path only).
    // Both are wrapped so a failure here is reported plainly, never a crash.

    if (remote === local) line('  in sync with origin.');
    else if (behind && !ahead && !dirty) {
      try { git(['merge', '--ff-only', remote]); line(`  fast-forwarded ${behind} commit(s) from origin.`); }
      catch (e) { warn(`could not fast-forward (${String(e.stderr || e.message).split('\n')[0]}) — leaving it for the Mac.`); }
    }
    else if (behind && !ahead && dirty) warn(`${behind} new commit(s) on origin but the tree is dirty — not touching it.`);
    else if (ahead && behind && !dirty) {
      try { git(['rebase', remote]); line(`  rebased ${ahead} local commit(s) onto ${behind} from origin — histories reconciled.`); }
      catch (e) {
        gitQ(['rebase', '--abort']);
        warn(`REBASE FAILED (${String(e.stderr || e.message).split('\n')[0]}) — aborted, nothing changed. Note it for the Mac; do not hand-resolve.`);
      }
    } else if (ahead && behind && dirty) warn(`${ahead} unpushed commit(s), ${behind} incoming, and a dirty tree — publish first, then re-run.`);
    else if (ahead) line(`  ${ahead} local commit(s) not yet pushed.`);
  } catch {
    warn('could not reach origin (offline?) — reading the local copy. Trust the report files below over the manifest.');
  }
}

// ---------- 4. the record: files first, manifest second ----------
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const history = manifest.history || [];
const inHistory = new Set(history.map((h) => String(h.reportId)));
const reportIds = existsSync(REPORTS_DIR)
  ? readdirSync(REPORTS_DIR).filter((f) => /^report-\d+\.json\.enc$/.test(f)).map((f) => f.match(/report-(\d+)\./)[1]).sort()
  : [];
const unrecorded = reportIds.filter((id) => !inHistory.has(id));

line();
line('── THE RECORD (files first, manifest second) ──');
line(`  report files on disk : ${reportIds.join(', ') || '(none)'}`);
line(`  recorded in manifest : ${history.map((h) => h.reportId).join(', ') || '(none)'}`);
if (unrecorded.length) {
  warn(`REPORT FILE(S) NOT IN THE MANIFEST: ${unrecorded.join(', ')}. The work WAS done — read those files before judging.`);
} else if (reportIds.length) line('  ✓ files and manifest agree.');

const current = manifest.currentHomeworkId;
line();
line(`  current lesson/homework : ${manifest.currentLessonId} / ${current}` +
     (inHistory.has(String(current)) ? '  (report is IN — it was done)' : '  (no report yet)'));
line(`  last practised          : ${manifest.counters?.lastPracticed || '—'}`);
line(`  Betragen                : ${manifest.conduct?.score ?? 65}/100`);
const open = (manifest.corrections || []).filter((c) => c.status === 'open');
line(`  Korrektur open          : ${open.length}${open.length ? ' — ' + open.map((c) => c.key).join(', ') : ''}`);
line(`  Anträge pending         : ${(manifest.requests || []).filter((r) => r.status === 'pending').length}`);

// ---------- 5. Berichte: filed vs READ BY YOU (FR-001) ----------
const reports = manifest.assignmentReports || {};
const filedIds = Object.keys(reports).sort();
const unreadIds = filedIds.filter((id) => !reports[id].readByTeacher);
const doneIds = new Set(history.map((h) => String(h.homeworkId)));
const owed = [...doneIds].filter((id) => !filedIds.includes(id)).sort();

line();
line('── BERICHTE ──');
line(`  filed  : ${filedIds.length ? filedIds.join(', ') : '(none)'}`);
line(`  owed   : ${owed.length ? owed.join(', ') : 'none'}`);
line(`  UNREAD by you: ${unreadIds.length ? unreadIds.join(', ') : 'none'}`);

if (unreadIds.length) {
  let pw = process.env.GL_PASSWORD;
  if (!pw) {
    warn('GL_PASSWORD not set — cannot decrypt the unread Berichte. Read them before ruling on conduct.');
  } else {
    line();
    line('  ┌─ UNREAD BERICHTE, IN FULL. Read these BEFORE any ruling. ─────────');
    for (const id of unreadIds) {
      let text;
      try { text = decryptString(pw, reports[id].enc); } catch { text = '(cannot decrypt)'; }
      line(`  │`);
      line(`  │ ── Bericht ${id} — filed ${String(reports[id].date).slice(0, 16)} ──`);
      for (const l of String(text).split('\n')) line(`  │   ${l}`);
    }
    line('  └───────────────────────────────────────────────────────────────────');
    line('  (session-end.js marks exactly these as read.)');
  }
}

// ---------- 6. deeds + seal ----------
const deeds = (manifest.deeds || []).filter((d) => d.status === 'open');
if (deeds.length) {
  line();
  line('── DEEDS OPEN ──');
  for (const d of deeds) line(`  ${d.id} (since ${d.assignedAt.slice(0, 10)}${d.due ? `, due ${d.due}` : ''}): ${d.text}`);
}

line();
line(existsSync(join(HER_DIR, 'SEAL_BREACH.md'))
  ? '  ⚠ frau_richter/SEAL_BREACH.md EXISTS — the guardrail was tampered with. Read it and rule.'
  : '  seal: no breach reported.');

// ---------- 7. write the claim ----------
writeFileSync(CLAIM, JSON.stringify({
  runId,
  startedAt: now.toISOString(),
  weekday: now.toLocaleDateString('en-GB', { weekday: 'long' }),
  intent: opt('--intent') || null,
  publishRoute,
  berichteShown: unreadIds,
  closedAt: null,
}, null, 2));

line();
line(`  run claim ${runId} open (publish route: ${publishRoute}).`);
if (publishRoute === 'blocked') line('═══ NOT publishable this run — teach knowing that. ═══');
else line(synced ? '═══ synced. Teach. ═══' : '═══ NOT synced — state may be stale. ═══');
