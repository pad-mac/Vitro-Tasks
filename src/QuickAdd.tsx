// The floating quick add bar (its own frameless window, opened by the global shortcut).
import { useEffect, useMemo, useRef, useState } from "react";
import { SuggestList, useListSuggest } from "./components/ListSuggest";
import { Icon } from "./components/ui";
import { useCreateTask } from "./components/tasks";
import { formatDateTime } from "./lib/dates";
import { hideCurrentWindow, onEvent, requestOpenTask, setQuickAddHeight, showMainWindow } from "./lib/platform";
import { matchList, parseQuick } from "./lib/quickparse";
import { PRIORITY_LABELS } from "./lib/views";
import { useStore } from "./store";

const BAR_H = 56;
const FOOT_H = 34;
const ROW_H = 34;

/** What typed quick-add text turns into: list, date, deadline and priority. */
/** `typedListOnly`: show the list only when the text names one (the phone's add sheet shows the list on its button). */
export function ParsedChips({ value, typedListOnly }: { value: string; typedListOnly?: boolean }) {
  const lists = useStore((s) => s.lists);
  const parsed = useMemo(() => parseQuick(value), [value]);
  const list = matchList(parsed.listQuery, lists);
  return (
    <span className="qa-chips">
      {(!typedListOnly || parsed.listQuery) && (
        <span className="qa-chip">
          {list ? <i className="dot" style={{ background: list.color }} /> : <Icon name="inbox" size={12} />}
          {list ? list.name : parsed.listQuery ? `no list “${parsed.listQuery}” → Inbox` : "Inbox"}
        </span>
      )}
      {parsed.start_date && (
        <span className="qa-chip">
          <Icon name="calendar" size={12} /> {formatDateTime(parsed.start_date, parsed.start_time)}
        </span>
      )}
      {parsed.deadline_date && (
        <span className="qa-chip is-deadline">
          <Icon name="deadline" size={12} /> {formatDateTime(parsed.deadline_date, parsed.deadline_time)}
        </span>
      )}
      {parsed.priority > 0 && <span className={`qa-chip p${parsed.priority}`}>{PRIORITY_LABELS[parsed.priority]}</span>}
    </span>
  );
}

export function QuickAdd() {
  const ready = useStore((s) => s.ready);
  const reload = useStore((s) => s.reload);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const suggest = useListSuggest(value, setValue, input);

  const parsed = useMemo(() => parseQuick(value), [value]);

  useEffect(() => {
    document.documentElement.classList.add("quickadd-window");
    let off = () => {};
    void onEvent("quickadd:shown", () => {
      setSaved(null);
      void reload();
      input.current?.focus();
    }).then((fn) => (off = fn));
    return () => off();
  }, [reload]);

  // The window grows while list suggestions are shown.
  const rows = suggest.open ? suggest.items.length : 0;
  useEffect(() => {
    void setQuickAddHeight(BAR_H + (rows ? rows * ROW_H + 12 : FOOT_H) + 2);
  }, [rows]);

  const close = () => {
    setValue("");
    void hideCurrentWindow();
  };

  const submit = async (openAfter: boolean) => {
    if (!parsed.title) return;
    const task = await create(value);
    setSaved(parsed.title);
    setValue("");
    if (openAfter && task) {
      // Open the main window on the task's list (or the Inbox) with the task open.
      await requestOpenTask(task.id, task.list_id);
      await showMainWindow();
      void hideCurrentWindow();
    } else {
      setTimeout(() => void hideCurrentWindow(), 450);
    }
  };

  if (!ready) return null;
  return (
    <div className="qa">
      <div className="qa-bar">
        <input
          ref={input}
          autoFocus
          value={value}
          placeholder="Add a task…"
          spellCheck={false}
          {...suggest.inputProps}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(null);
          }}
          onKeyDown={(e) => {
            if (suggest.onKeyDown(e)) return;
            if (e.key === "Enter") void submit(e.ctrlKey || e.metaKey);
            if (e.key === "Escape") close();
          }}
        />
        <kbd>Enter</kbd>
      </div>
      {suggest.open ? (
        <SuggestList s={suggest} className="qa-suggest" />
      ) : (
        <div className="qa-foot">
          {saved ? (
            <span className="qa-saved">
              <Icon name="check" size={14} /> Added “{saved}”
            </span>
          ) : value.trim() ? (
            <ParsedChips value={value} />
          ) : (
            <span className="qa-hint">tomorrow 14:00 · ^fri deadline · !high · #list · Ctrl+Enter adds and opens · Esc closes</span>
          )}
        </div>
      )}
    </div>
  );
}
