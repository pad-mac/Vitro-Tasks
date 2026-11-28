// Descriptions are markdown, one line per block, so a description without any
// formatting is the plain text it always was:
//   # / ## / ### heading     - bulleted     1. numbered     > quote
//   **bold**  *italic*  ~~struck~~  <u>underlined</u>  [label](link)
// A link to a Google Maps search is a location: shown as a pill with a pin,
// it opens the map at that place. Links may also go to apps (zotero:, obsidian:, …).
// `\` before a markup character keeps it as it is.

/** App links a description may hold besides web and mail links (also allowed in the opener, see capabilities). */
export const APP_SCHEMES = ["zotero", "obsidian", "notion", "things", "x-devonthink-item", "onenote", "tel", "sms", "facetime"];

const SCHEME = new RegExp(`^(https?://|mailto:|(?:${APP_SCHEMES.join("|")}):)`, "i");
/** Whether a link may be opened (web, mail, the app links above). */
export const safeLink = (href: string) => SCHEME.test(href);

const MAPS = "https://www.google.com/maps/search/?api=1&query=";
/** The link a location opens: Google Maps, searching for the place. */
export const locationLink = (place: string) => MAPS + encodeURIComponent(place.trim());
/** The place a location link searches for, or null for any other link. */
export function locationOf(href: string): string | null {
  if (!href.startsWith(MAPS)) return null;
  try {
    return decodeURIComponent(href.slice(MAPS.length).replace(/\+/g, " "));
  } catch {
    return null;
  }
}
/** A location as markdown: `[place](maps link)`. */
export const locationMarkdown = (place: string) => `[${escapeText(place.trim())}](${locationLink(place)})`;
/** A description with a place added on a line of its own (first, before anything written already). */
export const withLocation = (notes: string | null | undefined, place: string) => (notes ? `${locationMarkdown(place)}\n${notes}` : locationMarkdown(place));

// ---------- Blocks ----------

export type BlockType = "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "quote";

export interface Block {
  type: BlockType;
  text: string;
  /** Numbered: the item's number as typed. */
  n?: number;
}

export function parseBlocks(md: string): Block[] {
  return md.split("\n").map((line): Block => {
    let m = /^(#{1,3}) (.*)$/.exec(line);
    if (m) return { type: `h${m[1].length}` as BlockType, text: m[2] };
    m = /^[-*] (.*)$/.exec(line);
    if (m) return { type: "ul", text: m[1] };
    m = /^(\d{1,9})\. (.*)$/.exec(line);
    if (m) return { type: "ol", text: m[2], n: +m[1] };
    m = /^> ?(.*)$/.exec(line);
    if (m) return { type: "quote", text: m[1] };
    return { type: "p", text: line };
  });
}

const PREFIX: Record<Exclude<BlockType, "ol">, string> = { p: "", h1: "# ", h2: "## ", h3: "### ", ul: "- ", quote: "> " };

/** A plain line that would read as a heading, an item or a quote keeps its first character as typed. */
function guardLine(text: string): string {
  return /^(#{1,3} |[-*] |\d{1,9}\. |>)/.test(text) ? `\\${text}` : text;
}

export function blockLine(b: Block): string {
  if (b.type === "ol") return `${b.n ?? 1}. ${b.text}`;
  if (b.type === "p") return guardLine(b.text);
  return PREFIX[b.type] + b.text;
}

// ---------- Inline ----------

export type Inline =
  | { t: "text"; text: string }
  | { t: "b" | "i" | "s" | "u"; kids: Inline[] }
  | { t: "link"; href: string; text: string }
  | { t: "loc"; place: string; text: string };

const ESCAPABLE = "\\*_~[]<>#-";
const LINK = /^\[((?:\\.|[^\]\\\n])+)\]\(([^\s)]+)\)/;
const BARE = /^(?:https?:\/\/|www\.)[^\s<>()"]*[^\s<>()".,;:!?']/i;
const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Where a pair of markers (`**`, `~~`, `*`, `_`) closes, or -1. */
function closing(s: string, from: number, mark: string): number {
  for (let k = from; k <= s.length - mark.length; k++) {
    if (s[k] === "\\") {
      k++;
      continue;
    }
    if (s.startsWith(mark, k) && s[k - 1] !== " " && k > from) {
      // A run of three closes ** with its last two ("**bold *italic***").
      if (mark === "**" && s[k + 2] === "*") continue;
      // A single * must not be the start of a ** (and _ must end a word).
      if (mark === "*" && s[k + 1] === "*") {
        k++;
        continue;
      }
      if (mark === "_" && word(s[k + 1])) continue;
      return k;
    }
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", text });
    text = "";
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    const rest = s.slice(i);
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "[") {
      const m = LINK.exec(rest);
      if (m && safeLink(m[2])) {
        flush();
        const label = unescape(m[1]);
        const place = locationOf(m[2]);
        out.push(place !== null ? { t: "loc", place, text: label } : { t: "link", href: m[2], text: label });
        i += m[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "H" || c === "w" || c === "W") && !word(s[i - 1])) {
      const m = BARE.exec(rest);
      if (m) {
        flush();
        const raw = m[0];
        out.push({ t: "link", href: /^www\./i.test(raw) ? `https://${raw}` : raw, text: raw });
        i += raw.length;
        continue;
      }
    }
    const pair = (mark: string, t: "b" | "i" | "s"): boolean => {
      if (!rest.startsWith(mark) || s[i + mark.length] === " " || i + mark.length >= s.length) return false;
      if (mark === "_" && word(s[i - 1])) return false;
      const end = closing(s, i + mark.length, mark);
      if (end < 0) return false;
      flush();
      out.push({ t, kids: parseInline(s.slice(i + mark.length, end)) });
      i = end + mark.length;
      return true;
    };
    if (pair("**", "b") || pair("~~", "s") || pair("*", "i") || pair("_", "i")) continue;
    if (rest.startsWith("<u>")) {
      const end = s.indexOf("</u>", i + 3);
      if (end > i + 3) {
        flush();
        out.push({ t: "u", kids: parseInline(s.slice(i + 3, end)) });
        i = end + 4;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

function unescape(s: string): string {
  return s.replace(/\\([\\*_~[\]<>#-])/g, "$1");
}

/** Text as markdown: markup characters that would otherwise turn into formatting get a `\`. */
export function escapeText(s: string): string {
  const plain = parseInline(s);
  if (plain.length === 0 || (plain.length === 1 && plain[0].t === "text" && plain[0].text === s)) return s.replace(/\\(?=[\\*_~[\]<>#-])/g, "\\\\");
  return s.replace(/[\\*_~[\]<]/g, "\\$&");
}

/** What inline markdown reads as, without the markup. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "link" || n.t === "loc" ? n.text : inlineText(n.kids))).join("");
}

/** A description (or a title) without any markup: for widgets, previews, search. */
export function plainMarkdown(md: string): string {
  return parseBlocks(md)
    .map((b) => inlineText(parseInline(b.text)))
    .join("\n");
}

/** The first line that has text, without its markup (a row's preview). */
export function firstLineOf(md: string): string {
  for (const b of parseBlocks(md)) {
    if (b.text.trim()) return b.text.trim();
  }
  return "";
}

// ---------- HTML for the editor ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The pin drawn in a location pill (the app's 16 px icon style). */
export const PIN_SVG =
  '<svg class="icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 14s4.6-4.1 4.6-7.6a4.6 4.6 0 0 0-9.2 0C3.4 9.9 8 14 8 14z"/><circle cx="8" cy="6.4" r="1.6"/></svg>';

export function inlineHtml(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "text":
          return esc(n.text);
        case "link":
          return `<a href="${esc(n.href)}">${esc(n.text)}</a>`;
        case "loc":
          return `<span class="loc-pill" contenteditable="false" data-place="${esc(n.place)}">${PIN_SVG}<span>${esc(n.text)}</span></span>`;
        default:
          return `<${n.t}>${inlineHtml(n.kids)}</${n.t}>`;
      }
    })
    .join("");
}

/** The editor's HTML for a description: one element per line, lists and quotes grouped. */
export function notesToHtml(md: string): string {
  const blocks = parseBlocks(md);
  let html = "";
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const inner = inlineHtml(parseInline(b.text)) || "<br>";
    if (b.type === "ul" || b.type === "ol" || b.type === "quote") {
      const tag = b.type === "quote" ? "blockquote" : b.type;
      const start = b.type === "ol" && (b.n ?? 1) !== 1 ? ` start="${b.n}"` : "";
      const item = b.type === "quote" ? "div" : "li";
      html += `<${tag}${start}>`;
      for (; k < blocks.length && blocks[k].type === b.type; k++) html += `<${item}>${inlineHtml(parseInline(blocks[k].text)) || "<br>"}</${item}>`;
      html += `</${tag}>`;
      k--;
      continue;
    }
    html += b.type === "p" ? `<div>${inner}</div>` : `<${b.type}>${inner}</${b.type}>`;
  }
  return html;
}

// ---------- The editor's DOM back to markdown ----------

const BLOCK_TAGS = new Set(["DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE"]);

/** Inline content of a node as markdown. */
function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText((node.textContent ?? "").replace(/ /g, " ").replace(/​/g, ""));
  if (!(node instanceof HTMLElement)) return "";
  if (node.classList.contains("loc-pill")) {
    const place = node.dataset.place ?? node.textContent ?? "";
    const label = node.textContent ?? place;
    return label.trim() ? `[${escapeText(label.trim())}](${locationLink(place)})` : "";
  }
  if (node.tagName === "BR") return "";
  const kids = [...node.childNodes].map(inlineMd).join("");
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    return safeLink(href) && kids.trim() ? `[${kids}](${href})` : kids;
  }
  const style = node.style;
  const tag = node.tagName;
  const marks: [string, string][] = [];
  if (tag === "B" || tag === "STRONG" || +style.fontWeight >= 600 || style.fontWeight === "bold") marks.push(["**", "**"]);
  if (tag === "I" || tag === "EM" || style.fontStyle === "italic") marks.push(["*", "*"]);
  if (tag === "S" || tag === "STRIKE" || tag === "DEL" || /line-through/.test(style.textDecoration)) marks.push(["~~", "~~"]);
  if (tag === "U" || /underline/.test(style.textDecoration)) marks.push(["<u>", "</u>"]);
  if (!marks.length) return kids;
  // Spaces stay outside the markers ("**word** ", never "**word **").
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(kids)!;
  if (!m[2]) return kids;
  const open = marks.map((x) => x[0]).join("");
  const close = marks.map((x) => x[1]).reverse().join("");
  return `${m[1]}${open}${m[2]}${close}${m[3]}`;
}

/** Lines of a container: inline runs between its blocks and line breaks, each as a block of `type`. */
function containerLines(el: Node, type: BlockType, out: Block[]): void {
  let run = "";
  let open = false;
  const flush = (force = false) => {
    if (open || force) out.push({ type, text: run });
    run = "";
    open = false;
  };
  const kids = [...el.childNodes];
  kids.forEach((n, idx) => {
    if (n instanceof HTMLElement && BLOCK_TAGS.has(n.tagName)) {
      flush();
      blockLines(n, type, out);
      return;
    }
    if (n instanceof HTMLElement && n.tagName === "BR") {
      // A break at the very end only holds an empty line open.
      const last = idx === kids.length - 1;
      if (last && open) return flush();
      flush(true);
      return;
    }
    const md = inlineMd(n);
    if (md || n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && n.classList.contains("loc-pill"))) {
      run += md;
      open = true;
    }
  });
  flush();
}

function blockLines(el: HTMLElement, inherited: BlockType, out: Block[]): void {
  const tag = el.tagName;
  const before = out.length;
  if (tag === "UL" || tag === "OL") {
    let n = tag === "OL" ? +(el.getAttribute("start") ?? 1) || 1 : 0;
    for (const li of el.children) {
      if (!(li instanceof HTMLElement)) continue;
      if (li.tagName === "UL" || li.tagName === "OL") {
        blockLines(li, inherited, out);
        continue;
      }
      const at = out.length;
      containerLines(li, tag === "OL" ? "ol" : "ul", out);
      if (out.length === at) out.push({ type: tag === "OL" ? "ol" : "ul", text: "" });
      for (let k = at; k < out.length; k++) if (out[k].type === "ol") out[k].n = n++;
    }
    return;
  }
  const type: BlockType =
    tag === "H1" ? "h1" : tag === "H2" ? "h2" : /^H[3-6]$/.test(tag) ? "h3" : tag === "BLOCKQUOTE" ? "quote" : tag === "LI" ? "ul" : inherited;
  containerLines(el, type, out);
  // An empty block is an empty line.
  if (out.length === before) out.push({ type, text: "" });
}

/** The editor's lines, as blocks (one per line, empty ones included). */
export function htmlToBlocks(root: HTMLElement): Block[] {
  const out: Block[] = [];
  containerLines(root, "p", out);
  return out;
}

/** The editor's content as a description. */
export function htmlToNotes(root: HTMLElement): string {
  // Headings and quotes without text are plain empty lines.
  const lines = htmlToBlocks(root).map((b) => (b.text.trim() || b.type === "ul" || b.type === "ol" ? blockLine(b) : ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
