#!/usr/bin/env node
// memory.js — keep Frau Richter's working memory small enough to read every run.
//
// THE PROBLEM: the run protocol says "read every file in frau_richter/ in full."
// Those files only ever grew — ledger.md was 86% CLOSED rows, changelog.md was a
// full history, feature requests carried every built item — so every run paid
// ~25k tokens of input for maybe 6k of live information. Nothing there was
// wrong; it was just finished.
//
// THE SPLIT: a WORKING SET that is read every run, and an ARCHIVE that is
// written once and read only when a specific question needs it. Nothing is ever
// deleted — rolled entries move to frau_richter/archive/ with their dates, and
// the working file keeps a pointer. Her functionality is unchanged; only the
// default reading load is.
//
// Usage:
//   node scripts/memory.js --check           # sizes + budget, changes nothing
//   node scripts/memory.js --roll            # move finished items to archive/
//   node scripts/memory.js --roll --dry-run  # show what would move

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HER = join(ROOT, 'frau_richter');
const ARCHIVE = join(HER, 'archive');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Read every run. The budget is what one run can afford to spend on memory
// before it is spending more on remembering than on teaching.
const WORKING_SET = ['BRIEF.md', 'state.md', 'ledger.md', 'error-log.md', 'NEEDS_ATTENTION.md'];
const BUDGET_TOKENS = 9000;
const KEEP_CLOSED_ROWS = 4;    // most recent closed obligations stay visible for continuity
const KEEP_CHANGELOG_ENTRIES = 2;

const tok = (s) => Math.round(s.length / 4);
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function report() {
  let total = 0;
  console.log('WORKING SET — read every run:');
  for (const f of WORKING_SET) {
    const text = readIf(join(HER, f));
    if (text === null) continue;
    total += tok(text);
    console.log(`  ${String(tok(text)).padStart(6)} tok  ${f}`);
  }
  const fr = readIf(join(ROOT, 'feature requests.md'));
  if (fr) { total += tok(fr); console.log(`  ${String(tok(fr)).padStart(6)} tok  feature requests.md`); }
  console.log(`  ${'—'.repeat(6)}`);
  console.log(`  ${String(total).padStart(6)} tok  TOTAL  (budget ${BUDGET_TOKENS})`);
  if (total > BUDGET_TOKENS) {
    console.log(`\n  OVER BUDGET by ${total - BUDGET_TOKENS} tok.`);
    console.log('  First: node scripts/memory.js --roll   (mechanical — moves finished items)');
    // --roll deliberately will not touch these two: deciding what is still live
    // is judgement, and a script guessing at it would quietly discard her reasoning.
    const el = tok(readIf(join(HER, 'error-log.md')) || '');
    const st = tok(readIf(join(HER, 'state.md')) || '');
    if (el > 3000) console.log(`  Then by hand: error-log.md (${el} tok) — move patterns clean for several sessions into a "## RESOLVED" section and archive it. "not yet drilled" for an unreached phase is not yet a pattern.`);
    if (st > 2500) console.log(`  Then by hand: state.md (${st} tok) — keep THIS run and one prior; older narrative -> archive/state-history.md. Keep "check next run".`);
  }

  if (existsSync(ARCHIVE)) {
    const files = readdirSync(ARCHIVE);
    const at = files.reduce((s, f) => s + tok(readFileSync(join(ARCHIVE, f), 'utf8')), 0);
    console.log(`\nARCHIVE — read only on demand: ${files.length} file(s), ${at} tok (costs nothing per run)`);
  }
  return total;
}

// Append to an archive file under a dated heading, creating it if needed.
function archiveAppend(name, heading, body) {
  if (dryRun) return;
  mkdirSync(ARCHIVE, { recursive: true });
  const p = join(ARCHIVE, name);
  const head = existsSync(p) ? '' : `# ${name} — rolled out of the working set. Read only when a specific question needs it.\n`;
  writeFileSync(p, (existsSync(p) ? readFileSync(p, 'utf8') : head) + `\n## ${heading}\n\n${body.trim()}\n`);
}

// ledger.md: keep OPEN in full; keep only the most recent closed rows.
function rollLedger() {
  const p = join(HER, 'ledger.md');
  const text = readIf(p);
  if (!text) return 0;
  const i = text.indexOf('## CLOSED');
  if (i < 0) return 0;
  const head = text.slice(0, i);
  const closed = text.slice(i);
  const lines = closed.split('\n');
  const rows = lines.filter((l) => l.startsWith('| 20'));           // dated table rows only
  if (rows.length <= KEEP_CLOSED_ROWS) return 0;
  const keep = rows.slice(0, KEEP_CLOSED_ROWS);
  const move = rows.slice(KEEP_CLOSED_ROWS);
  archiveAppend('ledger-closed.md', `rolled ${new Date().toISOString().slice(0, 10)}`, move.join('\n'));
  const header = lines.slice(0, lines.indexOf(rows[0]));             // '## CLOSED' + table header
  const rebuilt = `${head}${header.join('\n')}\n${keep.join('\n')}\n\n_${move.length} older closed item(s) in [archive/ledger-closed.md](archive/ledger-closed.md)._\n`;
  if (!dryRun) writeFileSync(p, rebuilt);
  console.log(`  ledger.md: moved ${move.length} closed row(s) to archive`);
  return move.length;
}

// changelog.md: it is a write-mostly record. Keep the last couple of entries in
// place for continuity; everything older belongs in the archive.
function rollChangelog() {
  const p = join(HER, 'changelog.md');
  const text = readIf(p);
  if (!text) return 0;
  const parts = text.split(/^## /m);
  const head = parts.shift();
  if (parts.length <= KEEP_CHANGELOG_ENTRIES) return 0;
  const keep = parts.slice(0, KEEP_CHANGELOG_ENTRIES);
  const move = parts.slice(KEEP_CHANGELOG_ENTRIES);
  archiveAppend('changelog.md', `rolled ${new Date().toISOString().slice(0, 10)}`, move.map((s) => `## ${s}`).join('\n'));
  if (!dryRun) {
    writeFileSync(p, `${head}${keep.map((s) => `## ${s}`).join('')}\n_Older entries: [archive/changelog.md](archive/changelog.md)._\n`);
  }
  console.log(`  changelog.md: moved ${move.length} entry(ies) to archive`);
  return move.length;
}

// feature requests.md: built/declined entries are history; only pending drives work.
function rollFeatureRequests() {
  const p = join(ROOT, 'feature requests.md');
  const text = readIf(p);
  if (!text) return 0;
  const parts = text.split(/^## /m);
  const head = parts.shift();
  const done = parts.filter((s) => /\*\*Status:\*\*\s*(built|declined)/.test(s) && /^FR-\d/.test(s));
  const live = parts.filter((s) => !done.includes(s));
  if (!done.length) return 0;
  archiveAppend('feature-requests-done.md', `rolled ${new Date().toISOString().slice(0, 10)}`, done.map((s) => `## ${s}`).join('\n'));
  if (!dryRun) {
    writeFileSync(p, `${head}${live.map((s) => `## ${s}`).join('')}\n_Built/declined requests: [frau_richter/archive/feature-requests-done.md](frau_richter/archive/feature-requests-done.md)._\n`);
  }
  console.log(`  feature requests.md: moved ${done.length} built/declined entry(ies) to archive`);
  return done.length;
}

if (args.includes('--roll')) {
  console.log(dryRun ? 'DRY RUN — nothing will be written\n' : 'Rolling finished items into frau_richter/archive/\n');
  const moved = rollLedger() + rollChangelog() + rollFeatureRequests();
  if (!moved) console.log('  nothing to roll — the working set is already lean.');
  console.log('');
  report();
} else if (args.includes('--check')) {
  report();
} else {
  console.error('Usage: node scripts/memory.js --check | --roll [--dry-run]');
  process.exit(1);
}
