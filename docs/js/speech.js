// speech.js — German text-to-speech, shared by the homework runner (quiz.js),
// the drills (practice.js) and the test runner (test.js). It used to be the
// same block copy-pasted into all three, with two problems:
//
//   1. THE RACE. `speechSynthesis.getVoices()` returns [] until the browser has
//      enumerated voices, and the voice was resolved once at module load. On a
//      cold page load the first `speak()` therefore ran with voice = null, and
//      the browser read the German with its DEFAULT voice — on this Mac, Daniel
//      (en-GB). That is why the audio "sounded English": it literally was.
//      Fixed by resolving the voice AT speak time and, if the list isn't ready,
//      waiting briefly for `voiceschanged` before speaking.
//   2. QUALITY. It took the first `de-DE` voice, which on macOS is Anna — the
//      legacy compact voice, flat and robotic. Now voices are ranked (network /
//      premium / known-good neural German voices first), and the learner can
//      override the pick entirely from Settings.

const VOICE_KEY = 'gl_german_voice';       // the learner's explicit choice, by name
const READY_TIMEOUT_MS = 1200;

export function germanVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => (v.lang || '').toLowerCase().startsWith('de'));
}

export function getPreferredVoiceName() {
  try { return localStorage.getItem(VOICE_KEY) || ''; } catch { return ''; }
}
export function setPreferredVoiceName(name) {
  try { name ? localStorage.setItem(VOICE_KEY, name) : localStorage.removeItem(VOICE_KEY); } catch { /* private mode */ }
}

// Higher score = better. Quality varies wildly by platform, so this is a
// best-effort ordering; the Settings picker is the real answer when it's wrong.
function score(v) {
  const n = (v.name || '').toLowerCase();
  if (/google/.test(n)) return 100;                                   // Chrome network voices — best available
  if (/premium|enhanced|neural/.test(n)) return 90;                   // macOS/Edge high-quality downloads
  if (/katja|conrad|petra|markus|helena|yannick|amala/.test(n)) return 80; // known-good German neural voices
  if (!v.localService) return 70;                                     // network voices generally beat compact ones
  if (/anna/.test(n)) return 10;                                      // legacy macOS compact German — intelligible but robotic
  return 40;
}

export function pickGermanVoice() {
  const voices = germanVoices();
  if (!voices.length) return null;
  const chosen = getPreferredVoiceName();
  if (chosen) {
    const hit = voices.find((v) => v.name === chosen);
    if (hit) return hit;                                              // honour the learner's pick
  }
  const exact = voices.filter((v) => v.lang.toLowerCase() === 'de-de');
  return [...(exact.length ? exact : voices)].sort((a, b) => score(b) - score(a))[0];
}

// Resolve after the voice list is actually populated. Chrome fires
// `voiceschanged` once ready; Safari usually has them synchronously.
export function voicesReady() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  if (speechSynthesis.getVoices().length) return Promise.resolve(speechSynthesis.getVoices());
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(speechSynthesis.getVoices()); };
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, READY_TIMEOUT_MS);                             // never hang the drill on a silent browser
  });
}

// Speak German. Always German-tagged, always a German voice when the machine
// has one — never the default English voice reading German text.
export async function speakGerman(text, { rate = 0.88 } = {}) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  await voicesReady();                                                // kills the cold-load race
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  u.rate = rate;
  const voice = pickGermanVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang || 'de-DE'; }
  speechSynthesis.speak(u);
}
