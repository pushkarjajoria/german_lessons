// assignments.js — the assignment ledger. Homework pairs 1:1 with lessons
// (same id), so the curriculum placement in manifest.lessons organizes the
// assignments too: sections → subsections → numbered rows with a completion
// checkmark and score from manifest.history. The current pending assignment
// is pinned on top — it must be completed to proceed.

import { initLock, initLockButton } from './auth.js';
import { homeworkGated } from './corrections.js';

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

  const rowFor = (l) => {
    const h = byHw.get(l.id);
    const row = document.createElement('div');
    row.className = `assignment-row ${h ? 'assignment-done' : ''} ${l.id === pendingEntry?.id ? 'assignment-pending' : ''}`;
    let right;
    if (h) {
      right = `<span class="assignment-score">${h.firstTryCorrect}/${h.totalQuestions}</span>
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
    return row;
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
