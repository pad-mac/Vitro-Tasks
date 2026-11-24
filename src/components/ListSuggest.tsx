// Suggestions while typing a task: lists after "#", repeats after "every" /
// "jeden" / "alle 2". Arrow keys move, Enter or Tab picks.
import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { repeatSuggestions } from "../lib/quickparse";
import { orderedLists } from "../lib/views";
import { useStore } from "../store";
import { Icon } from "./ui";

export interface ListOption {
  kind?: "list";
  id: string;
  name: string;
  path: string;
  color: string;
}

export interface RepeatOption {
  kind: "repeat";
  id: string;
  phrase: string;
  label: string;
}

export type SuggestOption = ListOption | RepeatOption;

/** The token typed into the field for a list: its name without spaces. */
export const listToken = (name: string) => name.replace(/\s+/g, "");

/**
 * `lists: false` (the phone's quick add): "#" does not list matches here; the
 * caller shows its own list picker, filtered by `listQuery` (`listMatches`,
 * the likeliest first) and takes the token out with `dropListToken`.
 */
export function useListSuggest(value: string, setValue: (v: string) => void, input: RefObject<HTMLInputElement | null>, opts: { lists?: boolean } = {}) {
  const showLists = opts.lists ?? true;
  const lists = useStore((s) => s.lists);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const options = useMemo<ListOption[]>(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));
    return orderedLists(lists).map((l) => {
      const parent = l.parent_id ? byId.get(l.parent_id) : null;
      return { id: l.id, name: l.name, color: l.color, path: parent ? `${parent.name} › ${l.name}` : l.name };
    });
  }, [lists]);

  // The caret is read from the field itself, so a character just typed counts
  // straight away; the caret state only re-renders after arrow keys or clicks.
  const el = input.current;
  const pos = el && el.value === value && document.activeElement === el ? (el.selectionStart ?? value.length) : Math.min(caret, value.length);
  const before = value.slice(0, pos);
  const m = /(^|\s)#([^\s#]*)$/.exec(before);
  const query = m ? m[2].toLowerCase() : null;
  const repeats = useMemo(() => (query === null ? repeatSuggestions(before) : null), [query, before]);
  const listMatches = useMemo<ListOption[]>(() => {
    if (query === null) return [];
    const q = query.replace(/\s+/g, "");
    const key = (o: ListOption) => listToken(o.name).toLowerCase();
    const starts = options.filter((o) => key(o).startsWith(q));
    const contains = options.filter((o) => !key(o).startsWith(q) && (key(o).includes(q) || o.path.toLowerCase().includes(q)));
    return [...starts, ...contains];
  }, [options, query]);
  const items = useMemo<SuggestOption[]>(() => {
    if (query === null) return repeats ? repeats.items.map((x) => ({ kind: "repeat" as const, id: x.phrase, ...x })) : [];
    return showLists ? listMatches.slice(0, 7) : [];
  }, [listMatches, query, repeats, showLists]);

  /** The text without the "#…" being typed (and the caret where it was). */
  const dropListToken = () => {
    if (query === null) return;
    const start = before.length - query.length - 1;
    const rest = value.slice(before.length).replace(/^\S*/, "");
    const head = value.slice(0, start).replace(/\s+$/, "");
    const next = head && rest.trim() ? `${head} ${rest.trimStart()}` : `${head}${head ? " " : ""}${rest.trimStart()}`;
    const pos = Math.min(next.length, head.length + (head ? 1 : 0));
    setValue(next);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };
  const open = items.length > 0 && dismissed !== before;
  const active = Math.min(index, items.length - 1);

  const accept = (o: SuggestOption) => {
    // The typed part gives way to the chosen token or phrase, and the caret goes after it.
    const typed = o.kind === "repeat" ? (repeats?.typed ?? "") : `#${query ?? ""}`;
    const token = o.kind === "repeat" ? o.phrase : `#${listToken(o.name)}`;
    const start = before.length - typed.length;
    const rest = value.slice(before.length).replace(/^\S*/, "");
    const next = `${value.slice(0, start)}${token} ${rest.trimStart()}`;
    const pos = start + token.length + 1;
    setValue(next);
    setIndex(0);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  /** Returns true when the key was used by the suggestions. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setIndex((active + d + items.length) % items.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(items[active]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(before);
      return true;
    }
    return false;
  };

  const track = () => setCaret(input.current?.selectionStart ?? value.length);
  return {
    open,
    items,
    active,
    accept,
    onKeyDown,
    setIndex,
    listQuery: query,
    listMatches,
    dropListToken,
    /** Puts the caret at `pos` (after the caller changed the text). */
    placeCaret: (pos: number) => {
      setCaret(pos);
      requestAnimationFrame(() => input.current?.setSelectionRange(pos, pos));
    },
    inputProps: { onSelect: track, onKeyUp: track, onClick: track },
  };
}

export function SuggestList({ s, className = "" }: { s: ReturnType<typeof useListSuggest>; className?: string }) {
  if (!s.open) return null;
  return (
    <div className={`list-suggest ${className}`} role="listbox">
      {s.items.map((o, i) => (
        <button
          type="button"
          role="option"
          aria-selected={i === s.active}
          key={o.id}
          className={`suggest-item ${i === s.active ? "is-active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            s.accept(o);
          }}
          onMouseEnter={() => s.setIndex(i)}
        >
          {o.kind === "repeat" ? (
            <>
              <Icon name="repeat" size={13} />
              <span className="suggest-name">{o.phrase}</span>
              <span className="suggest-token">{o.label}</span>
            </>
          ) : (
            <>
              <i className="dot" style={{ background: o.color }} />
              <span className="suggest-name">{o.path}</span>
              <span className="suggest-token">#{listToken(o.name)}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
