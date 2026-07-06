#!/usr/bin/env node
// discipline.js — halt or reopen the course with Nachweis (proof-of-seriousness)
// tasks: recordings and handwriting sheets. These are NOT assignments — they are
// the persona's §4 Tier 3/4 consequence for long silence or consistent
// complacency, issued entirely at Frau Richter's discretion. While active, the
// site blocks homework and tests and shows the tasks on the dashboard.
//
// Usage:
//   node scripts/discipline.js --issue --reason "…" \
//        --task "recording: <exact instructions incl. anti-spoof opening>" \
//        --task "handwriting: <exact sentence, line count, token rule>" [--push]
//   node scripts/discipline.js --status
//   node scripts/discipline.js --clear [--push]
//
// Task instructions must carry their own anti-spoof elements (persona §5/§6):
// for handwriting, the fresh sentence + today's token; for recordings, the
// spoken date + a spontaneous element. The learner can mark a task "claimed"
// on the site; only --clear (after she verifies) reopens the course.
//
// NOTE: reason/instructions live in the PLAINTEXT manifest of a public repo —
// category-level wording only, no quoted answers or personal details.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'docs', 'data', 'manifest.json');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const multi = (name) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[i + 1]);
  return out;
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (args.includes('--status')) {
  const d = manifest.discipline;
  if (!d || !d.active) { console.log('Course open. No discipline block active.'); process.exit(0); }
  console.log(`HALTED since ${d.issuedAt} — ${d.reason}`);
  d.tasks.forEach((t, i) => console.log(`  ${i + 1}. [${t.type}] ${t.status}${t.claimedAt ? ` (claimed ${t.claimedAt})` : ''}\n     ${t.instructions}`));
  process.exit(0);
}

let commitMsg;
if (args.includes('--clear')) {
  if (!manifest.discipline?.active) { console.log('Nothing to clear — course is already open.'); process.exit(0); }
  manifest.discipline = {
    active: false,
    clearedAt: new Date().toISOString(),
    previous: { issuedAt: manifest.discipline.issuedAt, reason: manifest.discipline.reason },
  };
  commitMsg = 'discipline: cleared — course reopened';
  console.log('Cleared. The course is open again.');
} else if (args.includes('--issue')) {
  const reason = opt('--reason');
  const rawTasks = multi('--task');
  if (!reason || !rawTasks.length) {
    console.error('Usage: node scripts/discipline.js --issue --reason "…" --task "recording: …" [--task "handwriting: …"] [--push]');
    process.exit(1);
  }
  const tasks = rawTasks.map((raw, i) => {
    const m = raw.match(/^(recording|handwriting)\s*:\s*(.+)$/s);
    if (!m) { console.error(`Task ${i + 1} must start with "recording:" or "handwriting:" — got: ${raw.slice(0, 40)}`); process.exit(1); }
    return { id: i + 1, type: m[1], instructions: m[2].trim(), status: 'pending' };
  });
  manifest.discipline = {
    active: true,
    issuedAt: new Date().toISOString(),
    reason,
    tasks,
  };
  commitMsg = `discipline: course halted (${tasks.map((t) => t.type).join(', ')})`;
  console.log(`Issued. Course halted with ${tasks.length} task(s). Homework and tests are locked on the site.`);
} else {
  console.error('Usage: --issue … | --clear | --status   (see file header)');
  process.exit(1);
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

const gitCmds = ['git add docs/data/manifest.json', `git commit -m "${commitMsg}"`, 'git push'];
if (args.includes('--push')) {
  for (const cmd of gitCmds) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  }
} else {
  console.log('To publish:');
  for (const cmd of gitCmds) console.log(`  ${cmd}`);
}
