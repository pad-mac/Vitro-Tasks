# Vitro Tasks

A task manager for Windows (and, as a first prototype, iPhone) with lists and sublists, global views, three view modes (list, board, timeline), a calendar, and a global quick add bar. Tasks live in a local SQLite file and can sync to a server you host yourself.

Every task has two independent dates:

- **Planned**: when you intend to work on it (a day, a time, or a span of days).
- **Deadline**: when it must be done. Shown in the signal colour everywhere, with a countdown.

## What is in this version

| Area | Details |
| --- | --- |
| Lists | Lists with sublists of any depth. A parent list shows the tasks of all its sublists. Sections inside a list. Each list can be hidden from All, from Today / Next 7 Days, and from the calendar, and takes a colour from five palettes or any custom one (right-click the list; the row shows the default palette, the last circle opens all of them). New lists take their colours from the default palette, chosen under Settings → Appearance: Vivid (Apple's system colours, 2025), Crisp (Radix Colors, step 9), Bright and Deep (Tailwind 500 and 600), Soft (the earlier, quieter set). Drag lists in the sidebar into any order (on the middle of another list, a list becomes its sublist). The sidebar is resizable by dragging its edge. |
| Global views | All, Today, Next 7 Days, This Week, Deadlines, Inbox, Completed. Settings → Sidebar chooses which of them the sidebar shows. |
| This Week | A horizon instead of a day: a task set to This Week (the top of the date picker, the right-click menu, the phone's hold menu) belongs to the week from Monday to Sunday, without blocking a day in Today or the calendar. It is its own date setting: a day replaces it, and it replaces a day. The This Week view shows these tasks (lists hidden from Today / Next 7 Days stay hidden there too); once their week has passed they show as overdue, labelled "Last week", "2 weeks ago" and so on. Grouped by date, every view has a This Week group (on a board, a card dropped there gets it). Syncs like every field. |
| View modes | List, Board and Timeline for every list and global view, each with its own grouping (section, list, planned date, deadline, priority) and sorting (date, deadline, date & deadline — whichever of the two comes first —, priority, title, created, custom). |
| Board | Columns follow the grouping; inside each column, tasks are sub-grouped by the sort field. A card's date, deadline and list wrap onto more lines when they do not fit. Dragging a card to another column changes that field. |
| Order | Drag tasks into any order, in lists and on boards, whatever the sort. With the sort "Custom" this sets the tasks' own order; with any other sort the view remembers your order on top of it, and the sort menu offers "Restore default order". Dropping into another group changes what the group stands for (section, date, priority, list). |
| Timeline | Day, week and month zoom. Drag a bar to move it, drag its right edge to change the end, drag the diamond to move the deadline. |
| Calendar | Month, week, multi-week (2 to 6 weeks) and multi-day (1 to 6 days side by side, paging by that many), set in the view menu. Drag across days (or across hours in the week view) to create a task with that range, drag entries to reschedule, drag the lower edge of a timed entry to change its duration, and the left or right edge of an all-day entry (one day or several) to change its first or last day. Scrolling glides through weeks (month view) or days (week view, horizontal scroll) and settles on a whole week or day. Deadlines appear as outlined entries. In the week view, long titles fade out at the end, or wrap (Options → Wrap Titles in Week View); drop an entry on a day's date to make it an all-day entry of that day. One-day entries with a time show only a bar and text in the list colour. In the week view, days with a deadline get a frame around their date. Entries of days gone by fade (in the week view also today's once they are over); days of the next or previous month only grey their numbers, and a repeat's later dates look like the task itself. Within a day: tasks spanning several days first (so their bars line up), then deadlines, then tasks without a time, then timed ones by time; ties keep the tasks' position in their lists. |
| Repeats | Next to "Add time" in every date picker (editor, right-click menu, the phone's add sheet): Daily, Weekly (on the date's weekday), Monthly (on its day), Yearly, Every weekday, or Custom — by due date or by completion date, every N days / weeks / months / years, on chosen weekdays, on days of the month (or the last day), on the nth or last weekday of a month, in a chosen month, ending never, on a date or after N times. Completing a repeating task moves it on to its next date (after today if it was overdue; missed days are not owed) and keeps a completed copy of the done occurrence, with its subtasks; the next occurrence starts with its subtasks open. Undo takes both back; Won't do skips one occurrence the same way. A task shows once everywhere, with a small ↻ mark beside its date (in the calendar only on Windows: the phone's entries are too narrow for it); only the calendar also shows its later occurrences, drawn like the task itself, and clicking one opens the task. Moving the task moves the series (a rule on the date's own weekday or day follows the date). |
| Tasks | Priority (flag), hard deadline (target symbol, with days left), notes, subtasks, pinning, completion, won't do. Links and `[markdown](links)` in titles and notes are clickable. Each view has a switch next to the sort button that chooses editing in a popup or in the side pane. A completed task is struck through for a moment, then goes; an Undo button stays at the bottom left until you change the view. With details hidden, a small mark shows which tasks have a description. Tasks with subtasks have an arrow at the end of their row (list and board) that folds them away, and a button at the top of the list and board folds or unfolds all of them; the fold is remembered on each device. In Completed, tasks start folded. With Show Completed on, completed tasks sit below the open ones, the most recently completed first, whatever the sort (a custom order never moves them). |
| Subtasks | In the editor, tap a subtask to edit its title in place; Enter opens a new line right under it (on the last line, or on an empty one, it goes to the add line), and Backspace on an empty title removes it. The arrow at the end opens it on its own. With details shown, a subtask's description is previewed under its title. |
| Descriptions | Formatted as you write them. Select text in a description and a bar comes up over it (under it on the phone, clear of iOS's own menu): Text, Heading 1–3, Bulleted List, Numbered List and Quote, then bold, italic, strikethrough, underline, a link (type or paste it; select a link to change or remove it) and a place: the selection becomes a pill with a pin that opens Google Maps at that place, on the desktop and the phone (a description can hold several; the button turns a place back into text). `Ctrl+B`, `Ctrl+I`, `Ctrl+U` work too. Descriptions are kept as markdown, one line per block (`# heading`, `- item`, `1. item`, `> quote`, `**bold**`, `*italic*`, `~~struck~~`, `<u>underlined</u>`, `[label](link)`; a place is a link to a Google Maps search), so a description without formatting is the plain text it always was. The first line shows formatted in the views (with details on); the widgets show it without the markup. Links may also open apps: `zotero:`, `obsidian:`, `notion:`, `things:`, `x-devonthink-item:`, `onenote:`, `tel:`, `sms:`, `facetime:` (for example a Zotero item: `[the paper](zotero://select/items/…)`). Pasted text comes in without formatting. Clicking a link opens it while you are not writing in the description (with `Ctrl` held while you are); a place opens on any click. |
| Select | View menu → Select (lists and boards): tap tasks, or a group's circle, to select them; Select All in the header. The bar at the bottom sets a date, moves to a list or a section, deletes (tap twice), and under ··· sets priority, completes, won't do, pins, sets the deadline to today, duplicates. Escape or the ✓ leaves. |
| Right-click | Own menus for tasks (quick dates Today, Tomorrow and This Week, a full picker with a Start / End switch for spans — a span shows as one band across its days —, deadline, priority, subtask, pin, won't do, move, duplicate, delete), for lists, and for the Tasks/Calendar buttons in the title bar. |
| Split view | Right-click Tasks or Calendar in the title bar → Open … in split view: the view you are on gets the other one (or a second one of itself) beside it. Drag the line between them to share the width differently (double-click it for half and half). Tasks and Calendar each keep their own split (one each), so it stays as it was when you switch between them; the button of what is shown beside gets a light outline. A second tasks pane picks its list or view from its title; its × (or the same menu) closes the split. A second calendar has its own mode, weeks, days and wrapping. Tasks opened from the second pane always open in a popup (it has no popup / side pane switch); with the side pane on in the first pane, the side pane sits between the two. Kept per device; a window too narrow for two panes shows one, and rows in a narrow pane put their title on a line of its own. |
| Popup | The popup has a button beside its ··· menu that opens the task in the side pane instead, also where the side pane is off; the side pane closes again as soon as you click anywhere else, and the next task opens in a popup as before. |
| Window | Own title bar with the Tasks/Calendar switch, sync, settings and the window buttons. Right-click Tasks or Calendar to open that view in its own frameless window (drag it by its top area, close it with Alt+F4 or right-click on the top area). Works down to 300 px wide: the lists become a drawer, the board shows one lane, the side pane fills the window. |
| Text size | Settings → Appearance → Text size: a slider with four stops (two smaller, the original, one larger) that scales the text of the whole app, on Windows and on the phone. Kept per device. On the phone, fields you type in never go below 16 px (iOS would zoom in). |
| Trash | Deleted tasks (with the subtasks deleted with them) wait in the Trash, last deleted first, with their list and when they were deleted: Restore puts one back where it was (into the Inbox if its list is gone too), the bin deletes it forever after a second tap, Empty trash does all. A restore or a deletion syncs like any change; deleted forever, its text is cleared everywhere. The Trash is hidden from the sidebar by default: Settings → Sidebar opens any of these views by tapping its name (the switch shows or hides it). |
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
| `!low`, `!med`, `!high`, or `!1` `!2` `!3`, `!` `!!` `!!!`, `p1` `p2` `p3` | priority (low, medium, high) |
| `at Café Central`, `@home`, `at "Zum Schwarzen Kameel"` | a place: it goes into the description as a place pill. `at` counts before a capitalised word (so `look at the report` stays as it is; `at 14:30` is just the time), `@` before any word. The place runs up to the next date, time, `^`, `!` or `#`, a comma, or a joining word (`with`, `for`, `about`, `to`, `and`, `mit`, `für`, …), which goes on with the title: `Lunch at Luigi's with Anna fri 12:30`. Quotes take everything up to the closing quote. `in` is not used for places: it would catch `in 3 days`, `in the morning`, `talk in English` |
| `#research` | list; typing `#` shows matching lists, pick one with the arrow keys and `Enter` or `Tab`. On the phone the list button puts a `#` in the line and opens the list picker; typing filters it and `Enter` takes the marked (likeliest) list |

Example: `Draft chapter wed ^30.11. !high #research` · `Team call every 2 weeks on mon 10:00 #work` · `Dinner at Luigi's tomorrow 19:00`

In a view's "Add task" field only the + shows until the pointer is on it (or you write in it): then the hints.

### Keys

`Ctrl+Tab` switch Tasks / Calendar · `1` Tasks · `2` Calendar · `A` add task · `W` / `M` week / month (or multi-week, if that was used last) · `T` today in the calendar · `S` sidebar · `E` popup / side pane editing · `Esc` close

All of them can be changed under Settings → Shortcuts. Single-key shortcuts do nothing while you are typing.

Selected things take the plain colours of the theme (no highlight colour): a picked date gets an empty ring; switches have a raised knob on a recessed track, which fills with the theme's ink when on (like the primary buttons). On the desktop the sidebar's text is a quieter grey than the page's; list colours and marks there stay at full strength.

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

The whole app, the bar at the bottom included, is the same web UI as on Windows (so it can also run as a web page): the bar (Tasks and Calendar, the list bubble's button and the add button), the back button of Settings and the Settings button in the lists float as frosted bubbles (see-through, blurred). The list bubble's button opens a task list over the bottom third of the screen, above the bar, on This Week to begin with (its title switches it to any view or list); the view under it stays usable, both scroll and take taps on their own, and tasks are dragged between them: from the bubble into the view's groups or onto a calendar day (or the open day's list), and from the view or the calendar into the bubble. With the bubble open, a hold starts a drag right away; the task's menu comes once the finger rests. A repeating task keeps its date: This Week is not offered for it, and dropping it there leaves it where it was. In the calendar, with a day's list open under its week, the add button adds to that day. Holding a task lifts it and opens its menu (quick dates, priorities, pin, subtask, move, deadline, won't do, duplicate, delete). With the finger still down, slide onto the menu and let go on an entry to pick it (a haptic tick marks each one); move any other way, or slide off the menu again, and the task is dragged instead, with a line where it lands. After letting go the menu stays: tap an entry, or press the lifted task and move it to drag it. Where the menu needs the task moved aside, it waits until the finger rests (moving first drags). The keyboard has no bar with arrows and Done above it, follows the app's theme, and the app's sheets sit flush on it. A task opens in a sheet (the date on top, list, deadline, priority and more in a row at the bottom; while writing, a swipe down on that row puts the keyboard away); title, description and subtasks scroll as one column (as in TickTick) and the line you write in stays above the keyboard; leaving the app while writing ends the writing (a tap starts it again); in full screen, hold a subtask for its menu or to drag it into another place, and a subtask opened from there opens full screen too; pull it up to edit full screen, pull it down to close it (from full screen, a short pull goes back to the sheet, a long one closes it). The add button opens the quick add: a closed bubble floating just above the keyboard (its corners match the keyboard's; the page around it is dimmed and keeps its size), with the line and the send button at the top and buttons for date, deadline, priority and list below (priority opens a small menu with the keyboard still up; list puts a `#` in the line and opens the list picker, which typing filters; the quick add syntax below works too); pull it up, or tap the expand button, to go on in the full editor. Swiping in from the left edge opens the lists (in the calendar too, and on a board without moving the board); Settings are at the bottom of the lists, and their page has a round back button at the bottom left (or swipe in from the left edge to go back). The month view scrolls freely and settles on a week; tap a day and the view splits: the week stays at the top at month height and the day's tasks fill the rest (swipe up or down, or tap outside the week, to close it). Hold a day to add a task on it, or hold and move across days for a task spanning them. The week view shows all seven days in narrow columns, timed entries as tall as they last, and pages by swiping; Multi-Day shows 1 to 6 days. Things react with a grey highlight as soon as a finger rests on them (lines in the editor only when held: a tap writes in them). Data stays on the phone until you enter your sync server under Settings. Plain `http://` server addresses are allowed. With a free Apple ID, SideStore has to refresh the app every 7 days.

### Home screen widgets (iOS 17 or later)

Three widgets, added from the home screen's widget gallery after the app has run once (in light mode on a soft grey that deepens towards the bottom, in dark mode on dark grey):

- **List** (medium, large): a list or view of your choice (Today, Next 7 Days, This Week, All, Inbox, Deadlines or any list; long-press → Edit Widget) with its open tasks in the app's order, subtasks indented, the date on the right (red when overdue). Tick a checkbox to complete the task; + opens the app with the quick add for that list; a row opens the task inside that list.
- **Day** (large): today and tomorrow by the hour side by side, or (Edit Widget → Layout) today in two halves, morning and afternoon. All-day entries on top with "+N" for more, a red line at the current time. 08–22 unless something starts earlier or ends later. An entry opens its task in the calendar at that day.
- **Week** (medium, large): seven columns reaching out to the sides, headed by letter and date on one line ("M 24"), with the day's entries as chips (all day tinted, at a set time with a colour bar, deadlines outlined; titles cut at the edge, without "…") and "+N" for more. The arrows in the top corners page a week back or up to four ahead (back at this week after half an hour, or tap the month name between them); a day opens it in the calendar.

### Lock screen widgets and controls

Three widgets for the rectangle under the clock (lock screen → Customize → add widgets), drawn in the system's tint like the clock:

- **List**: the first three open tasks of a list or view of your choice (as the home screen's List widget), subtasks indented; tick one off right there, a row opens the task.
- **Next today**: what comes next today with a time: the time (a deadline with its target), the title and the first line of its description (a place, say). It moves on as each entry ends; when nothing with a time is left today it says "Nothing more scheduled today" (light and subdued, as every such note on the lock screen).
- **Coming up**: the next three entries with a time, today or later (up to four weeks ahead), each with its day ("Today", a weekday within the week, else the date), its time and its title; no checkbox. A row opens the task in the calendar at its day.

Three controls (iOS 18 or later) for Control Center, the lock screen's two corner buttons or the Action button: **New Task** (opens the quick add), **Today** and **Calendar** (at today). A control opens the app itself and hands it the place to go (iOS does not open custom links from controls), so its action is built into the app as well as into the widgets.

Taps open the app at the right place, also when it was closed.

The widgets sync on their own: the app hands them its data and its sync servers (in the app group only the app and its widgets can read), and with the app closed they pull what changed on the servers, about every half hour or whenever iOS lets them refresh (iOS spaces widget refreshes out by its own budget, so it can be longer). A task ticked in a widget is completed there at once and sent to its server straight away, repeating tasks moving on to their next date as in the app; the app takes it over when it comes forward, and it lands once whichever way it arrives first. Without a connection the tick waits in the widget until the next refresh or until the app comes forward. The widgets run the app's own sync and view code (`src/widget/core.ts`, in JavaScriptCore). The widgets are an app extension with its own App ID. With a free Apple ID, SideStore asks what to do with it: choose "Keep App Extensions (Register App ID for Each Extension)" (one more of the 10 App IDs a week; "Remove" leaves the app without widgets). With a paid developer account it does this without asking.

## Install

Download `VitroTasks-setup.exe` from the latest entry under **Releases**. `VitroTasks-portable.exe` runs without installing, but only the installed app can update itself. The app uses the WebView2 runtime, which Windows 11 ships with; on Windows 10 the installer fetches it if it is missing.

Closing the window keeps the app in the tray so the shortcut keeps working. Quit from the tray icon.

The database is `%APPDATA%\app.vitro.tasks\vitro.db`.

## Sync server

The server is one small Node process plus Postgres, and it updates itself. On your server, in a clone of this repository:

```
cd server
VITRO_TOKEN=<long random secret> POSTGRES_PASSWORD=<another secret> docker compose up -d
```

This runs the image published with every release (`ghcr.io/pad-mac/vitro-sync`, amd64 and arm64) and an updater (the maintained fork of Watchtower) that checks for a new image every 15 minutes and restarts the server on it; the database and its data stay, and the schema upgrades itself on start. Only the sync server is touched. Settings → Sync servers shows each server's version.

It listens on `127.0.0.1:8787`. Put a reverse proxy with TLS in front of it, then add it under Settings → Sync servers in the app (a name, the URL and the token). `GET /v1/health` answers without a token. For separate sets of lists (work and private, say), run one server per set and add each to the app; the servers need no change for that (which server a row lives on is only recorded on the device). The first server added takes the lists already on the device; removing one of several takes its lists off the device (they stay on the server), removing the only one keeps them on the device.

How it works: every row carries `updated_at` and a `deleted` flag. The app sends its changed rows and its cursor to `POST /v1/sync`; the server keeps the newer version of each row, numbers every accepted change, and returns everything after the cursor, with the protocol it speaks (`server.protocol`, 2 from 0.14). The schema for both sides is generated from `src/shared/schema.ts`, which is also the reference for a future mobile client. Whole-number fields (times, flags, status, priority) are rounded if they come with a fraction, and a request with something other than a number in one is refused with 400.

The token is a single shared secret, so one server serves one person (or one shared set of lists).

A server set up before 0.14.1 (built from the checkout, without the updater) moves over once: `cd <your clone> && git pull && cd server && docker compose up -d`. From then on it updates itself.

Every new field syncs: the server keeps every field a row carries, also ones it has no column for yet (in an `extra` column), and a field a row leaves out stays as it is (an older app does not clear what a newer one set; the app does the same with rows from the server). A server older than the app is shown where you look: the sync dot in the title bar turns amber, the phone's Settings button gets a badge, and the server's card in Settings says what to run. On the first sync with a server from 0.14 on, each device sends its repeat rules again (newer than the stored version, so the server takes them): rules set while the server was older reach the other devices then.

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

Layout: `src/` UI and data layer · `src/shared/schema.ts` data model · `src-tauri/` app shell (windows, tray, global shortcut on desktop; `tauri.ios.conf.json` and `Info.ios.plist` for iOS) · `plugins/native-ui/` the native iOS parts (Swift: glass bar, haptics, keyboard, the widgets' shared folder; the page talks to it through `src/lib/native.ts`) · `ios/widgets/` the home screen widgets (SwiftUI, WidgetKit; their data comes from `src/lib/widgets.ts`, their own sync from `src/widget/core.ts`) · `ios/app/` a fix for links that start the iOS app · `server/` sync server.

The iPhone build runs in `.github/workflows/ios.yml` on a macOS 26 runner (Xcode 26; `tauri ios init`, then `scripts/ios-widgets.mjs` adds the widget extension to the generated project, then `tauri ios build --no-sign`, and an ad-hoc signature gives the app and the extension their shared app group); push a branch named `ios-…` to build only that.

## Not in this version

Reminders, tags, focus timer, skipping a single later occurrence from the calendar, and accounts for more than one person on a server. On the phone: the timeline is not adapted yet, and tasks cannot be dragged onto lists in the drawer (use Move to).
