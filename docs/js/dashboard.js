// dashboard.js — the cockpit. Everything shown here comes from the plaintext,
// non-sensitive aggregates in manifest.json (counters + history); lesson and
// report content stays encrypted. Frau Richter's verdict is computed from the
// same numbers — earned, specific, never sycophantic — in the language she has
// decided the learner can handle (manifest.verdictLang, see richter-voice.js).

import { initLock, initLockButton, getPassword } from './auth.js';
import { encryptString, decryptString } from './crypto.js';
import { conductScore, conductTier, conductLocked, TIERS, apologyStatus, lockStatus, localDate, nextLecture } from './conduct.js';
import { getTests, deriveStatus, deriveForfeitReason, fmtDeadline, enforceForfeits } from './tests-common.js';
import { loadPortrait } from './portrait.js';
import { verdict, richterNotes, voiceLang, pct, STRINGS } from './richter-voice.js';
import { getPolicy, openCorrections, eligibleNow, nextEligibleAt, isOverdue, homeworkGated, attachModelRepeat } from './corrections.js';
import { lockdownPhotoUrl, disciplinePhotoUrl, detentionPhotoUrl } from './shame.js';
import { disciplineActive, disciplineStatus, retryAfterDate } from './discipline.js';
import { detentionActive, detentionStatus, repsForMiss, labelForMode } from './detention.js';
import { checkTextAnswer, checkTextAnswerDetailed } from './checking.js';
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

// ---------- discipline (Nachweis / no-practice) lockdown ----------
// Frau Richter has halted the course for lapsed practice (scripts/discipline.js).
// The dashboard collapses to one screen — the no-entry image and a single-
// session ritual: write her line N times, type an explanation/apology, then
// pass a short vocabulary quiz. Passing reopens the course automatically; a
// failed quiz bars the ritual two days, then resets it. Only the Lessons page
// stays open; the image stays until the quiz is passed.

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

async function renderDisciplineLockdown(manifest) {
  detachLinesGuards(); // any Betragen lines guard is stale here
  const panel = $('discipline-lock-panel');
  for (const sec of document.querySelectorAll('main > section')) sec.hidden = sec !== panel;
  panel.hidden = false;
  document.body.classList.add('lockdown');
  // Not fully dead: Lessons (and the Dashboard) stay reachable during discipline.
  document.querySelector('.topbar nav')?.classList.add('nav-discipline');

  const st = disciplineStatus(manifest);
  $('dlock-reason').textContent = st.reason || 'Practice lapsed. The course is closed until you set it right.';
  $('dlock-foot').textContent = '';

  // The no-entry image — its own encrypted asset (portrait).
  const fig = $('discipline-photo');
  if (!fig.querySelector('img')) {
    try {
      const url = await disciplinePhotoUrl(getPassword());
      if (url) { const img = document.createElement('img'); img.alt = 'Kurs gesperrt'; img.src = url; fig.appendChild(img); }
    } catch { /* wrong password or missing asset — the screen stands without it */ }
  }

  const prog = $('dlock-progress');
  $('dlines-area').hidden = true; $('dapology-area').hidden = true; $('dquiz-area').hidden = true;

  if (st.phase === 'cooldown') {
    prog.textContent = `You fell short of ${st.quiz.passCount} of ${st.quiz.count}. The ritual is barred until ${fmtDate(st.retryAt)} — then it resets: lines, explanation, quiz, from the top.`;
    return;
  }
  if (st.phase === 'lines') {
    prog.textContent = 'First — write the line, exactly, every time.';
    wireDisciplineLines(manifest, st);
    return;
  }
  if (st.phase === 'apology') {
    prog.textContent = 'Now — explain yourself: why practice lapsed, and why it will not happen again. English or German, in full sentences.';
    wireDisciplineApology(manifest);
    return;
  }
  // quiz
  prog.textContent = st.lastQuiz
    ? `Last — the quiz again: ${st.quiz.count} words, ${st.quiz.passCount} right to pass.`
    : `Last — a short quiz: ${st.quiz.count} words, ${st.quiz.passCount} right to pass. Pass and the course reopens.`;
  wireDisciplineQuiz(manifest, st);
}

// Phase 1: write her line, typed, N times. No pasting; a wrong copy doesn't count.
function wireDisciplineLines(manifest, st) {
  const area = $('dlines-area'); area.hidden = false;
  const input = $('dlines-input'), status = $('dlines-status'), prompt = $('dlines-prompt');
  const line = st.lines.text, times = st.lines.times, translation = st.lines.translation || '';
  const en = translation ? `<span class="lines-en">${escHtml(translation)}</span>` : '';
  const norm = (s) => s.trim().replace(/\s+/g, ' ');
  let done = 0;
  const render = (msg) => {
    prompt.innerHTML = `Write it ${times} times, exactly:<span class="lines-de"><strong>„${escHtml(line)}“</strong></span>${en}`;
    status.textContent = msg ?? `${done} / ${times}`;
  };
  input.value = ''; input.disabled = false; render();
  forbidPaste(input, status, 'No pasting. Write the line yourself.');
  input.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    if (norm(input.value) !== norm(line)) { input.value = ''; render(`Not exact — that one didn’t count. ${done} / ${times}.`); return; }
    done += 1; input.value = '';
    if (done < times) { render(); return; }
    input.disabled = true; status.textContent = 'Filing today’s lines…';
    if (!gh.isConfigured()) { status.textContent = 'No GitHub token (Settings) — the lines cannot be filed.'; input.disabled = false; return; }
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.discipline ||= {};
      fresh.discipline.attempt = { ...(fresh.discipline.attempt || {}), linesDoneAt: new Date().toISOString() };
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'discipline: lines written');
      manifest.discipline = fresh.discipline;
      renderDisciplineLockdown(manifest);
    } catch (err) { input.disabled = false; status.textContent = err.message; }
  };
}

// Phase 2: a typed explanation/apology, English or German. Encrypted; only she reads it.
function wireDisciplineApology(manifest) {
  const area = $('dapology-area'); area.hidden = false;
  const ta = $('dapology-text'), msg = $('dapology-msg'), btn = $('dapology-submit');
  ta.value = ''; msg.textContent = '';
  forbidPaste(ta, msg, 'No pasting. Write it yourself.');
  btn.disabled = false;
  btn.onclick = async () => {
    const text = ta.value.trim();
    if (text.length < 60) { msg.textContent = 'Not enough. Explain properly — why it lapsed, and why it will not recur.'; return; }
    btn.disabled = true; msg.textContent = 'Filing your explanation…';
    if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — it cannot be filed.'; btn.disabled = false; return; }
    try {
      const envelope = await encryptString(getPassword(), text);
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.discipline ||= {};
      fresh.discipline.attempt = { ...(fresh.discipline.attempt || {}), apology: envelope };
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'discipline: explanation filed');
      manifest.discipline = fresh.discipline;
      renderDisciplineLockdown(manifest);
    } catch (err) { btn.disabled = false; msg.textContent = err.message; }
  };
}

async function loadVocabPool() {
  const res = await fetch('data/vocab.json.enc');
  if (!res.ok) return [];
  const bank = JSON.parse(await decryptString(getPassword(), await res.json()));
  return bank.words || [];
}

// A vocab gloss like "forty (40)" or "the (masculine)" must accept the natural
// answer ("forty", "the") as well as the parenthetical ("40"). Build every
// reasonable form from one English gloss.
function vocabAnswers(en) {
  const set = new Set();
  const add = (s) => { const t = String(s).trim(); if (t) set.add(t); };
  const raw = String(en);
  for (const part of raw.split(/[\/;,]/)) {
    add(part);
    add(part.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ')); // drop parentheticals
  }
  for (const m of raw.match(/\(([^)]*)\)/g) || []) add(m.replace(/[()]/g, '')); // keep their contents too
  return [...set];
}

// Phase 3: a short recall quiz from the vocabulary bank — the neglected
// material. Pass reopens the course; fall short and it's barred two days.
async function wireDisciplineQuiz(manifest, st) {
  const area = $('dquiz-area'); area.hidden = false;
  const wrap = $('dquiz-questions'), msg = $('dquiz-msg'), btn = $('dquiz-submit');
  btn.hidden = true; msg.textContent = '';
  wrap.innerHTML = '<p class="muted">Loading the quiz…</p>';

  let pool = [];
  try { pool = (await loadVocabPool()).filter((w) => w && w.de && w.en); } catch { pool = []; }
  if (!pool.length) {
    wrap.innerHTML = '<p class="muted">The vocabulary bank is unavailable, so the quiz cannot run. This will be resolved at the next session — study in the meantime.</p>';
    return; // never self-clears without a real quiz
  }

  const picked = shuffleArr(pool).slice(0, Math.min(st.quiz.count, pool.length));
  wrap.innerHTML = '';
  picked.forEach((w, i) => {
    const row = document.createElement('div');
    row.className = 'dquiz-item';
    row.innerHTML = `<p class="dquiz-prompt">${i + 1}. „${escHtml(w.de)}“ <span class="muted">— in English</span></p>
      <input type="text" class="text-answer dquiz-input" id="dq-${i}" autocomplete="off" autocapitalize="off" spellcheck="false" />`;
    wrap.appendChild(row);
    forbidPaste(row.querySelector('input'), msg, 'No pasting. Answer from memory.');
  });
  btn.hidden = false; btn.disabled = false;

  btn.onclick = async () => {
    let correct = 0;
    picked.forEach((w, i) => {
      const given = $(`dq-${i}`).value;
      if (checkTextAnswer({ type: 'translate', answers: vocabAnswers(w.en), acceptFuzzy: true }, given)) correct += 1;
    });
    const total = picked.length;
    const passed = correct >= st.quiz.passCount;
    btn.disabled = true; msg.textContent = 'Grading…';
    if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — the quiz cannot be filed.'; btn.disabled = false; return; }
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.discipline ||= {};
      if (passed) {
        const prev = { issuedAt: fresh.discipline.issuedAt, reason: fresh.discipline.reason };
        fresh.discipline = { active: false, clearedAt: new Date().toISOString(), previous: prev, lastQuiz: { score: correct, total } };
        await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'discipline: quiz passed — course reopened');
        manifest.discipline = fresh.discipline;
        render(manifest); // the course is open again
      } else {
        fresh.discipline.attempt = null;                       // reset the whole ritual
        fresh.discipline.retryAfter = retryAfterDate().toISOString();
        await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'discipline: quiz failed — barred two days');
        manifest.discipline = fresh.discipline;
        msg.textContent = `${correct} / ${total} correct. You need ${st.quiz.passCount}.`;
        renderDisciplineLockdown(manifest);
      }
    } catch (err) { btn.disabled = false; msg.textContent = err.message; }
  };
}

// ---------- detention (weekend remediation) lockdown ----------
// A single locked screen on Sat/Sun: her tedious, repeat-heavy drills. Wrong
// answers are studied then reproduced from memory 4–10× (escalating). The red
// timer under the photo lives only in a cookie (never GitHub). Completion +
// per-drill results are recorded so SHE can rule the ±Betragen on Monday — the
// screen itself never touches the score.

let detentionTimer = null;
function stopDetentionTimer() { if (detentionTimer) { clearInterval(detentionTimer); detentionTimer = null; } }

const COOKIE = 'gl_detention_seconds';
function readCookieSeconds() {
  const m = (document.cookie || '').match(/(?:^|; )gl_detention_seconds=(\d+)/);
  return m ? Number(m[1]) : 0;
}
function writeCookieSeconds(n) { document.cookie = `${COOKIE}=${n};path=/;max-age=604800`; }
function fmtClock(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (x) => String(x).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}`;
}
function startDetentionTimer() {
  stopDetentionTimer();
  const el = $('detention-timer');
  let s = readCookieSeconds();
  const paint = () => { el.textContent = `Time in detention — ${fmtClock(s)}`; };
  paint();
  detentionTimer = setInterval(() => { s += 1; if (s % 5 === 0) writeCookieSeconds(s); paint(); }, 1000);
}

async function renderDetention(manifest) {
  detachLinesGuards();
  const panel = $('detention-lock-panel');
  for (const sec of document.querySelectorAll('main > section')) sec.hidden = sec !== panel;
  panel.hidden = false;
  document.body.classList.add('lockdown');
  document.querySelector('.topbar nav')?.classList.add('nav-dead'); // nothing but detention

  const st = detentionStatus(manifest);
  $('detention-reason').textContent = st.reason || 'Some of this did not stick. It will, now — from memory.';
  startDetentionTimer();

  const fig = $('detention-photo');
  if (!fig.querySelector('img')) {
    try {
      const url = await detentionPhotoUrl(getPassword());
      if (url) { const img = document.createElement('img'); img.alt = 'Nachsitzen'; img.src = url; fig.appendChild(img); }
    } catch { /* wrong password or missing asset */ }
  }

  $('detention-progress').textContent = `Drills — ${st.doneCount} of ${st.drills.length} done.`;
  $('detention-drill').hidden = true;
  $('detention-home').hidden = false;
  const startBtn = $('detention-start');
  const foot = $('detention-foot');

  if (st.complete) {
    startBtn.hidden = true;
    foot.textContent = 'Detention complete. It lifts on Monday. She sees what you did — and what you didn’t.';
    return;
  }
  startBtn.hidden = false;
  foot.textContent = 'Only this screen is open until Monday. Every wrong answer is written from memory until it holds.';
  const next = st.remaining[0];
  startBtn.textContent = `Start the next drill — ${next.label} (${st.remaining.length} left)`;
  startBtn.onclick = () => runDetentionDrill(manifest, st, next);
}

// The drill pool — reuses the same encrypted homework + vocab the practice tab
// draws from, filtered by the drill's mode. Hardened to typing (produce, never
// recognize), since detention is reproduction from memory.
async function loadDetentionArchive(manifest) {
  const pool = [];
  const missed = new Map();
  const weak = new Set();
  const decryptFile = async (path) => JSON.parse(await decryptString(getPassword(), JSON.parse((await gh.readText(path)).text)));
  const hwIds = [...new Set([...(manifest.lessons || []).map((l) => l.id), ...(manifest.history || []).map((h) => h.homeworkId)])].sort();
  for (const id of hwIds) {
    try { const hw = await decryptFile(`data/homework/homework-${id}.json.enc`); for (const q of hw.questions) pool.push({ key: `${id}:${q.id}`, q }); } catch { /* unavailable */ }
  }
  for (const h of manifest.history || []) {
    try {
      const rep = await decryptFile(`data/reports/report-${h.reportId}.json.enc`);
      for (const p of rep.perQuestion || []) if (p.attempts > 1 || !p.correct) missed.set(`${rep.homeworkId}:${p.qid}`, true);
    } catch { /* unavailable */ }
  }
  ((manifest.history || [])[manifest.history.length - 1]?.weakCategories || []).forEach((c) => weak.add(c));
  (manifest.teacherNote?.weakAreas || []).forEach((c) => weak.add(c));
  let vocab = [];
  try { vocab = (await decryptFile('data/vocab.json.enc')).words || []; } catch { /* none */ }
  return { pool, missed, weak, vocab };
}

// Any question type → "type the answer" (produce it).
function hardenToTyping(q) {
  if (q.type === 'multiple_choice') return { id: q.id, prompt: q.prompt, category: q.category, answers: [q.options[q.answerIndex]], note: q.note, acceptFuzzy: false, type: 'translate' };
  if (q.type === 'reorder') return { id: q.id, prompt: `${q.prompt} — type the full sentence`, category: q.category, answers: [q.answer.join(' ')], note: q.note, acceptFuzzy: true, type: 'translate' };
  return { ...q, type: 'translate' };
}

function detentionPoolFor({ pool, missed, weak, vocab }, mode, count) {
  let items;
  if (mode === 'vocab') {
    items = shuffleArr(vocab.filter((w) => w.de && w.en)).slice(0, count)
      .map((w) => ({ id: `v:${w.de}`, prompt: `„${w.de}“ — in English`, category: 'Vokabular', answers: vocabAnswers(w.en), acceptFuzzy: true, type: 'translate', note: w.note || '' }));
    return items;
  }
  let base;
  if (mode === 'mistakes') base = pool.filter((e) => missed.has(e.key));
  else if (mode === 'weak') base = pool.filter((e) => weak.has(e.q.category));
  else if (mode && mode.startsWith('cat:')) { const cat = mode.slice(4); base = pool.filter((e) => (e.q.category || '') === cat); }
  else base = pool; // 'mixed' / unknown
  if (base.length < Math.min(count, 3)) base = pool; // never strand him on an empty filter
  return shuffleArr(base).slice(0, count).map((e) => hardenToTyping(e.q));
}

async function runDetentionDrill(manifest, st, drill) {
  $('detention-home').hidden = true;
  const area = $('detention-drill'); area.hidden = false;
  const meta = $('detention-drill-meta'), prompt = $('detention-drill-prompt'), input = $('detention-drill-input');
  const fb = $('detention-feedback'), fbHead = $('detention-feedback-head'), fbBody = $('detention-feedback-body'), fbNext = $('detention-feedback-next');
  meta.textContent = `Drill — ${drill.label}`;
  prompt.textContent = 'Loading…'; input.value = ''; fb.hidden = true;

  let questions;
  try {
    const archive = await loadDetentionArchive(manifest);
    questions = detentionPoolFor(archive, drill.mode, drill.count);
  } catch { questions = []; }
  if (!questions.length) {
    prompt.textContent = 'This drill has no material to draw from. It counts as done.';
    await markDrillDone(manifest, drill.index);
    return;
  }

  const queue = questions.slice();
  const missCount = new Map();
  let solved = 0;
  const total = questions.length;

  const showQ = () => {
    fb.hidden = true; fbNext.hidden = true;
    const q = queue[0];
    meta.textContent = `Drill — ${drill.label} · ${solved}/${total}`;
    prompt.textContent = q.prompt;
    input.value = ''; input.disabled = false; input.focus();
  };
  const finish = async () => {
    area.hidden = true;
    await markDrillDone(manifest, drill.index);
  };
  const advance = () => { if (queue.length) showQ(); else finish(); };

  input.onkeydown = (e) => {
    if (e.key !== 'Enter' || input.disabled) return;
    const q = queue[0];
    const { correct } = checkTextAnswerDetailed(q, input.value);
    input.disabled = true;
    fb.hidden = false;
    fbBody.innerHTML = '';
    if (correct) {
      fbHead.textContent = 'Richtig.';
      fb.className = 'feedback feedback-ok';
      queue.shift(); solved += 1;
      fbNext.hidden = false; fbNext.textContent = queue.length ? 'Next' : 'Finish drill';
      fbNext.onclick = advance; fbNext.focus();
    } else {
      fbHead.textContent = 'Falsch.';
      fb.className = 'feedback feedback-bad';
      const n = (missCount.get(q.key ?? q.id) || 0) + 1;
      missCount.set(q.key ?? q.id, n);
      const times = repsForMiss(n, st.repsMin, st.repsMax);
      // Study the answer + reason, then reproduce it from memory `times` times.
      attachModelRepeat({
        mount: fbBody, nextBtn: fbNext, model: q.answers[0], times, studyFirst: true, explanation: q.note || '',
        onDone: () => {
          const at = Math.min(3, queue.length); // spaced requeue — it returns until it sits
          queue.splice(at, 0, queue.shift());
        },
      });
      fbNext.hidden = false; fbNext.textContent = queue.length > 1 ? 'Next' : 'Continue';
      fbNext.onclick = advance;
    }
  };
  showQ();
}

async function markDrillDone(manifest, index) {
  if (!gh.isConfigured()) {
    // No token to record with — advance locally so he isn't stuck; she reconciles.
    manifest.detention.record ||= { doneIndexes: [], startedAt: new Date().toISOString() };
    if (!manifest.detention.record.doneIndexes.includes(index)) manifest.detention.record.doneIndexes.push(index);
    renderDetention(manifest);
    return;
  }
  try {
    const { data: fresh } = await gh.readJson('data/manifest.json');
    fresh.detention ||= {};
    fresh.detention.record ||= { doneIndexes: [], startedAt: new Date().toISOString() };
    const rec = fresh.detention.record;
    if (!rec.doneIndexes.includes(index)) rec.doneIndexes.push(index);
    const totalDrills = (fresh.detention.drills || []).length;
    if (rec.doneIndexes.length >= totalDrills && !rec.completedAt) rec.completedAt = new Date().toISOString();
    rec.secondsSpent = readCookieSeconds();
    await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'detention: drill completed');
    manifest.detention = fresh.detention;
  } catch { /* leave local state; she reconciles Monday */ }
  renderDetention(manifest);
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
  // Cone tier's face is the Schande banner at the top of the page (shame.js) —
  // the rank badge keeps its plain ▲, no second photo here.
  const log = manifest.conduct?.log || [];
  const last = log[log.length - 1];
  $('conduct-last').textContent = last
    ? `Last ruling: ${last.delta > 0 ? '+' : ''}${last.delta} — ${last.reason} (${fmtDate(last.date)})`
    : 'No rulings yet. The score starts at 65 — everything above it is earned, nothing is given.';
  // The lock screen (below 60) is handled by renderLockdown() before the normal
  // dashboard renders — renderConduct only ever runs when NOT locked.
}

// ---------- lockdown (Betragen below 60) ----------
// The site closes to a single screen: a full-size image and nothing else — the
// nav is dead, the backdrop is a lock, and the only thing that works is the
// sequence back. That sequence is: two days straight of writing her assigned
// lines (typed, N times), then on the third day the apology finally opens
// (also typed, never pasted). See conduct.js lockStatus().

// Block paste / drag-drop / paste-inputType on a field — the words come from
// his own hand, whether they are her lines or his apology.
function forbidPaste(el, msgEl, warning) {
  const warn = (e) => { e.preventDefault(); if (msgEl) msgEl.textContent = warning; };
  el.addEventListener('paste', warn);
  el.addEventListener('drop', warn);
  el.addEventListener('beforeinput', (e) => { if (e.inputType && /paste|drop/i.test(e.inputType)) warn(e); });
}

async function renderLockdown(manifest) {
  detachLinesGuards(); // any prior lines-phase tab guard is stale now
  // Strip the dashboard to this one panel: hide every other section.
  const lockPanel = $('conduct-lock-panel');
  for (const sec of document.querySelectorAll('main > section')) {
    sec.hidden = sec !== lockPanel;
  }
  lockPanel.hidden = false;

  // The backdrop becomes a lock; the nav goes dead. Nothing works but the way back.
  document.body.classList.add('lockdown');
  document.querySelector('.topbar nav')?.classList.add('nav-dead');

  const score = conductScore(manifest);
  const st = lockStatus(manifest);

  $('lock-reason').textContent = `Betragen ${score}/100. Gesperrt.`;

  if (st.extraTasks) {
    const ex = $('apology-extra');
    ex.hidden = false;
    ex.textContent = `Her last rejection carried conditions: ${st.extraTasks}`;
  }

  // The full-size lockdown image (its own encrypted asset, not the cone photo).
  const fig = $('lockdown-photo');
  if (!fig.querySelector('img')) {
    try {
      const url = await lockdownPhotoUrl(getPassword());
      if (url) {
        const img = document.createElement('img');
        img.alt = 'Gesperrt';
        img.src = url;
        fig.appendChild(img);
      }
    } catch { /* wrong password or missing asset — the screen stands without it */ }
  }

  const prog = $('apology-progress');
  const linesArea = $('lines-area');
  const gate = $('apology-gate');
  const apologyArea = $('apology-area');
  const title = lockPanel.querySelector('.lockdown-title');
  const reason = $('lock-reason');
  // reset visibility each render — default: header text shown, header hidden
  // only while actively writing lines (so the image + textbox sit together and
  // the line/translation/warnings live below the box).
  linesArea.hidden = true; gate.hidden = true; apologyArea.hidden = true;
  title.hidden = false; reason.hidden = false; prog.hidden = false;

  if (st.phase === 'submitted') {
    prog.textContent = `Apology filed. Eligible for review: ${fmtLecture(st.eligibleAt)}. She decides then — not before.`;
    return;
  }

  if (st.phase === 'apology') {
    // Day 3: the lines are done; the apology opens behind the button.
    prog.textContent = 'Lines done — two days straight. Today the apology.';
    gate.hidden = false;
    wireApology(manifest, score);
    return;
  }

  // phase 'lines' — days 1 and 2.
  if (st.linesDoneToday) {
    prog.textContent = st.lineDaysDone >= 2
      ? 'Lines complete for today — two days done. The apology opens tomorrow.'
      : `Lines complete for today (day ${st.lineDaysDone} of 2). Come back tomorrow for the next set.`;
    return; // nothing more today
  }
  // Actively writing: the image + textbox are the pinned pair; the day, the
  // line, its translation and the counter all live below the box.
  title.hidden = true; reason.hidden = true; prog.hidden = true;
  wireLines(manifest, st, score);
}

// Tab/window-switch guards for the lines phase — kept module-level so a
// re-render never stacks duplicates. Detached whenever we leave the phase.
let linesGuards = null;
function detachLinesGuards() {
  if (!linesGuards) return;
  document.removeEventListener('visibilitychange', linesGuards.onHide);
  window.removeEventListener('blur', linesGuards.onBlur);
  linesGuards = null;
}

// Days 1–2: type her line, exactly, `times` times. Strict lines rules:
//   - any mistake restarts the count at 0;
//   - the last two are written from memory — the reference disappears;
//   - switching tabs/windows resets the current count.
function wireLines(manifest, st, score) {
  const area = $('lines-area');
  area.hidden = false;
  const input = $('lines-input');
  const status = $('lines-status');
  const prompt = $('lines-prompt');
  const line = st.lines.text;
  const times = st.lines.times;
  const translation = st.lines.translation || '';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = `Day ${st.lineDaysDone + 1} of 2`;
  const norm = (s) => s.trim().replace(/\s+/g, ' ');
  // The last two reps are written from memory (only meaningful for 3+).
  const memoryFrom = times >= 3 ? times - 2 : Infinity;
  let done = 0;

  // The line to copy (with its English meaning) and the counter sit BELOW the
  // textbox; once into the last two reps, the reference disappears.
  const en = translation ? `<span class="lines-en">${esc(translation)}</span>` : '';
  const render = (msg) => {
    prompt.innerHTML = done < memoryFrom
      ? `${day} — write it ${times} times, exactly:<span class="lines-de"><strong>„${esc(line)}“</strong></span>${en}`
      : `${day} — from memory now. The last ${times - done} without the line in front of you.`;
    status.textContent = msg ?? `${done} / ${times}`;
  };
  const reset = (why) => { done = 0; input.value = ''; render(why); };

  input.value = '';
  input.disabled = false;
  render();
  forbidPaste(input, status, 'No pasting. Write the line yourself.');

  input.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    if (norm(input.value) !== norm(line)) { reset(`Wrong. Start over — 0 / ${times}. Get it exactly right.`); input.focus(); return; }
    done += 1;
    input.value = '';
    if (done < times) { render(); return; }
    // Today's set complete — record the day. Guards off first.
    input.disabled = true;
    detachLinesGuards();
    status.textContent = 'Filing today’s lines…';
    if (!gh.isConfigured()) { status.textContent = 'No GitHub token (Settings) — the lines cannot be filed.'; input.disabled = false; return; }
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.conduct ||= { score, log: [] };
      fresh.conduct.lock ||= { active: true, since: new Date().toISOString(), apologies: [] };
      const lock = fresh.conduct.lock;
      lock.lines ||= st.lines;
      lock.lineDays ||= [];
      const today = localDate();
      if (!lock.lineDays.includes(today)) lock.lineDays.push(today);
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'conduct: lockdown lines written');
      manifest.conduct = fresh.conduct;
      renderLockdown(manifest);
    } catch (err) {
      input.disabled = false;
      status.textContent = err.message;
    }
  };

  // Switching tabs or windows resets the current count — eyes here, or start over.
  detachLinesGuards();
  const penalise = () => { if (done > 0) { reset('You switched away. The lines reset — 0. Eyes here.'); } };
  const onHide = () => { if (document.hidden) penalise(); };
  const onBlur = () => penalise();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('blur', onBlur);
  linesGuards = { onHide, onBlur };
}

// Day 3: reveal → typed apology → file it.
function wireApology(manifest, score) {
  const reveal = $('apology-reveal');
  const area = $('apology-area');
  const ta = $('apology-text');
  const submit = $('apology-submit');
  const msg = $('apology-msg');
  reveal.onclick = () => {
    $('apology-gate').hidden = true;
    area.hidden = false;
    ta.disabled = false; submit.disabled = false; ta.focus();
  };
  forbidPaste(ta, msg, 'No pasting. Type it — in your own words.');
  submit.onclick = async () => {
    const text = ta.value.trim();
    if (text.length < 100) { msg.textContent = 'Too short for an apology that means anything. Full sentences, auf Deutsch.'; return; }
    if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — the apology cannot be filed.'; return; }
    submit.disabled = true;
    msg.textContent = 'Filing…';
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      fresh.conduct ||= { score, log: [] };
      fresh.conduct.lock ||= { active: true, since: new Date().toISOString(), apologies: [] };
      const lock = fresh.conduct.lock;
      const today = localDate();
      if ((lock.apologies || []).some((a) => a.date === today)) throw new Error('Already filed today.');
      lock.apologies ||= [];
      lock.apologies.push({ date: today, enc: await encryptString(getPassword(), text) });
      if (!lock.eligibleAt) lock.eligibleAt = nextLecture().toISOString();
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'conduct: apology filed');
      manifest.conduct = fresh.conduct;
      ta.value = '';
      renderLockdown(manifest);
    } catch (e) {
      submit.disabled = false;
      msg.textContent = e.message;
    }
  };
}

// Anträge live on the Messages page now (messages.html), in the same thread
// as her Nachrichten — the dashboard stopped hosting the form.

// ---------- deeds (FR-004) ----------
// Real-world spoken tasks, made visible: assigned by her (scripts/deed.js),
// closed by the learner with one of three buttons and a one-line note. No
// proof, no upload — self-report, exactly as before, just no longer living
// only in her private ledger.

const DEED_STATUS_LABEL = { done: 'done', not_yet: 'not yet', declined: 'declined' };

function renderDeeds(manifest) {
  const panel = $('deeds-panel');
  const open = (manifest.deeds || []).filter((d) => d.status === 'open');
  if (!open.length) { panel.hidden = true; return; }
  panel.hidden = false;
  const list = $('deeds-list');
  list.innerHTML = '';
  for (const d of open) {
    const row = document.createElement('div');
    row.className = 'deed-row';
    row.innerHTML = `
      <p class="deed-text">${d.text}</p>
      <p class="muted deed-meta">assigned ${fmtDate(d.assignedAt)}${d.due ? ` · due with ${d.due}` : ''}</p>
      <textarea class="justify-input deed-note" rows="2" placeholder="One honest line — what happened?"></textarea>
      <div class="btn-row deed-actions">
        <button class="btn" data-status="done">Done</button>
        <button class="btn" data-status="not_yet">Not yet</button>
        <button class="btn btn-danger" data-status="declined">I'm not going to</button>
      </div>
      <p class="model-repeat-status deed-msg"></p>`;
    const note = row.querySelector('.deed-note');
    const msg = row.querySelector('.deed-msg');
    row.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = note.value.trim();
        if (text.length < 3) { msg.textContent = 'One honest line first.'; return; }
        if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — this cannot be filed.'; return; }
        row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        msg.textContent = 'Filing…';
        try {
          const { data: fresh } = await gh.readJson('data/manifest.json');
          const entry = (fresh.deeds || []).find((x) => x.id === d.id);
          if (!entry || entry.status !== 'open') throw new Error('Already closed — reload the page.');
          entry.status = btn.dataset.status;
          entry.closedAt = new Date().toISOString();
          entry.noteEnc = await encryptString(getPassword(), text);
          await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2),
            `deed ${d.id}: ${DEED_STATUS_LABEL[btn.dataset.status]}`);
          manifest.deeds = fresh.deeds;
          renderDeeds(manifest);
        } catch (e) {
          row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          msg.textContent = e.message;
        }
      });
    });
    list.appendChild(row);
  }
}

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

  // Betragen below 60: the dashboard collapses to the lockdown screen alone —
  // the full-size image and the gated, typed apology, nothing else.
  if (conductLocked(manifest)) { renderLockdown(manifest); return; }
  $('conduct-lock-panel').hidden = true;
  // The Nachweis (no-practice) lockdown does the same, with its own image and the
  // lines → apology → quiz ritual. Passing the quiz reopens the course.
  if (disciplineActive(manifest)) { renderDisciplineLockdown(manifest); return; }
  $('discipline-lock-panel').hidden = true;
  // Weekend detention: locks the whole site to its screen on Sat/Sun, inert Monday.
  if (detentionActive(manifest)) { renderDetention(manifest); return; }
  $('detention-lock-panel').hidden = true;
  stopDetentionTimer();
  document.body.classList.remove('lockdown');
  document.querySelector('.topbar nav')?.classList.remove('nav-dead', 'nav-discipline');

  renderConduct(manifest);
  renderDeeds(manifest);
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

  // Correction notices (FR-007, scripts/correction.js): her admission that a
  // past note or ruling was wrong, sitting right where the wrong claim sat —
  // plain, not discipline-red, not a Nachricht he has to go open. Newest
  // three, most recent first.
  const notices = (manifest.correctionNotices || []).slice(-3).reverse();
  const noticesWrap = $('correction-notices');
  noticesWrap.innerHTML = '';
  for (const c of notices) {
    const block = document.createElement('div');
    block.className = 'note-block correction-notice';
    block.innerHTML = '<p class="note-label"></p><p class="note-text"></p>';
    block.querySelector('.note-label').textContent = `Correction — ${fmtDate(c.date)}`;
    block.querySelector('.note-text').textContent = c.text;
    noticesWrap.appendChild(block);
  }

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
