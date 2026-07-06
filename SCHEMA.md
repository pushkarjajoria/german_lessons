# SCHEMA.md — Reading reports, writing homework, writing tests

The complete data reference for running the loop. Written for Frau Richter (the
assistant in a Claude Code session or a scheduled task): everything needed to **ingest
what the learner did** and **produce the next assignment**, without reading the site's
source code. Companion: `LEARNING_LOOP.md` (the process), this file (the formats).

**Ground rules that apply to everything below:**

- All content files are AES-GCM encrypted in the repo (`*.enc`). Never commit plaintext
  content; the `scripts/*.js` tools do the encryption and refuse a password that doesn't
  match the manifest canary. With `.env` present (`scripts/save-password.js`, gitignored),
  no script asks for a password.
- IDs are 4-digit zero-padded strings (`"0007"`). Scripts compute the next id themselves
  and rewrite a mismatched id in your JSON — don't fight them.
- `category` strings are the unit of all analytics. **Reuse the exact same names across
  assignments** or the per-category history fragments. Established categories:
  `Redemittel`, `Vokabular`, `Wortstellung`, `Produktion`, `Hörverstehen`, `Kasus`,
  `Konjugation`, `Negation`. Add new ones deliberately, in German, and keep them.
- `docs/data/manifest.json` is plaintext and maintained by the scripts/site. It may hold
  only non-sensitive aggregates (ids, dates, counts, scores, category numbers, titles) —
  never question text, answers, or learner prose.

---

## 1. Ingesting reports

### 1.1 Homework reports

```bash
node scripts/read-report.js --latest        # markdown digest (start every session here)
node scripts/read-report.js --id 0003 --json
```

File: `docs/data/reports/report-NNNN.json.enc`. Decrypted shape:

```jsonc
{
  "id": "0003", "homeworkId": "0003", "lessonId": "0003",
  "startedAt": "2026-07-10T18:11:02Z",
  "date": "2026-07-10T18:20:31Z",          // completion time
  "durationSec": 569,
  "totalQuestions": 11,
  "firstTryCorrect": 8,                     // the real score — first attempts only
  "eventualCorrect": 11,                    // ~always == total: misses requeue until solved
  "totalAttempts": 15,
  "reworkRatio": 1.36,                      // totalAttempts / totalQuestions; 1.0 = clean run
  "avgFirstAnswerLatencySec": 9.4,          // mean thinking time before each FIRST attempt
  "hintsUsedCount": 2,                      // hints are click-to-reveal, so this is a real signal
  "audioReplaysTotal": 3,                   // manual ▶ replays on listen_type (auto-play not counted)
  "categoryStats":    { "Kasus": { "correct": 1, "total": 3 }, … },   // first-try accuracy
  "categoryAttempts": { "Kasus": { "attempts": 7, "count": 3 }, … },  // total tries incl. requeues
  "weakCategories": ["Kasus"],              // first-try accuracy < 70%
  "missedItems": [ { "qid": "q6", "prompt": "…", "correct": "…", "given": "…" } ],
  "perQuestion": [ {
      "qid": "q6", "index": 5, "type": "fill_blank", "category": "Kasus",
      "attempts": 3,
      "correct": true,                      // eventually
      "given": "der",                       // FIRST answer given
      "allGiven": ["der", "die", "den"],    // every attempt in order — converging or thrashing?
      "matchType": "exact",                 // 'exact' | 'fuzzy' on the winning attempt
      "hintShown": true,
      "replays": 0, "reorderMoves": 0,
      "timeToFirstAnswerSec": 14.2
  } ],
  "notesForTeacher": "auto-generated one-liner"
}
```

**How to read it (persona §8 applied to fields):**

- `firstTryCorrect` / `categoryStats` → the headline; `weakCategories` → tier triggers
  when the same category recurs across 3+ reports.
- `categoryAttempts` → **masked weak spots**: accuracy fine but `attempts/count > ~1.6`
  means it only lands by trial and error. Treat as weak even though `weakCategories`
  doesn't flag it.
- `reworkRatio` high **+** `avgFirstAnswerLatencySec` low (< ~8s) → guessing, not
  thinking (attention problem → callout). High ratio + high latency → honest struggle
  (→ patience, re-teach).
- `allGiven` → distinguish near-misses (`den→dem`) from no-idea (`der→die→den`).
- `matchType: "fuzzy"` → accepted with a typo; knew it approximately, not cold.
- `hintsUsedCount`, `replays` → scaffolding dependence; rising trend = flag it.
- Cross-session signals (streak, gaps, `lastPracticed`) live in `manifest.json`
  `counters` + `history` — read those for regularity/tier decisions.

### 1.2 Test results

```bash
node scripts/read-test.js --latest          # or --id NNNN; add --json for raw
```

File: `docs/data/tests/test-result-NNNN.json.enc`. Two shapes:

**Forfeited** — `{ "testId", "status": "forfeited", "forfeitReason": "abandoned" |
"deadline", "date", "points": 0, "perQuestion": [] }`. Zero points stands; map to
persona tiers (abandoned mid-test is worse than a missed deadline with a declared
busy week).

**Submitted:**

```jsonc
{
  "testId": "0001", "status": "submitted",
  "startedAt": "…", "date": "…", "durationSec": 412,
  "totalQuestions": 10, "answered": 8, "timedOut": 2,
  "subjectiveCount": 2,
  "totalBlurs": 1,                          // window lost focus mid-test — she notices
  "autoScore": { "correct": 5, "total": 8 },// objective portion, machine-graded — VERIFY IT
  "perQuestion": [ {
      "qid": "q4", "index": 3, "type": "translate", "category": "Produktion",
      "given": "Koennen Sie weniger Wasser nehmen",  // null if timed out
      "timedOut": false, "timeUsedSec": 31.5,
      "replays": 1, "blurCount": 0,
      "autoCorrect": true, "matchType": "fuzzy"      // objective types only
  } ]
}
```

**Grading protocol:** `read-test.js` prints objective answers with expected-vs-given
(spot-check the auto-grades — normalization can't judge a valid alternative phrasing;
credit fair answers it rejected), then subjective answers in full. Decide total points,
then record:

```bash
node scripts/grade-test.js --id 0001 --score "12/15" --comment "One Richter sentence." --push
```

That flips the manifest entry to `graded`; the learner sees score + comment on the
dashboard. Detailed feedback belongs in the next lesson, not the comment.

---

## 2. Question types (shared vocabulary)

Six types. Homework supports the first five; **tests support all six** (`subjective` is
tests-only — the homework runner has no renderer for it).

Common required fields: `id` (unique within the assignment), `type`, `prompt`,
`category`. Homework-only optional: `note` (shown as feedback after answering — write it
in her register: corrective, specific, never sycophantic), `hint` (click-to-reveal
before answering; use sparingly). Tests ignore `note`/`hint` entirely and add
`timeLimitSec` (optional per question, falls back to the test's `defaultTimeLimitSec`).

| type | extra fields | how it's answered / checked |
|---|---|---|
| `fill_blank` | `answers[]` | `prompt` must contain a blank of 2+ underscores (`___`); rendered as an inline input. Checked per §2.1. |
| `multiple_choice` | `options[]`, `answerIndex` | Homework: click = answer. Test: click selects, Next confirms. |
| `reorder` | `tokens[]`, `answer[]` | Tokens shown shuffled (never pre-solved); learner clicks them into order. Correct = exact `answer` sequence. |
| `translate` | `answers[]`, `acceptFuzzy?` | Free text input. With `acceptFuzzy: true`, Levenshtein ≤ 1 passes — but only for normalized answers longer than 10 chars. |
| `listen_type` | `audioText`, `answers[]` | Browser TTS (`de-DE`) speaks `audioText` once automatically; ▶ replays are counted. Learner types what they heard. |
| `subjective` | `minWords?` | **Tests only.** Multi-line German prose, no machine checking — you grade it. Give it a generous `timeLimitSec` (180–300s). |

### 2.1 Answer checking (what "correct" means)

Both the given answer and every entry in `answers[]` are normalized before comparison:
lowercased, trimmed, trailing punctuation (`.!?,;:…`) stripped, umlauts folded
(`ä→ae, ö→oe, ü→ue, ß→ss`), whitespace collapsed. Consequences for authoring:

- **One canonical answer is enough** — `"answers": ["möchte"]` already matches `moechte`,
  `Möchte`, `möchte.`. Add extra entries only for genuinely different valid phrasings
  (word-order variants, synonyms), not spelling variants.
- Checking is whole-string equality after normalization — a `translate` answer with an
  extra word fails. Constrain the prompt ("Start with 'Einen'") when several word orders
  would be fair, or list the variants.
- `fill_blank` compares only the blank's content, so keep blanks to a single word or
  short chunk.

---

## 3. Creating homework (+ its lesson)

Every homework pairs with a lesson markdown — the teaching text. **Lessons are
displayed on the site**: the Lessons page renders each decrypted `.md` and organizes
them into a curriculum tree (major sections → collapsible subsections → lesson leaves).
Write the lesson as the primary teaching artifact; the questions' `note`s reinforce it.

### 3.1 Lesson file format

Plain markdown with **required front matter** — this is how you (and only you) decide
where the lesson sits in the curriculum tree:

```markdown
---
title: Im Supermarkt — Pfand & Karte
section: Phase 1 — Survival Deutsch
subsection: Supermarkt
---

**Zielt auf:** kein/nicht, Kasus-Akkusativ

## Die Chunks — lerne sie als Ganzes
…
```

- `title` (required) — shown in the tree and as the lesson heading.
- `section` (required) — the major grouping. Reuse existing section names **verbatim**
  to extend a group; a new name creates a new major section. Sections appear in the
  order their first lesson was published. Suggested naming: align with Studienplan
  phases (`Phase 1 — Survival Deutsch`, `Phase 2 — Alltag`, …).
- `subsection` (optional) — the collapsible group inside a section (e.g. one per domain
  pack: `Kaffee`, `Supermarkt`, `Friseur`). Omit the line to place the lesson directly
  under the section. The newest subsection renders expanded by default.
- Body: start headings at `##` (the title provides the `h1`). Supported markdown:
  headings to `####`, paragraphs, `**bold**`, `*italic*`, `` `code` ``, links, bullet
  and numbered lists, tables, `>` blockquotes, fenced code, `---` rules. Nothing else —
  no HTML, no images.

`new-lesson.js` refuses a lesson without a real `title:` and `section:`.

### 3.2 Encryption & publishing

`new-lesson.js` does the encryption — never commit a plaintext lesson, and never write
the `.enc` yourself when publishing something new:

```bash
node scripts/new-lesson.js --scaffold        # writes templates for the next id
# edit scripts/templates/lesson-NNNN.md and homework-NNNN.json (gitignored dir)
node scripts/new-lesson.js --lesson scripts/templates/lesson-NNNN.md \
                           --homework scripts/templates/homework-NNNN.json --push
```

This encrypts both files into `docs/data/lessons/` and `docs/data/homework/`, bumps the
manifest pointers, and appends `{id, title, section, subsection}` to `manifest.lessons`
(the plaintext index the tree is built from — titles/sections are visible in the public
repo, so name them like curriculum topics, nothing personal).

**Fixing an already-published lesson** (typo, added paragraph): edit your plaintext
source, re-encrypt it to the *same* filename, and commit — the index entry stays:

```bash
node scripts/encrypt.js scripts/templates/lesson-0004.md docs/data/lessons/lesson-0004.md.enc
```

To change a published lesson's tree placement, edit its entry in `manifest.lessons`
directly and commit.

### 3.3 Homework JSON

```jsonc
{
  "id": "0004",                    // script enforces the real next id
  "lessonId": "0004",
  "title": "Supermarkt — Pfand & Karte",     // shown to the learner; goes to history plaintext after completion
  "createdAt": "2026-07-11",
  "targetsWeakAreas": ["kasus-akkusativ", "chunks-supermarkt"],   // free-form tags, for your own record
  "questions": [ /* 8–12 questions, five types, see §2 */ ]
}
```

Runner behavior you're designing for: one question at a time; instant feedback
(`Richtig./Falsch.` + the `note`); **misses requeue ~3 questions later until produced
correctly** — so a missed item costs attempts, not completion; first-try counts as the
score. Composition rule from the Studienplan: ~60% new material, ~40% spaced review of
previously missed items, categories interleaved, anchored in his domains (coffee, gym,
supermarket, films, football — see `Studienplan.md` §6).

The dashboard offers the homework until a matching entry appears in `manifest.history`.

## 4. Creating tests (Klausuren)

```bash
node scripts/new-test.js --scaffold          # template for the next test id
# edit scripts/templates/test-NNNN.json
node scripts/new-test.js --test scripts/templates/test-NNNN.json --push
```

Test JSON:

```jsonc
{
  "id": "0002",
  "title": "Klausur — Phase 1 Survival",
  "createdAt": "2026-07-14",
  "deadline": "2026-07-18T22:00:00Z",   // ISO, must be in the future; forfeit past it
  "instructions": "Shown once, before the start button. One short paragraph.",
  "defaultTimeLimitSec": 45,
  "questions": [
    /* any of the six types; each may set its own timeLimitSec */
    { "id": "q9", "type": "subjective", "category": "Produktion",
      "prompt": "Beschreibe dein letztes Training im Fitnessstudio. Drei Sätze.",
      "minWords": 20, "timeLimitSec": 240 }
  ]
}
```

Test conditions (enforced by the site, so design questions accordingly): per-question
countdown, expiry = recorded unanswered; strictly forward, no hints, no notes, no
feedback; cannot be paused; leaving the page = forfeit (browser warns once); pending
past `deadline` = forfeit, 0 points. Time limits calibrate difficulty: ~30s for
recognition (MC), ~45–60s for production (fill/translate/reorder/listen), 180–300s per
subjective. Validation refuses: past deadlines, unknown types, limits under 5s, missing
`answers`/`options`/`tokens`/`audioText`.

Publishing appends to `manifest.tests` (`{id, title, deadline, status: "pending",
questionCount, createdAt}`) and reconciles any expired pending tests to `forfeited`.
The dashboard shows pending tests with a countdown; lifecycle is
`pending → submitted → graded` or `→ forfeited` (`abandoned` | `deadline`).

## 5. Teacher notes — your standing remark on the dashboard

The dashboard's "Notes from Frau Richter" panel is mostly *computed* (performance,
regularity, effort — derived from history). On top of it sits **"From her desk"**: a
remark you write yourself, in your voice, plus the weak areas you flag by hand. Your
flagged areas also join the "Current weak spots" chips — a hand flag outranks the
statistics.

Update it in **every scheduled session** after reading the latest report/result, so the
learner always faces a current assessment, not a stale one (it replaces the previous
note — there is no note history):

```bash
node scripts/teacher-note.js \
  --text "Kasus improved — 1/3 to 3/3. Wortstellung is the new front; the test on Friday will assume it." \
  --weak "Wortstellung" --push
node scripts/teacher-note.js --clear --push     # rare: nothing worth saying
```

Constraints: max 400 characters, and it lives in the **plaintext** manifest of a public
repo — so keep it category-level and in your register (short, specific, never
sycophantic). Never quote his answers or personal details; the full grading rationale
and teaching belong in the encrypted lesson. Writing weekly-updated weak areas here is
exactly what the learner asked for: your running judgment of where he stands, visible
every time he logs in.

## 6. Manifest quick reference (script-maintained — rarely hand-edit)

```jsonc
{
  "currentLessonId": "0004", "currentHomeworkId": "0004",   // bumped by new-lesson.js
  "counters": { "lessonsCompleted", "totalQuestions", "totalCorrect",   // first-try
                "streakDays", "lastPracticed" },
  "history": [ /* per completed homework: report id, date, scores, reworkRatio,
                  latency, hints, replays, categoryStats/Attempts, weakCategories */ ],
  "lessons": [ /* curriculum index: {id, title, section, subsection?} —
                  appended by new-lesson.js from the lesson's front matter */ ],
  "tests":   [ /* per test: id, title, deadline, status, and per status:
                  answered/timedOut, score+comment, forfeitReason */ ],
  "teacherNote": { /* {date, text, weakAreas[]} — set by teacher-note.js */ },
  "canary":  { /* encrypted login probe — rotate only via the settings page */ }
}
```

`history`, `tests`, `lessons`, and `teacherNote` are what the dashboard and Lessons
page run on — publishing through the scripts keeps them consistent; that is the entire
reason to never bypass the scripts.

Related, not in the manifest: `docs/data/portrait.jpg.enc` is Frau Richter's portrait
(AES-GCM over the JPEG's base64, same password as everything else), decrypted after
login for the dashboard and Lessons page. The settings page's "Re-encrypt everything"
covers it along with all `data/` subdirectories.
