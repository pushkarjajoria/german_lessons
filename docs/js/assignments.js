// assignments.js — the assignment ledger. Homework pairs 1:1 with lessons
// (same id), so the curriculum placement in manifest.lessons organizes the
// assignments too: sections → subsections → numbered rows with a completion
// checkmark and score from manifest.history. The current pending assignment
// is pinned on top — it must be completed to proceed.
//
// Berichte: every completed assignment owes a short written report — what the
// lesson asked for (the "write about…" task) or, failing that, what was
// learned and what still resists. Encrypted inline in
// manifest.assignmentReports[lessonId]; a completed assignment without one is
// flagged, and she notices flags.

import { initLock, initLockButton, getPassword } from './auth.js';
import { encryptString, decryptString } from './crypto.js';
import { homeworkGated } from './corrections.js';
import * as gh from './github.js';

const $ = (id) => document.getElementById(id);

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function render(manifest) {
  const lessons = manifest.lessons || [];
  const history = manifest.history || [];
  const byHw = new Map(history.map((h) => [h.homeworkId, h]));
  const halted = Boolean(manifest.discipline?.active);

  // Pinned pending assignment
  const pendingEntry = lessons.find((l) => l.id === manifest.currentHomeworkId && !byHw.has(l.id));
  const gated = !halted && homeworkGated(manifest);
  const pin = $('pending-panel');
  if (pendingEntry) {
    pin.hidden = false;
    $('pending-title').textContent = `${pendingEntry.id} · ${pendingEntry.title}`;
    $('pending-sub').textContent = halted
      ? 'Locked. The course is halted — see the dashboard. The tasks there come first.'
      : gated
        ? 'Locked behind overdue corrections. Erst die Korrektur — the queue is on the Practice page.'
        : `${pendingEntry.section}${pendingEntry.subsection ? ' → ' + pendingEntry.subsection : ''} · everything after this waits until it is done.`;
    const btn = $('pending-start');
    if (halted || gated) {
      btn.classList.remove('btn-primary');
      btn.removeAttribute('href');
      btn.textContent = 'Locked';
      if (gated) { btn.setAttribute('href', 'practice.html'); btn.textContent = 'Korrektur →'; }
    }
  } else {
    pin.hidden = true;
  }

  // Grouped ledger
  const tree = $('assignments-tree');
  tree.innerHTML = '';
  if (!lessons.length) {
    tree.innerHTML = '<p class="muted">No assignments yet. The first one arrives with the first lesson.</p>';
    return;
  }

  const sections = new Map();
  for (const l of lessons) {
    const sec = l.section || 'Allgemein';
    if (!sections.has(sec)) sections.set(sec, new Map());
    const subs = sections.get(sec);
    const sub = l.subsection || '';
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(l);
  }

  const reports = manifest.assignmentReports || {};

  // The report box under a completed assignment: filed → readable on demand;
  // missing → a flag and the textarea. Filing is once — she reads originals.
  const reportBlock = (l, manifest) => {
    const filed = reports[l.id];
    const det = document.createElement('details');
    det.className = 'report-details';
    const sum = document.createElement('summary');
    sum.className = filed ? 'report-sum report-sum-done' : 'report-sum report-sum-due';
    sum.textContent = filed ? `Bericht filed ${fmtDate(filed.date)} — view` : 'Bericht fehlt — write it';
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'report-body';
    det.appendChild(body);
    if (filed) {
      det.addEventListener('toggle', async () => {
        if (!det.open || body.dataset.loaded) return;
        body.dataset.loaded = '1';
        try {
          const text = await decryptString(getPassword(), filed.enc);
          body.innerHTML = '<p class="report-text"></p>';
          body.querySelector('.report-text').textContent = text;
        } catch { body.innerHTML = '<p class="muted">(unreadable)</p>'; }
      }, { once: false });
    } else {
      body.innerHTML = `
        <p class="muted">The report the assignment asked for — auf Deutsch where you can. Filed once,
        read by her at the next session. A completed assignment without its Bericht stays flagged.</p>
        <textarea class="justify-input" rows="4" placeholder="Bericht zu ${l.id} — …"></textarea>
        <div class="btn-row"><button class="btn btn-primary">File the Bericht</button></div>
        <p class="model-repeat-status"></p>`;
      const ta = body.querySelector('textarea');
      const btn = body.querySelector('button');
      const msg = body.querySelector('.model-repeat-status');
      btn.addEventListener('click', async () => {
        const text = ta.value.trim();
        if (text.length < 40) { msg.textContent = 'That is a note, not a report. A few honest sentences.'; return; }
        if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — the report cannot be filed.'; return; }
        btn.disabled = true;
        msg.textContent = 'Encrypting and filing…';
        try {
          const { data: fresh } = await gh.readJson('data/manifest.json');
          fresh.assignmentReports ||= {};
          if (fresh.assignmentReports[l.id]) throw new Error('Already filed — reload the page.');
          fresh.assignmentReports[l.id] = { date: new Date().toISOString(), enc: await encryptString(getPassword(), text) };
          await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), `bericht: ${l.id} filed`);
          manifest.assignmentReports = fresh.assignmentReports;
          render(manifest);
        } catch (e) {
          btn.disabled = false;
          msg.textContent = e.message;
        }
      });
    }
    return det;
  };

  const rowFor = (l) => {
    const h = byHw.get(l.id);
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = `assignment-row ${h ? 'assignment-done' : ''} ${l.id === pendingEntry?.id ? 'assignment-pending' : ''}`;
    let right;
    if (h) {
      const rep = reports[l.id]
        ? '<span class="chip report-chip-ok" title="Bericht filed">Bericht ✓</span>'
        : '<span class="chip chip-weak" title="The report is owed — she notices">Bericht fehlt</span>';
      right = `${rep}
               <span class="assignment-score">${h.firstTryCorrect}/${h.totalQuestions}</span>
               <span class="muted">${fmtDate(h.date)}</span>
               <span class="assignment-check" title="Completed">✓</span>`;
    } else if (l.id === pendingEntry?.id) {
      right = `<span class="chip chip-weak">pending</span>`;
    } else {
      right = `<span class="muted">not yet assigned</span>`;
    }
    row.innerHTML = `
      <span class="assignment-name"><span class="leaf-id">${l.id}</span> ${l.title}</span>
      <span class="assignment-right">${right}</span>`;
    wrap.appendChild(row);
    if (h) wrap.appendChild(reportBlock(l, manifest));
    return wrap;
  };

  for (const [secName, subs] of sections) {
    const secEl = document.createElement('div');
    secEl.className = 'lesson-section';
    const h = document.createElement('h3');
    h.className = 'lesson-section-title';
    h.textContent = secName;
    secEl.appendChild(h);
    for (const [subName, items] of subs) {
      if (subName) {
        const subEl = document.createElement('p');
        subEl.className = 'assignment-sub';
        subEl.textContent = subName;
        secEl.appendChild(subEl);
      }
      for (const l of items) secEl.appendChild(rowFor(l));
    }
    tree.appendChild(secEl);
  }
}

initLockButton();
initLock(async (manifest) => render(manifest));
