# The Learning Loop — how the circle closes

This file documents the full cycle that connects the Claude Code sessions (where Frau
Richter writes lessons) to the website (where Pushkar does homework) and back. It is the
operating manual for both sides. Companion files: `Deutsch_Sprachstand_Bericht.md` (level),
`Frau_Richter_Persona.md` (teacher), `Studienplan.md` (curriculum) — these three are
gitignored and live only on the local machine, since the repo itself is public.

```
        ┌────────────────────────────────────────────────────────┐
        │  1. Claude Code session: read latest report + 3 files  │
        │     → write lesson-NNNN.md + homework-NNNN.json        │
        └───────────────┬────────────────────────────────────────┘
                        │  2. scripts/new-lesson.js: encrypt, bump
                        │     manifest pointers, git commit+push
                        ▼
        ┌────────────────────────────────────────────────────────┐
        │  GitHub repo → GitHub Pages (docs/)                    │
        └───────────────┬────────────────────────────────────────┘
                        │  3. Website: password decrypts homework,
                        │     quiz runs, instant feedback, requeue
                        ▼
        ┌────────────────────────────────────────────────────────┐
        │  4. Website writes report-NNNN.json.enc back to repo   │
        │     (Contents API via PAT, or manual download+commit)  │
        │     + updates manifest counters/history                │
        └───────────────┬────────────────────────────────────────┘
                        │  5. Next session: scripts/read-report.js
                        │     → Frau Richter reads it → step 1
                        └──────────────► loop repeats
```

## Step 1 — The session reads the record

At the start of a Claude Code session in this repo, the assistant (as Frau Richter, per
the persona file's §8 protocol):

```bash
node scripts/read-report.js --latest    # uses .env (see scripts/save-password.js) or prompts
```

This prints the decrypted latest report: first-try accuracy, per-category and
per-attempts-per-category stats (the latter surfaces categories that score fine but only
after repeated tries — a weak spot accuracy alone hides), the exact missed items with what
was given vs. expected, per-question detail for anything with retries/hints/audio
replays/reorder hesitation, and the site's auto-generated `notesForTeacher`. The assistant
cross-references:

- `Deutsch_Sprachstand_Bericht.md` — the baseline diagnostic (long-term holes),
- `Studienplan.md` — which phase/domain pack is current,
- `Frau_Richter_Persona.md` — tier rules and session protocol.

## Step 2 — Write and publish the next lesson

The assistant writes two plaintext files (never committed in plaintext — they live in
`scripts/templates/` or a scratch directory and only their encrypted forms enter
`docs/data/`):

1. **Lesson markdown** — one focused teaching unit targeting the single weakest pattern
   from the report, in Frau Richter's register, anchored in Pushkar's domains (Studienplan §6).
2. **Homework JSON** — 8–12 questions across the five types (`fill_blank`,
   `multiple_choice`, `reorder`, `translate`, `listen_type`), mixing ~60% new material
   with ~40% spaced review of previously missed items (persona §2.3: spaced, interleaved).

Then:

```bash
node scripts/new-lesson.js --lesson <lesson.md> --homework <homework.json> --push
```

The script encrypts both (refusing a password that doesn't match the canary), writes them
to `docs/data/lessons/` and `docs/data/homework/`, bumps `currentLessonId` /
`currentHomeworkId` in `docs/data/manifest.json`, and commits/pushes (or prints the git
commands without `--push`). GitHub Pages redeploys `docs/` automatically.

## Step 3 — The learner practices

Pushkar opens the site, enters the password (login **is** decryption — the password
either opens the canary or nothing at all), and the dashboard shows streak, accuracy,
per-category breakdown, and the "Start today's homework" button whenever
`currentHomeworkId` has no matching entry in `manifest.history` yet. The quiz runner:

- renders one question at a time, all five types (audio via browser SpeechSynthesis, `de-DE`);
- checks answers case-insensitively, trims, normalizes umlauts (ä↔ae etc.), strips
  trailing punctuation; `translate` questions with `acceptFuzzy` tolerate one typo
  (Levenshtein ≤ 1) on longer answers;
- gives instant feedback with the question's `note`, in the teacher's voice — earned,
  specific, never sycophantic;
- **requeues misses ~3 questions later in the same session** until produced correctly
  (the anti-fossilization stance, in code).

## Step 4 — The report goes home

On completion the site builds `report-NNNN.json` — first-try vs. eventual correctness,
category stats, weak categories, missed items verbatim, auto notes, and a deliberately
generous set of per-question and per-session markers (Frau Richter invigilates, not just
grades): per question — every answer given in order (not just the first), whether the
final match was exact or only typo-forgiven, whether a hint was revealed and when, audio
replay count, reorder-token move count, and seconds-to-first-answer (thinking time before
the first guess). Per session — total rework ratio, average first-answer latency, hints
used, audio replays, and per-category average attempts (so a category that's "100%
eventually correct" but only after three tries each still gets flagged). It encrypts the
report under the same password, and:

- **with a PAT configured** (Settings page; stored in `localStorage` only): commits
  `docs/data/reports/report-NNNN.json.enc` and the updated `manifest.json`
  (counters, streak, history) via the GitHub Contents API;
- **without a PAT**: offers both files for download, to be committed manually.

`manifest.history` holds only non-sensitive aggregates (dates, scores, category numbers)
so the dashboard works without decrypting old reports. All content stays encrypted.

## Tests (Klausuren) — the second assessment channel

Alongside homework, Frau Richter can assign **tests**. Same encryption, same repo,
different rules — a test measures what actually sits, so the scaffolding homework
provides is deliberately removed:

- **Timed per question** (`timeLimitSec` per question or `defaultTimeLimitSec` for the
  test). When the clock runs out, the question is recorded as unanswered and gone.
- **One direction only** — no going back, no requeue, no hints.
- **No feedback during or after submission.** Objective questions are auto-graded
  *silently into the encrypted result*; the learner sees nothing until Frau Richter
  grades it.
- **Cannot be paused or stopped once started.** Leaving the page mid-test (the browser
  shows one warning) forfeits it: an in-progress marker in localStorage plus no
  submitted result = abandoned = a zero-point forfeit result is written on next visit.
- **Deadline** (ISO timestamp in the test file and manifest entry): pending past the
  deadline = forfeited with 0 points. The dashboard enforces this on login; the scripts
  reconcile it on the next publish, so it holds even without a PAT.
- **Subjective questions** (`type: "subjective"`, optional `minWords`) collect free
  German prose for Frau Richter to grade by hand.
- Tracking is test-grade too: per question — answer, time used, timed-out flag, audio
  replays, and **window-blur count** (she notices tab-switching during a Klausur).

**Lifecycle** (`manifest.tests[]`, plaintext aggregates only): `pending` → `submitted`
→ `graded`, or → `forfeited` (abandoned/deadline). The dashboard shows pending tests
with a deadline countdown and a "Take it" button, and the full record below.

**Assistant-side commands:**

```bash
node scripts/new-test.js --scaffold                 # template for the next test id
node scripts/new-test.js --test <file.json> --push  # validate, encrypt, deadline, publish
node scripts/read-test.js --latest                  # decrypt test + result for grading
node scripts/grade-test.js --id NNNN --score "12/15" --comment "…" --push
```

Files live in `docs/data/tests/` (`test-NNNN.json.enc`, `test-result-NNNN.json.enc`);
the settings page's "Re-encrypt everything" covers that directory too.

## Step 5 — The circle closes

Next session, `read-report.js` surfaces the new report and Frau Richter applies her §8
protocol. **How report signals map onto her tiers (persona §4):**

| Report signal | Tier | Session consequence |
|---|---|---|
| Practiced, errors new or improving | 0 | Brief acknowledgment, straight to new lesson |
| One missed day / one sloppy category | 1 | Callout + one extra targeted drill in the next homework |
| Same category weak (<70%) in 3+ consecutive reports, or the same `missedItems` prompt recurring | 2 | Next homework is remediation-heavy; new material held until the old form is produced correctly |
| ≥7 days since `lastPracticed` with no declared busy week, or a fossilizing item that keeps returning | 3 | Nachsitzen: remediation homework only + a real-world spoken task (persona §6) |
| Extended silent ghosting | 4 | Recommitment + re-diagnostic before anything else |

Declared busy weeks (Freistellung, persona §7) are honored: the learner says so in the
session, and the next homework is a 5-minute maintenance set instead of a full lesson.

## Ground rules (both sides)

- **The password is the security.** Repo privacy is not relied upon; the Pages site is
  assumed publicly reachable. AES-256-GCM, key from PBKDF2-SHA256 (210 000 iterations),
  fresh 16-byte salt + 12-byte IV per file, envelope `{v, salt, iv, ct}` — identical in
  `docs/js/crypto.js` (Web Crypto) and `scripts/lib-crypto.js` (Node built-ins), verified
  interoperable in both directions.
- **No secrets in the repo, ever.** The PAT lives only in the browser's localStorage. The
  password lives only in memory in the browser (page session); on the local machine it may
  also live in a gitignored `.env` (via `scripts/save-password.js`) so scheduled/unattended
  runs work — a deliberate convenience tradeoff for a single-user local machine, not an
  oversight, and reversible by deleting that file.
- **Plaintext lesson/homework sources** stay in `scripts/templates/` (gitignored) — only
  `.enc` files are committed under `docs/data/`.
- **Lost password = lost content.** There is no recovery path, by design. Back it up.
