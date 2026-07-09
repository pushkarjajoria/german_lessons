// richter-voice.js — Frau Richter's computed verdict and notes, in both
// languages. Which language the learner sees is her call, not a UI toggle:
// manifest.verdictLang is 'en' until she judges the learner can read her in
// German, then she flips it to 'de' (scripts/teacher-note.js --lang de).
// The German is deliberately plain — short A2-level sentences, which happens
// to be exactly her register anyway.

export function pct(correct, total) {
  return total ? Math.round((correct / total) * 100) : null;
}

export function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

// Gaps (in days) between consecutive practice days across the whole record.
export function sessionGaps(history) {
  const days = [...new Set(history.map((h) => h.date.slice(0, 10)))].sort();
  const gaps = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push(Math.round((new Date(days[i]) - new Date(days[i - 1])) / 86400000));
  }
  return gaps;
}

// A category weak across several recent sessions, not just once.
export function recurringWeakCategories(history, lookback = 3) {
  const counts = {};
  for (const h of history.slice(-lookback)) {
    for (const c of h.weakCategories || []) counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).filter(([, n]) => n >= 2).map(([c]) => c);
}

export function voiceLang(manifest) {
  return manifest.verdictLang === 'de' ? 'de' : 'en';
}

// ---------- the verdict (her opening line) ----------

export function verdict(manifest, weak, lang) {
  const { counters, history } = manifest;
  const idle = daysSince(counters.lastPracticed);
  const de = lang === 'de';

  if (!history.length) {
    return de
      ? 'Keine Daten, kein Urteil. Ein Urteil verdient man mit Arbeit. Die erste Hausaufgabe wartet — anfangen.'
      : 'No data, no opinion. Opinions are earned with work. The first homework is waiting — start.';
  }
  if (idle >= 7) {
    return de
      ? `${idle} Tage Stille, und kein Wort von dir. Warst du beschäftigt? Du kennst die Regel: Sag es vorher. Sonst — heute die Hausaufgabe. Sofort.`
      : `${idle} days of silence, and no word from you. If you were busy, you know the rule: say so. Otherwise — today, the homework. No preamble.`;
  }
  if (idle >= 3) {
    return de
      ? `${idle} Tage seit der letzten Übung. Die Hausaufgabe macht sich nicht selbst. Setz dich.`
      : `${idle} days since you last practiced. The homework did not do itself. Sit down.`;
  }
  const last = history[history.length - 1];
  const lastPct = pct(last.firstTryCorrect, last.totalQuestions);
  if (weak.size) {
    const w = [...weak].join(', ');
    return de
      ? `${w} rutscht immer wieder weg. Das ist kein Zufall, das ist ein Muster — und Muster werden hart. Es kommt zurück, bis es sitzt.`
      : `${w} keeps slipping. It is not a mystery, it is a pattern — and patterns harden. It returns until it sits.`;
  }
  if (counters.streakDays >= 3 && lastPct >= 90) {
    return de
      ? `${counters.streakDays} Tage in Folge, ${lastPct}% beim ersten Versuch. Gut. Das sage ich zum ersten Mal — mach es nicht zum letzten Mal.`
      : `${counters.streakDays} days in a row, ${lastPct}% on first try. Good. That is the first time I say it — do not make it the last.`;
  }
  if (lastPct >= 80) {
    return de
      ? `Letzte Sitzung: ${lastPct}% beim ersten Versuch. Akzeptabel. An den restlichen ${100 - lastPct}% arbeiten wir heute.`
      : `Last session: ${lastPct}% on first try. Acceptable. The remaining ${100 - lastPct}% is where we work today.`;
  }
  return de
    ? `Letzte Sitzung: ${lastPct}% beim ersten Versuch. Da bleiben wir nicht stehen. Die Fehler kommen zurück, bis sie sitzen.`
    : `Last session: ${lastPct}% on first try. That is not where we stop. The misses come back until they sit.`;
}

// ---------- the three notes ----------

export function richterNotes(manifest, lang) {
  const { counters, history } = manifest;
  const de = lang === 'de';

  if (!history.length) {
    return de ? {
      performance: 'Nichts wurde abgegeben. Es gibt noch nichts zu bewerten — und nichts zu loben, nur weil du da bist.',
      regularity: 'Keine Übung im Protokoll. Die Serie beginnt mit der ersten ehrlichen Sitzung, nicht vorher.',
      effort: 'Fleiß bewerte ich nach getaner Arbeit, nicht nach guten Absichten. Fang an, dann reden wir.',
    } : {
      performance: 'Nothing has been submitted. There is nothing yet to assess, and nothing to praise for merely arriving.',
      regularity: 'No practice recorded. The streak begins at the first honest session, not before.',
      effort: 'Effort is judged by work done, not by intentions stated. Begin, then we will have something to discuss.',
    };
  }

  const last = history[history.length - 1];
  const lastPct = pct(last.firstTryCorrect, last.totalQuestions);
  const trend = history.slice(-3).map((h) => pct(h.firstTryCorrect, h.totalQuestions));
  const recurring = recurringWeakCategories(history);

  // Performance
  let performance;
  if (recurring.length) {
    performance = de
      ? `${recurring.join(', ')} kommt Sitzung für Sitzung schwach zurück — nicht nur einmal. Das ist kein Ausrutscher mehr, das ist ein Muster. Es steht in der nächsten Lektion, bis es weg ist.`
      : `${recurring.join(', ')} ${recurring.length > 1 ? 'keep' : 'keeps'} coming back weak across sessions, not just once. That is no longer a slip, it is a pattern setting — and I do not let those sit. It returns in the next lesson until it is gone, not until it is convenient.`;
  } else if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) {
    performance = de
      ? `${lastPct}% bei der letzten Hausaufgabe, vorher ${trend[0]}%. Besser. Ich mache kein Fest daraus — eine gute Sitzung ist noch keine Gewohnheit.`
      : `${lastPct}% on the last homework, up from ${trend[0]}%. Improving. I will not make a ceremony of it — one good session is not yet a habit.`;
  } else if (lastPct >= 90) {
    performance = de
      ? `${lastPct}% beim ersten Versuch. Sauber. Das ist mein Standard für dich — kein Grund, nachzulassen.`
      : `${lastPct}% on first try. Clean. That is the standard I expect of you, not a reason to ease off it.`;
  } else if (lastPct >= 70) {
    performance = de
      ? `${lastPct}% beim ersten Versuch. Ausreichend, nicht mehr. Der Rest verschwindet nicht — er steht in deiner nächsten Lektion.`
      : `${lastPct}% on first try. Adequate, nothing more. The remainder does not vanish — it is in your next lesson.`;
  } else {
    performance = de
      ? `${lastPct}% beim ersten Versuch. Dabei bleibt es nicht. Wir werden langsamer und bauen neu auf, bevor etwas Neues dazukommt.`
      : `${lastPct}% on first try. That is not an acceptable resting point. We slow down and rebuild before anything new is added.`;
  }
  const maskedWeak = Object.entries(last.categoryAttempts || {})
    .filter(([cat, a]) => a.count > 0 && a.attempts / a.count > 1.6 && !(last.weakCategories || []).includes(cat))
    .map(([cat]) => cat);
  if (maskedWeak.length) {
    performance += de
      ? ` ${maskedWeak.join(', ')}: die Punktzahl stimmt, aber nur nach mehreren Versuchen. Das ist kein Können, das ist Raten mit Glück. Ich sehe es trotzdem.`
      : ` ${maskedWeak.join(', ')} scored acceptably but only after repeated tries — that is not mastery, it is trial and error that happened to land. I am watching it either way.`;
  }

  // Regularity
  const idle = daysSince(counters.lastPracticed);
  const gaps = sessionGaps(history);
  const missedStretches = gaps.filter((g) => g >= 2).length;
  let regularity;
  if (idle >= 7) {
    regularity = de
      ? `${idle} Tage Stille, ohne ein Wort von dir. Die Regel war immer einfach: Sag es, bevor du verschwindest — nicht danach.`
      : `${idle} days of silence, with no word from you in that time. If a busy week was the reason, the rule has always been simple: say so before you vanish, not after. Unannounced silence is what invites this conversation.`;
  } else if (idle >= 3) {
    regularity = de
      ? `${idle} Tage seit der letzten Sitzung. Noch kein Muster — aber ich beobachte es. Heute schließt du die Lücke.`
      : `${idle} days since the last session. Not yet a pattern of neglect, but close enough that I am watching it. Today closes the gap.`;
  } else if (counters.streakDays >= 5) {
    regularity = de
      ? `${counters.streakDays} Tage in Folge. So sieht Regelmäßigkeit aus. Aber ein Polster ist das nicht — kein freier Tag deswegen.`
      : `${counters.streakDays} days in a row. That is what regularity looks like. Do not treat it as a cushion that earns you a day off.`;
  } else if (missedStretches >= 3) {
    regularity = de
      ? `Du kommst, du gehst, du kommst wieder — ${missedStretches} Lücken von zwei oder mehr Tagen. Unregelmäßigkeit ist auch ein Fehler, der sich festsetzt. Wähle einen Rhythmus und halte ihn.`
      : `You return, then lapse, then return again — ${missedStretches} gaps of two or more days across your record. Inconsistency is its own kind of fossilizing error. Choose a rhythm and hold it.`;
  } else {
    regularity = de
      ? 'Einigermaßen stetig. Nichts zu eskalieren — und noch nichts zu loben.'
      : 'Reasonably steady. Nothing here to escalate, and nothing yet to applaud outright either.';
  }

  // Effort & sincerity
  const attemptsRatio = last.totalAttempts && last.totalQuestions ? last.totalAttempts / last.totalQuestions : 1;
  const avgLatency = typeof last.avgFirstAnswerLatencySec === 'number'
    ? last.avgFirstAnswerLatencySec
    : (last.totalQuestions ? last.durationSec / last.totalQuestions : null);
  const hints = last.hintsUsedCount || 0;
  const replays = last.audioReplaysTotal || 0;
  let effort;
  if (attemptsRatio <= 1.15) {
    effort = de
      ? 'Ein sauberer Durchlauf — fast keine Wiederholungen nötig. Was auch immer du vorher gemacht hast: weiter so.'
      : 'A clean run — little to no rework needed. Whatever preparation produced that, keep doing it.';
  } else if (attemptsRatio > 1.6 && avgLatency !== null && avgLatency < 8) {
    effort = de
      ? 'Viele Versuche, schnell getippt. Das heißt meistens: Raten, nicht Denken. Werde langsamer, bevor du antwortest — nicht erst, wenn ich „falsch“ sage.'
      : 'A lot of retries, answered quickly. That combination usually means guessing, not thinking — you are pattern-matching again, not working the answer out. Slow down before you answer, not after I tell you it is wrong.';
  } else if (attemptsRatio > 1.3) {
    effort = de
      ? 'Mehrere Aufgaben brauchten mehr als einen Versuch, aber du hast dir Zeit genommen. Das ist ehrliches Ringen, keine Schlamperei — dafür gibt es Geduld. Der Stoff kommt einfach wieder, bis er sitzt.'
      : 'Several items needed more than one try, but you took real time on them. That reads as honest struggle, not carelessness — it earns patience, and the material simply repeats until it holds.';
  } else {
    effort = de
      ? 'Normale Arbeit. Nichts Besonderes, nichts Besorgniserregendes.'
      : 'Ordinary effort. Nothing remarkable here, and nothing concerning either.';
  }
  if (hints >= 2) {
    effort += de
      ? ` Bei ${hints} Aufgaben hast du zuerst den Hinweis geöffnet. Ab und zu — in Ordnung. Als Gewohnheit ist ein Hinweis keine Hilfe mehr, sondern eine Krücke.`
      : ` You reached for the hint on ${hints} items before even attempting them. Occasionally, fine — if it becomes routine, it has stopped being a hint and become a crutch.`;
  } else if (hints === 1) {
    effort += de
      ? ' Ein Hinweis benutzt. Notiert — allein noch kein Problem.'
      : ' One hint used before attempting. Noted, not a concern on its own.';
  }
  if (replays >= 3) {
    effort += de
      ? ' Das Audio brauchte viele Wiederholungen. Hörverstehen ist gerade deine schwächste Stelle — erwarte mehr davon, nicht weniger.'
      : ' The audio needed repeated replays throughout. Listening comprehension is where you are weakest right now — expect more of it, not less.';
  }

  return { performance, regularity, effort };
}

// ---------- assorted UI strings the dashboard needs in both languages ----------

export const STRINGS = {
  en: {
    deskNote: (date) => `From her desk — ${date}`,
    ctaDone: (id) => `<strong>Nothing new.</strong> Homework ${id} is done; your next lesson is being prepared.`,
    ctaDoneSub: 'Use the wait properly: say your coffee order out loud, once, from memory. Recognizing is not knowing.',
    ctaStart: 'Start today’s homework →',
    ctaSub: (id) => `Homework ${id} is waiting. It knows you are here.`,
    disciplineTitle: 'The course is halted.',
    disciplineClaim: 'I have done this — submit for her review',
    disciplineClaimed: 'Submitted for review. She decides, not the button.',
    disciplineFoot: 'Homework and tests stay locked until Frau Richter clears this. Completing the tasks is how you reopen the course.',
    coneVerdict: 'I am disappointed — not angry, disappointed, which is worse. This is not who you are when you actually work. Climb out before you mistake the cone for your ceiling.',
  },
  de: {
    deskNote: (date) => `Von ihrem Schreibtisch — ${date}`,
    ctaDone: (id) => `<strong>Nichts Neues.</strong> Hausaufgabe ${id} ist fertig; deine nächste Lektion wird vorbereitet.`,
    ctaDoneSub: 'Nutze die Wartezeit richtig: Sag deine Kaffeebestellung einmal laut, aus dem Kopf. Erkennen ist nicht Können.',
    ctaStart: 'Heutige Hausaufgabe starten →',
    ctaSub: (id) => `Hausaufgabe ${id} wartet. Sie weiß, dass du hier bist.`,
    disciplineTitle: 'Der Kurs ist angehalten.',
    disciplineClaim: 'Erledigt — zur Kontrolle einreichen',
    disciplineClaimed: 'Zur Kontrolle eingereicht. Sie entscheidet, nicht der Knopf.',
    disciplineFoot: 'Hausaufgaben und Tests bleiben gesperrt, bis Frau Richter das hier aufhebt. Die Aufgaben zu erledigen ist der einzige Weg zurück.',
    coneVerdict: 'Ich bin enttäuscht — nicht wütend, enttäuscht, was schlimmer ist. So bist du nicht, wenn du wirklich arbeitest. Steig heraus, bevor du den Kegel für deine Decke hältst.',
  },
};
