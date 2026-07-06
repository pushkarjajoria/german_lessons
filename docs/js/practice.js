// practice.js — voluntary drills sampled from everything already published,
// plus the vocabulary gauntlet. No report is filed (drills are practice, not
// assessment), but a small plaintext practiceLog entry is appended to the
// manifest when a token is configured — Frau Richter reads the log.
//
// Modes:
//   mistakes — questions missed on first try in any past report
//   weak     — questions in currently-flagged weak categories
//   grammar  — "tenses & forms": conjugation/cases/word order/negation/tense cats
//   harder   — production transform: MC loses its options, reorder must be typed
//   mixed    — the whole archive, shuffled
//   vocab    — many-option word quiz with deliberately confusing distractors

import { decryptString } from './crypto.js';
import { initLock, initLockButton, getPassword } from './auth.js';
import * as gh from './github.js';
import { checkTextAnswerDetailed } from './checking.js';

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

// ---------- archive loading ----------

const GRAMMAR_CATS = ['Konjugation', 'Kasus', 'Wortstellung', 'Negation', 'Perfekt', 'Präteritum', 'Futur', 'Artikel', 'Präpositionen'];
const SESSION_SIZE = 12;
const VOCAB_ROUND = 10;
const VOCAB_OPTIONS = 10;
const REQUEUE_GAP = 3;

const archive = {
  manifest: null,
  pool: [],        // { key: 'hwId:qid', hwId, q }
  missedKeys: new Map(), // key -> total extra attempts across reports (weight)
  weakCats: new Set(),
  vocab: [],       // bank entries {de, en, category?, confusers?, note?}
};

async function decryptFile(path) {
  const { text } = await gh.readText(path);
  return JSON.parse(await decryptString(getPassword(), JSON.parse(text)));
}

async function loadArchive(manifest) {
  archive.manifest = manifest;
  const hwIds = [...new Set([
    ...(manifest.lessons || []).map((l) => l.id),
    ...(manifest.history || []).map((h) => h.homeworkId),
  ])].sort();

  for (const id of hwIds) {
    try {
      const hw = await decryptFile(`data/homework/homework-${id}.json.enc`);
      for (const q of hw.questions) {
        archive.pool.push({ key: `${id}:${q.id}`, hwId: id, q });
      }
    } catch (e) {
      console.warn(`homework ${id} unavailable:`, e.message);
    }
  }

  for (const h of manifest.history || []) {
    try {
      const rep = await decryptFile(`data/reports/report-${h.reportId}.json.enc`);
      for (const p of rep.perQuestion || []) {
        if (p.attempts > 1 || !p.correct) {
          const key = `${rep.homeworkId}:${p.qid}`;
          archive.missedKeys.set(key, (archive.missedKeys.get(key) || 0) + Math.max(1, p.attempts - 1));
        }
      }
    } catch (e) {
      console.warn(`report ${h.reportId} unavailable:`, e.message);
    }
  }

  const lastEntry = (manifest.history || [])[manifest.history.length - 1];
  (lastEntry?.weakCategories || []).forEach((c) => archive.weakCats.add(c));
  (manifest.teacherNote?.weakAreas || []).forEach((c) => archive.weakCats.add(c));

  try {
    const bank = await decryptFile('data/vocab.json.enc');
    archive.vocab = bank.words || [];
  } catch {
    archive.vocab = [];
  }
}

// ---------- mode pools ----------

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Production transform: recognition becomes typing-from-memory.
function harden(q) {
  if (q.type === 'multiple_choice') {
    return {
      ...q,
      type: 'translate',
      answers: [q.options[q.answerIndex]],
      acceptFuzzy: false,
      hint: undefined,
      _hardened: true,
    };
  }
  if (q.type === 'reorder') {
    return {
      ...q,
      type: 'translate',
      prompt: `${q.prompt} — type the full sentence`,
      answers: [q.answer.join(' ')],
      acceptFuzzy: true,
      hint: undefined,
      _hardened: true,
    };
  }
  return { ...q, hint: undefined, _hardened: true };
}

function poolFor(mode) {
  if (mode === 'mistakes') {
    return archive.pool
      .filter((e) => archive.missedKeys.has(e.key))
      .sort((a, b) => (archive.missedKeys.get(b.key) || 0) - (archive.missedKeys.get(a.key) || 0));
  }
  if (mode === 'weak') {
    return archive.pool.filter((e) => archive.weakCats.has(e.q.category));
  }
  if (mode === 'grammar') {
    return archive.pool.filter((e) => GRAMMAR_CATS.some((g) => (e.q.category || '').includes(g)));
  }
  // harder and mixed both draw on everything; harder prefers past trouble first
  if (mode === 'harder') {
    const troubled = archive.pool.filter((e) => archive.missedKeys.has(e.key) || archive.weakCats.has(e.q.category));
    return (troubled.length >= 4 ? troubled : archive.pool);
  }
  return archive.pool;
}

function buildSession(mode) {
  const base = poolFor(mode);
  // Weighted-ish: keep the ordering bias for mistakes/harder, shuffle the rest.
  const picked = (mode === 'mistakes')
    ? [...base.slice(0, 6), ...shuffled(base.slice(6))].slice(0, SESSION_SIZE)
    : shuffled(base).slice(0, SESSION_SIZE);
  return picked.map((e) => ({
    key: e.key,
    q: mode === 'harder' ? harden(e.q) : e.q,
  }));
}

// ---------- drill runner ----------

const run = {
  mode: null,
  queue: [],
  totalUnique: 0,
  resolved: 0,
  records: new Map(), // key -> { attempts, firstTryCorrect }
  startedAt: null,
};

function startDrill(mode) {
  const items = buildSession(mode);
  if (!items.length) return;
  run.mode = mode;
  run.queue = items;
  run.totalUnique = items.length;
  run.resolved = 0;
  run.records = new Map(items.map((it) => [it.key, { attempts: 0, firstTryCorrect: null }]));
  run.startedAt = Date.now();
  $('mode-select').hidden = true;
  $('summary-area').hidden = true;
  $('drill-area').hidden = false;
  renderNext();
}

function renderNext() {
  if (!run.queue.length) return finishDrill();
  const { q } = run.queue[0];
  $('progress-label').textContent = `${run.resolved} of ${run.totalUnique} done · ${run.queue.length} open`;
  $('progress-fill').style.width = `${(run.resolved / run.totalUnique) * 100}%`;
  $('feedback').hidden = true;
  const area = $('question-area');
  area.innerHTML = '';

  const catEl = document.createElement('p');
  catEl.className = 'q-category';
  catEl.textContent = (q.category || '') + (q._hardened ? ' · production' : '');
  area.appendChild(catEl);

  const promptEl = document.createElement('h2');
  promptEl.className = 'q-prompt';
  promptEl.textContent = q.type === 'fill_blank' ? '' : q.prompt;
  area.appendChild(promptEl);

  if (q.type === 'fill_blank') renderFillBlank(q, promptEl, area);
  else if (q.type === 'multiple_choice') renderMC(q, area);
  else if (q.type === 'reorder') renderReorder(q, area);
  else if (q.type === 'translate') renderText(q, area, 'In German…');
  else if (q.type === 'listen_type') renderListen(q, area);
  else { console.warn('Unknown type', q.type); run.queue.shift(); renderNext(); }
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
}

function renderFillBlank(q, promptEl, area) {
  promptEl.innerHTML = '';
  const parts = q.prompt.split(/_{2,}/);
  const input = document.createElement('input');
  input.className = 'inline-blank';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  promptEl.append(document.createTextNode(parts[0] ?? ''), input, document.createTextNode(parts[1] ?? ''));
  const submit = () => handleAnswer(q, checkTextAnswerDetailed(q, input.value).correct);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  submitBar(area, submit);
  input.focus();
}

function renderMC(q, area) {
  const list = document.createElement('div');
  list.className = 'mc-options';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'btn mc-option';
    b.textContent = opt;
    b.addEventListener('click', () => handleAnswer(q, i === q.answerIndex));
    list.appendChild(b);
  });
  area.appendChild(list);
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
  submitBar(area, () => {
    const ok = picked.length === q.answer.length && picked.every((t, i) => t === q.answer[i]);
    handleAnswer(q, ok);
  });
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
  const submit = () => handleAnswer(q, checkTextAnswerDetailed(q, input.value).correct);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  submitBar(area, submit);
  input.focus();
  return input;
}

function renderListen(q, area) {
  const play = document.createElement('button');
  play.className = 'btn play-btn';
  play.textContent = '▶ Play';
  play.addEventListener('click', () => speak(q.audioText));
  area.appendChild(play);
  renderText(q, area, 'What did you hear?');
  speak(q.audioText);
}

function correctDisplay(q) {
  if (q.type === 'multiple_choice') return q.options[q.answerIndex];
  if (q.type === 'reorder') return q.answer.join(' ');
  return q.answers?.[0] ?? '';
}

function handleAnswer(q, isCorrect) {
  const item = run.queue.shift();
  const rec = run.records.get(item.key);
  rec.attempts += 1;
  if (rec.attempts === 1) rec.firstTryCorrect = isCorrect;
  let head, note;
  if (isCorrect) {
    run.resolved += 1;
    head = rec.attempts === 1 ? 'Richtig.' : `Richtig — attempt ${rec.attempts}.`;
    note = q.note || '';
  } else {
    const at = Math.min(REQUEUE_GAP, run.queue.length);
    run.queue.splice(at, 0, item);
    head = 'Falsch.';
    note = `${correctDisplay(q)}${q.note ? ' — ' + q.note : ''} It returns shortly.`;
  }
  const el = $('feedback');
  el.hidden = false;
  el.className = `feedback ${isCorrect ? 'feedback-ok' : 'feedback-bad'}`;
  $('feedback-head').textContent = head;
  $('feedback-note').textContent = note;
  const btn = $('feedback-next');
  btn.textContent = run.queue.length ? 'Next' : 'Finish';
  btn.onclick = renderNext;
  btn.focus();
}

function finishDrill() {
  const firstTry = [...run.records.values()].filter((r) => r.firstTryCorrect).length;
  showSummary({
    title: 'Drill done.',
    text: `${firstTry} of ${run.totalUnique} on first try, everything eventually produced. ` +
      (firstTry === run.totalUnique
        ? 'Clean. Do not confuse a good drill with a good habit — come back tomorrow.'
        : 'The ones that needed retries are exactly why drilling exists. Again tomorrow.'),
  });
  logPractice(run.mode, run.totalUnique, firstTry);
}

// ---------- vocabulary gauntlet ----------

const CONFUSION_KEY = 'gl_vocab_confusion_v1';

function confusionMap() {
  try { return JSON.parse(localStorage.getItem(CONFUSION_KEY)) || {}; } catch { return {}; }
}
function recordConfusion(dir, word, picked) {
  const map = confusionMap();
  const k = `${dir}|${word}`;
  map[k] = map[k] || {};
  map[k][picked] = (map[k][picked] || 0) + 1;
  localStorage.setItem(CONFUSION_KEY, JSON.stringify(map));
}
function pastWrongPicks(dir, word) {
  const entry = confusionMap()[`${dir}|${word}`] || {};
  return Object.entries(entry).sort((a, b) => b[1] - a[1]).map(([opt]) => opt);
}

const vocabRun = {
  items: [],   // { w, dir }
  index: 0,
  firstTry: 0,
  wrongPairs: [], // { asked, picked, correct }
  startedAt: null,
};

function vocabDirection() {
  const sel = document.querySelector('input[name="vdir"]:checked');
  return sel ? sel.value : 'mixed';
}

function buildVocabOptions(w, dir) {
  const bank = archive.vocab;
  const target = dir === 'de-en' ? w.en : w.de;
  const optOf = (e) => (dir === 'de-en' ? e.en : e.de);
  const candidates = [];
  // 1. Your own past wrong picks — she reuses what already fooled you.
  candidates.push(...pastWrongPicks(dir, dir === 'de-en' ? w.de : w.en));
  // 2. Declared confusers (bank entries by German word; free strings work for EN→DE).
  for (const c of w.confusers || []) {
    const entry = bank.find((e) => e.de === c);
    if (entry) candidates.push(optOf(entry));
    else if (dir === 'en-de') candidates.push(c);
  }
  // 3. Same category — plausible neighbours.
  candidates.push(...shuffled(bank.filter((e) => e !== w && e.category && e.category === w.category)).map(optOf));
  // 4. The rest of the bank.
  candidates.push(...shuffled(bank.filter((e) => e !== w)).map(optOf));
  const distractors = [...new Set(candidates)].filter((o) => o && o !== target).slice(0, VOCAB_OPTIONS - 1);
  return shuffled([target, ...distractors]);
}

function startVocab() {
  const bank = archive.vocab;
  if (!bank.length) return;
  const chosenDir = vocabDirection();
  const conf = confusionMap();
  // Prefer words with a confusion record, then fill randomly.
  const troubled = bank.filter((w) => conf[`de-en|${w.de}`] || conf[`en-de|${w.en}`]);
  const rest = shuffled(bank.filter((w) => !troubled.includes(w)));
  const words = [...shuffled(troubled), ...rest].slice(0, VOCAB_ROUND);
  vocabRun.items = words.map((w) => ({
    w,
    dir: chosenDir === 'mixed' ? (Math.random() < 0.5 ? 'de-en' : 'en-de') : chosenDir,
  }));
  vocabRun.index = 0;
  vocabRun.firstTry = 0;
  vocabRun.wrongPairs = [];
  vocabRun.startedAt = Date.now();
  $('mode-select').hidden = true;
  $('summary-area').hidden = true;
  $('drill-area').hidden = false;
  renderVocabNext();
}

function renderVocabNext() {
  if (vocabRun.index >= vocabRun.items.length) return finishVocab();
  const { w, dir } = vocabRun.items[vocabRun.index];
  const asked = dir === 'de-en' ? w.de : w.en;
  const target = dir === 'de-en' ? w.en : w.de;

  $('progress-label').textContent = `Word ${vocabRun.index + 1} of ${vocabRun.items.length}`;
  $('progress-fill').style.width = `${(vocabRun.index / vocabRun.items.length) * 100}%`;
  $('feedback').hidden = true;
  const area = $('question-area');
  area.innerHTML = '';

  const catEl = document.createElement('p');
  catEl.className = 'q-category';
  catEl.textContent = `Vokabular · ${dir === 'de-en' ? 'DE → EN' : 'EN → DE'}`;
  area.appendChild(catEl);

  const promptEl = document.createElement('h2');
  promptEl.className = 'q-prompt vocab-word';
  promptEl.textContent = asked;
  area.appendChild(promptEl);

  const grid = document.createElement('div');
  grid.className = 'vocab-options';
  for (const opt of buildVocabOptions(w, dir)) {
    const b = document.createElement('button');
    b.className = 'btn vocab-option';
    b.textContent = opt;
    b.addEventListener('click', () => {
      const ok = opt === target;
      if (ok && !grid.dataset.missed) vocabRun.firstTry += 1;
      if (!ok) {
        grid.dataset.missed = '1';
        recordConfusion(dir, asked, opt);
        vocabRun.wrongPairs.push({ asked, picked: opt, correct: target });
      }
      const el = $('feedback');
      el.hidden = false;
      el.className = `feedback ${ok ? 'feedback-ok' : 'feedback-bad'}`;
      $('feedback-head').textContent = ok ? 'Richtig.' : 'Falsch.';
      $('feedback-note').textContent = ok
        ? (w.note || '')
        : `${asked} → ${target}. You picked "${opt}" — noted. It will be offered again.`;
      const btn = $('feedback-next');
      btn.textContent = vocabRun.index + 1 < vocabRun.items.length ? 'Next' : 'Finish';
      btn.onclick = () => { vocabRun.index += 1; renderVocabNext(); };
      btn.focus();
    });
    grid.appendChild(b);
  }
  area.appendChild(grid);
}

function finishVocab() {
  const parts = [`${vocabRun.firstTry} of ${vocabRun.items.length} on first pick.`];
  if (vocabRun.firstTry === vocabRun.items.length) {
    parts.push('No confusion today. The options get nastier next round.');
  } else {
    parts.push('Every wrong pick is remembered — and will sit next to the right answer again until you stop falling for it.');
  }
  const confHtml = vocabRun.wrongPairs.length
    ? '<p class="note-label">Confusions this round</p>' + vocabRun.wrongPairs
        .map((p) => `<p class="confusion-row">„${p.asked}“ — you chose <em>${p.picked}</em>, it is <strong>${p.correct}</strong></p>`)
        .join('')
    : '';
  showSummary({ title: 'Gauntlet done.', text: parts.join(' '), extraHtml: confHtml });
  logPractice('vocab', vocabRun.items.length, vocabRun.firstTry);
}

// ---------- summary + log ----------

let lastMode = null;

function showSummary({ title, text, extraHtml = '' }) {
  $('drill-area').hidden = true;
  $('summary-area').hidden = false;
  $('summary-title').textContent = title;
  $('summary-text').textContent = text;
  $('summary-confusions').innerHTML = extraHtml;
}

// Best-effort, silent: she should see that you drilled, and how it went.
async function logPractice(mode, items, firstTry) {
  lastMode = mode;
  if (!gh.isConfigured()) return;
  try {
    const { data: manifest } = await gh.readJson('data/manifest.json');
    manifest.practiceLog = (manifest.practiceLog || []).slice(-49);
    manifest.practiceLog.push({
      date: new Date().toISOString(),
      mode,
      items,
      firstTry,
      durationSec: Math.round((Date.now() - (mode === 'vocab' ? vocabRun.startedAt : run.startedAt)) / 1000),
    });
    await gh.writeText('data/manifest.json', JSON.stringify(manifest, null, 2), `practice: ${mode} ${firstTry}/${items}`);
  } catch (e) {
    console.warn('practice log not written:', e.message);
  }
}

// ---------- boot ----------

initLockButton();
initLock(async (manifest) => {
  $('again-btn').addEventListener('click', () => {
    $('summary-area').hidden = true;
    if (lastMode === 'vocab') startVocab();
    else if (lastMode) startDrill(lastMode);
    else $('mode-select').hidden = false;
  });

  await loadArchive(manifest);

  const counts = {
    mistakes: poolFor('mistakes').length,
    weak: poolFor('weak').length,
    grammar: poolFor('grammar').length,
    harder: poolFor('harder').length,
    mixed: archive.pool.length,
    vocab: archive.vocab.length,
  };
  for (const [mode, n] of Object.entries(counts)) {
    const label = mode === 'vocab' ? `${n} words` : `${n} questions`;
    $(`count-${mode}`).textContent = n ? label : (mode === 'vocab' ? 'no word bank yet' : 'nothing here yet');
    const card = document.querySelector(`.mode-card[data-mode="${mode}"]`);
    card.disabled = !n;
    if (n) {
      card.addEventListener('click', () => (mode === 'vocab' ? startVocab() : startDrill(mode)));
    }
  }
  $('vocab-direction').hidden = !archive.vocab.length;
  $('pool-status').textContent = archive.pool.length
    ? `Archive open: ${archive.pool.length} questions from ${new Set(archive.pool.map((e) => e.hwId)).size} assignment(s)` +
      (archive.vocab.length ? ` · ${archive.vocab.length} words in the bank.` : ' · no vocabulary bank published yet.')
    : 'Nothing published yet. Drills unlock with the first assignment.';
});
