import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Hover and press styles only for a real pointer. On touch screens WebKit
 * keeps :hover on the last tapped element (rows stay grey, and a tap that
 * reveals something on hover only hovers instead of acting), and :active
 * lights rows up while the finger scrolls past them.
 */
function pointerOnly() {
  return {
    postcssPlugin: "pointer-only",
    Once(root: any, { AtRule }: any) {
      root.walkRules((rule: any) => {
        if (!/:hover|:active/.test(rule.selector)) return;
        if (rule.parent?.type === "atrule" && rule.parent.name === "media" && rule.parent.params.includes("hover: hover")) return;
        const touchy = rule.selectors.filter((s: string) => /:hover|:active/.test(s));
        const rest = rule.selectors.filter((s: string) => !/:hover|:active/.test(s));
        const media = new AtRule({ name: "media", params: "(hover: hover) and (pointer: fine)" });
        media.append(rule.clone({ selectors: touchy }));
        rule.after(media);
        if (rest.length) rule.selectors = rest;
        else rule.remove();
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
