#!/usr/bin/env node
// read-report.js — decrypt and print a practice report so the assistant (or you)
// can read it at the start of a session.
// Usage: node scripts/read-report.js [--latest | --id NNNN] [--json]
//        (default: --latest; password prompted, or GL_PASSWORD env)

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptString, promptPassword } from './lib-crypto.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = join(ROOT, 'docs', 'data', 'reports');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const idIdx = args.indexOf('--id');
const wantedId = idIdx >= 0 ? args[idIdx + 1] : null;

let files;
try {
  files = readdirSync(REPORTS).filter((f) => /^report-\d+\.json\.enc$/.test(f)).sort();
} catch {
  files = [];
}
if (!files.length) {
  console.error('No reports found in docs/data/reports/. The learner has not completed homework yet.');
  process.exit(2);
}
const file = wantedId ? `report-${wantedId}.json.enc` : files[files.length - 1];
if (!files.includes(file)) {
  console.error(`Report ${file} not found. Available: ${files.join(', ')}`);
  process.exit(2);
}

const password = await promptPassword('Password: ');
let report;
try {
  report = JSON.parse(decryptString(password, JSON.parse(readFileSync(join(REPORTS, file), 'utf8'))));
} catch {
  console.error('Decryption failed — wrong password or corrupted file.');
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Readable markdown summary for the session
const pct = Math.round((report.firstTryCorrect / report.totalQuestions) * 100);
console.log(`# Report ${report.id} (homework ${report.homeworkId}, lesson ${report.lessonId})`);
console.log(`- Date: ${report.date}`);
console.log(`- Duration: ${Math.floor(report.durationSec / 60)}m ${report.durationSec % 60}s`);
console.log(`- First-try: ${report.firstTryCorrect}/${report.totalQuestions} (${pct}%) · eventual: ${report.eventualCorrect}/${report.totalQuestions}`);
console.log(`\n## Category stats`);
for (const [cat, s] of Object.entries(report.categoryStats || {})) {
  const flag = s.correct / s.total < 0.7 ? '  ← weak' : '';
  console.log(`- ${cat}: ${s.correct}/${s.total}${flag}`);
}
console.log(`\n## Weak categories\n${(report.weakCategories || []).join(', ') || '(none flagged)'}`);
if (report.missedItems?.length) {
  console.log(`\n## Missed on first try`);
  for (const m of report.missedItems) {
    console.log(`- [${m.qid}] "${m.prompt}"\n    expected: ${m.correct}\n    given:    ${m.given ?? '(nothing)'}`);
  }
}
console.log(`\n## Notes for teacher\n${report.notesForTeacher || '(none)'}`);
