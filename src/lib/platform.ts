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
