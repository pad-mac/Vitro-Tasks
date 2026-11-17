// The floating quick add bar (its own frameless window, opened by the global shortcut).
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/ui";
import { useCreateTask } from "./components/tasks";
import { formatDateTime } from "./lib/dates";
import { hideCurrentWindow, onEvent, showMainWindow } from "./lib/platform";
import { matchList, parseQuick } from "./lib/quickparse";
import { PRIORITY_LABELS } from "./lib/views";
import { useStore } from "./store";

export function QuickAdd() {
  const ready = useStore((s) => s.ready);
  const lists = useStore((s) => s.lists);
  const reload = useStore((s) => s.reload);
  const create = useCreateTask();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseQuick(value), [value]);
  const list = matchList(parsed.listQuery, lists);

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

  const close = () => {
    setValue("");
    void hideCurrentWindow();
  };

  const submit = async (openAfter: boolean) => {
    if (!parsed.title) return;
    await create(value);
    setSaved(parsed.title);
    setValue("");
    if (openAfter) {
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
        <span className="qa-mark">V</span>
        <input
          ref={input}
          autoFocus
          value={value}
          placeholder="Add a task…"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit(e.ctrlKey || e.metaKey);
            if (e.key === "Escape") close();
          }}
        />
        <kbd>Enter</kbd>
      </div>
      <div className="qa-foot">
        {saved ? (
          <span className="qa-saved">
            <Icon name="check" size={14} /> Added “{saved}”
          </span>
        ) : value.trim() ? (
          <span className="qa-chips">
            <span className="qa-chip">
              <Icon name="inbox" size={12} /> {list ? list.name : parsed.listQuery ? `no list “${parsed.listQuery}” → Inbox` : "Inbox"}
            </span>
            {parsed.start_date && (
              <span className="qa-chip mono">
                <Icon name="calendar" size={12} /> {formatDateTime(parsed.start_date, parsed.start_time)}
              </span>
            )}
            {parsed.deadline_date && (
              <span className="qa-chip is-deadline mono">
                <Icon name="deadline" size={12} /> {formatDateTime(parsed.deadline_date, parsed.deadline_time)}
              </span>
            )}
            {parsed.priority > 0 && <span className={`qa-chip p${parsed.priority}`}>{PRIORITY_LABELS[parsed.priority]}</span>}
          </span>
        ) : (
          <span className="qa-hint mono">tomorrow 14:00 · ^fri deadline · !high · #list · Ctrl+Enter opens app · Esc closes</span>
        )}
      </div>
    </div>
  );
}
