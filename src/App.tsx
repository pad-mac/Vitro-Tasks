import { useEffect, useMemo, useState } from "react";
import { CalendarView } from "./components/CalendarView";
import { ContextMenu } from "./components/ContextMenu";
import { KanbanView } from "./components/KanbanView";
import { ListView } from "./components/ListView";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Composer, TaskDetail, TaskPopup } from "./components/TaskDetail";
import { TimelineView } from "./components/TimelineView";
import { Icon, MenuItem, Popover } from "./components/ui";
import { isTauri, windowAction } from "./lib/platform";
import { SMART_VIEWS, groupTasks, tasksForView, type ViewRef } from "./lib/views";
import type { GroupBy, SortBy, ViewMode } from "./shared/schema";
import { computePrefs, useStore } from "./store";

const MODES: { value: ViewMode; label: string; icon: string }[] = [
  { value: "list", label: "List", icon: "list" },
  { value: "kanban", label: "Kanban", icon: "board" },
  { value: "timeline", label: "Timeline", icon: "timeline" },
];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "deadline", label: "Deadline" },
  { value: "priority", label: "Priority" },
  { value: "title", label: "Title" },
  { value: "created", label: "Created time" },
  { value: "manual", label: "Custom" },
];

function groupOptions(view: ViewRef): { value: GroupBy; label: string }[] {
  const all: { value: GroupBy; label: string }[] = [
    { value: "section", label: "Section" },
    { value: "list", label: "List" },
    { value: "date", label: "Date" },
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
  const showDetails = useStore((s) => s.showDetails);
  const setShowDetails = useStore((s) => s.setShowDetails);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setPrefs = useStore((s) => s.setPrefs);
  const addSection = useStore((s) => s.addSection);

  const prefs = useMemo(() => computePrefs(view, lists, settings), [view, lists, settings]);
  const completedView = view.kind === "smart" && view.id === "completed";
  const mode: ViewMode = completedView ? "list" : prefs.view_mode;
  const groups = useMemo(() => {
    const data = { lists, sections, tasks };
    const visible = tasksForView(view, data, showCompleted);
    return groupTasks(visible, completedView ? { group_by: "none", sort_by: "created" } : prefs, view, data);
  }, [view, lists, sections, tasks, showCompleted, prefs, completedView]);

  const title = view.kind === "list" ? (lists.find((l) => l.id === view.id)?.name ?? "") : SMART_VIEWS.find((v) => v.id === view.id)!.name;
  const sectioned = view.kind === "list" && prefs.group_by === "section";
  const effectiveGroup: GroupBy = prefs.group_by === "section" && view.kind !== "list" ? "none" : prefs.group_by;

  return (
    <>
      <header className="view-head">
        <button type="button" className="icon-btn icon-btn-lg" title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <Icon name="sidebar" size={18} />
        </button>
        <h1>{title}</h1>
        {!completedView && (
          <div className="head-tools">
            <Popover align="right" title="Group and sort" trigger={<span className="icon-btn icon-btn-lg"><Icon name="sort" size={18} /></span>}>
              {() => (
                <div className="menu menu-two">
                  <div>
                    <span className="cm-label">Group by</span>
                    {groupOptions(view).map((o) => (
                      <MenuItem key={o.value} active={o.value === effectiveGroup} onClick={() => void setPrefs(view, { group_by: o.value })}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </div>
                  <div>
                    <span className="cm-label">Sort by</span>
                    {SORTS.map((o) => (
                      <MenuItem key={o.value} active={o.value === prefs.sort_by} onClick={() => void setPrefs(view, { sort_by: o.value })}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </div>
                </div>
              )}
            </Popover>
            <Popover align="right" title="View" trigger={<span className="icon-btn icon-btn-lg"><Icon name="dots" size={18} /></span>}>
              {(close) => (
                <div className="menu cm">
                  <span className="cm-label">View</span>
                  <div className="view-switch" role="tablist" aria-label="View mode">
                    {MODES.map((m) => (
                      <button
                        type="button"
                        key={m.value}
                        role="tab"
                        aria-selected={mode === m.value}
                        title={m.label}
                        className={mode === m.value ? "is-active" : ""}
                        onClick={() => {
                          void setPrefs(view, { view_mode: m.value });
                          close();
                        }}
                      >
                        <Icon name={m.icon} size={20} />
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </div>
                  <div className="cm-sep" />
                  <MenuItem onClick={() => { setShowCompleted(!showCompleted); close(); }}>
                    <Icon name="done" size={15} /> {showCompleted ? "Hide Completed" : "Show Completed"}
                  </MenuItem>
                  <MenuItem onClick={() => { void setShowDetails(!showDetails); close(); }}>
                    <Icon name="notes" size={15} /> {showDetails ? "Hide Details" : "Show Details"}
                  </MenuItem>
                  {view.kind === "list" && (
                    <MenuItem
                      onClick={() => {
                        void setPrefs(view, { group_by: "section" });
                        void addSection(view.id, "New section");
                        close();
                      }}
                    >
                      <Icon name="plus" size={15} /> Add Section
                    </MenuItem>
                  )}
                </div>
              )}
            </Popover>
          </div>
        )}
      </header>
      {mode === "list" && <ListView view={view} groups={groups} sectioned={sectioned} />}
      {mode === "kanban" && <KanbanView view={view} groups={groups} sectioned={sectioned} sort={prefs.sort_by} />}
      {mode === "timeline" && <TimelineView view={view} groups={groups} sectioned={sectioned} />}
    </>
  );
}

function Titlebar({ onSettings, lastTaskView }: { onSettings: () => void; lastTaskView: ViewRef }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const sync = useStore((s) => s.sync);
  const syncNow = useStore((s) => s.syncNow);
  const update = useStore((s) => s.update);
  const installUpdate = useStore((s) => s.installUpdate);
  const syncTitle =
    sync.status === "off"
      ? "Sync is not set up"
      : sync.status === "error"
        ? `Sync failed: ${sync.message}`
        : sync.status === "syncing"
          ? "Syncing…"
          : `Synced${sync.last ? ` at ${new Date(sync.last).toLocaleTimeString()}` : ""}`;
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="logo" aria-label="Vitro Tasks" data-tauri-drag-region>V</span>
      <nav className="tb-nav">
        <button type="button" className={`tb-btn ${view.kind !== "calendar" ? "is-active" : ""}`} title="Tasks (1)" onClick={() => setView(lastTaskView)}>
          <Icon name="tasks" size={17} /> <span>Tasks</span>
        </button>
        <button type="button" className={`tb-btn ${view.kind === "calendar" ? "is-active" : ""}`} title="Calendar (2)" onClick={() => setView({ kind: "calendar" })}>
          <Icon name="calendar" size={17} /> <span>Calendar</span>
        </button>
      </nav>
      <div className="tb-drag" data-tauri-drag-region />
      {(update.status === "available" || update.status === "installing") && (
        <button type="button" className="tb-update" disabled={update.status === "installing"} onClick={() => void installUpdate()}>
          <Icon name="download" size={14} />
          {update.status === "installing" ? `Updating… ${Math.round((update.progress ?? 0) * 100)}%` : `Update to ${update.version}`}
        </button>
      )}
      <button type="button" className={`tb-btn tb-icon sync-${sync.status}`} title={syncTitle} onClick={() => (sync.status === "off" ? onSettings() : void syncNow())}>
        <Icon name="sync" size={17} />
        <i className="sync-dot" />
      </button>
      <button type="button" className="tb-btn tb-icon" title="Settings" onClick={onSettings}>
        <Icon name="settings" size={17} />
      </button>
      {isTauri() && (
        <div className="win-controls">
          <button type="button" aria-label="Minimize" onClick={() => void windowAction("minimize")}><Icon name="winmin" /></button>
          <button type="button" aria-label="Maximize" onClick={() => void windowAction("toggleMaximize")}><Icon name="winmax" /></button>
          <button type="button" aria-label="Close" className="win-close" onClick={() => void windowAction("close")}><Icon name="x" /></button>
        </div>
      )}
    </header>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selected = useStore((s) => s.tasks.find((t) => t.id === s.selectedId));
  const anchor = useStore((s) => s.anchor);
  const select = useStore((s) => s.select);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const shortcut = useStore((s) => s.shortcut);
  const shortcutError = useStore((s) => s.shortcutError);
  const checkUpdate = useStore((s) => s.checkUpdate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastTaskView, setLastTaskView] = useState<ViewRef>({ kind: "smart", id: "today" });

  useEffect(() => {
    if (view.kind !== "calendar") setLastTaskView(view);
  }, [view]);

  // Look for a new release shortly after start, then every six hours.
  useEffect(() => {
    if (!ready || !isTauri()) return;
    const first = setTimeout(() => void checkUpdate(), 5000);
    const again = setInterval(() => void checkUpdate(), 6 * 3600 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [ready, checkUpdate]);

  useEffect(() => {
    // The app has its own menus; the webview's default one only stays for text fields.
    const onContext = (e: MouseEvent) => {
      if (!/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
      if (e.key === "Escape" && !typing) {
        if (settingsOpen) setSettingsOpen(false);
        else if (!useStore.getState().anchor) select(null);
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "1") setView(lastTaskView);
      if (e.key === "2") setView({ kind: "calendar" });
      if (e.key === "n") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".add-bar input")?.focus();
      }
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
    };
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

  const pane = selected && !anchor ? selected : null;
  return (
    <div className="app">
      <Titlebar onSettings={() => setSettingsOpen(true)} lastTaskView={lastTaskView} />
      {shortcutError && (
        <button type="button" className="banner" onClick={() => setSettingsOpen(true)}>
          Quick add shortcut {shortcut} could not be registered ({shortcutError}). Click to choose another one.
        </button>
      )}
      <div className="workspace">
        {view.kind !== "calendar" && sidebarOpen && <Sidebar />}
        <main className="main">{view.kind === "calendar" ? <CalendarView /> : <TaskViews view={view} />}</main>
        {pane && <TaskDetail task={pane} variant="pane" />}
      </div>
      {selected && anchor && <TaskPopup task={selected} />}
      <Composer />
      <ContextMenu />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
