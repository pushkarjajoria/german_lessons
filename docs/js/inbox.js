// inbox.js — unread bookkeeping for the Messages page. What counts as unread:
//   * a message from Frau Richter without a readByLearner stamp (the durable
//     read receipt written back with a PAT — she sees when it was read), and
//     not in the localStorage fallback either (for PAT-less browsing);
//   * an Antrag ruling (response) the learner hasn't opened the page for since.
// auth.js calls navBadge() on every page after unlock.

const READ_KEY = 'gl_read_msgs';        // array of message ids read (PAT-less fallback)
const RULINGS_KEY = 'gl_seen_rulings';  // map request id -> respondedAt seen

const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };

export function unreadCount(manifest) {
  const readLocal = new Set(load(READ_KEY) || []);
  const msgs = (manifest.messages || []).filter(
    (m) => m.from === 'richter' && !m.readByLearner && !readLocal.has(m.id)
  );
  const seen = load(RULINGS_KEY) || {};
  const rulings = (manifest.requests || []).filter(
    (r) => r.response && seen[r.id] !== r.respondedAt
  );
  return msgs.length + rulings.length;
}

// Stamp everything currently visible as read/seen (localStorage side).
// The durable readByLearner write-back is messages.js's job (needs a PAT).
export function markAllSeenLocal(manifest) {
  const ids = (manifest.messages || []).filter((m) => m.from === 'richter').map((m) => m.id);
  const readLocal = new Set(load(READ_KEY) || []);
  ids.forEach((id) => readLocal.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify([...readLocal]));
  const seen = load(RULINGS_KEY) || {};
  for (const r of manifest.requests || []) {
    if (r.response) seen[r.id] = r.respondedAt;
  }
  localStorage.setItem(RULINGS_KEY, JSON.stringify(seen));
}

// The red dot on the nav — every page, right where the eye goes.
export function navBadge(manifest) {
  const link = document.querySelector('nav a[href="messages.html"]');
  if (!link) return;
  link.querySelector('.nav-badge')?.remove();
  const n = unreadCount(manifest);
  if (!n) return;
  const b = document.createElement('span');
  b.className = 'nav-badge';
  b.textContent = n;
  link.appendChild(b);
}
