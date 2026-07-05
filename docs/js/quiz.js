// quiz.js — the homework runner. One question at a time, instant feedback in
// Frau Richter's register (earned, specific, never sycophantic), missed questions
// requeue spaced within the session, and completion writes an encrypted report back.

import { encryptString, decryptString } from './crypto.js';
import { initLock, initLockButton, getPassword, getManifest } from './auth.js';
import * as gh from './github.js';

// ---------- answer checking ----------

export function normalize(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:…]+$/g, '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function checkTextAnswer(q, given) {
  const g = normalize(given);
  if (!g) return false;
  const norms = q.answers.map(normalize);
  if (norms.includes(g)) return true;
  // Fuzzy (Levenshtein ≤ 1) only for longer translate answers — typo grace, not laxity.
  if (q.type === 'translate' && q.acceptFuzzy) {
    return norms.some((a) => a.length > 10 && levenshtein(a, g) <= 1);
  }
  return false;
}

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
  records: new Map(), // qid -> { attempts, firstTryCorrect, firstGiven, category, correct }
  startedAt: null,
  reorderPicked: [],
};

const $ = (id) => document.getElementById(id);

async function startQuiz(manifest) {
  const hwId = manifest.currentHomeworkId;
  const { text } = await gh.readText(`data/homework/homework-${hwId}.json.enc`);
  const homework = JSON.parse(await decryptString(getPassword(), JSON.parse(text)));
  state.homework = homework;
  state.queue = homework.questions.slice();
  state.totalUnique = homework.questions.length;
  state.startedAt = Date.now();
  for (const q of homework.questions) {
    state.records.set(q.id, { attempts: 0, firstTryCorrect: null, firstGiven: null, category: q.category || 'Allgemein', correct: false });
  }
  $('hw-title').textContent = homework.title;
  renderNext();
}

function renderNext() {
  if (!state.queue.length) return finish();
  const q = state.queue[0];
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
    const hint = document.createElement('p');
    hint.className = 'q-hint';
    hint.textContent = `Hint: ${q.hint}`;
    area.appendChild(hint);
  }
  const submit = () => handleAnswer(q, input.value, checkTextAnswer(q, input.value));
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
    b.addEventListener('click', () => handleAnswer(q, opt, i === q.answerIndex));
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
  const rerender = () => {
    answerRow.innerHTML = '';
    state.reorderPicked.forEach((tok, i) => {
      const b = document.createElement('button');
      b.className = 'btn token token-picked';
      b.textContent = tok;
      b.addEventListener('click', () => { state.reorderPicked.splice(i, 1); rerender(); });
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
      b.addEventListener('click', () => { state.reorderPicked.push(tok); rerender(); });
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
    handleAnswer(q, given, ok);
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
  const submit = () => handleAnswer(q, input.value, checkTextAnswer(q, input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  submitBar(area, submit);
  input.focus();
  return input;
}

function renderListenType(q, area) {
  const play = document.createElement('button');
  play.className = 'btn play-btn';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => speak(q.audioText));
  area.appendChild(play);
  renderTextInput(q, area, 'What did you hear?');
  speak(q.audioText);
}

// ---------- answer handling / requeue ----------

function handleAnswer(q, given, isCorrect) {
  const rec = state.records.get(q.id);
  rec.attempts += 1;
  if (rec.attempts === 1) {
    rec.firstTryCorrect = isCorrect;
    rec.firstGiven = given;
  }
  state.queue.shift();
  let fb;
  if (isCorrect) {
    rec.correct = true;
    state.resolved += 1;
    fb = feedbackCorrect(q, rec.attempts);
  } else {
    // Spaced requeue in the same session — errors don't get to rest.
    const at = Math.min(REQUEUE_GAP, state.queue.length);
    state.queue.splice(at, 0, q);
    fb = feedbackWrong(q, rec.attempts, correctDisplay(q));
  }
  showFeedback(fb, isCorrect);
}

function showFeedback(fb, isCorrect) {
  const el = $('feedback');
  el.hidden = false;
  el.className = `feedback ${isCorrect ? 'feedback-ok' : 'feedback-bad'}`;
  $('feedback-head').textContent = fb.head;
  $('feedback-note').textContent = fb.note;
  const btn = $('feedback-next');
  btn.textContent = state.queue.length ? 'Next' : 'Finish';
  btn.onclick = renderNext;
  btn.focus();
}

// ---------- completion / report ----------

function buildReport() {
  const hw = state.homework;
  const perQuestion = [];
  const categoryStats = {};
  const missedItems = [];
  let firstTryCorrect = 0;
  for (const q of hw.questions) {
    const r = state.records.get(q.id);
    perQuestion.push({ qid: q.id, category: r.category, attempts: r.attempts, correct: r.correct, given: r.firstGiven });
    const c = (categoryStats[r.category] ||= { correct: 0, total: 0 });
    c.total += 1;
    if (r.firstTryCorrect) { c.correct += 1; firstTryCorrect += 1; }
    else missedItems.push({ qid: q.id, prompt: q.prompt, correct: correctDisplay(q), given: r.firstGiven });
  }
  const weakCategories = Object.entries(categoryStats)
    .filter(([, s]) => s.correct / s.total < 0.7)
    .map(([k]) => k);
  const strong = Object.entries(categoryStats).filter(([, s]) => s.correct === s.total).map(([k]) => k);
  const notes = [
    weakCategories.length ? `Struggled with: ${weakCategories.join(', ')}.` : 'No category below 70% on first try.',
    strong.length ? `Solid on first try: ${strong.join(', ')}.` : '',
    missedItems.length ? `Missed first-try: ${missedItems.map((m) => m.qid).join(', ')}.` : 'Clean run.',
  ].filter(Boolean).join(' ');
  return {
    id: hw.id,
    homeworkId: hw.id,
    lessonId: hw.lessonId,
    date: new Date().toISOString(),
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
    totalQuestions: hw.questions.length,
    firstTryCorrect,
    eventualCorrect: perQuestion.filter((p) => p.correct).length,
    totalAttempts: perQuestion.reduce((sum, p) => sum + p.attempts, 0),
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
    durationSec: report.durationSec,
    totalQuestions: report.totalQuestions,
    firstTryCorrect: report.firstTryCorrect,
    eventualCorrect: report.eventualCorrect,
    totalAttempts: report.totalAttempts,
    categories: report.categoryStats,
    weakCategories: report.weakCategories,
  });
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
  try {
    await startQuiz(manifest);
  } catch (e) {
    $('question-area').innerHTML = `<p class="lock-error">The homework could not be loaded: ${e.message}</p>`;
  }
});
