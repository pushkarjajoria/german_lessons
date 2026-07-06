// tests-common.js — shared test (Klausur) logic for the dashboard and the test
// runner: status derivation, deadline math, and the forfeit write-back.
//
// Test lifecycle, stored in manifest.tests[] (plaintext aggregates only — the
// questions themselves live encrypted in docs/data/tests/test-NNNN.json.enc):
//   pending   → assigned, not yet taken, deadline in the future
//   submitted → taken, encrypted result committed, awaiting Frau Richter's grading
//   graded    → scored by Frau Richter (scripts/grade-test.js)
//   forfeited → abandoned mid-test or deadline passed untaken. 0 points, no appeal.

import { encryptString } from './crypto.js';
import * as gh from './github.js';

export function getTests(manifest) {
  return manifest.tests || [];
}

export function markerKey(id) {
  return `gl_test_inprogress_${id}`;
}

export function isExpired(t) {
  return Boolean(t.deadline) && Date.now() > new Date(t.deadline).getTime();
}

// A marker without a submitted result means the tab was closed mid-test.
export function isAbandoned(t) {
  return t.status === 'pending' && localStorage.getItem(markerKey(t.id)) !== null;
}

// What the status *should* be right now, regardless of what's persisted yet.
export function deriveStatus(t) {
  if (t.status === 'pending' && (isExpired(t) || isAbandoned(t))) return 'forfeited';
  return t.status;
}

export function deriveForfeitReason(t) {
  if (isAbandoned(t)) return 'abandoned';
  if (isExpired(t)) return 'deadline';
  return null;
}

export function fmtDeadline(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `due in ${d}d ${h}h`;
  if (h > 0) return `due in ${h}h ${min}m`;
  return `due in ${min}m`;
}

// Persist a forfeit: encrypted zero-point result + manifest status flip.
// Needs the unlocked password (for the result envelope) and a PAT for the
// write; without a PAT the caller falls back to derived display-only status
// (scripts reconcile it on the next lesson/test publish).
export async function commitForfeit(test, reason, password, extra = {}) {
  const result = {
    testId: test.id,
    status: 'forfeited',
    forfeitReason: reason, // 'abandoned' | 'deadline'
    date: new Date().toISOString(),
    points: 0,
    perQuestion: [],
    ...extra,
  };
  const resultEnc = JSON.stringify(await encryptString(password, JSON.stringify(result, null, 2)), null, 2);
  if (!gh.isConfigured()) {
    // No PAT: keep the abandon marker — it is the only local record of the
    // forfeit until the downloaded result/manifest get committed by hand.
    return { written: false, resultEnc, result };
  }
  await gh.writeText(`data/tests/test-result-${test.id}.json.enc`, resultEnc,
    `test ${test.id}: forfeited (${reason})`);
  const { data: manifest } = await gh.readJson('data/manifest.json');
  const entry = (manifest.tests || []).find((t) => t.id === test.id);
  if (entry && entry.status === 'pending') {
    entry.status = 'forfeited';
    entry.forfeitReason = reason;
    entry.forfeitedAt = result.date;
    await gh.writeText('data/manifest.json', JSON.stringify(manifest, null, 2),
      `manifest: test ${test.id} forfeited (${reason})`);
  }
  localStorage.removeItem(markerKey(test.id));
  return { written: true, resultEnc, result };
}

// Called from the dashboard: persist any forfeits that only exist as derived
// state (expired deadlines, abandoned markers). Best-effort, silent.
export async function enforceForfeits(manifest, password) {
  let changed = false;
  for (const t of getTests(manifest)) {
    if (t.status !== 'pending') continue;
    const reason = deriveForfeitReason(t);
    if (!reason) continue;
    try {
      const { written } = await commitForfeit(t, reason, password);
      if (written) { t.status = 'forfeited'; t.forfeitReason = reason; changed = true; }
    } catch (e) {
      console.warn(`Could not persist forfeit for test ${t.id}:`, e.message);
    }
  }
  return changed;
}
