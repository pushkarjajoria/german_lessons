// dashboard.js — the cockpit. Everything shown here comes from the plaintext,
// non-sensitive aggregates in manifest.json (counters + history); lesson and
// report content stays encrypted. Frau Richter's verdict is computed from the
// same numbers — earned, specific, never sycophantic — in the language she has
// decided the learner can handle (manifest.verdictLang, see richter-voice.js).

import { initLock, initLockButton, getPassword } from './auth.js';
import { getTests, deriveStatus, deriveForfeitReason, fmtDeadline, enforceForfeits } from './tests-common.js';
import { loadPortrait } from './portrait.js';
import { verdict, richterNotes, voiceLang, pct, STRINGS } from './richter-voice.js';
import { getPolicy, openCorrections, eligibleNow, nextEligibleAt, isOverdue, homeworkGated } from './corrections.js';
import * as gh from './github.js';

const $ = (id) => document.getElementById(id);

let LANG = 'en';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-GB',
    { weekday: 'short', day: 'numeric', month: 'short' });
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

// ---------- discipline (Nachweis) banner ----------
// When Frau Richter has halted the course (scripts/discipline.js), the banner
// takes over the top of the dashboard and homework/tests refuse to start.

function renderDiscipline(manifest) {
  const d = manifest.discipline;
  const panel = $('discipline-panel');
  if (!d || !d.active) { panel.hidden = true; return; }
  const S = STRINGS[LANG];
  panel.hidden = false;
  $('discipline-title').textContent = S.disciplineTitle;
  $('discipline-reason').textContent = d.reason || '';
  const list = $('discipline-tasks');
  list.innerHTML = '';
  (d.tasks || []).forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'discipline-task';
    const kind = t.type === 'recording' ? '🎙' : '✍';
    const status = t.status === 'claimed'
      ? `<span class="chip">${S.disciplineClaimed}</span>`
      : `<button class="btn discipline-claim" data-i="${i}">${S.disciplineClaim}</button>`;
    row.innerHTML = `
      <p class="discipline-instructions">${kind} ${t.instructions}</p>
      <div class="discipline-status">${status}</div>`;
    list.appendChild(row);
  });
  $('discipline-foot').textContent = S.disciplineFoot;

  list.querySelectorAll('.discipline-claim').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        if (!gh.isConfigured()) throw new Error('No GitHub token configured (Settings) — tell her directly in the next session instead.');
        const { data: fresh } = await gh.readJson('data/manifest.json');
        const task = fresh.discipline?.tasks?.[Number(btn.dataset.i)];
        if (task) {
          task.status = 'claimed';
          task.claimedAt = new Date().toISOString();
          await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2),
            `discipline: task ${Number(btn.dataset.i) + 1} claimed`);
          manifest.discipline = fresh.discipline;
        }
        renderDiscipline(manifest);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = `${STRINGS[LANG].disciplineClaim} (${e.message})`;
      }
    });
  });
}

// ---------- Korrektur panel ----------
// Open corrections, their pass progress, and when the next pass counts.
// Overdue items are named — they are what locks new homework.

function renderKorrektur(manifest) {
  const policy = getPolicy(manifest);
  const open = openCorrections(manifest);
  const panel = $('korrektur-panel');
  if (!policy.enabled || !open.length) { panel.hidden = true; return; }
  panel.hidden = false;
  const gated = homeworkGated(manifest);
  $('korrektur-intro').textContent = gated
    ? 'Corrections have waited past the grace period. New homework is locked until they are produced — that is the rule, not a mood.'
    : `Each item must be produced correctly ${policy.requiredPasses}× on separate occasions (≥${Math.round(policy.minGapMinutes / 60)}h apart). A miss resets it. Left ${policy.graceHours}h, it locks new homework.`;
  const list = $('korrektur-list');
  list.innerHTML = '';
  for (const c of open) {
    const dots = Array.from({ length: c.required }, (_, i) =>
      `<span class="k-dot ${i < c.doneCount ? 'k-dot-done' : ''}"></span>`).join('');
    const overdue = isOverdue(c, policy);
    let when;
    if (eligibleNow(c, policy)) when = '<a class="btn btn-primary" href="practice.html">Produce it now</a>';
    else {
      const mins = Math.max(1, Math.ceil((nextEligibleAt(c, policy) - Date.now()) / 60000));
      when = `<span class="chip">next pass counts in ${mins >= 60 ? Math.ceil(mins / 60) + 'h' : mins + 'm'}</span>`;
    }
    const row = document.createElement('div');
    row.className = 'korrektur-row';
    row.innerHTML = `
      <span class="k-name">${c.category} <span class="muted">· from assignment ${c.hwId}${c.missedCount > 1 ? ` · missed ${c.missedCount}×` : ''}</span>
        ${overdue ? '<span class="chip chip-weak">overdue — locking homework</span>' : ''}</span>
      <span class="k-right"><span class="k-dots">${dots}</span>${when}</span>`;
    list.appendChild(row);
  }
}

// ---------- main render ----------

function render(manifest) {
  const { counters, history } = manifest;
  LANG = voiceLang(manifest);
  const S = STRINGS[LANG];

  renderDiscipline(manifest);
  renderKorrektur(manifest);

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
  // Areas Frau Richter flagged by hand outrank the statistics.
  (manifest.teacherNote?.weakAreas || []).forEach((w) => weak.add(w));
  const weakWrap = $('weak-areas');
  weakWrap.innerHTML = weak.size
    ? [...weak].map((w) => `<span class="chip chip-weak">${w}</span>`).join('')
    : '<p class="muted">No flagged weaknesses — yet. The test comes with the data.</p>';

  $('verdict').textContent = verdict(manifest, weak, LANG);

  renderTests(manifest);

  const notes = richterNotes(manifest, LANG);
  $('note-performance').textContent = notes.performance;
  $('note-regularity').textContent = notes.regularity;
  $('note-effort').textContent = notes.effort;

  // Her hand-written remark (scripts/teacher-note.js) — shown above the
  // computed notes whenever she has left one.
  const tn = manifest.teacherNote;
  if (tn && tn.text) {
    $('desk-note').hidden = false;
    $('desk-note-label').textContent = S.deskNote(fmtDate(tn.date));
    $('desk-note-text').textContent = tn.text;
    $('desk-note-chips').innerHTML = (tn.weakAreas || [])
      .map((w) => `<span class="chip chip-weak">${w}</span>`).join('');
  }

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

  // CTA vs. empty state — suppressed entirely while the course is halted.
  const cta = $('cta');
  if (manifest.discipline?.active) {
    cta.innerHTML = '';
    return;
  }
  const done = history.some((h) => h.homeworkId === manifest.currentHomeworkId);
  if (done) {
    cta.innerHTML = `
      <div class="empty-state">
        <p>${S.ctaDone(manifest.currentHomeworkId)}</p>
        <p class="muted">${S.ctaDoneSub}</p>
      </div>`;
  } else if (homeworkGated(manifest)) {
    cta.innerHTML = `
      <a class="btn btn-primary btn-big" href="practice.html">Erst die Korrektur →</a>
      <p class="muted cta-sub">Homework ${manifest.currentHomeworkId} stays locked while corrections sit overdue. The queue is below.</p>`;
  } else {
    cta.innerHTML = `
      <a class="btn btn-primary btn-big" href="homework.html">${S.ctaStart}</a>
      <p class="muted cta-sub">${S.ctaSub(manifest.currentHomeworkId)}</p>`;
  }
}

function renderTests(manifest) {
  const tests = getTests(manifest);
  const panel = $('tests-panel');
  if (!tests.length) { panel.hidden = true; return; }
  panel.hidden = false;
  const list = $('tests-list');
  list.innerHTML = '';
  // Pending first (nearest deadline on top), then the record.
  const order = { pending: 0, submitted: 1, graded: 2, forfeited: 3 };
  const sorted = tests.slice().sort((a, b) => {
    const s = order[deriveStatus(a)] - order[deriveStatus(b)];
    return s !== 0 ? s : new Date(a.deadline) - new Date(b.deadline);
  });
  for (const t of sorted) {
    const status = deriveStatus(t);
    const row = document.createElement('div');
    row.className = 'test-row';
    let right;
    if (status === 'pending') {
      const d = fmtDeadline(t.deadline);
      const urgent = new Date(t.deadline).getTime() - Date.now() < 86400000;
      const takeable = !manifest.discipline?.active;
      right = `<span class="chip ${urgent ? 'chip-weak' : ''}">${d}</span>
               ${takeable ? `<a class="btn btn-primary" href="test.html?id=${t.id}">Take it</a>` : '<span class="chip chip-weak">locked</span>'}`;
    } else if (status === 'submitted') {
      right = '<span class="chip">submitted · awaiting the red pen</span>';
    } else if (status === 'graded') {
      right = `<span class="chip">graded: ${t.score ?? '—'}</span>`;
    } else {
      const reason = t.forfeitReason || deriveForfeitReason(t) || 'forfeited';
      right = `<span class="chip chip-weak">forfeited (${reason}) · 0 points</span>`;
    }
    row.innerHTML = `
      <span class="test-name">${t.title || 'Test ' + t.id}</span>
      <span class="test-right">${right}</span>`;
    list.appendChild(row);
  }
}

initLockButton();
initLock(async (manifest) => {
  render(manifest);
  loadPortrait($('verdict-portrait'));
  // Persist any forfeits that are true but not yet written (expired deadlines,
  // abandoned in-progress markers), then re-render the panel with fresh state.
  const changed = await enforceForfeits(manifest, getPassword()).catch(() => false);
  if (changed) renderTests(manifest);
});
