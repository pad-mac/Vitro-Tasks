// Finds links in task text: [markdown](https://links) (also to apps, see APP_SCHEMES) and bare URLs.
import { APP_SCHEMES } from "./markdown";

export interface RichPart {
  text: string;
  href?: string;
}

const SAFE = new RegExp(`^(https?://|mailto:|(?:${APP_SCHEMES.join("|")}):)`, "i");
// [label](url) | bare http(s) URL | www. address
const TOKEN = new RegExp(
  `\\[([^\\]\\n]+)\\]\\(((?:https?:\\/\\/|mailto:|(?:${APP_SCHEMES.join("|")}):)[^\\s)]+)\\)|((?:https?:\\/\\/|www\\.)[^\\s<>()"]*[^\\s<>()".,;:!?'])`,
  "gi",
);

export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    if (m[1] !== undefined) {
      out.push({ text: m[1], href: m[2] });
    } else {
      const raw = m[3];
      const href = raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
      out.push(SAFE.test(href) ? { text: raw, href } : { text: raw });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Text with markdown links reduced to their labels, for places too small to click. */
export function plainText(text: string): string {
  return richParts(text)
    .map((p) => p.text)
    .join("");
}

export function hasLink(text: string): boolean {
  return richParts(text).some((p) => p.href);
}
