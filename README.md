# SocioStudy — Classroom Sociometric Study

A self-contained tool for running pedagogical sociometric studies of school classes
(children ~6–12). A teacher configures the class and the nomination questions, students
answer through a QR-scanned questionnaire on their own phone, and the app computes
sociometric indexes, status categories, charts and an interactive sociogram.

The teacher app runs entirely in the browser. Collecting answers by QR code needs the small
Node server included here (`server.js`) — that's what generates a real, working link for
each class and keeps students confined to just their own questionnaire.

## Quick start (recommended: a school/office computer on the Wi-Fi)

Requires [Node.js](https://nodejs.org) 18 or newer — nothing else to install.

```
npm start
```

That's it. It prints something like:

```
SocioStudy 1.0.0 is running.
  Teacher app:   http://localhost:3000/
  On your network (phones on the same Wi-Fi): http://192.168.1.42:3000
  Data folder:   ./data  (sessions are deleted after 30 days without activity)
```

- Open the **Teacher app** address on the computer running it.
- Students' phones must be on the **same Wi-Fi network** — that's the network address it
  printed. If phones can't load the page, the school Wi-Fi may isolate devices from each
  other ("client/AP isolation") — ask IT to disable that for this device, or use a phone
  hotspot from the teacher's own phone instead.
- Leave the terminal window open while collecting answers; closing it stops the server. If it's
  a shared computer, consider a password (see below) so students who find the address can't open
  the teacher app.

To stop it, press `Ctrl+C` in the terminal.

### Restarting it later

Answers and class setups are saved to disk in the `data/` folder, so stopping and restarting
the server does **not** lose anything already collected. QR links keep working across a
restart as long as `data/` is intact and no more than 30 days have passed.

### Protecting the teacher app with a password

By default, anyone who can reach the computer's address can open the full teacher app (see
every child's answers, delete data, etc.) — only the QR code itself is scoped to one
questionnaire. On a shared or public computer, set a password:

```
TEACHER_PASSWORD=choose-a-password npm start
```

A login page (not a browser popup) will ask for it the first time someone opens the teacher
app. Students scanning the QR code are never asked for this — the student page has no access
to the teacher app at all.

### Running it every day without retyping the command

- **Windows:** right-click Desktop → New → Shortcut → target `node server.js` with "Start in"
  set to this folder; or make a `.bat` file with `node server.js` in it and double-click it.
- **macOS:** save a file `start.command` containing `cd "$(dirname "$0")" && node server.js`,
  then `chmod +x start.command` once in Terminal; after that, double-clicking it starts the
  server.

## Other ways to run it

- **Offline, single computer, no QR code:** open `index.html` directly in a browser. Everything
  works except the "Questionnaire & QR" tab, which will say the server isn't reachable. You can
  still add students manually on the Data tab or import a responses file.
- **A cloud host (Render, Railway, Fly.io, a VPS, etc.):** deploy this folder like any Node app
  (`npm start`, or the platform's Node buildpack). Set `PUBLIC_URL` to the address the host gives
  you, and `TEACHER_PASSWORD` — anyone with the address can otherwise reach the teacher app. This
  is worth doing only if students need to answer from outside the school network; for a single
  classroom, the local option above is simpler and needs no account.

## What the server actually stores

Each class you create a QR code for becomes one file in `data/`, containing that class's
roster, questions, and the answers as they come in — nothing else, and nothing about other
classes. Deleting the QR code (or "Delete all data" on the Data tab) deletes that file
immediately. A class left untouched for 30 days (configurable via `SESSION_TTL_DAYS`) is
deleted automatically. The admin key that lets the teacher's browser manage a class never
leaves that browser and is never included in exports.

## Languages

The whole interface is available in **Bulgarian (default)** and **English**, toggled with the
EN/BG button in the header; the choice is remembered. The student questionnaire follows the
language chosen when the QR code was created. All strings live in `i18n.js`.

## One response per student

Each student can answer once — enforced by the server, not just the browser, so a student
can't submit twice by refreshing or using a different device. After submitting, the student's
name appears grayed out. To let a child re-answer (e.g. after a mistake), the teacher deletes
that student's response on the **Data** tab or the **Questionnaire & QR** tab.

## Privacy notes for teachers

- Get parental consent and follow your school's data-protection policy before collecting
  nominations from children, especially negative ones.
- Answers include real names by default. Turn on "Hide names in exports" (Analysis or Data tab)
  to export with anonymous codes instead.
- Nothing here is a clinical or diagnostic tool. Status labels (Popular, Neglected, etc.) are a
  common classroom-sociometry framework (Coie, Dodge & Copeland), meant to support ordinary
  educational practice — not a mental-health assessment.

## Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Network interface to bind |
| `DATA_DIR` | `./data` | Where class sessions are stored |
| `SESSION_TTL_DAYS` | `30` | Auto-delete a class after this many idle days |
| `TEACHER_PASSWORD` | *(none)* | Password for the teacher app (shown as a login page) |
| `PUBLIC_URL` | *(none)* | Public address to suggest, if hosted online |
| `TRUST_PROXY` | *(none)* | Set to `1` only if behind a reverse proxy |

## No backend, no build step (for the teacher app itself)

The teacher app is plain HTML, CSS and vanilla JavaScript — no framework, no bundler. The only
build-like step is `npm start`, which runs `server.js` as-is.

## Deploying to Render (hosted online, no computer to keep running)

This is the option if students need to answer from outside one Wi-Fi network, or you don't
want to keep a computer on. It's free to start and takes about 10 minutes the first time.

1. **Put this project in a GitHub repository.**
   - Go to [github.com/new](https://github.com/new), create a repository (any name, e.g.
     `sociostudy`), and keep it **private** — a public repo is fine too, but the code contains
     no secrets either way (the teacher password is set separately, not in the code).
   - Upload this folder's contents to it. Easiest way with no command line: on the new repo's
     page, click "uploading an existing file" and drag in everything except the `data/` folder
     (it shouldn't exist yet anyway — that's only created once the server runs).

2. **Create a Render account** at [render.com](https://render.com) (free, no card needed for
   this).

3. **New → Blueprint**, and point it at your GitHub repo. Render will read the `render.yaml`
   file already included here and set up the service and health check automatically.

4. When it asks for the `TEACHER_PASSWORD` environment variable, **set one** — do not leave it
   blank. On a public host, without a password anyone with the URL can open the full teacher
   app and see every class's answers. (On a home/school Wi-Fi this wasn't a risk since only
   people on that network could reach it; a public URL is reachable by anyone.)

5. Click deploy. After the build finishes (1–2 minutes), Render gives you a URL like
   `https://sociostudy-xyz.onrender.com` — that's your permanent teacher app address. Open it,
   log in with the password you set, and use it exactly as described above. The QR codes it
   generates will use that same address, so students can scan them from anywhere with internet,
   not just the same Wi-Fi.

6. **Free tier note:** Render's free web services sleep after 15 minutes of no traffic and take
   ~30–50 seconds to wake back up on the next request. That means the first person to open the
   app (or scan a QR code) after a quiet period will see a short delay before it loads — normal,
   not a bug. If that's a problem for live classroom use, Render's paid "Starter" tier ($7/mo)
   keeps it always on.

7. **Data does not persist on the free plan.** Render's free tier has no persistent disk, so
   the `data/` folder — every class's roster, questions and collected answers — is wiped
   whenever the service restarts. That happens on its own after 15 minutes idle, and also on
   every redeploy or host maintenance. Any QR codes already handed out stop working after that,
   and answers already collected are gone. Export anything you need to keep (Data tab → Export)
   before a restart is likely, and treat this deployment as suitable for testing or short
   single-session use rather than data you can't afford to lose.

   If you later need answers to survive restarts, upgrade the service to a paid plan in the
   Render dashboard and add a `disk:` block back into `render.yaml` (the earlier version of this
   file had one) — persistent disks aren't available on free services.
