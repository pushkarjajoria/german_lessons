// dashboard.js — the cockpit. Everything shown here comes from the plaintext,
// non-sensitive aggregates in manifest.json (counters + history); lesson and
// report content stays encrypted. Frau Richter's verdict is computed from the
// same numbers — earned, specific, never sycophantic.

import { initLock, initLockButton } from './auth.js';

const $ = (id) => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function pct(correct, total) {
  return total ? Math.round((correct / total) * 100) : null;
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function aggregateCategories(history) {
  const agg = {};
  for (const h of history) {
    for (const [cat, s] of Object.entries(h.categories || {})) {
      const a = (agg[cat] ||= { correct: 0, total: 0 });
      a.correct += s.correct;
      a.total += s.total;
    }
  }
  return agg;
}

// Gaps (in days) between consecutive practice days across the whole record —
// the raw material for judging regularity, not just the current idle streak.
function sessionGaps(history) {
  const days = [...new Set(history.map((h) => h.date.slice(0, 10)))].sort();
  const gaps = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push(Math.round((new Date(days[i]) - new Date(days[i - 1])) / 86400000));
  }
  return gaps;
}

// A category that shows up weak across several recent sessions, not just once —
// the fossilization signal the persona treats as categorically different from a slip.
function recurringWeakCategories(history, lookback = 3) {
  const counts = {};
  for (const h of history.slice(-lookback)) {
    for (const c of h.weakCategories || []) counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= 2).map(([c]) => c);
}

// Her opening line, per the persona's tier logic: acknowledgment is brief,
// absence is named, recurring weakness is named, praise is rationed.
function verdict(manifest, weak) {
  const { counters, history } = manifest;
  const idle = daysSince(counters.lastPracticed);
  if (!history.length) {
    return 'No data, no opinion. Opinions are earned with work. The first homework is waiting — start.';
  }
  if (idle >= 7) {
    return `${idle} days of silence, and no word from you. If you were busy, you know the rule: say so. Otherwise — today, the homework. No preamble.`;
  }
  if (idle >= 3) {
    return `${idle} days since you last practiced. The homework did not do itself. Sit down.`;
  }
  const last = history[history.length - 1];
  const lastPct = pct(last.firstTryCorrect, last.totalQuestions);
  if (weak.size) {
    const w = [...weak].join(', ');
    return `${w} keeps slipping. It is not a mystery, it is a pattern — and patterns harden. It returns until it sits.`;
  }
  if (counters.streakDays >= 3 && lastPct >= 90) {
    return `${counters.streakDays} days in a row, ${lastPct}% on first try. Good. That is the first time I say it — do not make it the last.`;
  }
  if (lastPct >= 80) {
    return `Last session: ${lastPct}% on first try. Acceptable. The remaining ${100 - lastPct}% is where we work today.`;
  }
  return `Last session: ${lastPct}% on first try. That is not where we stop. The misses come back until they sit.`;
}

// Her fuller notes: performance, regularity, effort/sincerity — three separate
// judgments, because a good score earned by rushing and a mediocre score earned
// by honest struggle are not the same thing to her, even if the number matches.
function richterNotes(manifest) {
  const { counters, history } = manifest;

  if (!history.length) {
    return {
      performance: 'Nothing has been submitted. There is nothing yet to assess, and nothing to praise for merely arriving.',
      regularity: 'No practice recorded. The streak begins at the first honest session, not before.',
      effort: 'Effort is judged by work done, not by intentions stated. Begin, then we will have something to discuss.',
    };
  }

  const last = history[history.length - 1];
  const lastPct = pct(last.firstTryCorrect, last.totalQuestions);
  const trend = history.slice(-3).map((h) => pct(h.firstTryCorrect, h.totalQuestions));
  const recurring = recurringWeakCategories(history);

  // Performance
  let performance;
  if (recurring.length) {
    const verb = recurring.length > 1 ? 'keep' : 'keeps';
    performance = `${recurring.join(', ')} ${verb} coming back weak across sessions, not just once. That is no longer a slip, it is a pattern setting — and I do not let those sit. It returns in the next lesson until it is gone, not until it is convenient.`;
  } else if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) {
    performance = `${lastPct}% on the last homework, up from ${trend[0]}%. Improving. I will not make a ceremony of it — one good session is not yet a habit.`;
  } else if (lastPct >= 90) {
    performance = `${lastPct}% on first try. Clean. That is the standard I expect of you, not a reason to ease off it.`;
  } else if (lastPct >= 70) {
    performance = `${lastPct}% on first try. Adequate, nothing more. The remainder does not vanish — it is in your next lesson.`;
  } else {
    performance = `${lastPct}% on first try. That is not an acceptable resting point. We slow down and rebuild before anything new is added.`;
  }

  // Regularity
  const idle = daysSince(counters.lastPracticed);
  const gaps = sessionGaps(history);
  const missedStretches = gaps.filter((g) => g >= 2).length;
  let regularity;
  if (idle >= 7) {
    regularity = `${idle} days of silence, with no word from you in that time. If a busy week was the reason, the rule has always been simple: say so before you vanish, not after. Unannounced silence is what invites this conversation.`;
  } else if (idle >= 3) {
    regularity = `${idle} days since the last session. Not yet a pattern of neglect, but close enough that I am watching it. Today closes the gap.`;
  } else if (counters.streakDays >= 5) {
    regularity = `${counters.streakDays} days in a row. That is what regularity looks like. Do not treat it as a cushion that earns you a day off.`;
  } else if (missedStretches >= 3) {
    regularity = `You return, then lapse, then return again — ${missedStretches} gaps of two or more days across your record. Inconsistency is its own kind of fossilizing error. Choose a rhythm and hold it.`;
  } else {
    regularity = 'Reasonably steady. Nothing here to escalate, and nothing yet to applaud outright either.';
  }

  // Effort & sincerity — read from how the work was done, not just the score.
  const attemptsRatio = last.totalAttempts && last.totalQuestions ? last.totalAttempts / last.totalQuestions : 1;
  const avgSec = last.totalQuestions ? last.durationSec / last.totalQuestions : null;
  let effort;
  if (attemptsRatio <= 1.15) {
    effort = 'A clean run — little to no rework needed. Whatever preparation produced that, keep doing it.';
  } else if (attemptsRatio > 1.6 && avgSec !== null && avgSec < 8) {
    effort = 'A lot of retries, answered quickly. That combination usually means guessing, not thinking — you are pattern-matching again, not working the answer out. Slow down before you answer, not after I tell you it is wrong.';
  } else if (attemptsRatio > 1.3) {
    effort = 'Several items needed more than one try, but you took real time on them. That reads as honest struggle, not carelessness — it earns patience, and the material simply repeats until it holds.';
  } else {
    effort = 'Ordinary effort. Nothing remarkable here, and nothing concerning either.';
  }

  return { performance, regularity, effort };
}

function render(manifest) {
  const { counters, history } = manifest;

  $('stat-streak').textContent = counters.streakDays || 0;
  $('stat-lessons').textContent = counters.lessonsCompleted || 0;
  const acc = pct(counters.totalCorrect, counters.totalQuestions);
  $('stat-accuracy').textContent = acc === null ? '—' : `${acc}%`;
  $('stat-last').textContent = fmtDate(counters.lastPracticed);

  // Per-category accuracy bars
  const agg = aggregateCategories(history);
  const catWrap = $('categories');
  catWrap.innerHTML = '';
  const cats = Object.entries(agg).sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total);
  if (!cats.length) {
    catWrap.innerHTML = '<p class="muted">No data yet. The first homework will provide it.</p>';
  }
  for (const [cat, s] of cats) {
    const p = pct(s.correct, s.total);
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.innerHTML = `
      <span class="cat-name">${cat}</span>
      <span class="cat-bar"><span class="cat-fill ${p < 70 ? 'cat-weak' : ''}" style="width:${p}%"></span></span>
      <span class="cat-pct">${p}% <span class="muted">(${s.correct}/${s.total})</span></span>`;
    catWrap.appendChild(row);
  }

  // Weak areas: categories under 70% across history, plus last report's flags
  const weak = new Set(cats.filter(([, s]) => s.correct / s.total < 0.7).map(([c]) => c));
  const lastEntry = history[history.length - 1];
  (lastEntry?.weakCategories || []).forEach((w) => weak.add(w));
  const weakWrap = $('weak-areas');
  weakWrap.innerHTML = weak.size
    ? [...weak].map((w) => `<span class="chip chip-weak">${w}</span>`).join('')
    : '<p class="muted">No flagged weaknesses — yet. The test comes with the data.</p>';

  $('verdict').textContent = verdict(manifest, weak);

  const notes = richterNotes(manifest);
  $('note-performance').textContent = notes.performance;
  $('note-regularity').textContent = notes.regularity;
  $('note-effort').textContent = notes.effort;

  // Recent sessions
  const recentWrap = $('recent');
  const recent = history.slice(-5).reverse();
  recentWrap.innerHTML = recent.length ? '' : '<p class="muted">No sessions yet.</p>';
  for (const h of recent) {
    const li = document.createElement('div');
    li.className = 'recent-row';
    li.innerHTML = `
      <span>${fmtDate(h.date)}</span>
      <span class="recent-title">${h.title || 'Homework ' + h.homeworkId}</span>
      <span class="recent-score">${h.firstTryCorrect}/${h.totalQuestions}</span>`;
    recentWrap.appendChild(li);
  }

  // CTA vs. empty state: is there homework newer than the last report?
  const done = history.some((h) => h.homeworkId === manifest.currentHomeworkId);
  const cta = $('cta');
  if (done) {
    cta.innerHTML = `
      <div class="empty-state">
        <p><strong>Nothing new.</strong> Homework ${manifest.currentHomeworkId} is done; your next lesson is being prepared.</p>
        <p class="muted">Use the wait properly: say your coffee order out loud, once, from memory. Recognizing is not knowing.</p>
      </div>`;
  } else {
    cta.innerHTML = `
      <a class="btn btn-primary btn-big" href="homework.html">Start today's homework →</a>
      <p class="muted cta-sub">Homework ${manifest.currentHomeworkId} is waiting. It knows you are here.</p>`;
  }
}

initLockButton();
initLock(async (manifest) => render(manifest));
