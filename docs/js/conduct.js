// conduct.js — the Betragen (conduct) system: a 0–100 score only Frau Richter
// moves (scripts/conduct.js), rendered as the star ladder at the top of the
// dashboard. It starts at 65 and is earned upward slowly:
//
//   100        Goldener Stern   — perfection held, not visited
//   95–99      Silberner Stern
//   88–94      Schwarzer Stern
//   below 88   Kegel der Schande — with comments on behaviour and performance
//   below 60   the site LOCKS: three consecutive days of a written apology in
//              German buy eligibility for review on the next lecture day;
//              she accepts (score back to 65) or rejects with extra tasks.
//
// Apology texts are AES-encrypted inline in the manifest (public repo) — only
// she reads them (scripts/conduct.js --show).

export const START_SCORE = 65;
export const LOCK_BELOW = 60;
export const APOLOGIES_NEEDED = 3;

export function conductScore(manifest) {
  return manifest.conduct?.score ?? START_SCORE;
}

export function conductTier(score) {
  if (score >= 100) return 'gold';
  if (score >= 95) return 'silver';
  if (score >= 88) return 'black';
  return 'cone';
}

export const TIERS = [
  { key: 'gold', label: 'Goldener Stern', rule: '100', glyph: '★', cls: 'star-gold' },
  { key: 'silver', label: 'Silberner Stern', rule: '95+', glyph: '★', cls: 'star-silver' },
  { key: 'black', label: 'Schwarzer Stern', rule: '88+', glyph: '★', cls: 'star-black' },
  { key: 'cone', label: 'Kegel der Schande', rule: 'below 88', glyph: '▲', cls: 'star-cone' },
];

export function conductLocked(manifest) {
  return conductScore(manifest) < LOCK_BELOW;
}

// ---------- lecture schedule (Mon & Wed, 10:00–12:00 local/CEST) ----------

export function isLectureNow(now = new Date()) {
  const d = now.getDay();
  const h = now.getHours();
  return (d === 1 || d === 3) && h >= 10 && h < 12;
}

export function nextLecture(after = new Date()) {
  const t = new Date(after);
  for (let i = 0; i < 8; i++) {
    const d = t.getDay();
    if ((d === 1 || d === 3) && (t.getHours() < 10 || t.toDateString() !== after.toDateString())) {
      const at = new Date(t);
      at.setHours(10, 0, 0, 0);
      if (at > after) return at;
    }
    t.setDate(t.getDate() + 1);
    t.setHours(0, 0, 0, 0);
  }
  return null;
}

// ---------- apology chain ----------

const localDate = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

// The chain that counts: consecutive daily apologies ending today or yesterday.
// A missed day breaks it — sorry means every day, not when convenient.
export function apologyChain(lock, now = new Date()) {
  const dates = (lock?.apologies || []).map((a) => a.date).sort();
  if (!dates.length) return [];
  const chain = [dates[0]];
  for (let i = 1; i < dates.length; i++) {
    if (dayDiff(dates[i - 1], dates[i]) === 1) chain.push(dates[i]);
    else chain.splice(0, chain.length, dates[i]);
  }
  const gap = dayDiff(chain[chain.length - 1], localDate(now));
  return gap <= 1 ? chain : [];
}

export function apologyStatus(manifest, now = new Date()) {
  const lock = manifest.conduct?.lock || null;
  const chain = apologyChain(lock, now);
  const today = localDate(now);
  const doneToday = chain.includes(today) || (lock?.apologies || []).some((a) => a.date === today);
  const complete = chain.length >= APOLOGIES_NEEDED;
  return {
    chain,
    doneToday,
    complete,
    remaining: Math.max(0, APOLOGIES_NEEDED - chain.length),
    eligibleAt: complete ? (lock?.eligibleAt ? new Date(lock.eligibleAt) : nextLecture(now)) : null,
    extraTasks: lock?.extraTasks || null,
  };
}

export { localDate };
