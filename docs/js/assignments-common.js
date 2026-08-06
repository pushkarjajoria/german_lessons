// assignments-common.js — what is actually outstanding, derived rather than pointed at.
//
// THE BUG THIS FIXES: the site decided "what homework is due" purely from
// `manifest.currentHomeworkId` — a SINGLE pointer. That breaks in two ways:
//
//   * More than one assignment can stand at once. She published 0010 and 0011
//     together and wrote "both 0010+0011 stand" — the pointer can only name one,
//     so the other was invisible.
//   * Nothing advances the pointer when the current one is completed. Once 0010
//     was done the dashboard said "nothing new" and the Assignments page pinned
//     nothing, while published, unstarted homework 0011 sat there unreachable.
//
// So: an assignment is OUTSTANDING if it is in the published lessons index and
// has no report in history. `new-lesson.js` always publishes a lesson and its
// homework together, so a lessons entry implies a homework file exists.
//
// The pointer is still honoured for ORDERING (do the one she named first) and as
// a fallback, but it can no longer hide work that is genuinely assigned.

export function outstandingAssignments(manifest) {
  const lessons = manifest.lessons || [];
  const doneIds = new Set((manifest.history || []).map((h) => h.homeworkId));
  return lessons
    .filter((l) => !doneIds.has(l.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));   // ids are zero-padded
}

// The one to work on now: her named current assignment when it is still
// outstanding (she sequences deliberately — 0010 before 0011), otherwise the
// oldest remaining one. Null when everything published has been done.
export function nextAssignment(manifest) {
  const open = outstandingAssignments(manifest);
  if (!open.length) return null;
  return open.find((l) => l.id === manifest.currentHomeworkId) || open[0];
}

export function nextAssignmentId(manifest) {
  return nextAssignment(manifest)?.id || manifest.currentHomeworkId;
}
