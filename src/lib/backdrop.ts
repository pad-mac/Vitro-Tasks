// iOS: the colour behind the web view. While the keyboard is up the web view
// is shortened to end above it, and the keyboard's rounded top corners show
// what lies behind: that has to be the colour of whatever sits at the bottom
// of the page right then (a sheet, the quick add, the page itself), in light
// and dark, or the corners show "holes".
import { hasNative, postNative } from "./native";

// Floating things that step aside while typing are not what the keyboard sits on.
const SKIP = ".m-bar, .undo-btn, .sel-bar, .m-tabs, .floating-copy, .drag-ghost, .is-rising";
// Sheets that sit on the keyboard: their own colour, even while they glide in.
const SHEETS = ".m-sheet.is-open:not(.is-rising), .m-task-sheet:not(.is-closing)";

let ctx: CanvasRenderingContext2D | null = null;

/** Any CSS colour as [r, g, b, a] (0–255, a 0–1), through a canvas so that every colour syntax works. */
export function rgba(css: string): [number, number, number, number] {
  if (!css || css === "transparent") return [0, 0, 0, 0];
  const m = css.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], a];
  }
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return [0, 0, 0, 0];
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** Composites colours given front to back (the first is on top) over the page colour. */
export function composite(colors: string[], base: string): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const c of colors) {
    const [cr, cg, cb, ca] = rgba(c);
    if (!ca) continue;
    const w = (1 - a) * ca;
    r += w * cr;
    g += w * cg;
    b += w * cb;
    a += w;
    if (a > 0.995) break;
  }
  const [br, bg, bb] = rgba(base);
  return hex(r + (1 - a) * br, g + (1 - a) * bg, b + (1 - a) * bb);
}

/** The colour at the bottom edge of the page, as the keyboard will meet it. */
export function bottomColor(): string {
  const base = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || getComputedStyle(document.body).backgroundColor;
  const sheet = [...document.querySelectorAll<HTMLElement>(SHEETS)].at(-1);
  if (sheet) return composite([getComputedStyle(sheet).backgroundColor], base);
  const stack = document.elementsFromPoint(innerWidth / 2, innerHeight - 2).filter((el) => !el.closest(SKIP));
  return composite(
    stack.map((el) => getComputedStyle(el).backgroundColor),
    base,
  );
}

let sent = "";
/** Tells the native side the colour to show behind the keyboard's corners (only when it changed). */
export function syncBackdrop() {
  if (!hasNative()) return;
  const color = bottomColor();
  if (color === sent) return;
  sent = color;
  postNative({ type: "backdrop", color });
}

/** Keeps the colour right: sheets opening, the keyboard coming, the theme, coming back to the app. */
export function watchBackdrop() {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const soon = () => {
    timers.forEach(clearTimeout);
    // Now, and once more after sheets and the keyboard have settled.
    syncBackdrop();
    timers = [setTimeout(syncBackdrop, 60), setTimeout(syncBackdrop, 320)];
  };
  // Only around the keyboard (its corners are where the colour shows): a text field taking the focus,
  // the keyboard's resize, the theme, coming back. Not on taps: it used to run on every touch, in the
  // middle of sheets, the drawer and the calendar opening and closing.
  document.addEventListener("focusin", (e) => (e.target as Element).matches?.("input, textarea, [contenteditable='true']") && soon(), true);
  window.addEventListener("resize", soon);
  window.addEventListener("vitro:backdrop", soon);
  document.addEventListener("visibilitychange", soon);
  new MutationObserver(soon).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  soon();
  return soon;
}
