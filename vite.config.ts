import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Hover and press styles only off the phone. On touch screens WebKit keeps
 * :hover on the last tapped element (rows stay grey, and a tap that reveals
 * something on hover only hovers instead of acting), and :active lights rows
 * up while the finger scrolls past them. The phone layout sets .is-mobile on
 * <html>; the added :where() keeps every selector's specificity as it was.
 */
function pointerOnly() {
  const guard = ":where(html:not(.is-mobile))";
  return {
    postcssPlugin: "pointer-only",
    Once(root: any) {
      root.walkRules((rule: any) => {
        if (!/:hover|:active/.test(rule.selector)) return;
        rule.selectors = rule.selectors.map((sel: string) => {
          if (!/:hover|:active/.test(sel)) return sel;
          if (/^\s*(html|:root)\b/.test(sel)) return sel.replace(/^(\s*(?:html|:root)[^\s>+~]*)/, "$1:where(:not(.is-mobile))");
          return `${guard} ${sel}`;
        });
      });
    },
  };
}
pointerOnly.postcss = true;

// Tauri expects a fixed port and ignores src-tauri when watching.
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [pointerOnly()] } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "es2022", outDir: "dist" },
  optimizeDeps: { exclude: ["sql.js"] },
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 30000 },
} as any);
