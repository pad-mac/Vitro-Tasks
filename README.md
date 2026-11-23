# Vitro Tasks

A task manager for Windows (and, as a first prototype, iPhone) with lists and sublists, global views, three view modes (list, board, timeline), a calendar, and a global quick add bar. Tasks live in a local SQLite file and can sync to a server you host yourself.

Every task has two independent dates:

- **Planned**: when you intend to work on it (a day, a time, or a span of days).
- **Deadline**: when it must be done. Shown in the signal colour everywhere, with a countdown.

## What is in this version

| Area | Details |
| --- | --- |
| Lists | Lists with sublists of any depth. A parent list shows the tasks of all its sublists. Sections inside a list. Each list can be hidden from All, from Today / Next 7 Days, and from the calendar, and takes one of 15 colours or any custom one (right-click the list). Drag lists in the sidebar into any order (on the middle of another list, a list becomes its sublist). The sidebar is resizable by dragging its edge. |
| Global views | All, Today, Next 7 Days, Deadlines, Inbox, Completed. Settings → Sidebar chooses which of them the sidebar shows. |
| View modes | List, Board and Timeline for every list and global view, each with its own grouping (section, list, planned date, deadline, priority) and sorting (date, deadline, date & deadline — whichever of the two comes first —, priority, title, created, custom). |
| Board | Columns follow the grouping; inside each column, tasks are sub-grouped by the sort field. Dragging a card to another column changes that field. |
| Order | Drag tasks into any order, in lists and on boards, whatever the sort. With the sort "Custom" this sets the tasks' own order; with any other sort the view remembers your order on top of it, and the sort menu offers "Restore default order". Dropping into another group changes what the group stands for (section, date, priority, list). |
| Timeline | Day, week and month zoom. Drag a bar to move it, drag its right edge to change the end, drag the diamond to move the deadline. |
| Calendar | Month, week and multi-week (2 to 6 weeks, set in the view menu). Drag across days (or across hours in the week view) to create a task with that range, drag entries to reschedule, drag the lower edge of a timed entry to change its duration, and the left or right edge of an all-day entry (one day or several) to change its first or last day. Scrolling glides through weeks (month view) or days (week view, horizontal scroll) and settles on a whole week or day. Deadlines appear as outlined entries. In the week view, long titles fade out at the end, or wrap (Options → Wrap Titles in Week View); drop an entry on a day's date to make it an all-day entry of that day. One-day entries with a time show only a bar and text in the list colour. In the week view, days with a deadline get a frame around their date. |
| Repeats | Next to "Add time" in every date picker (editor, right-click menu, the phone's add sheet): Daily, Weekly (on the date's weekday), Monthly (on its day), Yearly, Every weekday, or Custom — by due date or by completion date, every N days / weeks / months / years, on chosen weekdays, on days of the month (or the last day), on the nth or last weekday of a month, in a chosen month, ending never, on a date or after N times. Completing a repeating task moves it on to its next date (after today if it was overdue; missed days are not owed) and keeps a completed copy of the done occurrence, with its subtasks; the next occurrence starts with its subtasks open. Undo takes both back; Won't do skips one occurrence the same way. A task shows once everywhere, with a small ↻ mark beside its date; only the calendar also shows its later occurrences, lighter, and clicking one opens the task. Moving the task moves the series (a rule on the date's own weekday or day follows the date). |
| Tasks | Priority (flag), hard deadline (target symbol, with days left), notes, subtasks, pinning, completion, won't do. Links and `[markdown](links)` in titles and notes are clickable. Each view has a switch next to the sort button that chooses editing in a popup or in the side pane. A completed task is struck through for a moment, then goes; an Undo button stays at the bottom left until you change the view. With details hidden, a small mark shows which tasks have a description. Tasks with subtasks have an arrow at the end of their row (list and board) that folds them away, and a button at the top of the list and board folds or unfolds all of them; the fold is remembered on each device. In Completed, tasks start folded. |
| Subtasks | In the editor, tap a subtask to edit its title in place; Enter opens a new line right under it (on the last line, or on an empty one, it goes to the add line), and Backspace on an empty title removes it. The arrow at the end opens it on its own. With details shown, a subtask's description is previewed under its title. |
| Select | View menu → Select (lists and boards): tap tasks, or a group's circle, to select them; Select All in the header. The bar at the bottom sets a date, moves to a list or a section, deletes (tap twice), and under ··· sets priority, completes, won't do, pins, sets the deadline to today, duplicates. Escape or the ✓ leaves. |
| Right-click | Own menus for tasks (date with a full picker and a Start / End switch for spans, deadline, priority, subtask, pin, won't do, move, duplicate, delete), for lists, and for the Tasks/Calendar buttons in the title bar. |
| Window | Own title bar with the Tasks/Calendar switch, sync, settings and the window buttons. Right-click Tasks or Calendar to open that view in its own frameless window (drag it by its top area, close it with Alt+F4 or right-click on the top area). Works down to 300 px wide: the lists become a drawer, the board shows one lane, the side pane fills the window. |
| Updates | The app checks the releases of this repository and installs a newer version on request (Settings → Updates, or the button in the title bar). |
| Quick add | A small bar opened from anywhere with `Ctrl+Space` (changeable in Settings). `Enter` adds the task; `Ctrl+Enter` adds it and opens it in the app, inside the list (or Inbox) it went to. |
| Import / export | Settings → Data. Export writes every list, section, task and view setting to one CSV file that can be imported again. Import also reads a TickTick backup CSV (see below). |
| Sync | Optional, with one or several servers (each with its own name, say Work and Private). Each server keeps its own lists; the views show the lists of every server that is on, together, and a small mark in the sidebar says which server a list is on. Switch a server off or on in the title bar (or in Settings) to hide or show its lists. New lists and Inbox tasks go to the default server; a task or list moved onto another server's list goes over to that server (right-click a list to move it). Local first, last write wins per task. |

Drag a task onto a list in the sidebar to move it there.

### Quick add syntax

Works in the quick add bar and in every "Add task" field.

| You type | Meaning |
| --- | --- |
| `today`, `tomorrow`, `fri`, `24.12.`, `2026-12-24`, `in 3 days` | planned date |
| `14:30` | planned time |
| `^fri`, `^24.12.` | deadline |
| `daily`, `weekly`, `every day`, `every week`, `every other week`, `every second day`, `every 3 months`, `every mon and thu`, `every 2 weeks on mon, wed`, `every weekday`, `every weekend`, `every 15th`, `every first monday`, `every last friday` | repeat (the task starts on the first day the rule allows, or on a typed date); typing `every ` suggests phrases |
| `täglich`, `wöchentlich`, `jeden Tag`, `jeden Montag und Donnerstag`, `jede zweite Woche`, `alle 3 Monate`, `werktags`, `montags`, `jeden 15.` | the same in German (`jeden ` and `alle 2` suggest phrases) |
| `!low`, `!med`, `!high` (or `!1` `!2` `!3`) | priority |
| `#research` | list; typing `#` shows matching lists, pick one with the arrow keys and `Enter` or `Tab` |

Example: `Draft chapter wed ^30.11. !high #research` · `Team call every 2 weeks on mon 10:00 #work`

### Keys

`Ctrl+Tab` switch Tasks / Calendar · `1` Tasks · `2` Calendar · `A` add task · `W` / `M` week / month (or multi-week, if that was used last) · `T` today in the calendar · `S` sidebar · `E` popup / side pane editing · `Esc` close

All of them can be changed under Settings → Shortcuts. Single-key shortcuts do nothing while you are typing.

Selected things take the plain colours of the theme (no highlight colour): a picked date gets an empty ring, switches are a thin outline with a dot.

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
| Repeat | Repeat rule on open tasks (as TickTick writes them: `FREQ=WEEKLY;INTERVAL=1;BYDAY=TU`, `UNTIL`, `COUNT`) |

Reminders and other tags are not carried over; the import tells you how many there were. Importing the same backup again only adds what is new — and gives tasks from an earlier import (before repeats) their repeat rule.

## iPhone (prototype)

Each release also has `VitroTasks.ipa`, an unsigned build for sideloading with [SideStore](https://sidestore.io) (or AltStore), which signs it with your own Apple ID.

- To get updates in SideStore, add this source once: `https://github.com/pad-mac/Vitro-Tasks/releases/latest/download/vitro-tasks.altsource.json`
- Or download the `.ipa` from the release and open it with SideStore.

The bar at the bottom (Tasks, Calendar and the add button) are native iOS parts in Liquid Glass (iOS 26; a blurred bar on older versions); the screens themselves are the same web UI as on Windows. Holding a task lifts it and opens its menu (quick dates, priorities, pin, subtask, move, deadline, won't do, duplicate, delete). With the finger still down, slide onto the menu and let go on an entry to pick it (a haptic tick marks each one); move any other way, or slide off the menu again, and the task is dragged instead, with a line where it lands. After letting go the menu stays: tap an entry, or press the lifted task and move it to drag it. Where the menu needs the task moved aside, it waits until the finger rests (moving first drags). The keyboard has no bar with arrows and Done above it, follows the app's theme, and the app's sheets sit flush on it. A task opens in a sheet (the date on top, list, deadline, priority and more in a row at the bottom; while writing, a swipe down on that row puts the keyboard away); title, description and subtasks scroll as one column (as in TickTick) and the line you write in stays above the keyboard; leaving the app while writing ends the writing (a tap starts it again); in full screen, hold a subtask for its menu or to drag it into another place, and a subtask opened from there opens full screen too; pull it up to edit full screen, pull it down to close it (from full screen, a short pull goes back to the sheet, a long one closes it). The add button opens a sheet that rises once the keyboard is there, over the page (the page under it, the calendar too, keeps its size), with buttons for date, deadline, priority and list (priority and list open as a small menu with the keyboard still up; the quick add syntax below works too); pull it up, or tap the expand button, to go on in the full editor. Swiping in from the left edge opens the lists (in the calendar too); Settings are at the bottom of the lists, and their page has a round back button at the bottom left (or swipe in from the left edge to go back). The month view scrolls freely and settles on a week; tap a day and the view splits: the week stays at the top at month height and the day's tasks fill the rest (swipe up or down, or tap outside the week, to close it). Hold a day to add a task on it, or hold and move across days for a task spanning them. The week view pages by swiping. Things react with a grey highlight as soon as a finger rests on them (lines in the editor only when held: a tap writes in them). Data stays on the phone until you enter your sync server under Settings. Plain `http://` server addresses are allowed. With a free Apple ID, SideStore has to refresh the app every 7 days.

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

It listens on `127.0.0.1:8787`. Put a reverse proxy with TLS in front of it, then add it under Settings → Sync servers in the app (a name, the URL and the token). `GET /v1/health` answers without a token. For separate sets of lists (work and private, say), run one server per set and add each to the app; the servers need no change for that (which server a row lives on is only recorded on the device). The first server added takes the lists already on the device; removing one of several takes its lists off the device (they stay on the server), removing the only one keeps them on the device.

How it works: every row carries `updated_at` and a `deleted` flag. The app sends its changed rows and its cursor to `POST /v1/sync`; the server keeps the newer version of each row, numbers every accepted change, and returns everything after the cursor. The schema for both sides is generated from `src/shared/schema.ts`, which is also the reference for a future mobile client.

The token is a single shared secret, so one server serves one person (or one shared set of lists).

Updating the server: `cd /opt/vitro-tasks && git pull && cd server && docker compose up -d --build` (the schema upgrades itself on start). Repeat rules (since 0.11) need a server from 0.11 on; an older one still syncs everything else, the rules stay on the device that set them, and Settings → Sync servers says to update it. After the update they go up with the next sync. From 0.11 on the server leaves out fields it does not know instead of refusing them, so a newer app never stops syncing with it.

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

Layout: `src/` UI and data layer · `src/shared/schema.ts` data model · `src-tauri/` app shell (windows, tray, global shortcut on desktop; `tauri.ios.conf.json` and `Info.ios.plist` for iOS) · `plugins/native-ui/` the native iOS parts (Swift: glass bar, haptics, keyboard; the page talks to it through `src/lib/native.ts`) · `server/` sync server.

The iPhone build runs in `.github/workflows/ios.yml` on a macOS 26 runner (Xcode 26, for Liquid Glass; `tauri ios init`, then `tauri ios build --no-sign`); push a branch named `ios-…` to build only that.

## Not in this version

Reminders, tags, focus timer, skipping a single later occurrence from the calendar, and accounts for more than one person on a server. On the phone: the timeline is not adapted yet, and tasks cannot be dragged onto lists in the drawer (use Move to).
