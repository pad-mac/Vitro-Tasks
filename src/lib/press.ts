// The phone: things react the moment a finger rests on them (a grey press
// highlight), not only once their editor or menu is open. A short delay keeps
// rows from flashing while the list is being scrolled; a quick tap still
// shows the highlight briefly.
const PRESSABLE = [
  ".task-row",
  ".card-sub",
  ".card",
  ".m-task-sheet .subtask[data-id]",
  ".cal-chip",
  ".tl-item",
  ".nav-row",
  ".group-head",
  ".stepper-today",
  ".menu-item",
  ".hm-item",
  ".hm-cell",
  ".m-float-row",
  ".p-list-row",
  ".m-tool",
].join(", ");
// Inside these the finger is doing something else (typing, ticking, folding).
const NOT = "input, textarea, [contenteditable='true'], .check, .fold, .sub-open, .sel-group";
const DELAY = 70;
const SLOP = 8;

export function watchPress() {
  let el: HTMLElement | null = null;
  let x = 0;
  let y = 0;
  let timer = 0;
  let shown = false;
  const clear = (after = 0) => {
    clearTimeout(timer);
    const target = el;
    el = null;
    shown = false;
    if (!target) return;
    if (after) setTimeout(() => target.classList.remove("is-pressed"), after);
    else target.classList.remove("is-pressed");
  };
  document.addEventListener(
    "touchstart",
    (e) => {
      clear();
      if (e.touches.length !== 1) return;
      const t = e.target as HTMLElement;
      if (t.closest(NOT)) return;
      const hit = t.closest<HTMLElement>(PRESSABLE);
      if (!hit || hit.closest(".floating-copy, .drag-ghost")) return;
      el = hit;
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      timer = window.setTimeout(() => {
        if (!el) return;
        el.classList.add("is-pressed");
        shown = true;
      }, DELAY);
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!el) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - x, t.clientY - y) > SLOP) clear();
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "touchend",
    () => {
      if (!el) return;
      // A quick tap: show it for a moment so the touch is seen.
      if (!shown) el.classList.add("is-pressed");
      clear(140);
    },
    { capture: true },
  );
  document.addEventListener("touchcancel", () => clear(), { capture: true });
  // Scrolling the list under a resting finger.
  document.addEventListener("scroll", () => el && clear(), { capture: true, passive: true });
}
