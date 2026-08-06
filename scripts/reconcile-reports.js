#!/usr/bin/env node
// reconcile-reports.js — repair reports that were saved but never indexed.
//
// THE FAILURE IT REPAIRS: finishing homework writes TWO files — the encrypted
// report, then the manifest entry — and they are not atomic. When the second
// write fails, the report sits in docs/data/reports/ while manifest.history
// knows nothing about it. The learner's work is safe, but the dashboard reads
// the MANIFEST, so it still shows the homework as to-do, the counters are
// stale, and the first-try misses never enter the Korrektur queue. This hit
// reports 0009 and 0010. quiz.js now retries the manifest write, but that does
// not help a report already orphaned.
//
// This is mechanical repair, not judgement: every value written here is derived
// from the learner's own already-published report. It records what he did; it
// rules nothing. Betragen is never touched.
//
// Usage:
//   node scripts/reconcile-reports.js              # dry run — lists orphans, writes nothing
//   node scripts/reconcile-reports.js --apply      # write the manifest entries
// Publish with the run: node scripts/session-end.js --message "…"

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');
const REPORTS = join(ROOT, 'docs', 'data', 'reports');

const apply = process.argv.includes('--apply');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.history ||= [];
manifest.counters ||= {};

if (!existsSync(REPORTS)) { console.log('No reports directory.'); process.exit(0); }

const indexed = new Set(manifest.history.map((h) => h.reportId));
const onDisk = readdirSync(REPORTS)
  .map((f) => (f.match(/^report-(\d+)\.json\.enc$/) || [])[1])
  .filter(Boolean)
  .sort();
const orphans = onDisk.filter((id) => !indexed.has(id));

if (!orphans.length) {
  console.log(`All ${onDisk.length} report(s) are indexed in manifest.history. Nothing to reconcile.`);
  process.exit(0);
}

console.log(`Reports on disk but NOT in manifest.history: ${orphans.join(', ')}\n`);
const password = await promptPassword('Password (to read the reports): ');

// Mirrors docs/js/quiz.js updatedManifest(), including its idempotency guard.
// Streak is computed against the REPORT's date, not today's, so reconciling
// late cannot invent or break a streak.
function record(m, report, title) {
  if (m.history.some((h) => h.reportId === report.id)) return false;
  const day = report.date.slice(0, 10);
  const last = m.counters.lastPracticed ? m.counters.lastPracticed.slice(0, 10) : null;
  const dayBefore = new Date(new Date(report.date).getTime() - 86400000).toISOString().slice(0, 10);
  if (last !== day) m.counters.streakDays = last === dayBefore ? (m.counters.streakDays || 0) + 1 : 1;
  // Only advance lastPracticed if this report is newer than what is recorded.
  if (!m.counters.lastPracticed || report.date > m.counters.lastPracticed) m.counters.lastPracticed = report.date;
  m.counters.lessonsCompleted = (m.counters.lessonsCompleted || 0) + 1;
  m.counters.totalQuestions = (m.counters.totalQuestions || 0) + report.totalQuestions;
  m.counters.totalCorrect = (m.counters.totalCorrect || 0) + report.firstTryCorrect;
  m.history.push({
    reportId: report.id, homeworkId: report.homeworkId, title,
    date: report.date, startedAt: report.startedAt, durationSec: report.durationSec,
    totalQuestions: report.totalQuestions, firstTryCorrect: report.firstTryCorrect,
    eventualCorrect: report.eventualCorrect, totalAttempts: report.totalAttempts,
    reworkRatio: report.reworkRatio, avgFirstAnswerLatencySec: report.avgFirstAnswerLatencySec,
    hintsUsedCount: report.hintsUsedCount, audioReplaysTotal: report.audioReplaysTotal,
    categoryAttempts: report.categoryAttempts, categories: report.categoryStats,
    weakCategories: report.weakCategories,
  });
  m.history.sort((a, b) => String(a.reportId).localeCompare(String(b.reportId)));
  return true;
}

let changed = 0;
for (const id of orphans) {
  let report;
  try {
    report = JSON.parse(decryptString(password, JSON.parse(readFileSync(join(REPORTS, `report-${id}.json.enc`), 'utf8'))));
  } catch (e) {
    console.error(`  report ${id}: cannot read (${e.message}) — skipped.`);
    continue;
  }
  const title = (manifest.lessons || []).find((l) => l.id === report.homeworkId)?.title || `Homework ${report.homeworkId}`;
  console.log(`  report ${id} — homework ${report.homeworkId}, ${report.date.slice(0, 16).replace('T', ' ')}`);
  console.log(`    ${report.firstTryCorrect}/${report.totalQuestions} first-try · ${Math.round(report.durationSec / 60)} min · weak: ${(report.weakCategories || []).join(', ') || 'none'}`);
  if (apply && record(manifest, report, title)) changed += 1;
}

if (!apply) {
  console.log('\nDry run — nothing written. Re-run with --apply to record these.');
  console.log('NOTE: this only records what he already did. It does not touch Betragen,');
  console.log('and it does not grade anything — that stays yours.');
  process.exit(0);
}

if (!changed) { console.log('\nNothing written.'); process.exit(0); }
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`\nRecorded ${changed} report(s). counters.lessonsCompleted is now ${manifest.counters.lessonsCompleted}.`);
console.log(`Publish with the run:  node scripts/session-end.js --message "manifest: reconcile report(s) ${orphans.join(', ')}"`);
console.log('\nNOTE: Korrektur enrollment for these reports was NOT applied (that is quiz.js');
console.log('side, and enrolling late would distort the spacing). Check correction-policy.js');
console.log('--show if you want those misses in the queue.');
