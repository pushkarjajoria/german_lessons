// lessons.js — the curriculum browser. The tree (sections → subsections →
// collapsible lesson leaves) is built from manifest.lessons, which Frau
// Richter populates at her discretion via each lesson's front matter
// (see SCHEMA.md §3). Lesson bodies stay encrypted until clicked.

import { decryptString } from './crypto.js';
import { initLock, initLockButton, getPassword } from './auth.js';
import * as gh from './github.js';
import { renderMarkdown, parseFrontMatter } from './markdown.js';
import { loadPortrait } from './portrait.js';

const $ = (id) => document.getElementById(id);

function groupLessons(entries) {
  // Section order and subsection order follow first appearance in the index —
  // i.e., the order Frau Richter published them in.
  const sections = new Map();
  for (const e of entries) {
    const secName = e.section || 'Allgemein';
    if (!sections.has(secName)) sections.set(secName, new Map());
    const subs = sections.get(secName);
    const subName = e.subsection || '';
    if (!subs.has(subName)) subs.set(subName, []);
    subs.get(subName).push(e);
  }
  return sections;
}

async function openLesson(entry, leafBtn) {
  document.querySelectorAll('.lesson-leaf.active').forEach((b) => b.classList.remove('active'));
  leafBtn.classList.add('active');
  const empty = $('reader-empty');
  const content = $('reader-content');
  empty.hidden = true;
  content.hidden = false;
  content.innerHTML = '<p class="muted">Decrypting…</p>';
  try {
    const { text } = await gh.readText(`data/lessons/lesson-${entry.id}.md.enc`);
    const md = await decryptString(getPassword(), JSON.parse(text));
    const { meta, body } = parseFrontMatter(md);
    const title = meta.title || entry.title || `Lesson ${entry.id}`;
    // Don't duplicate the title if the body already opens with an h1.
    const heading = /^#\s/.test(body.trimStart()) ? '' : `<h1>${title}</h1>`;
    content.innerHTML = heading + renderMarkdown(body);
    content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    content.innerHTML = `<p class="lock-error">This lesson could not be decrypted: ${e.message}</p>`;
  }
}

function renderTree(manifest) {
  const entries = manifest.lessons || [];
  const tree = $('lesson-tree');
  tree.innerHTML = '';
  if (!entries.length) {
    tree.innerHTML = '<p class="muted">No lessons published yet. The first one arrives with the first session.</p>';
    return;
  }
  const wantedId = new URLSearchParams(location.search).get('id');
  let wantedBtn = null;

  for (const [secName, subs] of groupLessons(entries)) {
    const secEl = document.createElement('div');
    secEl.className = 'lesson-section';
    const h = document.createElement('h3');
    h.className = 'lesson-section-title';
    h.textContent = secName;
    secEl.appendChild(h);

    for (const [subName, lessons] of subs) {
      const makeLeaf = (entry) => {
        const btn = document.createElement('button');
        btn.className = 'lesson-leaf';
        btn.innerHTML = `<span class="leaf-id">${entry.id}</span> ${entry.title}`;
        btn.addEventListener('click', () => openLesson(entry, btn));
        if (entry.id === wantedId) wantedBtn = btn;
        return btn;
      };
      if (subName === '') {
        // Lessons placed directly under the section
        for (const l of lessons) secEl.appendChild(makeLeaf(l));
      } else {
        const det = document.createElement('details');
        det.className = 'lesson-sub';
        // Open the newest subsection by default; the rest start collapsed.
        const sum = document.createElement('summary');
        sum.textContent = subName;
        det.appendChild(sum);
        for (const l of lessons) det.appendChild(makeLeaf(l));
        secEl.appendChild(det);
      }
    }
    tree.appendChild(secEl);
  }

  // Open the last subsection (current material) by default
  const allSubs = tree.querySelectorAll('details.lesson-sub');
  if (allSubs.length) allSubs[allSubs.length - 1].open = true;

  if (wantedBtn) {
    wantedBtn.closest('details')?.setAttribute('open', '');
    wantedBtn.click();
  }
}

initLockButton();
initLock(async (manifest) => {
  renderTree(manifest);
  loadPortrait($('reader-portrait'));
});
