# Vitro Tasks

A task manager for Windows (and, as a first prototype, iPhone) with lists and sublists, global views, three view modes (list, board, timeline), a calendar, and a global quick add bar. Tasks live in a local SQLite file and can sync to a server you host yourself.

Every task has two independent dates:

- **Planned**: when you intend to work on it (a day, a time, or a span of days).
- **Deadline**: when it must be done. Shown in the signal colour everywhere, with a countdown.

## What is in this version

| Area | Details |
| --- | --- |
| Lists | Lists with sublists of any depth. A parent list shows the tasks of all its sublists. Sections inside a list. Each list can be hidden from All, from Today / Next 7 Days, and from the calendar (right-click the list). The sidebar is resizable by dragging its edge. |
| Global views | All, Today, Next 7 Days, Deadlines, Inbox, Completed. |
| View modes | List, Board and Timeline for every list and global view, each with its own grouping (section, list, planned date, deadline, priority) and sorting. |
| Board | Columns follow the grouping; inside each column, tasks are sub-grouped by the sort field. Dragging a card to another column changes that field. |
| Order | Drag tasks into any order, in lists and on boards, whatever the sort. With the sort "Custom" this sets the tasks' own order; with any other sort the view remembers your order on top of it, and the sort menu offers "Restore default order". Dropping into another group changes what the group stands for (section, date, priority, list). |
| Timeline | Day, week and month zoom. Drag a bar to move it, drag its right edge to change the end, drag the diamond to move the deadline. |
| Calendar | Month, week and multi-week (2 to 6 weeks, set in the view menu). Drag across days (or across hours in the week view) to create a task with that range, drag entries to reschedule, drag the lower edge of a timed entry to change its duration, and the left or right edge of an all-day entry (one day or several) to change its first or last day. Scroll to move through weeks (month view) or days (week view, horizontal scroll). Deadlines appear as outlined entries. One-day entries with a time show only a bar and text in the list colour. In the week view, days with a deadline get a frame around their date. |
| Tasks | Priority (flag), hard deadline (target symbol, with days left), notes, subtasks, pinning, completion, won't do. Links and `[markdown](links)` in titles and notes are clickable. Each view has a switch next to the sort button that chooses editing in a popup or in the side pane. |
| Right-click | Own menus for tasks (date with a full picker and a Start / End switch for spans, deadline, priority, subtask, pin, won't do, move, duplicate, delete), for lists, and for the Tasks/Calendar buttons in the title bar. |
| Window | Own title bar with the Tasks/Calendar switch, sync, settings and the window buttons. Right-click Tasks or Calendar to open that view in its own frameless window (drag it by its top area, close it with Alt+F4 or right-click on the top area). Works down to 300 px wide: the lists become a drawer, the board shows one lane, the side pane fills the window. |
| Updates | The app checks the releases of this repository and installs a newer version on request (Settings → Updates, or the button in the title bar). |
| Quick add | A small bar opened from anywhere with `Ctrl+Space` (changeable in Settings). `Enter` adds the task; `Ctrl+Enter` adds it and opens it in the app, inside the list (or Inbox) it went to. |
| Import / export | Settings → Data. Export writes every list, section, task and view setting to one CSV file that can be imported again. Import also reads a TickTick backup CSV (see below). |
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
| `#research` | list; typing `#` shows matching lists, pick one with the arrow keys and `Enter` or `Tab` |

Example: `Draft chapter wed ^30.11. !high #research`

### Keys

`Ctrl+Tab` switch Tasks / Calendar · `1` Tasks · `2` Calendar · `A` add task · `W` / `M` week / month (or multi-week, if that was used last) · `T` today in the calendar · `S` sidebar · `E` popup / side pane editing · `Esc` close

All of them can be changed under Settings → Shortcuts. Single-key shortcuts do nothing while you are typing.

Settings → Appearance also sets the highlight colour (silver by default), shown as a quiet pearl finish with a thin iridescent edge.

### Importing from TickTick

In TickTick: Settings → Account → Generate backup. In Vitro Tasks: Settings → Data → Import from TickTick.

| TickTick | Vitro Tasks |
| --- | --- |
| Folder / list | List / sublist (an existing list with the same name is reused) |
| Inbox | Inbox |
| Kanban column | Section |
| Checklist items | Subtasks (done items stay done) |
| Subtasks | Subtasks |
| Start / due date, all-day or timed | Planned date, time or span of days |
| Tag `deadline` | Deadline on the same date (the planned date stays) |
| Priority low / medium / high | Priority low / medium / high |
| Completed, won't do | Completed, won't do (completed tasks can be left out) |

Repeat rules, reminders and other tags are not carried over; the import tells you how many there were. Importing the same backup again only adds what is new.

## iPhone (prototype)

Each release also has `VitroTasks.ipa`, an unsigned build for sideloading with [SideStore](https://sidestore.io) (or AltStore), which signs it with your own Apple ID.

- To get updates in SideStore, add this source once: `https://github.com/pad-mac/Vitro-Tasks/releases/latest/download/vitro-tasks.altsource.json`
- Or download the `.ipa` from the release and open it with SideStore.

The bar at the bottom (Tasks, Calendar, Settings, and the add button) and the task menu are native iOS parts in Liquid Glass (iOS 26; a blurred bar on older versions); the screens themselves are the same web UI as on Windows. Holding a task lifts it out of the list and opens the system menu below it (pin, date, priority, subtask, move, deadline, won't do, duplicate, delete); moving the finger instead drags it to a new place. The keyboard has no bar with arrows and Done above it, and it follows the app's theme. A task opens in a sheet; pull it up to edit full screen, pull it down to close it. Swiping in from the left edge opens the lists. The month view scrolls freely and settles on a week; tap a day and the view splits: the week stays at the top at month height and the day's tasks fill the rest (swipe down above the list or tap the day again to close it). Hold a day to add a task on it, or hold and move across days for a task spanning them. The week view pages by swiping. Data stays on the phone until you enter your sync server under Settings. Plain `http://` server addresses are allowed. With a free Apple ID, SideStore has to refresh the app every 7 days.

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

Set the new version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` and push to `main`. The Build workflow publishes a release `vX.Y.Z` with the installer whenever that version has no release yet; installed apps pick the update up from there. The iPhone build and its SideStore source are added to the same release.

Updates are signed. The workflow needs the repository secret `TAURI_SIGNING_PRIVATE_KEY` (the private key belonging to the public key in `src-tauri/tauri.conf.json`). Without it the release is still published, but without `latest.json`, so installed apps will not see it. After adding the secret, run the workflow again (Actions → Build → Run workflow) to add the feed to the current release.

## Development

```
npm install
npm run dev          # UI in the browser at http://localhost:1420 (add ?demo for sample data)
npm run tauri dev    # desktop app
npm test             # unit tests; sync tests also run when TEST_DATABASE_URL points at a Postgres database
npm run tauri build  # Windows installer (on Windows)
```

Layout: `src/` UI and data layer · `src/shared/schema.ts` data model · `src-tauri/` app shell (windows, tray, global shortcut on desktop; `tauri.ios.conf.json` and `Info.ios.plist` for iOS) · `plugins/native-ui/` the native iOS parts (Swift: glass bar, task menu, keyboard; the page talks to it through `src/lib/native.ts`) · `server/` sync server.

The iPhone build runs in `.github/workflows/ios.yml` on a macOS 26 runner (Xcode 26, for Liquid Glass; `tauri ios init`, then `tauri ios build --no-sign`); push a branch named `ios-…` to build only that.

## Not in this version

Recurring tasks, reminders, tags, focus timer, and accounts for more than one person on a server. On the phone: the timeline is not adapted yet, and tasks cannot be dragged onto lists in the drawer (use Move to).
