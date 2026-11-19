import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { QuickAdd } from "./QuickAdd";
import { seedDemo } from "./lib/demo";
import { hasNative, postNative } from "./lib/native";
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
if (isMobile && window.visualViewport) {
  const vv = window.visualViewport;
  const onResize = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener("resize", onResize);
  vv.addEventListener("scroll", onResize);
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
