# german_lessons — personalized German loop (late A1 → A2 → early B1)

A private learning system with two halves that feed each other:

- **Claude Code sessions** (Frau Richter) read the latest practice report and write the
  next lesson + homework, encrypted, into this repo — see [`LEARNING_LOOP.md`](LEARNING_LOOP.md).
- **A static website** (GitHub Pages, `docs/`) that quizzes you on the current homework
  and writes an encrypted report back.

Pedagogy lives in three files: `Deutsch_Sprachstand_Bericht.md` (level),
`Frau_Richter_Persona.md` (teacher), `Studienplan.md` (curriculum). **These are
gitignored and exist only on the local machine** — the repo is public, so personal
material never enters it; Claude reads them from disk during sessions.

## Security model, in one paragraph

The repo and the deployed Pages site are **public** — privacy comes from two things:
the three personal pedagogy files are gitignored (local-only), and all lessons,
homework, and reports are stored **AES-256-GCM encrypted**
(key derived from your password via PBKDF2-SHA256, 210 000 iterations; fresh salt/IV per
file). "Logging in" just means your password successfully decrypts a known canary value
in the manifest — no password hash exists anywhere. The GitHub token (for automatic
report commits) lives only in your browser's localStorage. **If you lose the password,
the encrypted content is gone. There is no reset. Store it in your password manager.**

## One-time setup

1. **Create the GitHub repo and push** (public — free GitHub Pages requires it; the
   gitignore keeps personal files out):
   ```bash
   cd ~/Github/german_lessons
   git init -b main
   git add .
   git commit -m "initial: learning loop + site"
   gh repo create german_lessons --public --source . --push
   ```
2. **Enable Pages via GitHub Actions**, not the legacy branch-deploy pipeline — the
   latter has been unreliable ("Deployment failed, try again later" with no real cause).
   This repo already ships `.github/workflows/pages.yml`; just switch the Pages source:
   ```bash
   gh api -X PUT repos/<owner>/german_lessons/pages -f build_type=workflow
   gh api -X POST repos/<owner>/german_lessons/pages -f "source[branch]=main" -f "source[path]=/docs"
   ```
   Every push to `main` now redeploys automatically. When bumping the action versions in
   that workflow file, check current majors first (`gh api repos/actions/checkout/releases/latest`)
   rather than trusting memory — GitHub's hosted runners moved to Node 24 and older
   action majors silently break on it.
3. **Change the password.** The seeded content is encrypted under the starter password
   **`starter-passwort`** (public knowledge — it's in this README). On the site:
   Einstellungen → *Re-encrypt everything* with old `starter-passwort` and your real
   password (needs the token from step 4 first).
4. **Generate the write-back token** (optional but recommended): GitHub → Settings →
   Developer settings → Fine-grained personal access tokens → *only this repo*,
   Permissions: **Contents: Read and write**, nothing else. Paste it into the site's
   Settings page along with `owner/repo`. It stays in that browser only. If you'd
   rather not store a token, skip this — after each homework the site offers
   **Download** buttons for the encrypted report + updated manifest, and you commit them
   yourself.
5. **First login**: open the Pages URL, enter the password, do homework 0001
   ("Kaffee bestellen — dein Weg").
6. **For an unattended/scheduled loop** (so a cron job or scheduled Claude Code task can
   read reports and write new lessons without anyone typing a password), run once:
   ```bash
   node scripts/save-password.js
   ```
   This prompts for the password (hidden input, never shown, never sent anywhere) and
   writes it to a gitignored `.env` at the repo root as `GL_PASSWORD=...`. Every script
   in `scripts/` auto-loads that file, so a scheduled prompt just runs the commands below
   with no flags. This is a deliberate, not-accidental tradeoff: the password sits in
   plaintext on your own disk. It's already gitignored (never reaches the repo), never
   passes through a chat transcript, and this repo's password isn't reused anywhere else
   — so a local-disk compromise is an acceptable risk in exchange for a fully automated
   daily lesson. Delete `.env` any time to go back to typing it per run.

## The per-session loop (what the assistant runs)

```bash
# 1. Read what happened (uses .env if you ran save-password.js, else prompts)
node scripts/read-report.js --latest

# 2. Write the next lesson + homework (plaintext, in scripts/templates/ — gitignored)
node scripts/new-lesson.js --scaffold        # creates empty templates for the next id
#    …fill them in per LEARNING_LOOP.md step 2…

# 3. Encrypt, bump manifest pointers, commit, push
node scripts/new-lesson.js --lesson scripts/templates/lesson-NNNN.md \
                           --homework scripts/templates/homework-NNNN.json --push
```

This is exactly what a scheduled Claude Code task (`/schedule`, `CronCreate`, etc.) should
be told to do each time it fires — each firing starts a fresh session with no memory of
past ones, so give it the full instruction: read the latest report, cross-reference the
three local pedagogy files, then run the commands above.

Utility CLIs: `scripts/encrypt.js <file>` and `scripts/decrypt.js <file.enc>` (password
prompted with hidden input, or `GL_PASSWORD` env var / `.env` — never stored elsewhere).

## Local preview

```bash
python3 -m http.server 4173 -d docs    # then http://localhost:4173
```

## Layout

```
docs/               GitHub Pages site (vanilla ES modules, no build step)
  data/manifest.json         pointers + non-sensitive counters/history + encrypted canary
  data/lessons|homework|reports/*.enc    AES-GCM envelopes {v, salt, iv, ct}
scripts/            Node helpers (built-ins only): lib-crypto, new-lesson, read-report, encrypt, decrypt
LEARNING_LOOP.md    the full five-step loop, precisely
```
