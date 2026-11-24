// iOS: the colour behind the web view. While the keyboard is up the web view
// is shortened to end above it, and the keyboard's rounded top corners show
// what lies behind. That colour is never measured: the app knows what sits on
// the keyboard (a sheet, the dimmed page under the floating quick add, the
// settings page, the page itself), and each of those has its declared colour.
// It is set when that state changes, and the app only hears of a change.
import { hasNative, postNative } from "./native";

/** What sits at the bottom of the screen ("scrim": the page dimmed, under the floating quick add). */
export type Backdrop = "page" | "sheet" | "modal" | "scrim";

// The quick add's scrim (styles.css .m-scrim): black at 20% over the page.
const SCRIM = 0.2;

let base: Backdrop = "page";
let rising = false;
let sent = "";

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** A declared colour (#rgb, #rrggbb or rgb()) as [r, g, b]. */
export function rgb(css: string): [number, number, number] {
  const c = css.trim();
  const m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = c.replace("#", "");
  const full = h.length === 3 ? [...h].map((x) => x + x).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour for what sits at the bottom, from the theme's variables. */
export function backdropColor(kind: Backdrop, dimmed: boolean): string {
  const vars = getComputedStyle(document.documentElement);
  const v = (name: string) => vars.getPropertyValue(name).trim();
  // Sheets are --float; the page and the phone's settings page are --bg.
  const [r, g, b] = rgb(kind === "sheet" ? v("--float") : v("--bg"));
  const k = dimmed ? 1 - SCRIM : 1;
  return hex(r * k, g * k, b * k);
}

function apply() {
  if (!hasNative()) return;
  // While the quick add rises, the keyboard slides in under the dimmed page (not yet the sheet).
  const color = rising || base === "scrim" ? backdropColor("page", true) : backdropColor(base, false);
  if (color === sent) return;
  sent = color;
  postNative({ type: "backdrop", color });
}

/** What sits at the bottom of the screen now (App, from its own state). */
export function setBackdrop(kind: Backdrop) {
  base = kind;
  apply();
}

/** The quick add is on its way in (Mobile). */
export function setBackdropRising(on: boolean) {
  rising = on;
  apply();
}

/** The theme changed (also the system's, when the app follows it). */
export function refreshBackdrop() {
  sent = "";
  apply();
}

