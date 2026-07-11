// quiz.js — the homework runner. One question at a time, instant feedback in
// Frau Richter's register (earned, specific, never sycophantic), missed questions
// requeue spaced within the session, and completion writes an encrypted report back.

import { encryptString, decryptString } from './crypto.js';
import { initLock, initLockButton, getPassword, getManifest } from './auth.js';
import * as gh from './github.js';
import { checkTextAnswerDetailed } from './checking.js';
import { getPolicy, attachModelRepeat, enrollFromReport, homeworkGated, freezeQuestionArea } from './corrections.js';
import { conductLocked, conductScore } from './conduct.js';

// ---------- feedback voice ----------

// Her voice: "Richtig/Falsch" stay German — the first two words worth knowing.
function feedbackCorrect(q, attempts) {
  const head = attempts === 1 ? 'Richtig.' : `Richtig — on attempt ${attempts}. First try would have been better.`;
  return { head, note: q.note || '' };
}

function feedbackWrong(q, attempts, correctShown) {
  let head;
  if (attempts === 1) head = 'Falsch.';
  else if (attempts === 2) head = `Wrong again. The answer is: “${correctShown}”. Read it. The question comes back.`;
  else head = `Wrong for the ${attempts}. time. The answer: “${correctShown}”. Exactly these repetitions are how errors set like concrete — so it returns until it sits.`;
  return { head, note: q.note || '' };
}

function correctDisplay(q) {
  if (q.type === 'multiple_choice') return q.options[q.answerIndex];
  if (q.type === 'reorder') return q.answer.join(' ');
  return q.answers[0];
}

// ---------- speech (listen_type) ----------

let germanVoice = null;
function pickGermanVoice() {
  const voices = speechSynthesis.getVoices();
  germanVoice = voices.find((v) => v.lang === 'de-DE') || voices.find((v) => v.lang.startsWith('de')) || null;
}
if ('speechSynthesis' in window) {
  pickGermanVoice();
  speechSynthesis.onvoiceschanged = pickGermanVoice;
}

function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = 0.88;
  if (germanVoice) u.voice = germanVoice;
  speechSynthesis.speak(u);
}

// ---------- quiz state ----------

const REQUEUE_GAP = 3; // a miss returns after ~3 other questions (spaced, same session)

const state = {
  homework: null,
  queue: [],          // question objects still to answer (misses re-inserted)
  totalUnique: 0,
  resolved: 0,
  records: new Map(), // qid -> per-question tracking, see beginQuiz for the full shape
  startedAt: null,
  reorderPicked: [],
  restarts: 0,        // times a begun attempt was abandoned before this one
  running: false,
};

const $ = (id) => document.getElementById(id);

const startedKey = (id) => `gl_hw_started_${id}`;
const abandonsKey = (id) => `gl_hw_abandons_${id}`;

function guard(e) {
  e.preventDefault();
  e.returnValue = ''; // Chrome requires this to show the leave-warning dialog
}

// Pre-start gate: decrypt and present, but count NOTHING until Begin. An
// accidental open costs nothing; an abandoned begun attempt is on the record.
async function prepareQuiz(manifest) {
  const hwId = manifest.currentHomeworkId;
  const { text } = await gh.readText(`data/homework/homework-${hwId}.json.enc`);
  const homework = JSON.parse(await decryptString(getPassword(), JSON.parse(text)));
  state.homework = homework;

  // A leftover started-marker means the last begun attempt was walked out on.
  if (localStorage.getItem(startedKey(hwId))) {
    localStorage.removeItem(startedKey(hwId));
    const n = (Number(localStorage.getItem(abandonsKey(hwId))) || 0) + 1;
    localStorage.setItem(abandonsKey(hwId), String(n));
  }
  state.restarts = Number(localStorage.getItem(abandonsKey(hwId))) || 0;

  $('hw-prestart').hidden = false;
  $('prestart-title').textContent = homework.title;
  $('prestart-meta').textContent = `${homework.questions.length} questions · misses return until they sit · the report is filed when you finish.`;
  if (state.restarts > 0) {
    const ab = $('prestart-abandon');
    ab.hidden = false;
    ab.textContent = state.restarts === 1
      ? 'You began this homework once and walked out. It restarts from the beginning — and the report will say so.'
      : `You have begun and abandoned this homework ${state.restarts} times. Each one is in the report. Begin when you mean it.`;
  }
  $('hw-begin').addEventListener('click', () => beginQuiz(hwId), { once: true });
}

function beginQuiz(hwId) {
  localStorage.setItem(startedKey(hwId), new Date().toISOString());
  window.addEventListener('beforeunload', guard);
  state.running = true;
  $('hw-prestart').hidden = true;
  $('hw-panel').hidden = false;
  const homework = state.homework;
  state.queue = homework.questions.slice();
  state.totalUnique = homework.questions.length;
  state.startedAt = Date.now();
  for (const q of homework.questions) {
    state.records.set(q.id, {
      attempts: 0,
      firstTryCorrect: null,
      firstGiven: null,
      allGiven: [],           // every answer given, in order — shows whether they converged or thrashed
      matchType: null,        // 'exact' | 'fuzzy', set when the correct answer lands
      category: q.category || 'Allgemein',
      type: q.type,
      correct: false,
      firstShownAt: null,     // set on first render, for latency below
      timeToFirstAnswerSec: null, // thinking time before the very first attempt
      hintShown: false,
      replays: 0,             // listen_type: manual replay clicks
      reorderMoves: 0,        // reorder: token add/remove clicks
      justification: null,    // q.justify: his typed one-line reason, for her red pen
    });
  }
  $('hw-title').textContent = homework.title;
  renderNext();
}

function renderNext() {
  if (!state.queue.length) return finish();
  const q = state.queue[0];
  const rec = state.records.get(q.id);
  if (rec.firstShownAt === null) rec.firstShownAt = Date.now();
  $('progress-label').textContent = `${state.resolved} of ${state.totalUnique} done · ${state.queue.length} open`;
  $('progress-fill').style.width = `${(state.resolved / state.totalUnique) * 100}%`;
  $('feedback').hidden = true;
  const area = $('question-area');
  area.innerHTML = '';
  const catEl = document.createElement('p');
  catEl.className = 'q-category';
  catEl.textContent = q.category || '';
  area.appendChild(catEl);

  const promptEl = document.createElement('h2');
  promptEl.className = 'q-prompt';
  promptEl.textContent = q.type === 'fill_blank' ? '' : q.prompt;
  area.appendChild(promptEl);

  if (q.type === 'fill_blank') renderFillBlank(q, promptEl, area);
  else if (q.type === 'multiple_choice') renderMultipleChoice(q, area);
  else if (q.type === 'reorder') renderReorder(q, area);
  else if (q.type === 'translate') renderTextInput(q, area, 'In German…');
  else if (q.type === 'listen_type') renderListenType(q, area);
  else { console.warn('Unknown question type', q.type); resolveMiss(q, '(unsupported type)'); }
}

function submitBar(area, onSubmit) {
  const bar = document.createElement('div');
  bar.className = 'submit-bar';
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = 'Check';
  btn.addEventListener('click', onSubmit);
  bar.appendChild(btn);
  area.appendChild(bar);
  return btn;
}

function renderFillBlank(q, promptEl, area) {
  promptEl.innerHTML = '';
  const parts = q.prompt.split(/_{2,}/);
  const input = document.createElement('input');
  input.className = 'inline-blank';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  promptEl.append(document.createTextNode(parts[0] ?? ''), input, document.createTextNode(parts[1] ?? ''));
  if (q.hint) {
    // Hidden behind a click so "hint used" is an actual signal, not a given.
    const hintBtn = document.createElement('button');
    hintBtn.type = 'button';
    hintBtn.className = 'btn hint-toggle';
    hintBtn.textContent = 'Show hint';
    const hintText = document.createElement('p');
    hintText.className = 'q-hint';
    hintText.textContent = `Hint: ${q.hint}`;
    hintText.hidden = true;
    hintBtn.addEventListener('click', () => {
      hintText.hidden = false;
      hintBtn.hidden = true;
      state.records.get(q.id).hintShown = true;
    });
    area.append(hintBtn, hintText);
  }
  const submit = () => {
    const { correct, matchType } = checkTextAnswerDetailed(q, input.value);
    handleAnswer(q, input.value, correct, matchType);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  submitBar(area, submit);
  input.focus();
}

function renderMultipleChoice(q, area) {
  const list = document.createElement('div');
  list.className = 'mc-options';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'btn mc-option';
    b.textContent = opt;
    b.addEventListener('click', () => handleAnswer(q, opt, i === q.answerIndex, i === q.answerIndex ? 'exact' : null));
    list.appendChild(b);
  });
  area.appendChild(list);
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Don't hand them the solution pre-assembled.
  if (a.join('|') === arr.join('|') && arr.length > 1) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

function renderReorder(q, area) {
  state.reorderPicked = [];
  const answerRow = document.createElement('div');
  answerRow.className = 'reorder-row reorder-answer';
  answerRow.dataset.empty = 'Click the pieces in the right order.';
  const pool = document.createElement('div');
  pool.className = 'reorder-row reorder-pool';
  const rec = state.records.get(q.id);
  const rerender = () => {
    answerRow.innerHTML = '';
    state.reorderPicked.forEach((tok, i) => {
      const b = document.createElement('button');
      b.className = 'btn token token-picked';
      b.textContent = tok;
      b.addEventListener('click', () => { rec.reorderMoves += 1; state.reorderPicked.splice(i, 1); rerender(); });
      answerRow.appendChild(b);
    });
    pool.innerHTML = '';
    const remaining = q.tokens.slice();
    for (const picked of state.reorderPicked) {
      const idx = remaining.indexOf(picked);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    for (const tok of remaining) {
      const b = document.createElement('button');
      b.className = 'btn token';
      b.textContent = tok;
      b.addEventListener('click', () => { rec.reorderMoves += 1; state.reorderPicked.push(tok); rerender(); });
      pool.appendChild(b);
    }
  };
  area.append(answerRow, pool);
  if (!q._shuffled) q._shuffled = shuffled(q.tokens);
  q.tokens = q._shuffled;
  rerender();
  submitBar(area, () => {
    const given = state.reorderPicked.join(' ');
    const ok = state.reorderPicked.length === q.answer.length &&
      state.reorderPicked.every((t, i) => t === q.answer[i]);
    handleAnswer(q, given, ok, ok ? 'exact' : null);
  });
}

function renderTextInput(q, area, placeholder) {
  const input = document.createElement('input');
  input.className = 'text-answer';
  input.placeholder = placeholder;
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  area.appendChild(input);
  const tip = document.createElement('p');
  tip.className = 'q-hint';
  tip.textContent = 'You may write umlauts as ae/oe/ue/ss.';
  area.appendChild(tip);
  const submit = () => {
    const { correct, matchType } = checkTextAnswerDetailed(q, input.value);
    handleAnswer(q, input.value, correct, matchType);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  submitBar(area, submit);
  input.focus();
  return input;
}

function renderListenType(q, area) {
  const play = document.createElement('button');
  play.className = 'btn play-btn';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => {
    state.records.get(q.id).replays += 1; // manual replays only — the auto-play below doesn't count
    speak(q.audioText);
  });
  area.appendChild(play);
  renderTextInput(q, area, 'What did you hear?');
  speak(q.audioText);
}

// ---------- answer handling / requeue ----------

function handleAnswer(q, given, isCorrect, matchType = null) {
  // The answer is checked once. Wrong means the correction is typed back —
  // not the original answer quietly edited and re-checked.
  freezeQuestionArea();
  const rec = state.records.get(q.id);
  rec.attempts += 1;
  rec.allGiven.push(given);
  if (rec.attempts === 1) {
    rec.firstTryCorrect = isCorrect;
    rec.firstGiven = given;
    rec.timeToFirstAnswerSec = Math.round((Date.now() - rec.firstShownAt) / 100) / 10;
  }
  state.queue.shift();
  let fb;
  if (isCorrect) {
    rec.correct = true;
    rec.matchType = matchType;
    state.resolved += 1;
    fb = feedbackCorrect(q, rec.attempts);
  } else {
    // Spaced requeue in the same session — errors don't get to rest.
    const at = Math.min(REQUEUE_GAP, state.queue.length);
    state.queue.splice(at, 0, q);
    fb = feedbackWrong(q, rec.attempts, correctDisplay(q));
  }
  showFeedback(fb, isCorrect, q);
}

// Justify-your-answer: for questions she flags (q.justify), one typed line of
// reasoning is owed on the first attempt — right or wrong. It goes in the
// report verbatim for her subjective red pen; a correct answer with a wrong
// reason is exactly the pattern-matching she is hunting.
function attachJustify(mount, nextBtn, rec) {
  nextBtn.disabled = true;
  const wrap = document.createElement('div');
  wrap.className = 'justify-block';
  const label = document.createElement('p');
  label.className = 'model-repeat-label';
  label.textContent = 'Begründung — one line: why is that the answer? She reads it.';
  const ta = document.createElement('textarea');
  ta.className = 'justify-input';
  ta.rows = 2;
  ta.placeholder = 'Because…';
  const status = document.createElement('p');
  status.className = 'model-repeat-status';
  const submit = document.createElement('button');
  submit.className = 'btn';
  submit.textContent = 'Submit reason';
  submit.addEventListener('click', () => {
    const v = ta.value.trim();
    if (v.length < 8) { status.textContent = 'One honest line. Not a word.'; ta.focus(); return; }
    rec.justification = v;
    ta.disabled = true;
    submit.disabled = true;
    label.textContent = 'Noted. She will judge the reasoning, not just the answer.';
    status.textContent = '';
    nextBtn.disabled = false;
    nextBtn.focus();
  });
  wrap.append(label, ta, submit, status);
  mount.appendChild(wrap);
  ta.focus();
}

function showFeedback(fb, isCorrect, q) {
  const el = $('feedback');
  el.hidden = false;
  el.className = `feedback ${isCorrect ? 'feedback-ok' : 'feedback-bad'}`;
  $('feedback-head').textContent = fb.head;
  $('feedback-note').textContent = fb.note;
  el.querySelector('.model-repeat')?.remove();
  el.querySelector('.justify-block')?.remove();
  const btn = $('feedback-next');
  btn.disabled = false;
  btn.textContent = state.queue.length ? 'Next' : 'Finish';
  btn.onclick = renderNext;
  const rec = q ? state.records.get(q.id) : null;
  const needsJustify = Boolean(q?.justify && rec && rec.attempts === 1 && !rec.justification);
  // Persona §2.5, in code: a wrong answer is corrected by PRODUCING the
  // correction, on the spot, as many times as she demands — before moving on.
  // If a justification is also owed, it queues up behind the correction.
  if (!isCorrect && q) {
    const policy = getPolicy(getManifest());
    if (policy.enabled && policy.modelRepeat > 0) {
      attachModelRepeat({
        mount: el, nextBtn: btn, model: correctDisplay(q), times: policy.modelRepeat,
        onDone: needsJustify ? () => attachJustify(el, btn, rec) : undefined,
      });
      return;
    }
  }
  if (needsJustify) {
    attachJustify(el, btn, rec);
    return;
  }
  btn.focus();
}

// ---------- completion / report ----------

function buildReport() {
  const hw = state.homework;
  const perQuestion = [];
  const categoryStats = {};
  const categoryAttempts = {}; // category -> {attempts, count} — reveals hidden difficulty even when accuracy looks fine
  const missedItems = [];
  let firstTryCorrect = 0;
  hw.questions.forEach((q, index) => {
    const r = state.records.get(q.id);
    perQuestion.push({
      qid: q.id,
      index,
      type: r.type,
      category: r.category,
      attempts: r.attempts,
      correct: r.correct,
      given: r.firstGiven,
      allGiven: r.allGiven,
      matchType: r.matchType,
      hintShown: r.hintShown,
      replays: r.replays,
      reorderMoves: r.reorderMoves,
      timeToFirstAnswerSec: r.timeToFirstAnswerSec,
      ...(q.justify ? { justification: r.justification } : {}),
      ...(q.interleaved ? { interleaved: q.interleaved } : {}), // buried old question — her trap, marked for her eyes
    });
    const c = (categoryStats[r.category] ||= { correct: 0, total: 0 });
    c.total += 1;
    if (r.firstTryCorrect) { c.correct += 1; firstTryCorrect += 1; }
    else missedItems.push({ qid: q.id, prompt: q.prompt, correct: correctDisplay(q), given: r.firstGiven });
    const ca = (categoryAttempts[r.category] ||= { attempts: 0, count: 0 });
    ca.attempts += r.attempts;
    ca.count += 1;
  });
  const weakCategories = Object.entries(categoryStats)
    .filter(([, s]) => s.correct / s.total < 0.7)
    .map(([k]) => k);
  const strong = Object.entries(categoryStats).filter(([, s]) => s.correct === s.total).map(([k]) => k);
  const notes = [
    weakCategories.length ? `Struggled with: ${weakCategories.join(', ')}.` : 'No category below 70% on first try.',
    strong.length ? `Solid on first try: ${strong.join(', ')}.` : '',
    missedItems.length ? `Missed first-try: ${missedItems.map((m) => m.qid).join(', ')}.` : 'Clean run.',
  ].filter(Boolean).join(' ');
  const totalAttempts = perQuestion.reduce((sum, p) => sum + p.attempts, 0);
  const latencies = perQuestion.map((p) => p.timeToFirstAnswerSec).filter((v) => typeof v === 'number');
  const avgFirstAnswerLatencySec = latencies.length
    ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10
    : null;
  return {
    id: hw.id,
    homeworkId: hw.id,
    lessonId: hw.lessonId,
    startedAt: new Date(state.startedAt).toISOString(),
    date: new Date().toISOString(), // completion timestamp — kept for backward compatibility
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
    totalQuestions: hw.questions.length,
    firstTryCorrect,
    eventualCorrect: perQuestion.filter((p) => p.correct).length,
    totalAttempts,
    reworkRatio: Math.round((totalAttempts / hw.questions.length) * 100) / 100,
    avgFirstAnswerLatencySec,
    hintsUsedCount: perQuestion.filter((p) => p.hintShown).length,
    audioReplaysTotal: perQuestion.reduce((sum, p) => sum + (p.replays || 0), 0),
    restarts: state.restarts, // begun-and-abandoned attempts before this completed one
    categoryAttempts,
    perQuestion,
    categoryStats,
    weakCategories,
    missedItems,
    notesForTeacher: notes,
  };
}

function updatedManifest(manifest, report) {
  const m = structuredClone(manifest);
  const today = report.date.slice(0, 10);
  const last = m.counters.lastPracticed ? m.counters.lastPracticed.slice(0, 10) : null;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (last !== today) m.counters.streakDays = last === yesterday ? (m.counters.streakDays || 0) + 1 : 1;
  m.counters.lastPracticed = report.date;
  m.counters.lessonsCompleted += 1;
  m.counters.totalQuestions += report.totalQuestions;
  m.counters.totalCorrect += report.firstTryCorrect;
  // History keeps only non-sensitive aggregates (numbers, categories, dates) so the
  // dashboard works without decrypting every report. Content stays encrypted.
  m.history.push({
    reportId: report.id,
    homeworkId: report.homeworkId,
    title: state.homework.title,
    date: report.date,
    startedAt: report.startedAt,
    durationSec: report.durationSec,
    totalQuestions: report.totalQuestions,
    firstTryCorrect: report.firstTryCorrect,
    eventualCorrect: report.eventualCorrect,
    totalAttempts: report.totalAttempts,
    reworkRatio: report.reworkRatio,
    avgFirstAnswerLatencySec: report.avgFirstAnswerLatencySec,
    hintsUsedCount: report.hintsUsedCount,
    audioReplaysTotal: report.audioReplaysTotal,
    categoryAttempts: report.categoryAttempts,
    categories: report.categoryStats,
    weakCategories: report.weakCategories,
  });
  // Persona §2.5: first-try misses enter the Korrektur queue — to be produced
  // correctly, spaced, until they sit (see corrections.js / SCHEMA.md).
  enrollFromReport(m, report);
  return m;
}

function summaryLine(report) {
  const pct = report.firstTryCorrect / report.totalQuestions;
  const n = `${report.firstTryCorrect} of ${report.totalQuestions} on the first try`;
  if (pct === 1) return `${n}. Faultless. That is the standard, not the exception — again tomorrow.`;
  if (pct >= 0.8) return `${n}. Proper work. The gaps (${report.weakCategories.join(', ') || 'few'}) go into the next lesson.`;
  if (pct >= 0.5) return `${n}. Not enough yet. ${report.weakCategories.join(' and ') || 'The misses'} we repeat until they sit.`;
  return `${n}. We have work ahead of us. No new material before this sits — that is how errors are stopped from setting.`;
}

async function finish() {
  // Answers are locked in — lift the abandon trap before any network I/O so a
  // failed upload can no longer look like walking out.
  state.running = false;
  window.removeEventListener('beforeunload', guard);
  localStorage.removeItem(startedKey(state.homework.id));
  localStorage.removeItem(abandonsKey(state.homework.id));
  const report = buildReport();
  const pw = getPassword();
  const reportEnc = JSON.stringify(await encryptString(pw, JSON.stringify(report, null, 2)), null, 2);
  // Re-read the manifest fresh when we can write, so we don't clobber concurrent changes.
  const manifest = gh.isConfigured()
    ? (await gh.readJson('data/manifest.json')).data
    : getManifest();
  const newManifest = updatedManifest(manifest, report);
  const manifestText = JSON.stringify(newManifest, null, 2);
  const reportPath = `data/reports/report-${report.id}.json.enc`;

  $('question-area').innerHTML = '';
  $('feedback').hidden = true;
  $('progress-fill').style.width = '100%';
  $('progress-label').textContent = 'Done.';
  const done = $('done-area');
  done.hidden = false;
  $('done-summary').textContent = summaryLine(report);
  $('done-detail').textContent = `Duration: ${Math.floor(report.durationSec / 60)} min ${report.durationSec % 60} s · report ${report.id}`;

  const status = $('done-status');
  if (gh.isConfigured()) {
    try {
      status.textContent = 'Writing the encrypted report to the repo…';
      await gh.writeText(reportPath, reportEnc, `report ${report.id}: ${report.firstTryCorrect}/${report.totalQuestions} first-try`);
      await gh.writeText('data/manifest.json', manifestText, `manifest: record report ${report.id}`);
      status.textContent = 'Report committed. Frau Richter reads it before your next lesson.';
    } catch (e) {
      status.textContent = `Write failed (${e.message}). Download the files and commit them by hand.`;
      offerDownloads(report, reportEnc, manifestText);
    }
  } else {
    status.textContent = 'No GitHub token configured — download both files and commit them yourself.';
    offerDownloads(report, reportEnc, manifestText);
  }
}

function offerDownloads(report, reportEnc, manifestText) {
  const wrap = $('done-downloads');
  wrap.hidden = false;
  wrap.innerHTML = '';
  const mk = (label, filename, content) => {
    const a = document.createElement('a');
    a.className = 'btn';
    a.textContent = label;
    a.download = filename;
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    wrap.appendChild(a);
  };
  mk('⬇ Report (encrypted)', `report-${report.id}.json.enc`, reportEnc);
  mk('⬇ manifest.json (updated)', 'manifest.json', manifestText);
  const p = document.createElement('p');
  p.className = 'q-hint';
  p.textContent = 'Destination: docs/data/reports/ and docs/data/manifest.json — then commit and push.';
  wrap.appendChild(p);
}

// ---------- boot ----------

initLockButton();
initLock(async (manifest) => {
  // Conduct lock: Betragen below 60 closes the course entirely.
  if (conductLocked(manifest)) {
    $('hw-panel').hidden = false;
    $('hw-title').textContent = 'Gesperrt.';
    $('question-area').innerHTML =
      `<p class="lock-error">Betragen ${conductScore(manifest)}/100 — below 60 the course is closed. ` +
      'The apologies are written on the dashboard, one per day, three days in a row. Then I decide.</p>';
    return;
  }
  // Course halted (Nachweis tasks outstanding) — homework refuses to start.
  if (manifest.discipline?.active) {
    $('hw-panel').hidden = false;
    $('hw-title').textContent = 'The course is halted.';
    $('question-area').innerHTML =
      '<p class="lock-error">No homework until the outstanding tasks are done and cleared. ' +
      'You will find them on the dashboard. This is not negotiable from this side of the desk.</p>';
    return;
  }
  // Overdue Korrektur gates new homework: nothing new until the old thing is right.
  if (homeworkGated(manifest)) {
    $('hw-panel').hidden = false;
    $('hw-title').textContent = 'Erst die Korrektur.';
    $('question-area').innerHTML =
      '<p class="lock-error">Corrections have been waiting longer than I allow. New homework stays locked ' +
      'until they are produced correctly — <a href="practice.html">the Korrektur queue is on the Practice page</a>. ' +
      'This is how errors are stopped from setting.</p>';
    return;
  }
  try {
    await prepareQuiz(manifest);
  } catch (e) {
    $('hw-panel').hidden = false;
    $('question-area').innerHTML = `<p class="lock-error">The homework could not be loaded: ${e.message}</p>`;
  }
});
