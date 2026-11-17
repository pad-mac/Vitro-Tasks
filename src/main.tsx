import "@fontsource-variable/inter";
import "./styles.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { QuickAdd } from "./QuickAdd";
import { seedDemo } from "./lib/demo";
import { isTauri, windowLabel } from "./lib/platform";
import { useStore } from "./store";

const isQuickAdd = windowLabel() === "quickadd";

function Root() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
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
    if (!isTauri() && new URLSearchParams(location.search).has("demo")) await seedDemo();
    if (!isQuickAdd && isTauri()) {
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
