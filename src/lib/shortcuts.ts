// In-app keyboard shortcuts. All of them can be changed in Settings.

export type ActionId =
  | "switchLayer"
  | "goTasks"
  | "goCalendar"
  | "addTask"
  | "calWeek"
  | "calMonth"
  | "calToday"
  | "toggleSidebar"
  | "toggleEditMode";

export const ACTIONS: { id: ActionId; label: string; def: string }[] = [
  { id: "switchLayer", label: "Switch between Tasks and Calendar", def: "Ctrl+Tab" },
  { id: "goTasks", label: "Go to Tasks", def: "1" },
  { id: "goCalendar", label: "Go to Calendar", def: "2" },
  { id: "addTask", label: "Add task (where the add bar is shown)", def: "A" },
  { id: "calWeek", label: "Calendar: week view", def: "W" },
  { id: "calMonth", label: "Calendar: month view", def: "M" },
  { id: "calToday", label: "Calendar: jump to today", def: "T" },
  { id: "toggleSidebar", label: "Show or hide the list sidebar", def: "S" },
  { id: "toggleEditMode", label: "Switch popup / side pane editing", def: "E" },
];

export type Shortcuts = Record<ActionId, string>;

export const DEFAULT_SHORTCUTS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.def])) as Shortcuts;

const MODS = ["Control", "Alt", "Shift", "Meta", "AltGraph", "CapsLock", "Dead"];

/** "Ctrl+Shift+K" style name of a key press, or null for a lone modifier. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODS.includes(e.key)) return null;
  let key: string;
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (e.key === " ") key = "Space";
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else key = e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  // Shift only counts for keys whose name does not already carry it.
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/** True while the user is typing somewhere: single-key shortcuts must stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
}

export function hasModifier(combo: string): boolean {
  return /^(Ctrl|Alt|Meta)\+/.test(combo);
}

export function parseShortcuts(raw: string | null): Shortcuts {
  try {
    return { ...DEFAULT_SHORTCUTS, ...(raw ? (JSON.parse(raw) as Partial<Shortcuts>) : {}) };
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

/** Set while Settings records a new shortcut, so the app does not act on those keys. */
export const shortcutRecording = { active: false };
