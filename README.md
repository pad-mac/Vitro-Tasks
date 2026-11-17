# Vitro Tasks

A task manager for Windows with lists and sublists, global views, three view modes (list, board, timeline), a calendar, and a global quick add bar. Tasks live in a local SQLite file and can sync to a server you host yourself.

Every task has two independent dates:

- **Planned**: when you intend to work on it (a day, a time, or a span of days).
- **Deadline**: when it must be done. Shown in the signal colour everywhere, with a countdown.

## What is in this version

| Area | Details |
| --- | --- |
| Lists | Lists with sublists of any depth. A parent list shows the tasks of all its sublists. Sections inside a list. |
| Global views | All, Today, Next 7 Days, Deadlines, Inbox, Completed. |
| View modes | List, Board and Timeline for every list and global view, each with its own grouping (section, list, planned date, deadline, priority) and sorting. |
| Board | Columns follow the grouping; inside each column, tasks are sub-grouped by the sort field. Dragging a card to another column changes that field. |
| Timeline | Day, week and month zoom. Drag a bar to move it, drag its right edge to change the end, drag the diamond to move the deadline. |
| Calendar | Month and week. Drag across days (or across hours in the week view) to create a task with that range, drag entries to reschedule, drag the lower edge of a timed entry to change its duration. Scroll to move through weeks (month view) or days (week view, horizontal scroll). Deadlines appear as outlined entries. |
| Tasks | Priority, notes, subtasks, pinning, completion, won't do. Edited in the side pane (list view) or in a popup next to the task (board, timeline, calendar). |
| Right-click | Own menus for tasks (date, deadline, priority, subtask, pin, won't do, move, duplicate, delete) and for lists. |
| Window | Own title bar with the Tasks/Calendar switch, sync, settings and the window buttons. |
| Updates | The app checks the releases of this repository and installs a newer version on request (Settings → Updates, or the button in the title bar). |
| Quick add | A small bar opened from anywhere with `Ctrl+Space` (changeable in Settings). |
| Sync | Optional. Local first, last write wins per task. |

Drag a task onto a list in the sidebar to move it there.

### Quick add syntax

Works in the quick add bar and in every "Add task" field.

| You type | Meaning |
| --- | --- |
| `today`, `tomorrow`, `fri`, `24.12.`, `2026-12-24`, `in 3 days` | planned date |
| `14:30` | planned time |
| `^fri`, `^24.12.` | deadline |
| `!low`, `!med`, `!high` (or `!1` `!2` `!3`) | priority |
| `#research` | list, matched by the start of its name |

Example: `Draft chapter wed ^30.11. !high #research`

### Keys

`n` new task · `1` tasks · `2` calendar · `Esc` close the detail pane

## Install

Download `VitroTasks-setup.exe` from the latest entry under **Releases**. `VitroTasks-portable.exe` runs without installing, but only the installed app can update itself. The app uses the WebView2 runtime, which Windows 11 ships with; on Windows 10 the installer fetches it if it is missing.

Closing the window keeps the app in the tray so the shortcut keeps working. Quit from the tray icon.

The database is `%APPDATA%\app.vitro.tasks\vitro.db`.

## Sync server

The server is one small Node process plus Postgres. On your server:

```
cd server
VITRO_TOKEN=<long random secret> POSTGRES_PASSWORD=<another secret> docker compose up -d
```

It listens on `127.0.0.1:8787`. Put a reverse proxy with TLS in front of it, then enter the URL and the token under Settings → Sync server in the app. `GET /v1/health` answers without a token.

How it works: every row carries `updated_at` and a `deleted` flag. The app sends its changed rows and its cursor to `POST /v1/sync`; the server keeps the newer version of each row, numbers every accepted change, and returns everything after the cursor. The schema for both sides is generated from `src/shared/schema.ts`, which is also the reference for a future mobile client.

The token is a single shared secret, so one server serves one person.

## Releasing

Set the new version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` and push to `main`. The Build workflow publishes a release `vX.Y.Z` with the installer whenever that version has no release yet; installed apps pick the update up from there.

Updates are signed. The workflow needs the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the private key belonging to the public key in `src-tauri/tauri.conf.json`). Without it the release is still published, but without `latest.json`, so installed apps will not see it. After adding the secret, run the workflow again (Actions → Build → Run workflow) to add the feed to the current release.

## Development

```
npm install
npm run dev          # UI in the browser at http://localhost:1420 (add ?demo for sample data)
npm run tauri dev    # desktop app
npm test             # unit tests; sync tests also run when TEST_DATABASE_URL points at a Postgres database
npm run tauri build  # Windows installer (on Windows)
```

Layout: `src/` UI and data layer · `src/shared/schema.ts` data model · `src-tauri/` desktop shell (windows, tray, global shortcut) · `server/` sync server.

## Not in this version

Recurring tasks, reminders, tags, focus timer, manual drag ordering inside a list, import from other apps, and accounts for more than one person on a server.
