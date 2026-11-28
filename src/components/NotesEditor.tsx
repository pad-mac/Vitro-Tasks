// The description editor: what is written shows formatted while it is written
// (headings, lists, quotes, bold, italic, struck, underlined, links, places) and
// is kept as markdown (lib/markdown). Selecting text brings up a bar with the
// formatting; a place turns the selection into a pill that opens Google Maps.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { blockLine, htmlToBlocks, htmlToNotes, locationLink, notesToHtml, PIN_SVG, safeLink, type Block, type BlockType } from "../lib/markdown";
import { isMobile, openExternal } from "../lib/platform";
import { Icon } from "./ui";

export interface NotesDraft {
  value: string;
  "data-draft": string;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
}

const BLOCKS: { type: BlockType; label: string; icon: string }[] = [
  { type: "p", label: "Text", icon: "fmt-text" },
  { type: "h1", label: "Heading 1", icon: "fmt-h1" },
  { type: "h2", label: "Heading 2", icon: "fmt-h2" },
  { type: "h3", label: "Heading 3", icon: "fmt-h3" },
  { type: "ul", label: "Bulleted List", icon: "fmt-ul" },
  { type: "ol", label: "Numbered List", icon: "fmt-ol" },
  { type: "quote", label: "Quote", icon: "fmt-quote" },
];

// ---------- Selection as character offsets (survives redrawing the lines) ----------

function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
  return out;
}

function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  let n = 0;
  for (const t of textNodes(root)) {
    if (t === node) return n + offset;
    if (node.nodeType !== Node.TEXT_NODE && node.contains(t)) {
      // A boundary between children: count the text before the child at `offset`.
      const child = node.childNodes[offset];
      if (child && (child === t || child.contains(t))) return n;
    }
    n += t.length;
  }
  return n;
}

function saveSelection(root: HTMLElement): { a: number; b: number } | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer)) return null;
  return { a: offsetOf(root, r.startContainer, r.startOffset), b: offsetOf(root, r.endContainer, r.endOffset) };
}

function pointAt(root: HTMLElement, at: number): [Node, number] {
  let n = 0;
  const nodes = textNodes(root);
  for (const t of nodes) {
    if (at <= n + t.length && !t.parentElement?.closest(".loc-pill")) return [t, at - n];
    n += t.length;
  }
  return [root, root.childNodes.length];
}

function restoreSelection(root: HTMLElement, s: { a: number; b: number } | null) {
  if (!s) return;
  const r = document.createRange();
  const [sn, so] = pointAt(root, s.a);
  const [en, eo] = pointAt(root, s.b);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/** The editor's line elements in order (one per line once redrawn: blocks, list items, quote lines). */
function lineElements(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.children) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.tagName === "UL" || el.tagName === "OL" || el.tagName === "BLOCKQUOTE") out.push(...([...el.children] as HTMLElement[]));
    else out.push(el);
  }
  return out;
}

/** Numbered runs count up from their first item's number. */
function renumber(blocks: Block[]): Block[] {
  let n = 0;
  return blocks.map((b, k) => {
    if (b.type !== "ol") return b;
    n = k > 0 && blocks[k - 1].type === "ol" ? n + 1 : (b.n ?? 1);
    return { ...b, n };
  });
}

export function NotesEditor({ draft, placeholder, className = "" }: { draft: NotesDraft; placeholder: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // The description the editor shows right now (so its own changes are not drawn again).
  const shown = useRef<string | null>(null);
  const shownFor = useRef<string | null>(null);
  const [empty, setEmpty] = useState(!draft.value);
  const id = draft["data-draft"];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (draft.value === shown.current && shownFor.current === id) return;
    // While being written in, what comes back from saving is what it shows already.
    if (document.activeElement === el && shownFor.current === id && shown.current !== null) return;
    el.innerHTML = notesToHtml(draft.value);
    shown.current = draft.value;
    shownFor.current = id;
    setEmpty(!draft.value);
  }, [draft.value, id]);

  const changed = () => {
    const el = ref.current;
    if (!el) return;
    const md = htmlToNotes(el);
    setEmpty(!md && !el.querySelector("li, h1, h2, h3, blockquote, .loc-pill"));
    if (md === shown.current) return;
    shown.current = md;
    draft.onChange({ target: { value: md } });
  };

  /** Redraws the lines from their markdown (after a change of line kinds), keeping the selection. */
  const redraw = (blocks: Block[]) => {
    const el = ref.current;
    if (!el) return;
    const sel = saveSelection(el);
    el.innerHTML = notesToHtml(renumber(blocks).map(blockLine).join("\n"));
    restoreSelection(el, sel);
    changed();
  };

  const setBlock = (type: BlockType) => {
    const el = ref.current;
    if (!el) return;
    // Lines as the editor has them now, drawn one element per line.
    const sel = saveSelection(el);
    const blocks = htmlToBlocks(el);
    el.innerHTML = notesToHtml(blocks.map(blockLine).join("\n"));
    restoreSelection(el, sel);
    const range = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0) : null;
    const lines = lineElements(el);
    const picked = lines.map((l, k) => (range && range.intersectsNode(l) ? k : -1)).filter((k) => k >= 0 && k < blocks.length);
    if (!picked.length) return;
    // Lists and quotes toggle off when every picked line is one already.
    const off = (type === "ul" || type === "ol" || type === "quote") && picked.every((k) => blocks[k].type === type);
    const next = blocks.map((b, k) => (picked.includes(k) ? { ...b, type: off ? "p" : type, n: type === "ol" && !off ? 1 : undefined } : b));
    redraw(next);
  };

  const inline = (cmd: "bold" | "italic" | "strikeThrough" | "underline") => {
    document.execCommand(cmd);
    changed();
  };

  const link = (href: string | null, range: Range | null) => {
    const el = ref.current;
    if (!el || !range) return;
    el.focus();
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (href) document.execCommand("createLink", false, href);
    else document.execCommand("unlink");
    changed();
  };

  /** The selection becomes a place (or, where it holds places, plain text again). */
  const place = () => {
    const el = ref.current;
    const sel = getSelection();
    if (!el || !sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const pills = [...el.querySelectorAll<HTMLElement>(".loc-pill")].filter((p) => range.intersectsNode(p));
    if (pills.length) {
      for (const p of pills) p.replaceWith(document.createTextNode(p.textContent ?? ""));
      el.normalize();
      return changed();
    }
    const text = range.toString().replace(/\s+/g, " ").trim();
    if (!text) return;
    const pill = document.createElement("span");
    pill.className = "loc-pill";
    pill.contentEditable = "false";
    pill.dataset.place = text;
    pill.innerHTML = `${PIN_SVG}<span></span>`;
    pill.lastElementChild!.textContent = text;
    range.deleteContents();
    range.insertNode(pill);
    // The caret goes on after it: before the space that follows, or (at the end of a line) after a
    // zero-width one, which a description never keeps (the caret needs text to sit in).
    const next = pill.nextSibling;
    const spaced = next?.nodeType === Node.TEXT_NODE && /^\s/.test(next.textContent ?? "");
    const after = spaced ? (next as Text) : document.createTextNode("\u200b");
    if (!spaced) pill.after(after);
    const r = document.createRange();
    r.setStart(after, spaced ? 0 : 1);
    sel.removeAllRanges();
    sel.addRange(r);
    changed();
  };

  return (
    <>
      <div
        ref={ref}
        className={`${className} rich-editor ${empty ? "is-empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        data-draft={id}
        spellCheck
        onInput={changed}
        onBlur={() => {
          changed();
          draft.onBlur();
        }}
        onPaste={(e) => {
          // Text only: formatting from elsewhere does not come along.
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("text/plain")) return;
          e.preventDefault();
        }}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          const pill = t.closest<HTMLElement>(".loc-pill");
          const a = t.closest<HTMLAnchorElement>("a[href]");
          // A place always opens; a link opens while not writing (or with Ctrl / ⌘ held).
          if (pill || (a && (document.activeElement !== ref.current || e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            e.stopPropagation();
            const href = pill ? locationLink(pill.dataset.place ?? pill.textContent ?? "") : a!.getAttribute("href")!;
            if (safeLink(href)) void openExternal(href);
          }
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && !e.altKey && !e.shiftKey && (e.key === "b" || e.key === "i" || e.key === "u")) {
            e.preventDefault();
            inline(e.key === "b" ? "bold" : e.key === "i" ? "italic" : "underline");
          }
        }}
      />
      <FormatBar editor={ref} onBlock={setBlock} onInline={inline} onLink={link} onPlace={place} />
    </>
  );
}

// ---------- The bar over a selection ----------

function blockAt(editor: HTMLElement, node: Node | null): BlockType {
  let n: Node | null = node;
  while (n && n !== editor) {
    if (n instanceof HTMLElement) {
      const tag = n.tagName;
      if (tag === "H1") return "h1";
      if (tag === "H2") return "h2";
      if (/^H[3-6]$/.test(tag)) return "h3";
      if (tag === "UL") return "ul";
      if (tag === "OL") return "ol";
      if (tag === "BLOCKQUOTE") return "quote";
    }
    n = n.parentNode;
  }
  return "p";
}

function FormatBar({
  editor,
  onBlock,
  onInline,
  onLink,
  onPlace,
}: {
  editor: React.RefObject<HTMLDivElement | null>;
  onBlock: (t: BlockType) => void;
  onInline: (cmd: "bold" | "italic" | "strikeThrough" | "underline") => void;
  onLink: (href: string | null, range: Range | null) => void;
  onPlace: () => void;
}) {
  const [at, setAt] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const [state, setState] = useState({ block: "p" as BlockType, bold: false, italic: false, strike: false, underline: false, link: null as string | null, place: false });
  const [menu, setMenu] = useState(false);
  const [linking, setLinking] = useState<{ range: Range; value: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    let timer = 0;
    const read = () => {
      const sel = getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed || document.activeElement !== el || !el.contains(sel.anchorNode)) {
        if (!bar.current?.contains(document.activeElement)) {
          setAt(null);
          setMenu(false);
          setLinking(null);
        }
        return;
      }
      const range = sel.getRangeAt(0);
      const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
      const first = rects[0] ?? range.getBoundingClientRect();
      const box = range.getBoundingClientRect();
      setAt({ x: rects.length > 1 ? box.left + box.width / 2 : first.left + first.width / 2, top: first.top, bottom: (rects[rects.length - 1] ?? box).bottom });
      const a = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest("a[href]");
      setState({
        block: blockAt(el, range.startContainer),
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        strike: document.queryCommandState("strikeThrough"),
        underline: document.queryCommandState("underline"),
        link: a && el.contains(a) ? a.getAttribute("href") : null,
        place: [...el.querySelectorAll(".loc-pill")].some((p) => range.intersectsNode(p)),
      });
    };
    // Not while the mouse is still selecting: the bar comes once the selection is made.
    const onSel = () => {
      clearTimeout(timer);
      if (pointerDown.current) return;
      timer = window.setTimeout(read, isMobile ? 220 : 60);
    };
    const down = () => (pointerDown.current = true);
    const up = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      onSel();
    };
    document.addEventListener("selectionchange", onSel);
    el.addEventListener("mousedown", down);
    document.addEventListener("mouseup", up);
    const hide = () => setAt(null);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
      el.removeEventListener("mousedown", down);
      document.removeEventListener("mouseup", up);
      window.removeEventListener("resize", hide);
    };
  }, [editor]);

  // Placed over the selection on the desktop; on the phone under it (iOS shows its own menu above).
  useLayoutEffect(() => {
    const b = bar.current;
    if (!b || !at) return;
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, at.x - w / 2));
    const above = at.top - h - 8;
    const below = at.bottom + (isMobile ? 34 : 8);
    const top = isMobile ? (below + h < innerHeight - 8 ? below : above) : above > 8 ? above : below;
    b.style.left = `${Math.round(left)}px`;
    b.style.top = `${Math.round(top)}px`;
  });

  if (!at) return null;
  const keep = { onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onPointerDown: (e: React.PointerEvent) => e.preventDefault() };
  const btn = (name: string, title: string, on: boolean, act: () => void, content?: ReactNode) => (
    <button type="button" className={`fmt-btn ${on ? "is-on" : ""}`} title={title} aria-label={title} aria-pressed={on} {...keep} onClick={act}>
      {content ?? <Icon name={name} size={16} />}
    </button>
  );
  const current = BLOCKS.find((b) => b.type === state.block) ?? BLOCKS[0];
  return createPortal(
    <div ref={bar} className={`fmt-bar ${isMobile ? "is-touch" : ""}`} role="toolbar" aria-label="Formatting">
      {linking ? (
        <form
          className="fmt-link"
          onSubmit={(e) => {
            e.preventDefault();
            const v = linking.value.trim();
            const href = v && !/^[a-z][a-z0-9+.-]*:/i.test(v) ? `https://${v}` : v;
            onLink(href && safeLink(href) ? href : null, linking.range);
            setLinking(null);
          }}
        >
          <Icon name="link" size={15} />
          <input
            autoFocus
            value={linking.value}
            placeholder="Paste or type a link"
            onChange={(e) => setLinking({ ...linking, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onLink(state.link, linking.range);
                setLinking(null);
              }
            }}
          />
          {state.link && btn("x", "Remove the link", false, () => {
            onLink(null, linking.range);
            setLinking(null);
          })}
        </form>
      ) : (
        <>
          <button type="button" className={`fmt-btn fmt-block ${menu ? "is-open" : ""}`} title="Text style" aria-haspopup="menu" aria-expanded={menu} {...keep} onClick={() => setMenu((m) => !m)}>
            <Icon name={current.icon} size={16} />
            <Icon name="chevron" size={10} />
          </button>
          <i className="fmt-sep" />
          {btn("fmt-b", "Bold", state.bold, () => onInline("bold"))}
          {btn("fmt-i", "Italic", state.italic, () => onInline("italic"))}
          {btn("fmt-s", "Strikethrough", state.strike, () => onInline("strikeThrough"))}
          {btn("fmt-u", "Underline", state.underline, () => onInline("underline"))}
          <i className="fmt-sep" />
          {btn("link", state.link ? "Edit the link" : "Link", !!state.link, () => {
            const sel = getSelection();
            if (sel?.rangeCount) setLinking({ range: sel.getRangeAt(0).cloneRange(), value: state.link ?? "" });
          })}
          {btn("place", state.place ? "Back to text" : "Place (opens in Google Maps)", state.place, onPlace)}
          {menu && (
            <div className="fmt-menu" role="menu">
              {BLOCKS.map((b) => (
                <button
                  type="button"
                  key={b.type}
                  role="menuitem"
                  className={`fmt-item ${b.type === state.block ? "is-on" : ""}`}
                  {...keep}
                  onClick={() => {
                    onBlock(b.type);
                    setMenu(false);
                  }}
                >
                  <Icon name={b.icon} size={16} />
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
