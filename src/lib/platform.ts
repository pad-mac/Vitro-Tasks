// Thin wrappers around Tauri so the same UI also runs in a plain browser tab.
import { isTauri } from "../db/driver";

export { isTauri };

export const DEFAULT_SHORTCUT = "Ctrl+Space";

export function windowLabel(): string {
  if (!isTauri()) return new URLSearchParams(location.search).get("window") ?? "main";
  // Set synchronously by Tauri before any script runs.
  const meta = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } })
    .__TAURI_INTERNALS__?.metadata;
  return meta?.currentWindow?.label ?? "main";
}

const CHANGED = "vitro:changed";

/** Tells the other windows that the database changed. */
export async function announceChange(): Promise<void> {
  if (!isTauri()) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(CHANGED, { from: windowLabel() });
}

export async function onRemoteChange(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ from: string }>(CHANGED, (e) => {
    if (e.payload.from !== windowLabel()) handler();
  });
}

export async function onEvent(name: string, handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(name, handler);
}

export async function hideCurrentWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

/** Registers the global quick add shortcut. Throws with a readable message if it is taken. */
export async function setQuickAddShortcut(shortcut: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_quick_add_shortcut", { shortcut });
}

export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_main_window");
}

export async function windowAction(action: "minimize" | "toggleMaximize" | "close"): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "toggleMaximize") await w.toggleMaximize();
  else await w.close();
}

export async function appVersion(): Promise<string> {
  if (!isTauri()) return "dev";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export interface FoundUpdate {
  version: string;
  notes: string;
  /** Downloads, installs and restarts the app. Reports progress from 0 to 1. */
  install(onProgress: (fraction: number) => void): Promise<void>;
}

/** Asks the GitHub release feed for a newer version. Null when up to date. */
export async function findUpdate(): Promise<FoundUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total) onProgress(Math.min(1, done / total));
        }
        if (event.event === "Finished") onProgress(1);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
