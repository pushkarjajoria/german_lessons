#!/usr/bin/env node
// messages.js — Frau Richter's correspondence desk (site: messages.html).
// Nachrichten are two-way encrypted notes with read receipts; use them for
// clarification questions, "explain this mistake to me", or anything that
// improves the teaching. Anträge stay in scripts/requests.js.
//
// Usage:
//   node scripts/messages.js --list                          # decrypt thread + read receipts
//   node scripts/messages.js --send "text" [--needs-reply] [--push]
//   node scripts/messages.js --reports [--id NNNN]           # decrypt assignment Berichte
//
// --needs-reply flags the message so the site shows "She expects an answer."
// until the learner writes back. Read receipts (readByLearner) tell you
// whether a message was opened — delivered is not read, and read is expected.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptString, decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (args.includes('--list')) {
  const msgs = manifest.messages || [];
  if (!msgs.length) { console.log('No messages on file.'); process.exit(0); }
  const password = await promptPassword('Password: ');
  for (const m of msgs.slice(-20)) {
    let text;
    try { text = decryptString(password, m.enc); } catch { text = '(cannot decrypt)'; }
    const who = m.from === 'richter' ? 'YOU  ' : 'HIM  ';
    const receipt = m.from === 'richter'
      ? (m.readByLearner ? ` · read ${m.readByLearner.slice(0, 16)}` : ' · UNREAD')
      : '';
    const flag = m.needsReply && !m.repliedAt ? ' · AWAITING HIS REPLY' : '';
    console.log(`\n[${m.id}] ${who}${m.date.slice(0, 16)}${receipt}${flag}\n  ${text}`);
  }
  process.exit(0);
}

if (args.includes('--reports')) {
  const reports = manifest.assignmentReports || {};
  const ids = opt('--id') ? [opt('--id')] : Object.keys(reports).sort();
  if (!ids.length) { console.log('No Berichte filed.'); }
  const password = ids.length ? await promptPassword('Password: ') : null;
  for (const id of ids) {
    const r = reports[id];
    if (!r) { console.log(`\n=== ${id}: NO BERICHT FILED ===`); continue; }
    let text;
    try { text = decryptString(password, r.enc); } catch { text = '(cannot decrypt)'; }
    console.log(`\n=== Bericht ${id} — filed ${r.date.slice(0, 16)} ===\n${text}`);
  }
  // The flags she reads first: completed assignments with no report.
  const done = new Set((manifest.history || []).map((h) => h.homeworkId));
  const missing = [...done].filter((id) => !reports[id]).sort();
  if (missing.length) console.log(`\nMISSING Berichte (completed, unreported): ${missing.join(', ')}`);
  process.exit(0);
}

const text = opt('--send');
if (!text) { console.error('Usage: --list | --send "text" [--needs-reply] [--push] | --reports [--id NNNN]'); process.exit(1); }
const password = await promptPassword('Password: ');
manifest.messages ||= [];
manifest.messages.push({
  id: `m${Date.now()}`,
  date: new Date().toISOString(),
  from: 'richter',
  enc: encryptString(password, text),
  ...(args.includes('--needs-reply') ? { needsReply: true } : {}),
});
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`Sent${args.includes('--needs-reply') ? ' (reply required)' : ''}. He sees the badge on every page.`);

const gitCmds = ['git add docs/data/manifest.json', 'git commit -m "message: from her desk"', 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
