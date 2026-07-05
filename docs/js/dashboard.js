// dashboard.js — the cockpit. Everything shown here comes from the plaintext,
// non-sensitive aggregates in manifest.json (counters + history); lesson and
// report content stays encrypted.

import { initLock } from './auth.js';

const $ = (id) => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function pct(correct, total) {
  return total ? Math.round((correct / total) * 100) : null;
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
    catWrap.innerHTML = '<p class="muted">Noch keine Daten. Die erste Hausaufgabe liefert sie.</p>';
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
    : '<p class="muted">Keine markierten Schwächen — noch. Der Test kommt mit den Daten.</p>';

  // Recent sessions
  const recentWrap = $('recent');
  const recent = history.slice(-5).reverse();
  recentWrap.innerHTML = recent.length ? '' : '<p class="muted">Noch keine Sitzungen.</p>';
  for (const h of recent) {
    const li = document.createElement('div');
    li.className = 'recent-row';
    li.innerHTML = `
      <span>${fmtDate(h.date)}</span>
      <span class="recent-title">${h.title || 'Hausaufgabe ' + h.homeworkId}</span>
      <span class="recent-score">${h.firstTryCorrect}/${h.totalQuestions}</span>`;
    recentWrap.appendChild(li);
  }

  // CTA vs. Frau-Richter empty state: is there homework newer than the last report?
  const done = history.some((h) => h.homeworkId === manifest.currentHomeworkId);
  const cta = $('cta');
  if (done) {
    cta.innerHTML = `
      <div class="empty-state">
        <p><strong>Nichts Neues.</strong> Hausaufgabe ${manifest.currentHomeworkId} ist erledigt; die nächste Lektion wird vorbereitet.</p>
        <p class="muted">Nutze die Wartezeit sinnvoll: sprich deine Kaffee-Bestellung einmal laut durch. Erkennen ist nicht Können.</p>
      </div>`;
  } else {
    cta.innerHTML = `
      <a class="btn btn-primary btn-big" href="homework.html">Heutige Hausaufgabe starten →</a>
      <p class="muted cta-sub">Hausaufgabe ${manifest.currentHomeworkId} wartet. Sie weiß, dass du hier bist.</p>`;
  }
}

initLock(async (manifest) => render(manifest));
