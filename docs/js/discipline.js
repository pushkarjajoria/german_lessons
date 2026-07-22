// discipline.js — the Nachweis (no-practice) lockdown state machine, shared by
// the dashboard (which runs the ritual) and the other pages (which lock to
// Lessons only while it is active). Frau Richter issues and configures it with
// scripts/discipline.js; the flow below is a single-session ritual, NOT the
// multi-day Betragen lockdown:
//
//   1. lines    — write her line, typed, N times (once, not across days)
//   2. apology  — a typed explanation in English or German: why practice
//                 lapsed, and why it will not happen again
//   3. quiz     — a short recall quiz drawn from the vocabulary bank (the
//                 neglected material). Pass and the block clears itself; fall
//                 short and the whole ritual is barred for two days, then resets.
//
// While active, only the Lessons page is open — everything else is halted — and
// the no-entry image stays until the quiz is passed.

import { localDate } from './conduct.js';

export const DEFAULT_DISCIPLINE_LINES = {
  text: 'Ich übe jeden Tag, ohne Ausnahme.',
  translation: 'I practice every day, without exception.',
  times: 15,
};
export const DEFAULT_QUIZ = { count: 6, passPct: 70 };
export const RETRY_DAYS = 2;

export function disciplineActive(manifest) {
  return Boolean(manifest.discipline?.active);
}

// The full state machine for the discipline lockdown screen.
//   phase 'cooldown' — a failed quiz bars the ritual until retryAt (two days)
//   phase 'lines'    — still owe the typed lines
//   phase 'apology'  — lines done; the typed explanation/apology is open
//   phase 'quiz'     — apology filed; the recall quiz is open
//   phase 'done'     — quiz passed (transient; the block clears itself)
export function disciplineStatus(manifest, now = new Date()) {
  const d = manifest.discipline;
  if (!d?.active) return null;
  const lines = d.lines || DEFAULT_DISCIPLINE_LINES;
  const quiz = { ...DEFAULT_QUIZ, ...(d.quiz || {}) };
  const a = d.attempt || null;
  const retryAt = d.retryAfter ? new Date(d.retryAfter) : null;

  let phase;
  if (retryAt && retryAt > now) phase = 'cooldown';
  else if (!a || !a.linesDoneAt) phase = 'lines';
  else if (!a.apology) phase = 'apology';
  else if (!a.quiz || !a.quiz.passed) phase = 'quiz';
  else phase = 'done';

  return {
    phase,
    reason: d.reason || '',
    lines,
    quiz,
    retryAt: phase === 'cooldown' ? retryAt : null,
    lastQuiz: a?.quiz || null,
  };
}

// When a quiz falls short: bar the ritual for RETRY_DAYS and wipe the attempt so
// the whole sequence (lines → apology → quiz) must be done again afterwards.
export function retryAfterDate(now = new Date()) {
  const t = new Date(now);
  t.setDate(t.getDate() + RETRY_DAYS);
  return t;
}

export { localDate };
