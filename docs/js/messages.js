// messages.js — the correspondence desk. One thread, two registers:
//   * Nachrichten (manifest.messages): two-way notes — she asks for
//     clarification or an explanation of a mistake, the learner answers
//     (or writes first). Encrypted inline; metadata plaintext.
//   * Anträge (manifest.requests): formal requests, rendered in the same
//     thread with her ruling shown as a reply bubble.
// Opening this page stamps her messages read — durably (readByLearner via
// PAT, so she can see it was read) or locally without one.

import { initLock, initLockButton, getPassword } from './auth.js';
import { encryptString, decryptString } from './crypto.js';
import { markAllSeenLocal, navBadge } from './inbox.js';
import * as gh from './github.js';

const $ = (id) => document.getElementById(id);

const fmt = (iso) => new Date(iso).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

async function dec(env) {
  try { return await decryptString(getPassword(), env); } catch { return '(unreadable)'; }
}

async function renderThread(manifest) {
  const thread = $('thread');
  thread.innerHTML = '';

  // Merge messages and Anträge into one chronological run.
  const items = [];
  for (const m of manifest.messages || []) items.push({ kind: 'message', date: m.date, m });
  for (const r of manifest.requests || []) items.push({ kind: 'antrag', date: r.date, r });
  items.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!items.length) {
    thread.innerHTML = '<p class="muted">Nothing yet. When she writes, it lands here — and so do your Anträge.</p>';
    return;
  }

  for (const it of items) {
    if (it.kind === 'message') {
      const m = it.m;
      const text = await dec(m.enc);
      const row = document.createElement('div');
      row.className = `msg-row ${m.from === 'richter' ? 'msg-her' : 'msg-mine'}`;
      row.innerHTML = `
        <div class="msg-bubble">
          <p class="msg-meta">${m.from === 'richter' ? 'Frau Richter' : 'You'} · ${fmt(m.date)}</p>
          <p class="msg-text"></p>
          ${m.from === 'richter' && m.needsReply && !m.repliedAt ? '<p class="msg-flag">She expects an answer.</p>' : ''}
        </div>`;
      row.querySelector('.msg-text').textContent = text;
      thread.appendChild(row);
    } else {
      const r = it.r;
      const text = await dec(r.enc);
      const row = document.createElement('div');
      row.className = 'msg-row msg-mine';
      const chip = r.status === 'granted' ? '<span class="chip">granted</span>'
        : r.status === 'declined' ? '<span class="chip chip-weak">declined</span>'
        : '<span class="chip">pending — awaits her desk</span>';
      row.innerHTML = `
        <div class="msg-bubble msg-antrag">
          <p class="msg-meta">Antrag · You · ${fmt(r.date)} ${chip}</p>
          <p class="msg-text"></p>
        </div>`;
      row.querySelector('.msg-text').textContent = text;
      thread.appendChild(row);
      if (r.response) {
        const reply = document.createElement('div');
        reply.className = 'msg-row msg-her';
        reply.innerHTML = `
          <div class="msg-bubble msg-ruling">
            <p class="msg-meta">Frau Richter · ruling · ${fmt(r.respondedAt)}</p>
            <p class="msg-text"></p>
          </div>`;
        reply.querySelector('.msg-text').textContent = r.response;
        thread.appendChild(reply);
      }
    }
  }
  thread.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

// Durable read receipts: stamp readByLearner on her unread messages and push.
// She checks the stamps — "delivered" is not "read", and read is expected.
async function stampRead(manifest) {
  markAllSeenLocal(manifest);
  navBadge(manifest);
  if (!gh.isConfigured()) return;
  const unread = (manifest.messages || []).filter((m) => m.from === 'richter' && !m.readByLearner);
  if (!unread.length) return;
  try {
    const { data: fresh } = await gh.readJson('data/manifest.json');
    let changed = false;
    const now = new Date().toISOString();
    for (const m of fresh.messages || []) {
      if (m.from === 'richter' && !m.readByLearner) { m.readByLearner = now; changed = true; }
    }
    if (changed) {
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2), 'messages: read');
      manifest.messages = fresh.messages;
    }
  } catch { /* read receipts are best-effort */ }
}

function wireComposer(manifest) {
  $('compose-send').addEventListener('click', async () => {
    const msg = $('compose-msg');
    const text = $('compose-text').value.trim();
    const kind = document.querySelector('input[name="msg-kind"]:checked').value;
    if (text.length < (kind === 'antrag' ? 20 : 2)) {
      msg.textContent = kind === 'antrag'
        ? 'A formal request has substance and courtesy. Write it properly.'
        : 'Write something first.';
      return;
    }
    if (!gh.isConfigured()) { msg.textContent = 'No GitHub token (Settings) — nothing can be filed.'; return; }
    $('compose-send').disabled = true;
    msg.textContent = 'Filing…';
    try {
      const { data: fresh } = await gh.readJson('data/manifest.json');
      const enc = await encryptString(getPassword(), text);
      if (kind === 'antrag') {
        fresh.requests ||= [];
        fresh.requests.push({ id: `r${Date.now()}`, date: new Date().toISOString(), enc, status: 'pending' });
      } else {
        fresh.messages ||= [];
        fresh.messages.push({ id: `m${Date.now()}`, date: new Date().toISOString(), from: 'learner', enc });
        // A learner message answers any of her open questions.
        for (const m of fresh.messages) {
          if (m.from === 'richter' && m.needsReply && !m.repliedAt) m.repliedAt = new Date().toISOString();
        }
      }
      await gh.writeText('data/manifest.json', JSON.stringify(fresh, null, 2),
        kind === 'antrag' ? 'antrag: formal request filed' : 'message: from the learner');
      manifest.messages = fresh.messages;
      manifest.requests = fresh.requests;
      $('compose-text').value = '';
      msg.textContent = kind === 'antrag'
        ? 'Filed. She rules on it at her desk — next session at the latest.'
        : 'Sent. She reads it at her desk.';
      await renderThread(manifest);
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      $('compose-send').disabled = false;
    }
  });
}

initLockButton();
initLock(async (manifest) => {
  await renderThread(manifest);
  wireComposer(manifest);
  await stampRead(manifest);
});
