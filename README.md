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
2. **Enable Pages**: repo → Settings → Pages → Source: *Deploy from a branch* →
   Branch `main`, folder `/docs`. Wait ~1 minute for the first deploy.
3. **Change the password.** The seeded content is encrypted under the starter password
   **`starter-passwort`** (public knowledge — it's in this README). On the site:
   Einstellungen → *Alles neu verschlüsseln* with old `starter-passwort` and your real
   password (needs the token from step 4 first), or locally:
   ```bash
   # decrypt + re-encrypt each file under the new password
   GL_PASSWORD=starter-passwort node scripts/decrypt.js docs/data/homework/homework-0001.json.enc /tmp/hw.json
   GL_PASSWORD=<new>            node scripts/encrypt.js /tmp/hw.json docs/data/homework/homework-0001.json.enc
   # …same for docs/data/lessons/lesson-0001.md.enc, then rebuild the canary via settings page
   ```
   (The settings page route is easier — it also rotates the canary.)
4. **Generate the write-back token** (optional but recommended): GitHub → Settings →
   Developer settings → Fine-grained personal access tokens → *only this repo*,
   Permissions: **Contents: Read and write**, nothing else. Paste it into the site's
   Einstellungen page along with `owner/repo`. It stays in that browser only. If you'd
   rather not store a token, skip this — after each homework the site offers
   **Download** buttons for the encrypted report + updated manifest, and you commit them
   yourself.
5. **First login**: open the Pages URL, enter the password, do homework 0001
   ("Kaffee bestellen — dein Weg").

## The per-session loop (what the assistant runs)

```bash
# 1. Read what happened
GL_PASSWORD=… node scripts/read-report.js --latest

# 2. Write the next lesson + homework (plaintext, in scripts/templates/ — gitignored)
node scripts/new-lesson.js --scaffold        # creates empty templates for the next id
#    …fill them in per LEARNING_LOOP.md step 2…

# 3. Encrypt, bump manifest pointers, commit, push
node scripts/new-lesson.js --lesson scripts/templates/lesson-NNNN.md \
                           --homework scripts/templates/homework-NNNN.json --push
```

Utility CLIs: `scripts/encrypt.js <file>` and `scripts/decrypt.js <file.enc>` (password
prompted with hidden input, or `GL_PASSWORD` env var — never stored).

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
