// test.js — the Klausur runner. Everything the homework runner is not:
// per-question countdown, one direction only, no feedback, no pausing,
// leaving = forfeit. Objective questions are graded silently into the
// encrypted result; subjective ones wait for Frau Richter.

import { encryptString, decryptString } from './crypto.js';
import { initLock, getPassword } from './auth.js';
import * as gh from './github.js';
import { gradeObjective } from './checking.js';
import { getTests, markerKey, deriveStatus, deriveForfeitReason, commitForfeit, fmtDeadline } from './tests-common.js';
import { conductLocked, conductScore } from './conduct.js';

const $ = (id) => document.getElementById(id);

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

// ---------- state ----------

const state = {
  manifest: null,
  entry: null,        // manifest.tests[] entry
  test: null,         // decrypted test content
  index: 0,
  perQuestion: [],
  startedAt: null,
  qShownAt: null,
  timerId: null,
  timeLimit: 0,
  replays: 0,
  blurs: 0,
  totalBlurs: 0,
  running: false,
  justifyEl: null,   // q.justify: textarea whose value rides along with the answer
};

function guard(e) {
  e.preventDefault();
  e.returnValue = ''; // required by Chrome to show the leave-warning dialog
}

function onBlur() {
  if (state.running) { state.blurs += 1; state.totalBlurs += 1; }
}

// ---------- boot ----------

function endScreen(title, text, statusMsg = '', ok = true) {
  $('pre-start').hidden = true;
  $('test-area').hidden = true;
  const end = $('end-area');
  end.hidden = false;
  $('end-title').textContent = title;
  $('end-text').textContent = text;
  const st = $('end-status');
  st.textContent = statusMsg;
  st.className = `status ${ok ? 'status-ok' : 'status-bad'}`;
}

initLock(async (manifest) => {
  state.manifest = manifest;
  // Conduct lock: Betragen below 60 closes everything, tests included.
  if (conductLocked(manifest)) {
    endScreen('Gesperrt.',
      `Betragen ${conductScore(manifest)}/100. No tests while the course is closed. The apologies come first — dashboard, one per day, three days.`,
      '', false);
    return;
  }
  // Course halted — tests are locked exactly like homework.
  if (manifest.discipline?.active) {
    endScreen('The course is halted.',
      'No tests while the outstanding tasks sit undone. They are on the dashboard. Do them, and the course reopens.',
      '', false);
    return;
  }
  const wanted = new URLSearchParams(location.search).get('id');
  const tests = getTests(manifest);
  const entry = wanted
    ? tests.find((t) => t.id === wanted)
    : tests
        .filter((t) => deriveStatus(t) === 'pending')
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];

  if (!entry) {
    endScreen('No test.', wanted
      ? `There is no test ${wanted} on record.`
      : 'Nothing is assigned right now. Tests come when I decide they come — usually unannounced.');
    return;
  }
  state.entry = entry;

  const status = deriveStatus(entry);
  if (status === 'forfeited') {
    if (entry.status === 'pending') {
      // Persist what is already true.
      const reason = deriveForfeitReason(entry);
      try { await commitForfeit(entry, reason, getPassword()); } catch (e) { console.warn(e.message); }
      endScreen('Forfeited.', reason === 'abandoned'
        ? 'You left mid-test. The rules were on the front page: leaving is forfeiting. Zero points, and it goes in the record.'
        : 'The deadline passed and the test was never taken. Zero points. Deadlines are not suggestions.',
        'Recorded.', false);
    } else {
      endScreen('Forfeited.', 'This test was forfeited. Zero points. It is in the record.', '', false);
    }
    return;
  }
  if (status === 'submitted') {
    endScreen('Already submitted.', 'This test is done and waiting for my red pen. You will see the result when I have graded it — not before.');
    return;
  }
  if (status === 'graded') {
    endScreen('Graded.', `Score: ${entry.score ?? '—'}. ${entry.comment || ''}`);
    return;
  }

  // Pending and takeable — load content, offer the one-way door.
  let test;
  try {
    const { text } = await gh.readText(`data/tests/test-${entry.id}.json.enc`);
    test = JSON.parse(await decryptString(getPassword(), JSON.parse(text)));
  } catch (e) {
    endScreen('Unavailable.', `The test file could not be loaded: ${e.message}`, '', false);
    return;
  }
  state.test = test;

  $('pre-start').hidden = false;
  $('test-title').textContent = test.title;
  // Deliberately NOT the paper's instructions here — those are sealed until
  // the learner is locked in. Only the shape is visible: count, time, deadline.
  const limits = [...new Set(test.questions.map((q) => q.timeLimitSec ?? test.defaultTimeLimitSec ?? 60))];
  $('test-meta').textContent =
    `${test.questions.length} questions · ${limits.length === 1 ? `${limits[0]}s each` : `${Math.min(...limits)}–${Math.max(...limits)}s per question`} · ${fmtDeadline(entry.deadline)}`;
  $('start-btn').addEventListener('click', start, { once: true });
});

// ---------- run ----------

const TYPE_LABELS = {
  fill_blank: 'fill the blank',
  multiple_choice: 'multiple choice (one answer)',
  reorder: 'rebuild the sentence from pieces',
  translate: 'translate / produce in German',
  listen_type: 'listen and type',
  subjective: 'free writing (she grades it by hand)',
  multi_select: 'select ALL correct options — there may be one, several, or many',
  click_mistake: 'click the mistaken word in the sentence',
};

// The paper's own briefing — visible only past the point of no return, before
// the first clock starts. Reading time is free; the door behind is already shut.
function showBriefing() {
  const test = state.test;
  $('pre-start').hidden = true;
  $('briefing-area').hidden = false;
  $('briefing-instructions').textContent = test.instructions || '';
  const mech = $('briefing-mechanics');
  mech.innerHTML = '';
  const li = (html) => {
    const el = document.createElement('li');
    el.innerHTML = html;
    mech.appendChild(el);
  };
  const counts = {};
  for (const q of test.questions) counts[q.type] = (counts[q.type] || 0) + 1;
  li(`<strong>Question types in this paper:</strong> ${Object.entries(counts)
    .map(([t, n]) => `${TYPE_LABELS[t] || t} (×${n})`).join(' · ')}.`);
  if (test.questions.some((q) => q.justify)) {
    li('<strong>Some questions demand a Begründung</strong> — a typed one-line reason, inside the same time limit. It is graded.');
  }
  if (test.negativeMarking) {
    li('<strong>Negative marking on option questions.</strong> A wrong pick costs 1/(number of options) of a point — with 10 options, −0.1. Guessing has a price; it is priced fairly, so a coin-flip gains you nothing.');
  } else {
    li('No negative marking on this paper.');
  }
  if (test.allowSkip !== false) {
    li('<strong>Skipping is allowed.</strong> The “Unsure — skip” button records zero for that question, no penalty. Knowing that you do not know is worth more than a lucky guess — use it honestly.');
  } else {
    li('<strong>No skipping on this paper.</strong> Every question must be faced.');
  }
  li('The per-question clock starts at the first question, not on this page.');
  $('begin-questions-btn').addEventListener('click', () => {
    $('briefing-area').hidden = true;
    $('test-area').hidden = false;
    renderQuestion();
  }, { once: true });
}

function start() {
  // Point of no return.
  localStorage.setItem(markerKey(state.entry.id), new Date().toISOString());
  window.addEventListener('beforeunload', guard);
  window.addEventListener('blur', onBlur);
  document.getElementById('test-nav').style.visibility = 'hidden'; // no exits offered mid-test
  state.startedAt = Date.now();
  state.running = true;
  showBriefing();
}

function renderQuestion() {
  const q = state.test.questions[state.index];
  state.qShownAt = Date.now();
  state.replays = 0;
  state.blurs = 0;
  state.timeLimit = q.timeLimitSec ?? state.test.defaultTimeLimitSec ?? 60;

  $('test-progress').textContent = `Question ${state.index + 1} of ${state.test.questions.length}`;
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

  let getAnswer;
  if (q.type === 'fill_blank') getAnswer = renderFillBlank(q, promptEl, area);
  else if (q.type === 'multiple_choice') getAnswer = renderMultipleChoice(q, area);
  else if (q.type === 'reorder') getAnswer = renderReorder(q, area);
  else if (q.type === 'translate') getAnswer = renderText(q, area, 'In German…');
  else if (q.type === 'listen_type') getAnswer = renderListen(q, area);
  else if (q.type === 'subjective') getAnswer = renderSubjective(q, area);
  else if (q.type === 'multi_select') getAnswer = renderMultiSelect(q, area);
  else if (q.type === 'click_mistake') getAnswer = renderClickMistake(q, area);
  else { console.warn('Unknown type', q.type); record(null, false); return; }

  // Justify-your-answer: her flagged questions demand a one-line reason inside
  // the same time limit. It is graded subjectively with the rest — an answer
  // with no reasoning behind it is worth less to her than a reasoned miss.
  state.justifyEl = null;
  if (q.justify) {
    const jl = document.createElement('p');
    jl.className = 'q-hint justify-label';
    jl.textContent = 'Begründung (required): why is that the answer? Same clock.';
    const ta = document.createElement('textarea');
    ta.className = 'justify-input';
    ta.rows = 2;
    ta.placeholder = 'Because…';
    area.append(jl, ta);
    state.justifyEl = ta;
  }

  const bar = document.createElement('div');
  bar.className = 'submit-bar';
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = state.index === state.test.questions.length - 1 ? 'Submit test' : 'Next →';
  btn.addEventListener('click', () => record(getAnswer(), false));
  bar.appendChild(btn);
  // The honest way out: zero points, no penalty. Guessing is priced; admitting
  // you don't know is free — that asymmetry is the point.
  if (state.test.allowSkip !== false && q.type !== 'subjective') {
    const skip = document.createElement('button');
    skip.className = 'btn skip-btn';
    skip.textContent = 'Unsure — skip (0 points, no penalty)';
    skip.addEventListener('click', () => record(null, false, true));
    bar.appendChild(skip);
  }
  area.appendChild(bar);

  startTimer();
}

function startTimer() {
  stopTimer();
  const tick = () => {
    const elapsed = (Date.now() - state.qShownAt) / 1000;
    const left = Math.max(0, state.timeLimit - elapsed);
    $('test-timer').textContent = `${Math.ceil(left)}s`;
    $('test-timer').classList.toggle('timer-low', left <= 10);
    $('timer-fill').style.width = `${(left / state.timeLimit) * 100}%`;
    if (left <= 0) record(null, true); // time's up — gone, no appeal
  };
  tick();
  state.timerId = setInterval(tick, 200);
}

function stopTimer() {
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
}

function record(given, timedOut, skipped = false) {
  stopTimer();
  const q = state.test.questions[state.index];
  state.perQuestion.push({
    qid: q.id,
    index: state.index,
    type: q.type,
    category: q.category || 'Allgemein',
    given: timedOut || skipped ? null : given,
    skipped,
    ...(q.justify ? { justification: state.justifyEl?.value.trim() || null } : {}),
    timedOut,
    timeUsedSec: Math.round((Date.now() - state.qShownAt) / 100) / 10,
    replays: state.replays,
    blurCount: state.blurs,
  });
  state.index += 1;
  if (state.index < state.test.questions.length) renderQuestion();
  else finish();
}

// ---------- renderers (no feedback, no hints — it's a test) ----------

function renderFillBlank(q, promptEl, area) {
  promptEl.innerHTML = '';
  const parts = q.prompt.split(/_{2,}/);
  const input = document.createElement('input');
  input.className = 'inline-blank';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  promptEl.append(document.createTextNode(parts[0] ?? ''), input, document.createTextNode(parts[1] ?? ''));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') record(input.value, false); });
  input.focus();
  return () => input.value;
}

function renderMultipleChoice(q, area) {
  let selected = null;
  const list = document.createElement('div');
  list.className = 'mc-options';
  q.options.forEach((opt) => {
    const b = document.createElement('button');
    b.className = 'btn mc-option';
    b.textContent = opt;
    b.addEventListener('click', () => {
      selected = opt;
      list.querySelectorAll('.mc-option').forEach((x) => x.classList.remove('mc-selected'));
      b.classList.add('mc-selected');
    });
    list.appendChild(b);
  });
  area.appendChild(list);
  return () => selected;
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.join('|') === arr.join('|') && arr.length > 1) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

function renderReorder(q, area) {
  const picked = [];
  const tokens = shuffled(q.tokens);
  const answerRow = document.createElement('div');
  answerRow.className = 'reorder-row reorder-answer';
  answerRow.dataset.empty = 'Click the pieces in the right order.';
  const pool = document.createElement('div');
  pool.className = 'reorder-row reorder-pool';
  const rerender = () => {
    answerRow.innerHTML = '';
    picked.forEach((tok, i) => {
      const b = document.createElement('button');
      b.className = 'btn token token-picked';
      b.textContent = tok;
      b.addEventListener('click', () => { picked.splice(i, 1); rerender(); });
      answerRow.appendChild(b);
    });
    pool.innerHTML = '';
    const remaining = tokens.slice();
    for (const p of picked) {
      const idx = remaining.indexOf(p);
      if (idx >= 0) remaining.splice(idx, 1);
    }
    for (const tok of remaining) {
      const b = document.createElement('button');
      b.className = 'btn token';
      b.textContent = tok;
      b.addEventListener('click', () => { picked.push(tok); rerender(); });
      pool.appendChild(b);
    }
  };
  area.append(answerRow, pool);
  rerender();
  return () => picked.join(' ');
}

function renderText(q, area, placeholder) {
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
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') record(input.value, false); });
  input.focus();
  return () => input.value;
}

function renderListen(q, area) {
  const play = document.createElement('button');
  play.className = 'btn play-btn';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => { state.replays += 1; speak(q.audioText); });
  area.appendChild(play);
  const getAnswer = renderText(q, area, 'What did you hear?');
  speak(q.audioText);
  return getAnswer;
}

// Select ALL correct options — the count is not given. Toggling is free until
// submit; the answer is the SET, graded as an exact match.
function renderMultiSelect(q, area) {
  const selected = new Set();
  const list = document.createElement('div');
  list.className = 'mc-options';
  const tip = document.createElement('p');
  tip.className = 'q-hint';
  tip.textContent = 'Select every correct option — one, several, or many. The whole set must be right.';
  area.appendChild(tip);
  q.options.forEach((opt) => {
    const b = document.createElement('button');
    b.className = 'btn mc-option';
    b.textContent = opt;
    b.addEventListener('click', () => {
      if (selected.has(opt)) { selected.delete(opt); b.classList.remove('mc-selected'); }
      else { selected.add(opt); b.classList.add('mc-selected'); }
    });
    list.appendChild(b);
  });
  area.appendChild(list);
  return () => (selected.size ? [...selected] : null);
}

// Click the mistaken word. Every token is clickable; the wrong-word count is
// what prices a guess under negative marking.
function renderClickMistake(q, area) {
  let picked = null;
  const tip = document.createElement('p');
  tip.className = 'q-hint';
  tip.textContent = 'One word in this sentence is wrong. Click it.';
  area.appendChild(tip);
  const row = document.createElement('div');
  row.className = 'reorder-row cm-sentence';
  q.tokens.forEach((tok, i) => {
    const b = document.createElement('button');
    b.className = 'btn token';
    b.textContent = tok;
    b.addEventListener('click', () => {
      picked = i;
      row.querySelectorAll('.token').forEach((x) => x.classList.remove('mc-selected'));
      b.classList.add('mc-selected');
    });
    row.appendChild(b);
  });
  area.appendChild(row);
  return () => picked;
}

function renderSubjective(q, area) {
  const ta = document.createElement('textarea');
  ta.className = 'subjective-answer';
  ta.rows = 6;
  ta.placeholder = 'Auf Deutsch. Full sentences. I read everything.';
  area.appendChild(ta);
  if (q.minWords) {
    const tip = document.createElement('p');
    tip.className = 'q-hint';
    tip.textContent = `Aim for at least ${q.minWords} words. Umlauts as ae/oe/ue/ss are fine.`;
    area.appendChild(tip);
  }
  ta.focus();
  return () => ta.value;
}

// ---------- finish ----------

async function finish() {
  // The test is over — answers are locked in. Lift the forfeit trap first so a
  // failed upload or a closed tab can no longer cost the points.
  state.running = false;
  window.removeEventListener('beforeunload', guard);
  window.removeEventListener('blur', onBlur);
  localStorage.removeItem(markerKey(state.entry.id));
  document.getElementById('test-nav').style.visibility = '';

  // Silent objective grading — goes into the encrypted result, not the screen.
  // With negativeMarking, a wrong answer on an option question costs 1/n of a
  // point (n = option count): a fair price that makes blind guessing worthless
  // in expectation. Skips and timeouts cost nothing — only guessing is priced.
  const optionCount = (q) =>
    q.type === 'multiple_choice' || q.type === 'multi_select' ? q.options.length
    : q.type === 'click_mistake' ? q.tokens.length
    : null;
  let autoCorrect = 0;
  let autoTotal = 0;
  let autoPoints = 0;
  for (const p of state.perQuestion) {
    const q = state.test.questions[p.index];
    const g = gradeObjective(q, p.given);
    if (g.gradable) {
      autoTotal += 1;
      p.autoCorrect = g.correct;
      p.matchType = g.matchType;
      if (g.correct) {
        autoCorrect += 1;
        autoPoints += 1;
      } else if (state.test.negativeMarking && !p.skipped && !p.timedOut
                 && p.given !== null && p.given !== undefined && p.given !== ''
                 && optionCount(q)) {
        p.penalty = Math.round((1 / optionCount(q)) * 100) / 100;
        autoPoints -= p.penalty;
      }
    }
  }
  autoPoints = Math.round(autoPoints * 100) / 100;

  const result = {
    testId: state.entry.id,
    status: 'submitted',
    startedAt: new Date(state.startedAt).toISOString(),
    date: new Date().toISOString(),
    durationSec: Math.round((Date.now() - state.startedAt) / 1000),
    totalQuestions: state.test.questions.length,
    answered: state.perQuestion.filter((p) => !p.timedOut && !p.skipped).length,
    skipped: state.perQuestion.filter((p) => p.skipped).length,
    timedOut: state.perQuestion.filter((p) => p.timedOut).length,
    subjectiveCount: state.perQuestion.filter((p) => p.type === 'subjective').length,
    totalBlurs: state.totalBlurs,
    negativeMarking: Boolean(state.test.negativeMarking),
    // objective portion only, pending review; points = correct minus guess penalties
    autoScore: { correct: autoCorrect, total: autoTotal, points: autoPoints },
    perQuestion: state.perQuestion,
  };

  const pw = getPassword();
  const resultEnc = JSON.stringify(await encryptString(pw, JSON.stringify(result, null, 2)), null, 2);

  const skippedNote = (result.timedOut
    ? ` The clock took ${result.timedOut} of them — speed is part of knowing.`
    : '') + (result.skipped
    ? ` You skipped ${result.skipped} — honestly declared, honestly zero.`
    : '');
  endScreen('Submitted.',
    `${result.answered} of ${result.totalQuestions} questions answered.${skippedNote} You will see nothing until I have graded it. That is how tests work.`);

  const st = $('end-status');
  if (gh.isConfigured()) {
    try {
      st.textContent = 'Sealing and filing the test…';
      await gh.writeText(`data/tests/test-result-${state.entry.id}.json.enc`, resultEnc,
        `test ${state.entry.id}: submitted (${result.answered}/${result.totalQuestions} answered)`);
      const { data: manifest } = await gh.readJson('data/manifest.json');
      const entry = (manifest.tests || []).find((t) => t.id === state.entry.id);
      if (entry) {
        entry.status = 'submitted';
        entry.submittedAt = result.date;
        entry.answered = result.answered;
        entry.timedOut = result.timedOut;
      }
      await gh.writeText('data/manifest.json', JSON.stringify(manifest, null, 2),
        `manifest: test ${state.entry.id} submitted`);
      st.textContent = 'Filed. Frau Richter grades it before your next lesson.';
    } catch (e) {
      st.textContent = `Filing failed (${e.message}) — download the files and commit them by hand. The answers are safe either way.`;
      offerDownloads(resultEnc);
    }
  } else {
    st.textContent = 'No GitHub token configured — download the result and commit it yourself.';
    offerDownloads(resultEnc);
  }
}

function offerDownloads(resultEnc) {
  const wrap = $('end-downloads');
  wrap.hidden = false;
  wrap.innerHTML = '';
  const a = document.createElement('a');
  a.className = 'btn';
  a.textContent = '⬇ Test result (encrypted)';
  a.download = `test-result-${state.entry.id}.json.enc`;
  a.href = URL.createObjectURL(new Blob([resultEnc], { type: 'application/json' }));
  wrap.appendChild(a);
  const p = document.createElement('p');
  p.className = 'q-hint';
  p.textContent = 'Destination: docs/data/tests/ — then commit and push.';
  wrap.appendChild(p);
}
