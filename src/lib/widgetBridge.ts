// The app's side of the iOS widgets: keeps their snapshot current, takes over
// what was ticked in them, and opens what was tapped in them (vitrotasks://
// links, which iOS hands to the app and Rust passes on as "vitro:opened").
import { useStore } from "../store";
import { computePrefs } from "./views";
import { hasNative, onNative, postNative } from "./native";
import { isTauri } from "./platform";
import type { SmartId, ViewRef } from "./views";
import { buildSnapshot } from "./widgets";
import type { AdoptedChange } from "../db/repo";

const SMART_IDS: SmartId[] = ["all", "today", "next7", "inbox", "deadlines", "completed"];
const WAIT_MS = 1500;

let timer: ReturnType<typeof setTimeout> | undefined;
let written = "";

/** What the widgets would show now (`at` left at 0). */
export function widgetSnapshot() {
  const s = useStore.getState();
  return buildSnapshot(s, (v) => computePrefs(v, s.lists, s.settings), undefined, 0);
}

/**
 * Writes what the widgets draw from (if it changed): the snapshot, and the
 * data with the servers, from which they draw and sync on their own while the
 * app is closed (src/widget/core.ts).
 */
async function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!useStore.getState().ready) return;
  const state = await useStore.getState().widgetState();
  const snap = widgetSnapshot();
  const same = JSON.stringify([snap, { ...state, at: 0 }]);
  if (same === written) return;
  written = same;
  snap.at = state.at;
  postNative({ type: "widgets", json: JSON.stringify(snap), state: JSON.stringify(state) });
}

const later = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), WAIT_MS);
};

function viewFor(id: string | null): ViewRef | null {
  if (!id) return null;
  if ((SMART_IDS as string[]).includes(id)) return { kind: "smart", id: id as SmartId };
  return useStore.getState().lists.some((l) => l.id === id) ? { kind: "list", id } : null;
}

/** Opens what a widget tap asked for: vitrotasks://add?list=…, task?id=…, calendar?day=… */
export function openLink(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  if (u.protocol !== "vitrotasks:") return;
  const what = u.host || u.pathname.replace(/^\/+/, "");
  const q = u.searchParams;
  const s = useStore.getState();
  // Whatever was open gives way: settings and the quick add (App), menus, the drawer.
  const link = (add: boolean) => window.dispatchEvent(new CustomEvent("vitro:link", { detail: { add } }));
  if (what !== "add") link(false);
  s.setDrawerOpen(false);
  s.openMenu(null);
  s.closeComposer();
  s.setSelecting(null);
  switch (what) {
    case "add": {
      const view = viewFor(q.get("list"));
      if (view) s.setView(view);
      s.select(null);
      // A link is not a tap: the native side lets this one focus raise the keyboard.
      postNative({ type: "allowFocus" });
      setTimeout(() => link(true), 60);
      break;
    }
    case "list": {
      const view = viewFor(q.get("id"));
      if (view) s.setView(view);
      s.select(null);
      break;
    }
    case "task": {
      // Opened where it was tapped: in that list or view (list widget), or in the calendar at that day (day widget).
      const id = (q.get("id") ?? "").split("~")[0];
      const view = viewFor(q.get("view"));
      const day = q.get("day");
      if (view) s.setView(view);
      else if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        s.setView({ kind: "calendar" });
        s.goCalDay(day);
      }
      if (useStore.getState().tasks.some((t) => t.id === id)) useStore.getState().select(id);
      break;
    }
    case "calendar": {
      s.select(null);
      s.setView({ kind: "calendar" });
      const day = q.get("day");
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) s.goCalDay(day);
      break;
    }
  }
}

/** iOS app only: starts once the data has loaded. */
export async function startWidgetBridge() {
  if (!hasNative()) return;
  useStore.subscribe((s, prev) => {
    if (s.tasks !== prev.tasks || s.lists !== prev.lists || s.sections !== prev.sections || s.settings !== prev.settings) later();
  });
  // Changed in a widget: the rows it wrote, taken over as they are (it may have
  // sent them to the server already: they land once either way). Ticks of
  // version 0.12.0 come as plain ids. Then the widgets get the app's data at once.
  onNative("widgetActions", (payload) => {
    const changes = Array.isArray(payload.changes) ? (payload.changes as AdoptedChange[]) : [];
    const actions = Array.isArray(payload.actions) ? (payload.actions as { kind?: string; id?: string }[]) : [];
    const ids = actions.filter((a) => a.kind === "complete" && typeof a.id === "string").map((a) => a.id!);
    void (async () => {
      try {
        await useStore.getState().adoptWidgetChanges(changes);
        if (ids.length) await useStore.getState().completeTasks(ids, { silent: true });
      } finally {
        await flush();
      }
    })();
  });
  // The native side greets the page again after a reload: ask once more then.
  onNative("ready", () => postNative({ type: "widgetsTake" }));
  postNative({ type: "widgetsTake" });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") postNative({ type: "widgetsTake" });
    // Leaving the app: the widgets get the latest at once.
    else void flush();
  });
  void flush();

  if (!isTauri()) return;
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const take = async () => {
    const urls = await invoke<string[]>("take_opened_urls").catch(() => [] as string[]);
    for (const url of urls) openLink(url);
  };
  await listen("vitro:opened", () => void take());
  // Started by a tap on a widget: the link waited for the page.
  await take();
}
