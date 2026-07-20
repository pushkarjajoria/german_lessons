# The Learning Loop — how the circle closes

This file documents the full cycle that connects the Claude Code sessions (where Frau
Richter writes lessons) to the website (where Pushkar does homework) and back. It is the
operating manual for both sides. Companion files: `SCHEMA.md` (every data format — how
to read reports and author homework/tests; start there when producing content), plus the
pedagogy: `Deutsch_Sprachstand_Bericht.md` (level), `Frau_Richter_Persona.md` (teacher),
`Studienplan.md` (curriculum) — those three are gitignored and live only on the local
machine, since the repo itself is public.

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

## Step 0 — The session syncs (and why it must)

The scheduled sandbox has no SSH key and no `known_hosts`, so `git push` there dies
with *Host key verification failed*, and a stale `.git/index.lock` has repeatedly
blocked `git add`. Two failures followed from that: her commits piled up locally
while the website pushed the learner's work to origin (**divergence**, hand-untangled
every few days), and one run judged from a **stale manifest** while the report file
sat on disk — it withheld a lesson and cost a week of wrong instruction.

Both are fixed by bookending every session:

```bash
node scripts/session-start.js     # first command
node scripts/session-end.js --message "…"   # last command
```

`session-start.js` clears a stale index.lock, fetches origin over **anonymous HTTPS**
(the repo is public, so this needs no credentials and works in the sandbox), rebases
her unpushed commits onto the learner's pushed work — so the next push is always a
fast-forward — and prints the record **files first, manifest second**, loudly naming
any report file the manifest hasn't caught up with.

`session-end.js` commits the run. With `GL_GITHUB_TOKEN` in the gitignored `.env`
(beside `GL_PASSWORD`) it pushes over HTTPS itself; without one it writes a
one-paste handoff to `frau_richter/NEEDS_ATTENTION.md`. Either way the work is
committed, which is what keeps the histories from drifting.

**FR-003, fixed 2026-07-20.** The sandbox mount **permits creating files inside `.git/` but
denies deleting them** — `touch .git/__probe` succeeds, `rm` on it returns *Operation not
permitted*, on a file owned by the sandbox user at mode 600. Because git creates
`index.lock` with `O_CREAT|O_EXCL`, a single stale lock used to make every `git add` /
`git commit` fail for the rest of the session, silently — `session-start.js` printed only
`in sync with origin.` and a whole run could be taught believing it would publish.

Fixed via `scripts/lib-git.js`: both scripts now commit through an index held in the
system temp dir (`GIT_INDEX_FILE`, seeded with `git read-tree HEAD`), where the lock is
created and removed on a writable-and-unlinkable path — so a stale, even *unremovable*,
`.git/index.lock` becomes irrelevant litter instead of a permanent blockade.
`session-start.js` now also says plainly when the mount can't unlink, and
`session-end.js` reports the actual publish route used. Verified against a genuinely
undeletable lock (macOS `chflags uchg`, reproducing the sandbox's `EPERM`): commit
succeeds regardless.

## Step 0.5 — She opens the drawer

Before teaching, she reads `feature requests.md` (repo root, gitignored) for anything the
development sessions have marked **`built`** since she last looked, and starts using it that
day. At the end of the session she writes back into it.

This is a **loop, not a suggestion box**: the development chat reads that file every time it
is opened and implements what is pending, so a gap she absorbs silently is a gap that never
gets fixed and that she pays for again every week. The trigger for writing an entry is not
only "something broke" — it is also, and mostly, *catching herself improvising*: tracking
something in her private notes because the site has nowhere to put it, trimming a judgement
to fit a field, or telling him in prose what a dashboard should be showing him. See persona
§ session routine, step 8.

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
per-category breakdown, Frau Richter's notes, and the "Start today's homework" button
whenever `currentHomeworkId` has no matching entry in `manifest.history` yet. The
**Lessons page** renders every published lesson (decrypted client-side) in a curriculum
tree — sections and subsections chosen by Frau Richter in each lesson's front matter
(SCHEMA.md §3). The quiz runner:

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
  replays, and window-blur count. **Tab-switching is enforced, not just counted**
  (announced in the standing rules and the briefing): the first switch during a live
  question forfeits that question (`tabForfeit: true`, an acknowledged full-screen
  warning follows); the second ends the exam where it stands (`endedByTabSwitch`),
  with only the questions answered until then counting — the rest are zero
  (`unreached`). Aggregates (`tabForfeits`, `endedByTabSwitch`) also land on the
  plaintext manifest entry so the dashboard record shows it.

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

**Novelty rule:** tests measure transfer, not memory — every test question asks an
already-taught skill in a *new* sentence and context. `new-test.js` decrypts all
published homework and refuses exact prompt duplicates (`--allow-duplicates` to
override; near-duplicates get a warning).

## Around the core loop — drills, ledger, language, discipline

- **Practice page (site):** voluntary drills sampled from all published homework —
  previous mistakes (from the reports), weak areas, tenses & forms, harder
  production-only transforms (MC loses its options, reorder must be typed), mixed —
  plus a **vocabulary gauntlet**: ~10 options per word from the encrypted bank
  (`docs/data/vocab.json.enc`, maintained via `scripts/vocab-add.js`), distractors
  drawn from declared confusers, same-category neighbours, and the learner's own past
  wrong picks (tracked in localStorage, re-offered until they stop working). Drills
  file no report but append `{date, mode, items, firstTry}` to `manifest.practiceLog`.
- **Assignments page (site):** every assignment numbered and listed under its
  section/subsection with a completion checkmark and score; the current pending
  assignment is pinned on top — it must be completed to proceed.
- **Verdict language:** the dashboard's computed verdict/notes exist in English and
  German (`docs/js/richter-voice.js`); `manifest.verdictLang` decides which renders,
  flipped by `scripts/teacher-note.js --lang de|en` at the teacher's discretion.
- **Betragen (star ladder):** `manifest.conduct` — a 0–100 conduct score starting at
  65, adjusted only by scripts/conduct.js (one ruling per session, reason logged).
  Dashboard shows only the rank currently held (gold 95–100 / silver 80–94 /
  black 65–79 / cone below 65) plus the next rung's threshold; auth.js stamps `body[data-tier]`
  sitewide and the CSS gives each tier its own atmosphere — gold: warmed palette +
  glinting star + soft gold vignette; silver: cool polished palette; black:
  baseline; cone: drained ashen palette, greyed portrait, a breathing red vignette,
  an SVG watermark of punishment lines (SCHANDE / nicht genug / Ich muss besser
  werden.) tiled across every page (animations respect prefers-reduced-motion), and
  the learner's own photo (docs/data/img/learner.enc, encrypted; docs/js/shame.js)
  in full original color — replacing the cone glyph on the dashboard rank badge and
  pinned to the corner of every other page, captioned "Der Schüler."
  Below 60 every page locks; the learner files an apology in German (encrypted
  inline, one per calendar day, chain restarts on a missed day) — three consecutive
  days earn review eligibility on the next lecture day (Mon/Wed 10:00), where the
  teacher accepts (score → 65, unlock) or rejects with conditions (count restarts).
- **Messages page (Nachrichten & Anträge):** one encrypted thread on messages.html.
  Anträge (`manifest.requests[]`, scripts/requests.js rules grant/decline — the
  ruling renders as her reply) and two-way notes (`manifest.messages[]`,
  scripts/messages.js: --send [--needs-reply], --list with read receipts; opening
  the page stamps readByLearner). Unread items badge the nav on every page
  (docs/js/inbox.js via auth.js). Persona: lecture hours Mon/Wed 10:00–12:00 CEST;
  off-hours questions are redirected here; tone feeds the conduct score.
- **Berichte (assignment reports):** every completed assignment owes a written
  report, filed once on the Assignments page → `manifest.assignmentReports[lessonId]
  = {date, enc}`; missing ones are flagged on the ledger and listed by
  scripts/messages.js --reports — she names them at session start.
- **Surprise test repertoire:** two test-only question types — `multi_select`
  (options[] + answerIndexes[], exact set match) and `click_mistake` (tokens[] +
  mistakeIndex) — plus per-test `negativeMarking` (wrong option pick costs 1/n of a
  point; typed answers, skips, and timeouts are never penalized) and `allowSkip`
  (default true; records `skipped`, 0 points). The paper's `instructions` and
  mechanics render on a briefing screen only after the learner is locked in
  (forfeit armed), before the first per-question clock. Results carry
  `autoScore.points` (correct − penalties). Quizzes are warned away from negative
  marking and >2 surprise questions; the full repertoire belongs to Klausuren/finals.
- **Semesters:** `manifest.semester` (scripts/semester.js) spans a run of lessons with
  short quizzes (`kind:"quiz"`, ~10 min) and one long final (`kind:"final"`, 20–30 min),
  weighted quizzes 40% / final 60% against a high pass bar. Fail once → retake final in
  a week (new + jumbled questions); fail twice → the course repeats as a new round
  (`S1-R1`) with republished assignments. The dashboard shows the standing.
- **Homework start-gate:** opening the page records nothing; the attempt begins at an
  explicit Begin behind a one-sitting warning. Abandoning after Begin restarts the
  attempt and is counted in the report (`restarts`).
- **Justify-your-answer:** questions flagged `justify: true` demand a typed one-line
  reason — in homework before continuing, in tests inside the same time limit — stored
  verbatim (`justification`) for subjective grading. **Her verdict on it comes back**
  (FR-005): `scripts/justify-verdict.js --report NNNN --qid qN --verdict
  sound|pattern-matching --note "…"` writes to `manifest.justifyVerdicts[reportId][qid]`
  (plaintext aggregate, never touches the encrypted report); the Assignments page
  decrypts the matching report + homework to show his prompt/answer/reasoning next to
  her verdict, per assignment.
- **Buried interleaving:** `new-lesson.js --interleave 0002:q7` copies old questions
  into today's homework at random positions, unmarked for the learner, marked
  (`interleaved`) in the report. `new-lesson.js --republish NNNN` (FR-002) corrects an
  already-published lesson/homework in place — same `.enc` paths, manifest pointers
  and curriculum placement untouched, any live buried interleave carried forward
  automatically; refuses outright once a report exists for that id.
- **Deeds (FR-004):** `manifest.deeds[]` — real-world spoken tasks as first-class
  objects (`scripts/deed.js --add "…" --due NNNN`), shown as a standing dashboard row
  until the learner closes it (done/not yet/declining + an encrypted one-line note).
  No proof, no upload — self-report, now visible instead of living only in the
  teacher's private ledger. `session-start.js` prints every open one.
- **Nachweis uploads:** discipline tasks accept a proof file on the dashboard — encrypted
  client-side and committed to `docs/data/uploads/`, opened only by the teacher
  (`scripts/read-upload.js`); clearing the block remains a manual teacher act.
- **Korrektur (ASR model-repeat):** a wrong answer in homework/drills locks the Next
  button until the correct model is typed back `policy.modelRepeat` times; every
  first-try homework miss auto-enrolls in `manifest.corrections` and must be produced
  correctly (hardened: typed, no options) `requiredPasses` times on occasions
  ≥ `minGapMinutes` apart — a miss resets the count, and items open past `graceHours`
  lock new homework. All hyperparameters live in `manifest.correctionPolicy`
  (`scripts/correction-policy.js`); the dashboard shows the queue with pass-progress,
  the Practice page hosts the runner, and sittings log to `practiceLog` as `korrektur`.
- **Feature requests (`feature requests.md`, repo root, gitignored):** Frau
  Richter's drawer for site capabilities she wants but doesn't have. Her sessions
  write entries (FR-NNN, date, status, request, pedagogy); the development sessions
  read the file on every task and implement pending entries, flipping status to
  `built` with a date and one line on what shipped.
- **Discipline (course halt):** after long unexplained silence or consistent
  complacency, `scripts/discipline.js --issue` publishes Nachweis tasks (recording /
  handwriting sheet, each with anti-spoof requirements) and halts the course — the
  dashboard shows a red panel and homework/tests refuse to start until the teacher
  verifies the proof and runs `--clear`. The learner's "submit for review" button only
  marks a task claimed; clearing is exclusively the teacher's act.

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
