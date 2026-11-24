import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import { CalendarView, EditModeToggle } from "./components/CalendarView";
import { ContextMenu } from "./components/ContextMenu";
import { HoldMenu } from "./components/HoldMenu";
import { KanbanView } from "./components/KanbanView";
import { ListView } from "./components/ListView";
import { MobileAdd, MobileBar, MobileTaskSheet, useEdgeSwipe, useTouchGestures } from "./components/Mobile";
import { SelectBar, SelectHead, UndoButton } from "./components/Select";
import { setBackdrop } from "./lib/backdrop";
import { watchPress } from "./lib/press";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Composer, TaskDetail, TaskPopup } from "./components/TaskDetail";
import { TimelineView } from "./components/TimelineView";
import { Icon, MenuItem, Popover } from "./components/ui";
import { isMobile, isTauri, onOpenTask, windowAction, windowLabel } from "./lib/platform";
import { comboFromEvent, hasModifier, isTyping, shortcutRecording, type ActionId } from "./lib/shortcuts";
import { orderKey, parseRanks } from "./lib/order";
import { SMART_VIEWS, groupTasks, hiddenLists, tasksForView, type Group, type ViewRef } from "./lib/views";
import type { GroupBy, SortBy, Task, ViewMode } from "./shared/schema";
import { computePrefs, useStore, viewKey } from "./store";

/** Windows narrower than this get the drawer sidebar and a full-width side pane. */
const NARROW = 720;

function useNarrow() {
  // Phones always get the narrow layout (tablets too, for the touch-sized parts).
  const [narrow, setNarrow] = useState(() => isMobile || innerWidth < NARROW);
  useEffect(() => {
    const onResize = () => setNarrow(isMobile || innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}


const MODES: { value: ViewMode; label: string; icon: string }[] = [
  { value: "list", label: "List", icon: "list" },
  { value: "kanban", label: "Kanban", icon: "board" },
  { value: "timeline", label: "Timeline", icon: "timeline" },
];

const SORTS: { value: SortBy; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "deadline", label: "Deadline" },
  { value: "datedeadline", label: "Date & Deadline" },
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

// Memoised: App re-renders for the sheet, the drawer, the quick add and the keyboard; the lists under them need not.
const TaskViews = memo(function TaskViews({ view }: { view: Exclude<ViewRef, { kind: "calendar" }> }) {
  const lists = useStore((s) => s.lists);
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const settings = useStore((s) => s.settings);
  const showCompleted = useStore((s) => s.showCompleted);
  const lingering = useStore((s) => s.lingering);
  const setShowCompleted = useStore((s) => s.setShowCompleted);
  const showDetails = useStore((s) => s.showDetails);
  const setShowDetails = useStore((s) => s.setShowDetails);
  const setPrefs = useStore((s) => s.setPrefs);
  const addSection = useStore((s) => s.addSection);
  const detached = useStore((s) => s.detached);
  const selecting = useStore((s) => s.selecting);
  const setSelecting = useStore((s) => s.setSelecting);
  const toggleSidebar = useToggleSidebar();

  const prefs = useMemo(() => computePrefs(view, lists, settings), [view, lists, settings]);
  const completedView = view.kind === "smart" && view.id === "completed";
  const mode: ViewMode = completedView ? "list" : prefs.view_mode;
  const groups = useMemo(() => {
    const data = { lists, sections, tasks, hidden: hiddenLists(settings), lingering };
    const visible = tasksForView(view, data, showCompleted);
    if (completedView) return groupTasks(visible, { group_by: "none", sort_by: "created" }, view, data);
    return groupTasks(visible, prefs, view, data, undefined, parseRanks(settings[orderKey(viewKey(view), prefs.sort_by)]));
  }, [view, lists, sections, tasks, settings, showCompleted, prefs, completedView, lingering]);
  const customOrder = !completedView && prefs.sort_by !== "manual" && !!settings[orderKey(viewKey(view), prefs.sort_by)];
  const clearCustomOrder = useStore((s) => s.clearCustomOrder);

  const title = view.kind === "list" ? (lists.find((l) => l.id === view.id)?.name ?? "") : SMART_VIEWS.find((v) => v.id === view.id)!.name;
  const sectioned = view.kind === "list" && prefs.group_by === "section";
  const effectiveGroup: GroupBy = prefs.group_by === "section" && view.kind !== "list" ? "none" : prefs.group_by;

  const canSelect = !completedView && (mode === "list" || mode === "kanban");
  if (selecting && canSelect)
    return (
      <>
        <SelectHead title={title} groups={groups} />
        {mode === "list" && <ListView view={view} groups={groups} sectioned={sectioned} sort={prefs.sort_by} />}
        {mode === "kanban" && <KanbanView view={view} groups={groups} sectioned={sectioned} sort={prefs.sort_by} />}
        <SelectBar view={view} />
      </>
    );

  return (
    <>
      <header className="view-head" data-tauri-drag-region={detached ? true : undefined}>
        <button type="button" className="icon-btn icon-btn-lg" title="Show or hide the lists" onClick={toggleSidebar}>
          <Icon name="sidebar" size={20} />
        </button>
        <h1 data-tauri-drag-region={detached ? true : undefined}>{title}</h1>
        {completedView && (
          <div className="head-tools">
            <FoldAllButton groups={groups} completed />
          </div>
        )}
        {!completedView && (
          <div className="head-tools">
            <EditModeToggle view={view} />
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
                    {customOrder && (
                      <>
                        <div className="cm-sep" />
                        <MenuItem onClick={() => void clearCustomOrder(view, prefs.sort_by)}>
                          <Icon name="undo" size={14} /> Restore default order
                        </MenuItem>
                      </>
                    )}
                  </div>
                </div>
              )}
            </Popover>
            {mode !== "timeline" && <FoldAllButton groups={groups} completed={false} />}
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
                  {canSelect && (
                    <MenuItem onClick={() => { setSelecting([]); close(); }}>
                      <Icon name="select" size={15} /> Select
                    </MenuItem>
                  )}
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
      {mode === "list" && <ListView view={view} groups={groups} sectioned={sectioned} sort={completedView ? "created" : prefs.sort_by} />}
      {mode === "kanban" && <KanbanView view={view} groups={groups} sectioned={sectioned} sort={prefs.sort_by} />}
      {mode === "timeline" && <TimelineView view={view} groups={groups} sectioned={sectioned} />}
    </>
  );
});

/**
 * Folds or unfolds the subtasks of every task in the view at once (list and
 * board). Shows "unfold" when everything is folded, else "fold".
 */
function FoldAllButton({ groups, completed }: { groups: Group[]; completed: boolean }) {
  const tasks = useStore((s) => s.tasks);
  const folded = useStore((s) => s.folded);
  const setFolds = useStore((s) => s.setFolds);
  const parents = useMemo(() => {
    const withKids = new Set(tasks.filter((t) => t.parent_id).map((t) => t.parent_id!));
    return groups.flatMap((g) => g.tasks).filter((t) => withKids.has(t.id)).map((t) => t.id);
  }, [groups, tasks]);
  if (!parents.length) return null;
  // The Completed view starts folded: there an entry means "opened".
  const isFolded = (id: string) => (completed ? !folded[`open:${id}`] : !!folded[id]);
  const all = parents.every(isFolded);
  const keys = completed ? parents.map((id) => `open:${id}`) : parents;
  return (
    <button type="button" className="icon-btn icon-btn-lg" title={all ? "Unfold all subtasks" : "Fold all subtasks"} onClick={() => setFolds(keys, completed ? all : !all)}>
      <Icon name={all ? "unfoldall" : "foldall"} size={18} />
    </button>
  );
}

/** Sidebar button: in narrow windows it slides the lists over the content. */
function useToggleSidebar() {
  const narrow = useNarrow();
  return () => {
    const s = useStore.getState();
    if (narrow) s.setDrawerOpen(!s.drawerOpen);
    else s.setSidebarOpen(!s.sidebarOpen);
  };
}

/** The sync servers in the title bar: a click switches one on or off (off: its lists are hidden everywhere). */
function TitlebarServers() {
  const servers = useStore((s) => s.servers);
  const states = useStore((s) => s.serverSync);
  const updateServer = useStore((s) => s.updateServer);
  if (!servers.length) return null;
  return (
    <div className="tb-servers" role="group" aria-label="Sync servers">
      {servers.map((x) => {
        const st = x.enabled ? (states[x.id]?.status ?? "idle") : "off";
        const what = !x.enabled
          ? "off: its lists are hidden"
          : st === "error"
            ? `sync failed: ${states[x.id]?.message ?? ""}`
            : st === "syncing"
              ? "syncing…"
              : states[x.id]?.last
                ? `synced at ${new Date(states[x.id]!.last!).toLocaleTimeString()}`
                : "on";
        return (
          <button
            type="button"
            key={x.id}
            className={`tb-server sync-${st} ${x.enabled ? "is-on" : ""}`}
            aria-pressed={x.enabled}
            title={`${x.name}: ${what}. Click to ${x.enabled ? "hide" : "show"} its lists.`}
            onClick={() => void updateServer(x.id, { enabled: !x.enabled })}
          >
            <i className="sync-dot" />
            {x.name}
          </button>
        );
      })}
    </div>
  );
}

function Titlebar({ onSettings }: { onSettings: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const lastTaskView = useStore((s) => s.lastTaskView);
  const openMenu = useStore((s) => s.openMenu);
  const layerMenu = (layer: "tasks" | "calendar") => (e: RMouseEvent) => {
    e.preventDefault();
    openMenu({ kind: "layer", id: layer, x: e.clientX, y: e.clientY });
  };
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
      <nav className="tb-nav">
        <button type="button" className={`tb-btn ${view.kind !== "calendar" ? "is-active" : ""}`} title="Tasks (right-click: open in a new window)" onClick={() => setView(lastTaskView)} onContextMenu={layerMenu("tasks")}>
          <Icon name="tasks" size={17} /> <span>Tasks</span>
        </button>
        <button type="button" className={`tb-btn ${view.kind === "calendar" ? "is-active" : ""}`} title="Calendar (right-click: open in a new window)" onClick={() => setView({ kind: "calendar" })} onContextMenu={layerMenu("calendar")}>
          <Icon name="calendar" size={17} /> <span>Calendar</span>
        </button>
      </nav>
      <TitlebarServers />
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

/** Runs a shortcut action. Returns false when it does not apply here. */
function runAction(id: ActionId, narrow: boolean): boolean {
  const s = useStore.getState();
  const inCalendar = s.view.kind === "calendar";
  switch (id) {
    case "switchLayer":
      if (s.detached) return false;
      s.setView(inCalendar ? s.lastTaskView : { kind: "calendar" });
      return true;
    case "goTasks":
      if (s.detached) return false;
      s.setView(s.lastTaskView);
      return true;
    case "goCalendar":
      if (s.detached) return false;
      s.setView({ kind: "calendar" });
      return true;
    case "addTask": {
      const input = document.querySelector<HTMLInputElement>(".add-bar input");
      if (!input) return false;
      input.focus();
      return true;
    }
    case "calWeek":
      if (!inCalendar) return false;
      s.setCalMode("week");
      return true;
    case "calMonth":
      // M goes to whichever of Month and Multi-Week was used last.
      if (!inCalendar) return false;
      s.setCalMode(s.calMonthLike);
      return true;
    case "calToday":
      if (!inCalendar) return false;
      s.goCalToday();
      return true;
    case "toggleSidebar":
      if (inCalendar) return false;
      if (narrow) s.setDrawerOpen(!s.drawerOpen);
      else s.setSidebarOpen(!s.sidebarOpen);
      return true;
    case "toggleEditMode":
      void s.setEditMode(s.view, s.editMode(s.view) === "popup" ? "pane" : "popup");
      return true;
  }
}

/** Presses on empty space close the side pane, as an outside click closes the popup. */
const KEEPS_SELECTION =
  ".task-row, .card, .cal-chip, .week-event, .tl-item, .tl-chip, .tl-title, .layer, .floating, button, input, textarea, a, .add-bar, .rich-view";

/**
 * Whether a text field has the focus (on the phone: the keyboard is up).
 * Only a field that is still on the page and shown counts: iOS sends no blur
 * when a focused field is removed, and a hidden one (the closed quick add)
 * can keep the focus when a script may not move it. While typing, the check
 * repeats itself, so a missed event cannot leave the bar hidden.
 */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const shown = !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest("[aria-hidden='true']");
      setTyping(isTyping(el) && shown);
    };
    const onOut = () => setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", onOut);
    const timer = setInterval(check, 700);
    return () => {
      clearInterval(timer);
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}

export function App() {
  const ready = useStore((s) => s.ready);
  const fatal = useStore((s) => s.fatal);
  const view = useStore((s) => s.view);
  const selected = useStore((s) => s.tasks.find((t) => t.id === s.selectedId) ?? null);
  const select = useStore((s) => s.select);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawerOpen = useStore((s) => s.setDrawerOpen);
  const detached = useStore((s) => s.detached);
  // Phones always open a task full screen.
  const editMode = useStore((s) => (isMobile ? "pane" : s.editMode(s.view)));
  const shortcut = useStore((s) => s.shortcut);
  const shortcutError = useStore((s) => s.shortcutError);
  const narrow = useNarrow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addPreset, setAddPreset] = useState<Partial<Task> | null>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const openAdd = useCallback((preset: Partial<Task> | null) => {
    setAddPreset(preset);
    setAddOpen(true);
    addInput.current?.focus();
  }, []);
  useTouchGestures();
  useEdgeSwipe();
  // The phone's bar steps aside for sheets, menus and the keyboard.
  const menu = useStore((s) => s.menu);
  const selecting = useStore((s) => s.selecting);
  const composer = useStore((s) => s.composer);
  const typing = useTyping();
  // iOS: the colour behind the web view is whatever sits at the bottom of the
  // page (a sheet, the quick add, the page), so the keyboard's rounded corners match it.
  const theme = useStore((s) => s.theme);
  // The edge swipe on the settings page goes back.
  useEffect(() => {
    const back = () => setSettingsOpen(false);
    window.addEventListener("vitro:back", back);
    return () => window.removeEventListener("vitro:back", back);
  }, []);
  // A widget's +: the quick add for the view it shows (lib/widgetBridge).
  useEffect(() => {
    const add = () => openAdd(null);
    window.addEventListener("vitro:quickadd", add);
    return () => window.removeEventListener("vitro:quickadd", add);
  }, [openAdd]);
  const pressWatched = useRef(false);
  useEffect(() => {
    if (!isMobile || pressWatched.current) return;
    pressWatched.current = true;
    watchPress();
  }, []);
  // What the keyboard's corners show: known from what is open (no measuring); the app hears only of a change.
  // The quick add floats above the keyboard: the dimmed page shows around it (and at the keyboard's corners).
  const sheetUp = !!selected || !!composer;
  useEffect(() => {
    if (isMobile) setBackdrop(settingsOpen ? "modal" : sheetUp ? "sheet" : addOpen ? "scrim" : "page");
  }, [settingsOpen, sheetUp, addOpen, theme]);

  // Quick add's Ctrl+Enter: show the new task inside its list (or the Inbox).
  useEffect(() => {
    if (windowLabel() !== "main") return;
    let off = () => {};
    void onOpenTask(async ({ taskId, listId }) => {
      const st = useStore.getState();
      await st.reload();
      st.setView(listId ? { kind: "list", id: listId } : { kind: "smart", id: "inbox" });
      useStore.getState().select(taskId, null);
    }).then((fn) => (off = fn));
    return () => off();
  }, []);

  useEffect(() => {
    // The app has its own menus; the webview's default one only stays for text fields.
    const onContext = (e: MouseEvent) => {
      if (!/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (shortcutRecording.active) return;
      const typing = isTyping(e.target);
      if (e.key === "Escape" && !typing) {
        const st = useStore.getState();
        if (settingsOpen) setSettingsOpen(false);
        else if (st.selecting && !document.querySelector(".pop-panel:not(.is-closing)")) st.setSelecting(null);
        else if (st.drawerOpen) st.setDrawerOpen(false);
        else if (!st.anchor || st.editMode(st.view) === "pane") select(null);
        return;
      }
      if (settingsOpen || document.querySelector(".floating:not(.is-closing), .pop-panel:not(.is-closing)")) {
        // Menus and popups keep the keyboard, apart from shortcuts with a modifier.
        if (!(e.ctrlKey || e.altKey || e.metaKey)) return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      // Single keys only act while nothing is being typed.
      if (typing && !hasModifier(combo)) return;
      const { shortcuts } = useStore.getState();
      const action = (Object.keys(shortcuts) as ActionId[]).find((k) => shortcuts[k] === combo);
      if (action && runAction(action, narrow)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen, select, narrow]);

  if (fatal) {
    return (
      <div className="boot">
        <b>Vitro Tasks could not open its database.</b>
        <code>{fatal}</code>
      </div>
    );
  }
  if (!ready) return <div className="boot"><span className="micro">loading</span></div>;

  const taskLayer = view.kind !== "calendar";
  // On the phone a task opens in a sheet instead of the side pane.
  const pane = selected && editMode === "pane" && !isMobile ? selected : null;
  const popup = selected && editMode === "popup" ? selected : null;
  const onWorkspaceDown = (e: RMouseEvent) => {
    if (!pane || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest(".detail-pane, .sidebar") || t.closest(KEEPS_SELECTION)) return;
    select(null);
  };
  return (
    <div className={`app ${narrow ? "is-narrow" : ""} ${detached ? "is-detached" : ""}`}>
      {isMobile ? null : detached ? (
        <div
          className="drag-strip"
          data-tauri-drag-region
          onContextMenu={(e) => {
            e.preventDefault();
            useStore.getState().openMenu({ kind: "window", id: "window", x: e.clientX, y: e.clientY });
          }}
        />
      ) : (
        <Titlebar onSettings={() => setSettingsOpen(true)} />
      )}
      {shortcutError && !detached && (
        <button type="button" className="banner" onClick={() => setSettingsOpen(true)}>
          Quick add shortcut {shortcut} could not be registered ({shortcutError}). Click to choose another one.
        </button>
      )}
      <div className="workspace" onMouseDown={onWorkspaceDown}>
        {taskLayer && !narrow && sidebarOpen && <Sidebar />}
        <main className="main">
          {view.kind === "calendar" ? <CalendarView /> : <TaskViews view={view} />}
          <UndoButton />
        </main>
        {pane && <TaskDetail key="pane" task={pane} variant="pane" />}
        {(taskLayer || isMobile) && narrow && drawerOpen && (
          <>
            <div className="drawer-scrim" onMouseDown={() => setDrawerOpen(false)} />
            <Sidebar
              drawer
              onSettings={
                isMobile
                  ? () => {
                      setDrawerOpen(false);
                      setSettingsOpen(true);
                    }
                  : undefined
              }
            />
          </>
        )}
      </div>
      <TaskPopup task={popup} />
      <Composer />
      <ContextMenu />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {isMobile && (
        <>
          <MobileBar
            settingsOpen={settingsOpen}
            hidden={drawerOpen || addOpen || !!selected || !!menu || !!composer || typing || !!selecting}
            onCloseSettings={() => setSettingsOpen(false)}
            onAdd={() => openAdd(null)}
          />
          <MobileTaskSheet task={selected} />
          <MobileAdd open={addOpen} onClose={() => setAddOpen(false)} inputRef={addInput} onOpen={openAdd} preset={addPreset} />
          <HoldMenu />
        </>
      )}
    </div>
  );
}
