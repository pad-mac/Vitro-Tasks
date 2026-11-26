# Vitro Tasks: primer for Claude Code

Put this file at the root of the repo as `CLAUDE.md`. Claude Code reads it at the start of every session. It carries over the rules and context from the earlier chats, up to **v0.15.0** (main `d4db69c`).

## The project

The repo is `pad-mac/Vitro-Tasks` (public). Vitro Tasks is Patrick's own task and calendar app. It started as a rebuild of TickTick's functions (TickTick is the reference app) and is growing toward a **unified task/event system**: appointments and to-dos in one list, appointments linked to what has to be done for them, and enough freedom per item to work both as a task list and as a calendar.

- **Windows:** a Tauri 2 desktop exe. It has its own frame bar (the menus sit in the top bar with the window controls), a global quick-add bar on Ctrl+Space, a tray icon, and updates from GitHub Releases.
- **iPhone:** an IPA built on GitHub's macOS runners and installed with SideStore (iOS 26). The screens are the same web UI as on Windows. Native parts: the bottom bar (Liquid Glass), the widgets and the controls.
- **Sync:** a self-hosted server (Node + Postgres) running on his VPS. Every device has its own SQLite database.

## Stack and layout

- `src/`: React + TypeScript + zustand. `store.ts` holds the app state and actions. `styles.css` is one stylesheet. `components/`, `lib/` (views, dates, repeat, order, widgets, …) and `db/` (`driver.ts`, `repo.ts`, `sync.ts`). `shared/schema.ts` is the data model and `SYNC_PROTOCOL`.
- `src/widget/core.ts`: widget logic that runs in JavaScriptCore inside the iOS widget extension, built into a bundle by CI.
- `src-tauri/`: the Rust shell and Tauri config. `plugins/native-ui/`: the Swift plugin for the native iOS parts.
- `ios/`:
  - `widgets/`: the WidgetKit extension. `Shared.swift`, `Live.swift` (an actor that does the network), `Intents.swift`, List, Day, Week, `LockWidgets.swift`, `Controls.swift`.
  - `preview/`: renders widget PNGs on macOS for CI.
  - `app/`: native bits in the app target, e.g. `LaunchLinks.m`.
- `scripts/ios-widgets.mjs`: patches the Tauri-generated Xcode project (xcodegen) to add the widget extension.
- `server/`: the sync server, its Dockerfile and docker-compose.
- `.github/workflows/`: `build.yml` (Windows, tests, server image, release) and `ios.yml`.

## Hard rules (Patrick set these explicitly)

1. **Don't build, commit, push or release until he says "build".** A question, a discussion, or a "yeah" to an idea is not a go-ahead. When the instruction is ambiguous, ask.
2. **Mobile and desktop stay at feature parity.** Every feature lands on both, phone pickers and editors included.
3. **Every new field or feature goes through sync end to end,** his running server included. Repeats once failed to reach the other device; never again.
4. **Speed comes first, especially on iOS** (app opening, popups, the calendar split). Don't add work to every tap for a cosmetic detail. Never measure or sample at runtime what is fixed and predictable from the app's own state.
5. **Change only what he asks.** For example, keep the existing editor layout. A redesign he didn't ask for got v0.8.0 rejected and reverted.
6. **Never introduce new bugs.** Be resilient and thorough: test every release against regressions.
7. **Commits:**
   - Author: `git -c user.name="pad-mac" -c user.email="pad-mac@users.noreply.github.com" commit …`. Never his personal email.
   - End each message with:
     ```
     Co-Authored-By: Claude <noreply@anthropic.com>
     ```
8. **Secrets:**
   - Never print or log `VITRO_TOKEN`.
   - The updater signing key lives only in the GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`, `…_PASSWORD`).
   - Never commit his TickTick backup CSV or any personal data.
9. **Never run prettier (or any reformatter) on repo files.**

## What "build" means (the release routine)

1. Implement and test: `npx tsc --noEmit -p .`, then `npx vitest run`, then click through the change in the browser (see Testing).
2. Update `README.md` (its feature table and the widget sections).
3. Bump the version in **5 files**: `package.json`, `package-lock.json` (the two top entries), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` (the `vitro-tasks` package).
4. Commit on `main` and push. CI builds Windows, iOS, tests and the server image, then publishes the release.
5. Verify that the release is at the new version, that `latest.json` (the Windows updater) and `vitro-tasks.altsource.json` (SideStore) show it, and that the server image `ghcr.io/pad-mac/vitro-sync:<version>` exists.
   - If the macOS runner is "not acquired" (GitHub capacity), run `gh run rerun <id> --failed`.
6. Reply short, concrete and honest. Answer **every part** of his message, and say plainly what wasn't tested (e.g. what only he can test on the phone).

**Swift/iOS changes:** iterate on an `ios-*` branch first. CI uploads the widget preview PNGs (`widget-previews` artifact) on those branches. Look at them, then squash-merge into `main`. Notes:
- `ios.yml` first compiles `ios/widgets/*.swift` on its own to fail fast. The preview step compiles a fixed file list for macOS, so keep iOS-only API inside `#if os(iOS)`.
- Inside a `TimelineProvider`, `Entry` means the timeline entry. Use `DayItem` (a typealias) for the snapshot's entry.
- GitHub refuses to delete remote branches (403), so old `ios-*` branches stay.

## Technical knowledge to keep

**Sync (`SYNC_PROTOCOL = 2`)**
- The server keeps unknown fields in `extra JSONB`, so new client fields survive an old schema.
- Rows are last-write-wins by `updated_at`.
- A field missing from a row keeps its current value, on the server and in the client's `applyRemote`.
- The response carries `server: {protocol, version}`. The client flags old servers, and Settings shows "server X" and a warning.

**Server auto-update**
- Every release publishes `ghcr.io/pad-mac/vitro-sync:latest` and `:<version>` (amd64 + arm64).
- The compose file runs it with watchtower (`nickfedor/watchtower`, label-enabled, polling every 900 s).
- `/v1/health` returns `{ok, version}`.
- Don't build workarounds for old servers. Servers update themselves.

**Database**
- The sql.js driver binds positionally, so SQL `$n` placeholders must each appear **once and in order**. Out of order, an update silently does nothing; this happened once.
- Deletes are soft: `deleted = 1` is in the trash, `deleted = 2` is deleted forever (text cleared). The row stays so the deletion syncs.

**Device settings** (calendar days, text size) live in `meta`, per device (see `cal_days` and `text_size` in `store.ts`). Synced settings live in the `settings` table, e.g. `sidebar:hidden` and `sidebar:trash`.

**Text size:** `--ts` multiplies every font size in `styles.css` (`calc(Npx * var(--ts))`). Phone inputs must stay ≥ 16 px, otherwise iOS zooms in.

**Widgets**
- The app writes `state.json` into the app group. The widget pulls from the servers itself (`pulled.json`) and records its own changes (`changes.json`). The app takes those over with `adoptRows`.
- Links: `vitrotasks://add`, `list?id=…`, `task?id=…&view=…|day=…`, `calendar?day=YYYY-MM-DD|today`. They work from a cold start too.

**Calendar**
- Order within a day: multi-day spans first (so their bars line up), then deadlines, then untimed tasks by position, then timed ones by time.
- Completed tasks always come last, newest completion first.
- `useMinutesNow` is a shared minute clock. Past entries are greyed; out-of-month days grey only their numbers.

## Design rules (his words and standards)

- The look is grey, low-contrast, technical but sleek, with Inter throughout, close to his CSS-styled TickTick PWA. Aim for clean, professional and minimal, but playfully technical.
- "Clean" doesn't mean stripped-down outline controls. A design must fit together with all its elements, and sometimes that takes being a little bold. The thin-outline toggle of v0.10.1 was "hideous".
- **Equal padding on all sides** of a highlight or selection around its element. Icons and checkboxes are vertically centred on their text line. Centre whatever is obviously better centred. Spacious but functional.
- Controls sit where they belong for the kind of UI. For example, a bottom control in a drawer sits snug at the bottom as a pill, not as a divided section floating too high.
- Aim for a middle ground between snappy, minimal and smooth: short, snappy fades, never long animations.
- **Touch:**
  - No hover styles on touch, and no highlight while scrolling.
  - Tasks react the moment they're touched, but the grey must not fade out and back in before a popup opens.
  - Editor lines get no tap grey.
  - Phone UI is designed for touch, never desktop layouts reused.
  - Fill colours at the keyboard's rounded corners must match whatever sits on the keyboard, in light and dark.
- Reuse the app's established icons and decisions (the target icon for deadlines, not the hourglass).
- Phone long-press menu: a row of four quick dates, a row of four priorities, a separator, Pin, then the rest. It's the app's own menu (Inter, a blurred background), and you can slide the held finger over it and release to pick, with haptics.
- Never suggest Japanese names for anything.

## How to talk with him

- Short and concrete. He is direct and wants honest, precise assessments; he pushes back on vague ones.
- No inline citation markup.
- When a message has several parts, address all of them, even if one is the main part.
- Be humble about mistakes, and double-check facts that may be outdated.
- For PowerShell commands, put each line in its own code block.

## Testing

- `npx vitest run`. Tests that need a database run only with `TEST_DATABASE_URL` and `TEST_DATABASE_URL_2` (Postgres); otherwise they're skipped.
- Browser checks in the earlier chats used `npx vite preview --port 4173` with `?demo` (demo data) and `?mobile&demo` (the phone layout). The page exposes `window.__store` (zustand) for setup.
  - The scripted scenarios lived outside the repo and are **not** carried over. Write new ones, or check by hand, as needed.
  - In the old harness, some phone scenarios failed on a `__nativeLog` stub. That was the harness, not the app.

## Open items (as of v0.15.0)

- **Controls** (New Task, Today, Calendar, iOS 18) use `OpenURLIntent`. They compile, but are **untested on the phone**. If tapping one doesn't open the app, wire the intent into the app target as well.
- **Settings on the phone:** content scrolls under the status bar with nothing behind it (the "Text size" heading overlaps the clock). Reported in a screenshot, not fixed yet.
- **Shortcuts/Siri actions** ("Add task", etc.) aren't built. They'd need App Intents in the app target. Still unanswered: is his Apple developer account the paid kind? Free accounts are limited in app IDs.
- **Calendar tiebreak across lists** is position, which is close to arbitrary between two lists. Offered: sidebar order, then position, or alphabetical. Not decided.
- **Direction discussed, nothing decided:** the problem is that the single date field does three jobs (appointment, intention, "show me today"). Dumping things into Today blocks the month view. Ideas offered:
  1. fixed vs. flexible dates (flexible ones shown only as a count);
  2. horizons (Today / This week / This month / Someday) instead of dates;
  3. tasks linked to appointments, with lead times;
  4. deadlines that pull work forward;
  5. a daily triage instead of silent rollover;
  6. day capacity;
  7. work sessions as time blocks linked to the task;
  8. an optional checkbox, so appointments archive themselves.

  Wait for him to pick.
- **Further out:** grow the app toward a project manager, possibly with an end-to-end-encrypted chat over his VPS and immediate iOS push notifications.
