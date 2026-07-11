// dashboard.js — the cockpit. Everything shown here comes from the plaintext,
// non-sensitive aggregates in manifest.json (counters + history); lesson and
// report content stays encrypted. Frau Richter's verdict is computed from the
// same numbers — earned, specific, never sycophantic — in the language she has
// decided the learner can handle (manifest.verdictLang, see richter-voice.js).

import { initLock, initLockButton, getPassword } from './auth.js';
import { encryptString, decryptString } from './crypto.js';
import { conductScore, conductTier, conductLocked, TIERS, apologyStatus, localDate, nextLecture } from './conduct.js';
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
      ? `<span class="chip">${S.disciplineClaimed}${t.upload ? ' · proof attached' : ''}</span>`
      : `<input type="file" id="dfile-${i}" class="discipline-file" ${t.type === 'recording' ? 'accept="audio/*"' : 'accept="image/*"'} />
         <button class="btn btn-primary discipline-upload" data-i="${i}">Attach proof &amp; ${S.disciplineClaim}</button>
         <button class="btn discipline-claim" data-i="${i}" title="Only if she said no file is needed">${S.disciplineClaim} (no file)</button>`;
    row.innerHTML = `
      <p class="discipline-instructions">${kind} ${t.instructions}</p>
      <div class="discipline-status">${status}</div>
      <p class="model-repeat-status discipline-msg" id="dmsg-${i}"></p>`;
    list.appendChild(row);
  });
  $('discipline-foot').textContent = S.disciplineFoot;

  // Claiming — with or without an encrypted proof upload. The upload is
  // AES-GCM under the same password and lands in data/uploads/; only she can
  // open it (scripts/read-upload.js), and only she clears the block.
  const claimTask = async (i, uploadPath) => {
    const { data: fresh } = await gh.readJson('data/manifest.json');
    const task = fresh.discipline?.tasks?.[i];
    if (task) {
      task.status = 'claimed';
      task.claimedAt = new Date().toISOString();
      if (uploadPath) task.upload = uploadPath;
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2),
        `discipline: task ${i + 1} claimed${uploadPath ? ' with proof' : ''}`);
      manifest.discipline = fresh.discipline;
    }
    renderDiscipline(manifest);
  };

  list.querySelectorAll('.discipline-upload').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.i);
      const msg = $(`dmsg-${i}`);
      const file = $(`dfile-${i}`).files[0];
      if (!file) { msg.textContent = 'Choose the file first. The proof is the point.'; return; }
      if (file.size > 15 * 1024 * 1024) { msg.textContent = 'Over 15 MB — compress it (shorter clip, smaller photo) and try again.'; return; }
      btn.disabled = true;
      msg.textContent = 'Encrypting and filing…';
      try {
        if (!gh.isConfigured()) throw new Error('No GitHub token configured (Settings)');
        const buf = await file.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let o = 0; o < bytes.length; o += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(o, o + 0x8000));
        }
        const payload = JSON.stringify({ filename: file.name, mime: file.type, dataB64: btoa(bin) });
        const envelope = JSON.stringify(await encryptString(getPassword(), payload), null, 2);
        const path = `data/uploads/nachweis-task${i + 1}-${Date.now()}.enc`;
        await gh.writeText(path, envelope, `nachweis: proof for task ${i + 1}`);
        await claimTask(i, path);
      } catch (e) {
        btn.disabled = false;
        msg.textContent = `Failed: ${e.message}`;
      }
    });
  });
  list.querySelectorAll('.discipline-claim').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const i = Number(btn.dataset.i);
      try {
        if (!gh.isConfigured()) throw new Error('No GitHub token configured (Settings) — tell her directly in the next session instead.');
        await claimTask(i, null);
      } catch (e) {
        btn.disabled = false;
        $(`dmsg-${i}`).textContent = e.message;
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

// ---------- Betragen: the star ladder ----------
// Only her hand moves the score (scripts/conduct.js). The site renders the
// ladder, and below 60 it closes the course until the apologies are written
// and she has ruled on them.

function fmtLecture(d) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) + ', 10:00';
}

// The learner's own photo, next to hers, while he sits in the cone — the
// shame has a face, and it is not hers. Encrypted at rest (data/img/
// learner.enc, AES under the same password); decrypted only after unlock,
// shown only in cone standing.
let shamePhotoUrl = null;
async function showShamePhoto() {
  const head = document.querySelector('.conduct-head');
  if (!head || head.querySelector('.shame-photo')) return;
  try {
    if (!shamePhotoUrl) {
      const res = await fetch('data/img/learner.enc');
      if (!res.ok) return;
      const payload = JSON.parse(await decryptString(getPassword(), await res.json()));
      shamePhotoUrl = `data:${payload.mime};base64,${payload.dataB64}`;
    }
    const fig = document.createElement('figure');
    fig.className = 'shame-photo';
    fig.innerHTML = '<img alt="The student, in the cone" /><figcaption>Der Schüler.</figcaption>';
    fig.querySelector('img').src = shamePhotoUrl;
    head.insertBefore(fig, head.firstElementChild.nextElementSibling);
  } catch { /* wrong password or missing asset — the cone stands on its own */ }
}

function renderConduct(manifest) {
  const score = conductScore(manifest);
  const tier = conductTier(score);
  // Only the rank held is displayed — the ones above are earned into view.
  const info = TIERS.find((t) => t.key === tier);
  const panel = $('conduct-panel');
  panel.className = `panel conduct-panel conduct-${tier}`;
  const glyph = $('rank-glyph');
  glyph.textContent = info.glyph;
  glyph.className = `rank-glyph ${info.cls}`;
  $('rank-name').textContent = info.label;
  const nextUp = { cone: 'Schwarzer Stern begins at 65.', black: 'Silberner Stern begins at 80.', silver: 'Goldener Stern begins at 95.', gold: 'There is nothing above. Hold it.' };
  $('rank-next').textContent = nextUp[tier];
  $('conduct-score').textContent = score;
  if (tier === 'cone') showShamePhoto();
  else document.querySelector('.conduct-head .shame-photo')?.remove();
  const log = manifest.conduct?.log || [];
  const last = log[log.length - 1];
  $('conduct-last').textContent = last
    ? `Last ruling: ${last.delta > 0 ? '+' : ''}${last.delta} — ${last.reason} (${fmtDate(last.date)})`
    : 'No rulings yet. The score starts at 65 — everything above it is earned, nothing is given.';

  // Lock panel + apology machinery
  const lockPanel = $('conduct-lock-panel');
  if (!conductLocked(manifest)) { lockPanel.hidden = true; return; }
  lockPanel.hidden = false;
  const st = apologyStatus(manifest);
  $('lock-reason').textContent =
    `Betragen ${score}/100. The course is closed. The way back: a written apology, in German, in full sentences, ` +
    `on three consecutive days. Then I review it on the next lecture day — Monday or Wednesday, 10:00. Not before.`;
  if (st.extraTasks) {
    const ex = $('apology-extra');
    ex.hidden = false;
    ex.textContent = `Her last rejection carried conditions: ${st.extraTasks}`;
  }
  const prog = $('apology-progress');
  if (st.complete) {
    prog.textContent = `Apologies ${st.chain.length}/3 — complete. Eligible for review: ${fmtLecture(st.eligibleAt)}. She decides then.`;
    $('apology-text').disabled = false; // further apologies are permitted, not required
  } else if (st.doneToday) {
    prog.textContent = `Apology ${st.chain.length}/3 recorded for today. Tomorrow the next one — a missed day starts the count over.`;
    $('apology-text').disabled = true;
    $('apology-submit').disabled = true;
  } else {
    prog.textContent = st.chain.length
      ? `Apologies: ${st.chain.length}/3. Today's is due.`
      : 'Apologies: 0/3. Begin today — a missed day starts the count over.';
  }

  $('apology-submit').onclick = async () => {
    const msg = $('apology-msg');
    const text = $('apology-text').value.trim();
    if (text.length < 100) { msg.textContent = 'Too short for an apology that means anything. Full sentences, auf Deutsch.'; return; }
    if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — the apology cannot be filed.'; return; }
    $('apology-submit').disabled = true;
    msg.textContent = 'Filing…';
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.conduct ||= { score, log: [] };
      fresh.conduct.lock ||= { active: true, since: new Date().toISOString(), apologies: [] };
      const lock = fresh.conduct.lock;
      const today = localDate();
      if (lock.apologies.some((a) => a.date === today)) throw new Error('Already filed today. Tomorrow.');
      lock.apologies.push({ date: today, enc: await encryptString(getPassword(), text) });
      const chainNow = apologyStatus(fresh).chain;
      if (chainNow.length >= 3 && !lock.eligibleAt) lock.eligibleAt = nextLecture().toISOString();
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2),
        `conduct: apology ${Math.min(chainNow.length, 3)}/3 filed`);
      manifest.conduct = fresh.conduct;
      $('apology-text').value = '';
      renderConduct(manifest);
    } catch (e) {
      $('apology-submit').disabled = false;
      msg.textContent = e.message;
    }
  };
}

// Anträge live on the Messages page now (messages.html), in the same thread
// as her Nachrichten — the dashboard stopped hosting the form.

// ---------- semester panel ----------
// Quizzes (40%) + one long final (60%), her weights. Standing shown as it
// accumulates; a failed final shows the retake countdown; a second failure
// shows the repeat verdict. Forfeited semester tests count as 0%.

function renderSemester(manifest) {
  const sem = manifest.semester;
  const panel = $('semester-panel');
  if (!sem) { panel.hidden = true; return; }
  panel.hidden = false;

  const pctOf = (score) => {
    const m = String(score ?? '').match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/);
    return m && Number(m[2]) > 0 ? (Number(m[1]) / Number(m[2])) * 100 : null;
  };
  const semTests = (manifest.tests || []).filter((t) => t.semester === sem.id);
  const quizzes = semTests.filter((t) => t.kind === 'quiz');
  const finals = semTests.filter((t) => t.kind === 'final');

  $('semester-title').textContent = `${sem.title} · ${sem.id}`;
  $('semester-meta').textContent =
    `Quizzes ${sem.weights.quizzes}% + final ${sem.weights.final}% · pass at ${sem.passPct}%` +
    (sem.attempt > 1 ? ` · attempt ${sem.attempt}` : '') +
    (sem.repeatCount ? ` · repeat round ${sem.repeatCount}` : '');

  const verdictEl = $('semester-verdict');
  verdictEl.hidden = true;
  if (sem.status === 'retake') {
    const days = Math.max(0, Math.ceil((new Date(sem.retakeDeadline) - Date.now()) / 86400000));
    verdictEl.hidden = false;
    verdictEl.textContent = `Failed. The retake is in ${days} day(s) — until then, intensive training: drills, Korrektur, no shortcuts. The retake asks the same skills in new clothes.`;
  } else if (sem.status === 'repeat') {
    verdictEl.hidden = false;
    verdictEl.textContent = 'Failed twice. The course repeats from the top — every assignment, every quiz, the final. Not a punishment: evidence that the foundation was not there. This time it will be.';
  } else if (sem.status === 'passed') {
    const last = (sem.evaluations || [])[sem.evaluations.length - 1];
    verdictEl.hidden = false;
    verdictEl.textContent = `Passed at ${last?.totalPct ?? '—'}%. Noted. The next semester will assume everything this one taught.`;
  }

  const list = $('semester-list');
  list.innerHTML = '';
  const row = (label, t) => {
    const div = document.createElement('div');
    div.className = 'test-row';
    let right;
    if (!t) right = '<span class="muted">not yet assigned</span>';
    else if (t.status === 'graded') right = `<span class="chip">${t.score} · ${Math.round(pctOf(t.score) ?? 0)}%</span>`;
    else if (t.status === 'forfeited') right = '<span class="chip chip-weak">forfeited · 0%</span>';
    else if (t.status === 'submitted') right = '<span class="chip">submitted · awaiting the red pen</span>';
    else right = `<span class="chip">pending · ${fmtDeadline(t.deadline)}</span>`;
    div.innerHTML = `<span class="test-name">${label}</span><span class="test-right">${right}</span>`;
    list.appendChild(div);
  };
  quizzes.forEach((t, i) => row(`Quiz ${i + 1} — ${t.title}`, t));
  if (finals.length) finals.forEach((t) => row(`★ Final — ${t.title}`, t));
  else row('★ Final', null);

  const quizPcts = quizzes
    .filter((t) => t.status === 'graded' || t.status === 'forfeited')
    .map((t) => (t.status === 'forfeited' ? 0 : pctOf(t.score)))
    .filter((v) => v !== null);
  const quizAvg = quizPcts.length ? quizPcts.reduce((a, b) => a + b, 0) / quizPcts.length : null;
  $('semester-standing').textContent = quizAvg === null
    ? 'No graded quizzes yet. The standing starts with the first one.'
    : `Quiz average so far: ${Math.round(quizAvg)}% (worth ${sem.weights.quizzes}% of the total). The final decides the remaining ${sem.weights.final}% — and the bar is ${sem.passPct}%.`;
}

// ---------- main render ----------

function render(manifest) {
  const { counters, history } = manifest;
  LANG = voiceLang(manifest);
  const S = STRINGS[LANG];

  renderDiscipline(manifest);
  renderConduct(manifest);
  renderKorrektur(manifest);
  renderSemester(manifest);

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
  // Kegel der Schande: her disappointment is stated in words, at the top of
  // the verdict, not just implied by the room's color.
  const coneHeader = $('cone-verdict-header');
  const inCone = conductTier(conductScore(manifest)) === 'cone';
  coneHeader.hidden = !inCone;
  if (inCone) coneHeader.textContent = STRINGS[LANG].coneVerdict;

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

  // CTA vs. empty state — suppressed entirely while the course is halted or
  // conduct-locked (the apology panel above is the only way forward).
  const cta = $('cta');
  if (manifest.discipline?.active || conductLocked(manifest)) {
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
