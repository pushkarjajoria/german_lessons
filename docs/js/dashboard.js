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
