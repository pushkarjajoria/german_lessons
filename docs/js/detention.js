// detention.js — the weekend detention lockdown (performance remediation).
// Assigned ONLY in the Friday session (scripts/detention.js), sized to the
// week's test/homework results. It locks the whole site to a single detention
// screen on Sat/Sun, runs her tedious repeat-heavy drills, and goes inert on
// Monday whether or not it was finished. Record-only: the client stores what
// was done and the time spent (a cookie), and SHE rules the ±Betragen herself
// on Monday — no automatic mechanic ever moves the score (persona §6.5).

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

export function detentionStatus(manifest, now = new Date()) {
  const d = manifest.detention || null;
  const drills = (d?.drills || []).map((x, i) => ({
    index: i,
    mode: x.mode,
    count: x.count || 8,
    label: x.label || labelForMode(x.mode),
  }));
  const record = d?.record || { doneIndexes: [], startedAt: null, completedAt: null };
  const done = record.doneIndexes || [];
  const remaining = drills.filter((dr) => !done.includes(dr.index));
  return {
    active: detentionActive(manifest, now),
    reason: d?.reason || '',
    drills,
    remaining,
    doneCount: done.length,
    repsMin: d?.repsMin ?? 4,
    repsMax: d?.repsMax ?? 10,
    record,
    complete: drills.length > 0 && remaining.length === 0,
    expiresAt: d?.expiresAt ? new Date(d.expiresAt) : null,
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
  return { mistakes: 'past mistakes', weak: 'weak spots', grammar: 'grammar & forms', mixed: 'everything', vocab: 'vocabulary' }[mode] || mode;
}
