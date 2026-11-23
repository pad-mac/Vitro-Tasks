import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { QuickAdd } from "./QuickAdd";
import { seedDemo } from "./lib/demo";
import { hasNative, postNative } from "./lib/native";
import { refreshBackdrop } from "./lib/backdrop";
import { isMobile, isTauri, windowLabel } from "./lib/platform";

/** Readable text colour on top of a highlight colour. */
function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#1f1f1f";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#1d1d1f" : "#ffffff";
}
import { useStore } from "./store";

const isQuickAdd = windowLabel() === "quickadd";
if (isMobile) document.documentElement.classList.add("is-mobile");
// iOS app: the bar, the task menu and the keyboard are native.
if (hasNative()) document.documentElement.classList.add("is-native");

// The on-screen keyboard: how much of the window it covers, for sheets that sit on top of it.
// `kb-up`: the keyboard is up, whether the web view was shortened above it
// (the iOS app) or the keyboard lies over it (--kb): sheets on top of it drop
// their home-indicator padding, so the row above the keyboard is evenly padded.
if (isMobile && window.visualViewport) {
  const vv = window.visualViewport;
  const onResize = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    const root = document.documentElement;
    root.style.setProperty("--kb", `${kb}px`);
    root.classList.toggle("kb-up", kb > 60 || innerHeight < screen.height - 120);
  };
  vv.addEventListener("resize", onResize);
  vv.addEventListener("scroll", onResize);
  window.addEventListener("resize", onResize);
  // The iOS app resizes the web view at the start of the keyboard's slide, so
  // whatever sits on the keyboard jumped to where it will end (behind the
  // keyboard while it still slides away: the editor "flashed"). It is moved
  // back and follows the keyboard instead. Runs before the frame is painted.
  let lastH = innerHeight;
  // The page's own height without the keyboard. While a sheet (an overlay) is being written in,
  // the page under it keeps that height: the calendar's rows and the lists do not squeeze (nor
  // lay out again) because the keyboard came; it covers that part of the page anyway.
  let fullH = innerHeight;
  const pinPage = () => {
    const root = document.documentElement;
    if (innerHeight >= fullH - 80) {
      fullH = innerHeight;
      root.classList.remove("pin-h");
      return;
    }
    if (document.activeElement?.closest(".m-sheet, .m-task-sheet") || root.classList.contains("pin-h")) {
      root.style.setProperty("--app-h", `${fullH}px`);
      root.classList.add("pin-h");
    }
  };
  window.addEventListener("resize", () => {
    pinPage();
    const d = innerHeight - lastH;
    lastH = innerHeight;
    if (Math.abs(d) < 120) return;
    // A sheet still on its way in (the quick add) rises on its own once the keyboard is there.
    const riders = document.querySelectorAll<HTMLElement>(".m-task-sheet:not(.is-full):not(.is-closing), .m-sheet.is-open:not(.is-rising), .m-task-sheet.is-full .detail-bar");
    for (const el of riders) el.animate([{ translate: `0 ${-d}px` }, { translate: "0 0" }], { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
  });
  document.addEventListener("visibilitychange", () => setTimeout(onResize, 50));
  onResize();
}

// Leaving the app while writing: iOS takes the keyboard away but leaves the
// field focused, and coming back the editor sat there stuck (bar down, no
// keyboard, a tap on the field did nothing). The writing ends instead; a tap
// starts it again. Text is kept (every field saves on blur).
if (isMobile) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    const a = document.activeElement as HTMLElement | null;
    if (a?.matches("input, textarea, [contenteditable='true']")) a.blur();
  });
}

// iOS: if the web view is ever left short without a keyboard (the keyboard
// went away without the usual notice), ask the native side to fit it again.
if (isMobile) {
  const check = () => {
    const typing = document.activeElement?.matches("input, textarea, [contenteditable='true']");
    if (!typing && innerHeight < screen.height - 40) postNative({ type: "fit" });
  };
  document.addEventListener("focusout", () => setTimeout(check, 500));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && setTimeout(check, 300));
  window.addEventListener("resize", () => setTimeout(check, 800));
}

function Root() {
  const theme = useStore((s) => s.theme);
  const highlight = useStore((s) => s.highlight);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--hl", highlight);
    root.setProperty("--on-hl", onColor(highlight));
  }, [highlight]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      // The native parts (bar, menus, keyboard) follow the app's theme.
      if (isMobile) {
        const css = getComputedStyle(document.documentElement);
        postNative({ type: "theme", dark: theme === "system" ? null : dark, bg: css.getPropertyValue("--bg").trim(), raised: css.getPropertyValue("--raised").trim() });
        refreshBackdrop();
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return isQuickAdd ? <QuickAdd /> : <App />;
}

void useStore
  .getState()
  .init()
  .then(async () => {
    // Browser preview only: `?demo` fills an empty database with sample data.
    if (!isTauri() && new URLSearchParams(location.search).has("demo")) {
      await seedDemo();
      // (The sample's completed tasks are not something to undo.)
      useStore.setState({ undo: null });
      // For the scripted checks of the preview.
      (window as unknown as { __store: typeof useStore }).__store = useStore;
    }
    // Coming back to the app (phone unlocked, window shown again) pulls changes.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && windowLabel() === "main") void useStore.getState().syncNow();
    });
    // Only the main desktop window owns the global shortcut and the update checks.
    if (windowLabel() === "main" && isTauri() && !isMobile) {
      // Register the saved shortcut from here so a failure (shortcut already
      // taken by another program) becomes visible in the app.
      const { shortcut, setShortcut } = useStore.getState();
      void setShortcut(shortcut);
      // Look for a newer release shortly after start, then every six hours.
      const { checkUpdate } = useStore.getState();
      setTimeout(() => void checkUpdate(), 5000);
      setInterval(() => void checkUpdate(), 6 * 60 * 60 * 1000);
    }
  });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
