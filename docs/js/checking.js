// checking.js — answer normalization and checking, shared by the homework
// runner (quiz.js) and the test runner (test.js).

export function normalize(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[.!?,;:…]+$/g, '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Reports whether the match was exact or only accepted via typo-forgiveness —
// a real signal for whether an answer was known or half-guessed.
export function checkTextAnswerDetailed(q, given) {
  const g = normalize(given);
  if (!g) return { correct: false, matchType: null };
  const norms = q.answers.map(normalize);
  if (norms.includes(g)) return { correct: true, matchType: 'exact' };
  // Fuzzy (Levenshtein ≤ 1) only for longer translate answers — typo grace, not laxity.
  if (q.type === 'translate' && q.acceptFuzzy && norms.some((a) => a.length > 10 && levenshtein(a, g) <= 1)) {
    return { correct: true, matchType: 'fuzzy' };
  }
  return { correct: false, matchType: null };
}

export function checkTextAnswer(q, given) {
  return checkTextAnswerDetailed(q, given).correct;
}

// Objective grading for a test answer (no UI, no feedback — used silently).
// Returns { gradable, correct, matchType } — gradable=false for subjective.
export function gradeObjective(q, given) {
  if (q.type === 'subjective') return { gradable: false, correct: null, matchType: null };
  if (given === null || given === undefined || given === '') return { gradable: true, correct: false, matchType: null };
  if (q.type === 'multiple_choice') {
    return { gradable: true, correct: given === q.options[q.answerIndex], matchType: 'exact' };
  }
  if (q.type === 'reorder') {
    return { gradable: true, correct: given === q.answer.join(' '), matchType: 'exact' };
  }
  const r = checkTextAnswerDetailed(q, given);
  return { gradable: true, correct: r.correct, matchType: r.matchType };
}
