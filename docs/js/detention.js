// detention.js — the weekend detention lockdown (performance remediation).
// Assigned ONLY in the Friday session (scripts/detention.js). It locks the
// whole site to a single detention screen from Friday 17:00 through Monday
// 00:00 and goes inert whether or not it's finished. The point is TIME, not a
// checklist — "if you will not learn, you will sit and drill until you have."
// A fixed target (e.g. 90 min) is the floor; doing badly makes it worse in two
// ways at once: each wrong item costs more reproduction reps (repsForMiss),
// AND the overall target itself extends (extensionMinutes), bounded by a cap
// so it's harsh, not literally endless. Record-only: the client stores what
// was done and the time spent, and SHE rules the ±Betragen herself on Monday —
// no automatic mechanic ever moves the score (persona §6.5).

export function detentionActive(manifest, now = new Date()) {
  const d = manifest.detention;
  if (!d?.active) return false;
  const starts = d.startsAt ? new Date(d.startsAt) : null;   // Friday 17:00
  const expires = d.expiresAt ? new Date(d.expiresAt) : null; // Monday 00:00
  if (starts && now < starts) return false;                  // before Friday 5pm: not yet
  if (expires && now >= expires) return false;               // Monday onward: inert
  if (starts || expires) return true;                        // inside the stored window
  const day = now.getDay();                                  // fallback (no window): weekend only
  return day === 6 || day === 0;
}

// How many extra minutes bad performance has earned, capped so the session
// stays harsh but finite rather than open-ended.
export function extensionMinutes(record, opts) {
  const wrong = record?.wrongCount || 0;
  const perWrong = opts?.extensionPerWrongMinutes ?? 2;
  const cap = opts?.maxExtensionMinutes ?? 45;
  return Math.min(cap, wrong * perWrong);
}

export function detentionStatus(manifest, now = new Date()) {
  const d = manifest.detention || null;
  const record = d?.record || { secondsSpent: 0, itemsSeen: 0, correctCount: 0, wrongCount: 0, startedAt: null, completedAt: null };
  const baseMinutes = d?.targetMinutes ?? 90;
  const extraMinutes = extensionMinutes(record, d);
  const effectiveMinutes = baseMinutes + extraMinutes;
  const elapsedMinutes = (record.secondsSpent || 0) / 60;
  const modes = (d?.modes && d.modes.length ? d.modes : ['weak']).map((m) => ({ mode: m, label: labelForMode(m) }));
  return {
    active: detentionActive(manifest, now),
    reason: d?.reason || '',
    modes,
    baseMinutes,
    extraMinutes,
    effectiveMinutes,
    elapsedMinutes,
    remainingMinutes: Math.max(0, effectiveMinutes - elapsedMinutes),
    repsMin: d?.repsMin ?? 4,
    repsMax: d?.repsMax ?? 10,
    record,
    started: Boolean(record.startedAt),
    complete: Boolean(record.completedAt) || (elapsedMinutes >= effectiveMinutes && record.itemsSeen > 0),
  };
}

// Escalating reproduction count: the more times THIS item has been missed in
// the drill, the more times it must be produced from memory — repsMin, +2 each
// further miss, capped at repsMax. Failure is punished immediately with more.
export function repsForMiss(missCount, repsMin = 4, repsMax = 10) {
  return Math.min(repsMax, repsMin + 2 * (Math.max(1, missCount) - 1));
}

export function labelForMode(mode) {
  if (!mode) return 'drill';
  if (mode.startsWith('cat:')) return mode.slice(4);
  if (mode.startsWith('lesson:')) return `Lektion ${mode.slice(7)} — the lines themselves`;
  return { mistakes: 'past mistakes', weak: 'weak spots', grammar: 'grammar & forms', mixed: 'everything', vocab: 'vocabulary' }[mode] || mode;
}
