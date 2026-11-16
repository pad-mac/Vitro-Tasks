import { useEffect, useMemo, useState } from "react";
import { CalendarView } from "./components/CalendarView";
import { KanbanView } from "./components/KanbanView";
import { ListView } from "./components/ListView";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { TimelineView } from "./components/TimelineView";
import { Icon, Select } from "./components/ui";
import { SMART_VIEWS, groupTasks, tasksForView, type ViewRef } from "./lib/views";
import type { GroupBy, SortBy, ViewMode } from "./shared/schema";
import { computePrefs, useStore } from "./store";

const MODES: { value: ViewMode; label: string; icon: string }[] = [
  { value: "list", label: "List", icon: "list" },
  { value: "kanban", label: "Board", icon: "board" },
  { value: "timeline", label: "Timeline", icon: "timeline" },
];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "date", label: "Planned date" },
  { value: "deadline", label: "Deadline" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
  { value: "created", label: "Newest" },
];

function groupOptions(view: ViewRef): { value: GroupBy; label: string }[] {
  const all: { value: GroupBy; label: string }[] = [
    { value: "section", label: "Section" },
    { value: "list", label: "List" },
    { value: "date", label: "Planned date" },
    { value: "deadline", label: "Deadline" },
    { value: "priority", label: "Priority" },
    { value: "none", label: "None" },
  ];
  return all.filter((o) => (o.value === "section" ? view.kind === "list" : true));
}

function TaskViews({ view }: { view: Exclude<ViewRef, { kind: "calendar" }> }) {
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const showCompleted = useStore((s) => s.showCompleted);
  const setShowCompleted = useStore((s) => s.setShowCompleted);
  const setPrefs = useStore((s) => s.setPrefs);

  const prefs = useMemo(() => computePrefs(view, lists, settings), [view, lists, settings]);
  const completedView = view.kind === "smart" && view.id === "completed";
  const mode: ViewMode = completedView ? "list" : prefs.view_mode;
  const groups = useMemo(() => {
    const data = { lists, sections, tasks };
    const visible = tasksForView(view, data, showCompleted);
    return groupTasks(visible, completedView ? { group_by: "none", sort_by: "created" } : prefs, view, data);
  }, [view, lists, sections, tasks, showCompleted, prefs, completedView]);

  const title = view.kind === "list" ? (lists.find((l) => l.id === view.id)?.name ?? "") : SMART_VIEWS.find((v) => v.id === view.id)!.name;
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const sectioned = view.kind === "list" && prefs.group_by === "section";
  const effectiveGroup: GroupBy = prefs.group_by === "section" && view.kind !== "list" ? "none" : prefs.group_by;

  return (
    <>
      <header className="view-head">
        <h1>
          {title} <span className="mono thin">{String(total).padStart(2, "0")}</span>
        </h1>
        {!completedView && (
          <div className="head-tools">
            <Select icon="group" label="Group" value={effectiveGroup} options={groupOptions(view)} onChange={(v) => void setPrefs(view, { group_by: v })} align="right" />
            <Select icon="sort" label="Sort" value={prefs.sort_by} options={SORTS} onChange={(v) => void setPrefs(view, { sort_by: v })} align="right" />
            <button type="button" className={`btn ${showCompleted ? "is-on" : ""}`} onClick={() => setShowCompleted(!showCompleted)} title="Show completed tasks">
              <Icon name="done" size={14} /> Completed
            </button>
            <div className="segmented" role="tablist" aria-label="View mode">
              {MODES.map((m) => (
                <button type="button" key={m.value} role="tab" aria-selected={mode === m.value} className={mode === m.value ? "is-active" : ""} onClick={() => void setPrefs(view, { view_mode: m.value })}>
                  <Icon name={m.icon} size={14} /> {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>
      {mode === "list" && <ListView view={view} groups={groups} sectioned={sectioned} />}
      {mode === "kanban" && <KanbanView view={view} groups={groups} sectioned={sectioned} />}
      {mode === "timeline" && <TimelineView view={view} groups={groups} sectioned={sectioned} />}
    </>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selected = useStore((s) => s.tasks.find((t) => t.id === s.selectedId));
  const select = useStore((s) => s.select);
  const sync = useStore((s) => s.sync);
  const syncNow = useStore((s) => s.syncNow);
  const shortcut = useStore((s) => s.shortcut);
  const shortcutError = useStore((s) => s.shortcutError);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastTaskView, setLastTaskView] = useState<ViewRef>({ kind: "smart", id: "today" });

  useEffect(() => {
    if (view.kind !== "calendar") setLastTaskView(view);
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
      if (e.key === "Escape" && !typing) {
        if (settingsOpen) setSettingsOpen(false);
        else select(null);
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1") setView(lastTaskView);
      if (e.key === "2") setView({ kind: "calendar" });
      if (e.key === "n") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".add-bar input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, lastTaskView, select, setView]);

  if (fatal) {
    return (
      <div className="boot">
        <b>Vitro Tasks could not open its database.</b>
        <code>{fatal}</code>
      </div>
    );
  }
  if (!ready) return <div className="boot"><span className="micro">loading</span></div>;

  const syncTitle =
    sync.status === "off"
      ? "Sync is not set up"
      : sync.status === "error"
        ? `Sync failed: ${sync.message}`
        : sync.status === "syncing"
          ? "Syncing…"
          : `Synced${sync.last ? ` at ${new Date(sync.last).toLocaleTimeString()}` : ""}`;

  return (
    <div className={`app ${selected ? "has-detail" : ""} ${shortcutError ? "has-banner" : ""}`}>
      {shortcutError && (
        <button type="button" className="banner" onClick={() => setSettingsOpen(true)}>
          Quick add shortcut {shortcut} could not be registered ({shortcutError}). Click to choose another one.
        </button>
      )}
      <div className="rail">
        <span className="logo" aria-label="Vitro Tasks">V</span>
        <button type="button" className={`rail-btn ${view.kind !== "calendar" ? "is-active" : ""}`} title="Tasks (1)" onClick={() => setView(lastTaskView)}>
          <Icon name="tasks" size={18} />
        </button>
        <button type="button" className={`rail-btn ${view.kind === "calendar" ? "is-active" : ""}`} title="Calendar (2)" onClick={() => setView({ kind: "calendar" })}>
          <Icon name="calendar" size={18} />
        </button>
        <span className="rail-space" />
        <button
          type="button"
          className={`rail-btn sync-${sync.status}`}
          title={syncTitle}
          onClick={() => (sync.status === "off" ? setSettingsOpen(true) : void syncNow())}
        >
          <Icon name="sync" size={18} />
          <i className="sync-dot" />
        </button>
        <button type="button" className="rail-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" size={18} />
        </button>
      </div>
      {view.kind !== "calendar" && <Sidebar />}
      <main className="main">{view.kind === "calendar" ? <CalendarView /> : <TaskViews view={view} />}</main>
      {selected && <TaskDetail key="detail" task={selected} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
