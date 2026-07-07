// corrections.js — the Korrektur system: persona §2.5 ("correct early and
// correct hard", ASR model-repeat) in code. Two layers:
//
//   1. Model-repeat, in the moment: a wrong answer blocks the Next button
//      until the learner has TYPED the correct model back N times
//      (policy.modelRepeat). Recognition of the correction is not enough;
//      the correction must be produced, immediately.
//
//   2. The Korrektur queue, across days: first-try misses are enrolled in
//      manifest.corrections. Each item must be produced correctly (hardened,
//      production-only) policy-many times on SEPARATE occasions with a
//      minimum time gap — spaced retrieval, not massed repetition. A miss
//      during Korrektur resets the count. Items left past the grace period
//      lock new homework: Erst die Korrektur.
//
// Every number is Frau Richter's to set (scripts/correction-policy.js).
// manifest.corrections entries hold only ids/categories — never content.

import { normalize } from './checking.js';

export const DEFAULT_POLICY = {
  enabled: true,
  modelRepeat: 2,        // typed reproductions required at the moment of error (0 = off)
  requiredPasses: 3,     // spaced correct productions to clear a Korrektur item
  minGapMinutes: 180,    // a pass only counts this long after the previous one
  resetOnMiss: true,     // wrong during Korrektur → the count starts over
  gateHomework: true,    // overdue corrections lock new homework
  graceHours: 48,        // how long an item may sit open before it gates
  autoEnroll: 'firstTryMiss', // 'firstTryMiss' | 'off'
  maxOpen: 12,           // enrollment stops here; clearing reopens the door
};

export function getPolicy(manifest) {
  return { ...DEFAULT_POLICY, ...(manifest.correctionPolicy || {}) };
}

export function openCorrections(manifest) {
  return (manifest.corrections || []).filter((c) => c.status === 'open');
}

export function eligibleNow(entry, policy, now = Date.now()) {
  if (entry.status !== 'open') return false;
  if (!entry.lastPassedAt) return true;
  return now - new Date(entry.lastPassedAt).getTime() >= policy.minGapMinutes * 60000;
}

export function nextEligibleAt(entry, policy) {
  if (!entry.lastPassedAt) return null;
  return new Date(new Date(entry.lastPassedAt).getTime() + policy.minGapMinutes * 60000);
}

export function isOverdue(entry, policy, now = Date.now()) {
  return entry.status === 'open' && now - new Date(entry.addedAt).getTime() > policy.graceHours * 3600000;
}

// The gate: does an overdue open correction block new homework?
export function homeworkGated(manifest) {
  const policy = getPolicy(manifest);
  if (!policy.enabled || !policy.gateHomework) return false;
  return openCorrections(manifest).some((c) => isOverdue(c, policy));
}

// Enroll first-try misses from a finished homework report. Mutates manifest.
// Re-missing an already-open item resets its progress — it clearly hasn't sat.
export function enrollFromReport(manifest, report) {
  const policy = getPolicy(manifest);
  if (!policy.enabled || policy.autoEnroll !== 'firstTryMiss') return;
  manifest.corrections ||= [];
  const open = () => manifest.corrections.filter((c) => c.status === 'open');
  for (const p of report.perQuestion || []) {
    const missed = p.attempts > 1 || !p.correct;
    if (!missed) continue;
    const key = `${report.homeworkId}:${p.qid}`;
    const existing = manifest.corrections.find((c) => c.key === key);
    if (existing) {
      existing.status = 'open';
      existing.missedCount = (existing.missedCount || 1) + 1;
      existing.doneCount = 0;
      existing.lastPassedAt = null;
      existing.addedAt = report.date;
      delete existing.clearedAt;
    } else if (open().length < policy.maxOpen) {
      manifest.corrections.push({
        key,
        hwId: report.homeworkId,
        qid: p.qid,
        category: p.category || 'Allgemein',
        reason: 'first-try miss',
        missedCount: 1,
        addedAt: report.date,
        required: policy.requiredPasses,
        doneCount: 0,
        lastPassedAt: null,
        status: 'open',
      });
    }
  }
}

// ---------- the model-repeat UI ----------
// Injected into a feedback panel after a wrong answer: an input that must
// receive the correct model N times before `nextBtn` unlocks. Checking uses
// the same normalization as answers (umlaut folding, case, punctuation).

export function attachModelRepeat({ mount, nextBtn, model, times, onDone }) {
  if (!times || times < 1) return null;
  nextBtn.disabled = true;

  const wrap = document.createElement('div');
  wrap.className = 'model-repeat';
  const label = document.createElement('p');
  label.className = 'model-repeat-label';
  const input = document.createElement('input');
  input.className = 'text-answer model-repeat-input';
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.placeholder = 'Type the correction…';
  const status = document.createElement('p');
  status.className = 'model-repeat-status';

  let done = 0;
  const update = () => {
    label.textContent = times > 1
      ? `Type the correction — ${times} times, correctly. (${done}/${times})`
      : 'Type the correction — once, correctly.';
    status.textContent = '';
  };
  update();

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (normalize(input.value) === normalize(model)) {
      done += 1;
      input.value = '';
      if (done >= times) {
        wrap.classList.add('model-repeat-done');
        label.textContent = 'Corrected. Now it continues.';
        status.textContent = '';
        input.disabled = true;
        nextBtn.disabled = false;
        nextBtn.focus();
        if (onDone) onDone();
      } else {
        update();
        status.textContent = 'Again.';
      }
    } else {
      status.textContent = 'Not the correction. Look at it, then type it exactly.';
      input.select();
    }
  });

  wrap.append(label, input, status);
  mount.appendChild(wrap);
  input.focus();
  return wrap;
}
