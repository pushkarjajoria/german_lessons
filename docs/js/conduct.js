// conduct.js — the Betragen (conduct) system: a 0–100 score only Frau Richter
// moves (scripts/conduct.js), rendered as the star ladder at the top of the
// dashboard. It starts at 65 and is earned upward slowly:
//
//   95–100     Goldener Stern
//   80–94      Silberner Stern
//   65–79      Schwarzer Stern
//   below 65   Kegel der Schande — with comments on behaviour and performance
//   below 60   the site LOCKS: two days straight of writing her assigned lines,
//              then on the third day the apology opens; a filed apology buys
//              eligibility for review on the next lecture day; she accepts
//              (score back to 65) or rejects with extra tasks.
//
// Apology texts are AES-encrypted inline in the manifest (public repo) — only
// she reads them (scripts/conduct.js --show).

export const START_SCORE = 65;
export const LOCK_BELOW = 60;
export const APOLOGIES_NEEDED = 3;

export function conductScore(manifest) {
  return manifest.conduct?.score ?? START_SCORE;
}

export function conductTier(score) {
  if (score >= 95) return 'gold';
  if (score >= 80) return 'silver';
  if (score >= 65) return 'black';
  return 'cone';
}

export const TIERS = [
  { key: 'gold', label: 'Goldener Stern', rule: '95–100', glyph: '★', cls: 'star-gold' },
  { key: 'silver', label: 'Silberner Stern', rule: '80–94', glyph: '★', cls: 'star-silver' },
  { key: 'black', label: 'Schwarzer Stern', rule: '65–79', glyph: '★', cls: 'star-black' },
  { key: 'cone', label: 'Kegel der Schande', rule: 'below 65', glyph: '▲', cls: 'star-cone' },
];

export function conductLocked(manifest) {
  return conductScore(manifest) < LOCK_BELOW;
}

// ---------- lecture schedule (Mon & Wed, 10:00–12:00 local/CEST) ----------

export function isLectureNow(now = new Date()) {
  const d = now.getDay();
  const h = now.getHours();
  return (d === 1 || d === 3) && h >= 10 && h < 12;
}

export function nextLecture(after = new Date()) {
  const t = new Date(after);
  for (let i = 0; i < 8; i++) {
    const d = t.getDay();
    if ((d === 1 || d === 3) && (t.getHours() < 10 || t.toDateString() !== after.toDateString())) {
      const at = new Date(t);
      at.setHours(10, 0, 0, 0);
      if (at > after) return at;
    }
    t.setDate(t.getDate() + 1);
    t.setHours(0, 0, 0, 0);
  }
  return null;
}

// ---------- apology chain ----------

const localDate = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// The chain that counts: consecutive daily apologies ending today or yesterday.
// A missed day breaks it — sorry means every day, not when convenient.
export function apologyChain(lock, now = new Date()) {
  const dates = (lock?.apologies || []).map((a) => a.date).sort();
  if (!dates.length) return [];
  const chain = [dates[0]];
  for (let i = 1; i < dates.length; i++) {
    if (dayDiff(dates[i - 1], dates[i]) === 1) chain.push(dates[i]);
    else chain.splice(0, chain.length, dates[i]);
  }
  const gap = dayDiff(chain[chain.length - 1], localDate(now));
  return gap <= 1 ? chain : [];
}

export function apologyStatus(manifest, now = new Date()) {
  const lock = manifest.conduct?.lock || null;
  const chain = apologyChain(lock, now);
  const today = localDate(now);
  const doneToday = chain.includes(today) || (lock?.apologies || []).some((a) => a.date === today);
  const complete = chain.length >= APOLOGIES_NEEDED;
  return {
    chain,
    doneToday,
    complete,
    remaining: Math.max(0, APOLOGIES_NEEDED - chain.length),
    eligibleAt: complete ? (lock?.eligibleAt ? new Date(lock.eligibleAt) : nextLecture(now)) : null,
    extraTasks: lock?.extraTasks || null,
  };
}

// ---------- the lockdown sequence: lines, then the apology ----------
// Two days straight of writing the lines Frau Richter set (her text, her
// count), then on the THIRD consecutive day the apology finally opens. A
// missed day breaks the streak and restarts it — every day, not when
// convenient. Lines and count are hers to set (scripts/conduct.js --set-lines);
// this default only keeps the screen functional if she has not yet.

export const LINE_DAYS_NEEDED = 2;
export const DEFAULT_LINES = { text: 'Ich vernachlässige meine Pflichten nicht wieder.', translation: 'I will not neglect my duties again.', times: 20 };

// Consecutive run of dates ending today or yesterday, else [] (streak dead).
function consecutiveRun(dates, now = new Date()) {
  const sorted = [...dates].sort();
  if (!sorted.length) return [];
  let run = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i - 1], sorted[i]) === 1) run.push(sorted[i]);
    else run = [sorted[i]];
  }
  return dayDiff(run[run.length - 1], localDate(now)) <= 1 ? run : [];
}

// The full state machine for the lockdown screen.
//   phase 'lines'     — still owe line-days (or just finished today's set)
//   phase 'apology'   — two consecutive line-days done; today the apology opens
//   phase 'submitted' — the apology is filed; awaiting her review
export function lockStatus(manifest, now = new Date()) {
  const lock = manifest.conduct?.lock || null;
  const today = localDate(now);
  const lines = lock?.lines || DEFAULT_LINES;
  const linesAssigned = Boolean(lock?.lines);
  const lineDays = (lock?.lineDays || []).map((d) => (typeof d === 'string' ? d : d.date));
  const apologies = lock?.apologies || [];

  const run = consecutiveRun(lineDays, now);
  const lineDaysDone = run.length;
  const linesDoneToday = run.includes(today);
  const lastLineDay = run[run.length - 1] || null;

  let phase;
  if (apologies.length >= 1) phase = 'submitted';
  else if (lineDaysDone >= LINE_DAYS_NEEDED && lastLineDay !== today) phase = 'apology';
  else phase = 'lines';

  const apologyDone = apologies.length >= 1;
  return {
    phase,
    lines,                                   // {text, times} she set (or default)
    linesAssigned,
    lineDaysDone,                            // 0, 1, or 2 (consecutive)
    linesDoneToday,
    linesRemaining: Math.max(0, LINE_DAYS_NEEDED - lineDaysDone),
    apologyDone,
    eligibleAt: apologyDone ? (lock?.eligibleAt ? new Date(lock.eligibleAt) : nextLecture(now)) : null,
    extraTasks: lock?.extraTasks || null,
  };
}

export { localDate };
