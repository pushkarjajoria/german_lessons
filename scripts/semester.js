#!/usr/bin/env node
// semester.js — the semester state machine. A semester spans a set of lectures,
// carries short quizzes (~10 min) along the way and ONE long final (20–30 min)
// at the end. The total is weighted — quizzes 40%, final 60% by default — and
// the passing bar is high, because "eventually correct" is no standard.
//
//   Fail once  → status "retake": intensive training, retake final in a week
//                (she authors a NEW final: fresh questions + jumbled variants
//                of old ones, via new-test.js with kind:final).
//   Fail twice → status "repeat": the whole course again — all assignments,
//                quizzes, and final, republished under a new round id.
//
// Usage:
//   node scripts/semester.js --open --title "Semester 1 — Phase 0/1" \
//        [--id S1] [--pass 70] [--quiz-weight 40] [--lectures 8] [--push]
//   node scripts/semester.js --status
//   node scripts/semester.js --evaluate [--push]    # after the final is graded
//   node scripts/semester.js --repeat [--push]      # start the repeat round after a second failure
//
// Quizzes/finals attach themselves: author the test JSON with
//   "kind": "quiz" | "final", "semester": "<id>"    (see new-test.js)

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

const pctOf = (score) => {
  const m = String(score ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  return m && Number(m[2]) > 0 ? (Number(m[1]) / Number(m[2])) * 100 : null;
};

function gather(sem) {
  const tests = (manifest.tests || []).filter((t) => t.semester === sem.id);
  const quizzes = tests.filter((t) => t.kind === 'quiz');
  const finals = tests.filter((t) => t.kind === 'final');
  // Forfeited counts as 0 — a skipped quiz is not a skipped weight.
  const quizPcts = quizzes
    .filter((t) => t.status === 'graded' || t.status === 'forfeited')
    .map((t) => (t.status === 'forfeited' ? 0 : pctOf(t.score)))
    .filter((v) => v !== null);
  const gradedFinal = finals.filter((t) => t.status === 'graded').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  const forfeitedFinal = finals.find((t) => t.status === 'forfeited');
  const quizAvg = quizPcts.length ? quizPcts.reduce((a, b) => a + b, 0) / quizPcts.length : null;
  const finalPct = gradedFinal ? pctOf(gradedFinal.score) : (forfeitedFinal ? 0 : null);
  return { quizzes, finals, quizPcts, quizAvg, gradedFinal, forfeitedFinal, finalPct };
}

function weighted(sem, quizAvg, finalPct) {
  const qw = sem.weights.quizzes / 100;
  return Math.round(((quizAvg ?? 0) * qw + (finalPct ?? 0) * (1 - qw)) * 10) / 10;
}

let commitMsg;

if (args.includes('--open')) {
  if (manifest.semester && ['active', 'retake'].includes(manifest.semester.status)) {
    console.error(`Semester ${manifest.semester.id} is still ${manifest.semester.status}. Evaluate or repeat it first.`);
    process.exit(1);
  }
  const title = opt('--title');
  if (!title) { console.error('--open needs --title.'); process.exit(1); }
  const prev = manifest.semester;
  manifest.semester = {
    id: opt('--id') || (prev ? `S${Number((prev.id.match(/^S(\d+)/) || [, 0])[1]) + 1}` : 'S1'),
    title,
    openedAt: new Date().toISOString(),
    attempt: 1,
    repeatCount: 0,
    weights: { quizzes: Number(opt('--quiz-weight')) || 40, final: 100 - (Number(opt('--quiz-weight')) || 40) },
    passPct: Number(opt('--pass')) || 70,
    plannedLectures: Number(opt('--lectures')) || null,
    status: 'active',
    rounds: prev ? [...(prev.rounds || []), summaryOf(prev)] : [],
  };
  commitMsg = `semester: ${manifest.semester.id} opened — "${title}"`;
  console.log(`Opened ${manifest.semester.id}: quizzes ${manifest.semester.weights.quizzes}% + final ${manifest.semester.weights.final}%, pass at ${manifest.semester.passPct}%.`);
} else if (args.includes('--status')) {
  const sem = manifest.semester;
  if (!sem) { console.log('No semester defined.'); process.exit(0); }
  const g = gather(sem);
  console.log(`# ${sem.id} — ${sem.title} [${sem.status}] attempt ${sem.attempt}${sem.repeatCount ? ` · repeat round ${sem.repeatCount}` : ''}`);
  console.log(`Weights: quizzes ${sem.weights.quizzes}% / final ${sem.weights.final}% · pass ≥ ${sem.passPct}%`);
  for (const t of g.quizzes) console.log(`  quiz  ${t.id} "${t.title}" — ${t.status}${t.score ? ` (${t.score} = ${Math.round(pctOf(t.score))}%)` : ''}`);
  for (const t of g.finals) console.log(`  FINAL ${t.id} "${t.title}" — ${t.status}${t.score ? ` (${t.score} = ${Math.round(pctOf(t.score))}%)` : ''}`);
  console.log(`Quiz average: ${g.quizAvg === null ? '—' : Math.round(g.quizAvg) + '%'} · final: ${g.finalPct === null ? 'not graded' : Math.round(g.finalPct) + '%'}`);
  if (g.finalPct !== null) console.log(`Weighted total: ${weighted(sem, g.quizAvg, g.finalPct)}% (pass ≥ ${sem.passPct}%)`);
  if (sem.status === 'retake') console.log(`RETAKE pending — deadline ${sem.retakeDeadline}. Intensive training until then; the retake final gets NEW questions + jumbled old ones.`);
  process.exit(0);
} else if (args.includes('--evaluate')) {
  const sem = manifest.semester;
  if (!sem || !['active', 'retake'].includes(sem.status)) { console.error('No active/retake semester to evaluate.'); process.exit(1); }
  const g = gather(sem);
  if (g.finalPct === null) { console.error('The final is not graded (or not published) yet — nothing to evaluate.'); process.exit(1); }
  const total = weighted(sem, g.quizAvg, g.finalPct);
  const passed = total >= sem.passPct;
  sem.evaluations = sem.evaluations || [];
  sem.evaluations.push({
    date: new Date().toISOString(),
    attempt: sem.attempt,
    quizAvgPct: g.quizAvg === null ? null : Math.round(g.quizAvg * 10) / 10,
    finalPct: Math.round(g.finalPct * 10) / 10,
    totalPct: total,
    result: passed ? 'passed' : 'failed',
  });
  if (passed) {
    sem.status = 'passed';
    sem.closedAt = new Date().toISOString();
    commitMsg = `semester: ${sem.id} PASSED at ${total}%`;
    console.log(`PASSED: ${total}% (bar: ${sem.passPct}%). One dry sentence of acknowledgment is permitted. Open the next semester when ready.`);
  } else if (sem.attempt === 1) {
    sem.status = 'retake';
    sem.attempt = 2;
    sem.retakeDeadline = new Date(Date.now() + 7 * 86400000).toISOString();
    commitMsg = `semester: ${sem.id} failed at ${total}% — retake in one week`;
    console.log(`FAILED: ${total}% (bar: ${sem.passPct}%). Attempt 2 in one week (${sem.retakeDeadline.slice(0, 10)}).`);
    console.log('Between now and then: intensive training (drills, Korrektur adds on every miss).');
    console.log('Author the retake final with NEW questions + jumbled variants of the old ones:');
    console.log(`  node scripts/new-test.js --scaffold   # set kind:"final", semester:"${sem.id}", deadline = retake date`);
  } else {
    sem.status = 'repeat';
    commitMsg = `semester: ${sem.id} failed twice — course repeats`;
    console.log(`FAILED AGAIN: ${total}%. The course repeats — all assignments, quizzes, and the final, from the top.`);
    console.log(`Run: node scripts/semester.js --repeat --push   # then republish the material as new numbered assignments`);
  }
} else if (args.includes('--repeat')) {
  const sem = manifest.semester;
  if (!sem || sem.status !== 'repeat') { console.error('No semester awaiting a repeat.'); process.exit(1); }
  const round = (sem.repeatCount || 0) + 1;
  manifest.semester = {
    ...sem,
    id: `${sem.id.replace(/-R\d+$/, '')}-R${round}`,
    openedAt: new Date().toISOString(),
    attempt: 1,
    repeatCount: round,
    status: 'active',
    retakeDeadline: null,
    evaluations: [],
    rounds: [...(sem.rounds || []), summaryOf(sem)],
  };
  delete manifest.semester.closedAt;
  commitMsg = `semester: repeat round ${round} opened (${manifest.semester.id})`;
  console.log(`Repeat round open: ${manifest.semester.id}. Republish the lessons (new ids, same ground), quizzes, and final tagged with this semester id.`);
} else {
  console.error('Usage: --open --title "…" | --status | --evaluate | --repeat   (see file header)');
  process.exit(1);
}

function summaryOf(s) {
  return { id: s.id, title: s.title, status: s.status, attempt: s.attempt, evaluations: s.evaluations || [], openedAt: s.openedAt, closedAt: s.closedAt || null };
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "${commitMsg}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
