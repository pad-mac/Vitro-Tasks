// List colour palettes: sets of eight that are made to sit together, red to
// purple. New lists take their colours from the default one (Settings →
// Appearance); the list menu offers all of them and any custom colour.
//
// Sources (the colours are taken over as published):
// - Vivid: Apple's system colours as updated for the 2025 design (Human
//   Interface Guidelines → Color → System colors, light appearance).
// - Crisp: Radix Colors, step 9 (the solid colour of each scale).
// - Bright / Deep: Tailwind CSS, shades 500 / 600.
// - Soft: the colours Vitro Tasks used before.

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  { id: "vivid", name: "Vivid", colors: ["#ff383c", "#ff8d28", "#ffcc00", "#34c759", "#00c3d0", "#0088ff", "#6155f5", "#cb30e0"] },
  { id: "crisp", name: "Crisp", colors: ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"] },
  { id: "bright", name: "Bright", colors: ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"] },
  { id: "deep", name: "Deep", colors: ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777"] },
  { id: "soft", name: "Soft", colors: ["#c8553d", "#d9773d", "#c9a227", "#5f9e5a", "#3fa796", "#5b8def", "#9a6bd1", "#7c8794"] },
];

export const DEFAULT_PALETTE = "vivid";

/** The palette new lists take their colours from (a synced setting). */
export function defaultPalette(settings: Record<string, string>): Palette {
  return PALETTES.find((p) => p.id === settings["palette"]) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;
}

// New lists go round the palette in this order, so neighbours differ: blue, green, orange, indigo, red, teal, yellow, purple.
const SPREAD = [5, 3, 1, 6, 0, 4, 2, 7];

/** The colour for the nth new list. */
export function colorForNew(palette: Palette, n: number): string {
  return palette.colors[SPREAD[n % SPREAD.length]];
}

/** Every palette colour, to tell custom colours apart. */
export const PALETTE_COLORS = new Set(PALETTES.flatMap((p) => p.colors));
