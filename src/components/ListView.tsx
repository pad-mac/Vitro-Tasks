import { useState } from "react";
import { defaultsForView, type Group, type ViewRef } from "../lib/views";
import { useStore } from "../store";
import { AddBar, TaskRow, useDropTarget } from "./tasks";
import { Icon, InlineInput, MenuItem, Popover } from "./ui";

function GroupBlock({ group, view, sectioned }: { group: Group; view: ViewRef; sectioned: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const updateTask = useStore((s) => s.updateTask);
  const updateSection = useStore((s) => s.updateSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const drop = useDropTarget((id) => {
    if (Object.keys(group.patch).length) void updateTask(id, group.patch);
  });
  const isSection = sectioned && group.key !== "nosection";
  return (
    <section className={`group ${drop.over ? "is-drop" : ""}`} {...drop.props}>
      {group.label && (
        <header className={`group-head ${group.tone === "overdue" ? "tone-overdue" : ""}`}>
          <button type="button" className={`twist ${collapsed ? "" : "is-open"}`} onClick={() => setCollapsed(!collapsed)} aria-label="Collapse group">
            <Icon name="chevron" size={12} />
          </button>
          {renaming ? (
            <InlineInput
              initial={group.label}
              onCommit={(v) => {
                void updateSection(group.key, { name: v });
                setRenaming(false);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span className="group-label" onDoubleClick={() => isSection && setRenaming(true)}>
              {group.label}
            </span>
          )}
          <span className="count mono">{group.tasks.length}</span>
          {isSection && (
            <Popover className="hover-reveal" trigger={<Icon name="dots" size={14} />} title="Section options">
              {(close) => (
                <div className="menu">
                  <MenuItem onClick={() => { setRenaming(true); close(); }}>Rename section</MenuItem>
                  <MenuItem danger onClick={() => { void deleteSection(group.key); close(); }}>Delete section</MenuItem>
                </div>
              )}
            </Popover>
          )}
        </header>
      )}
      {!collapsed && group.tasks.map((t) => <TaskRow key={t.id} task={t} showList={view.kind !== "list" || t.list_id !== view.id} />)}
      {!collapsed && group.label && !group.tasks.length && <div className="group-empty">No tasks</div>}
    </section>
  );
}

export function ListView({ view, groups, sectioned }: { view: ViewRef; groups: Group[]; sectioned: boolean }) {
  const addSection = useStore((s) => s.addSection);
  const [adding, setAdding] = useState(false);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  
  const completedView = view.kind === "smart" && view.id === "completed";
  return (
    <div className="list-view">
      <div className="list-inner">
        {!completedView && <AddBar base={defaultsForView(view)} />}
        {groups.map((g) => (
          <GroupBlock key={g.key} group={g} view={view} sectioned={sectioned} />
        ))}
        {!total && !groups.some((g) => g.label) && (
          <div className="empty">
            <span className="empty-mark mono">00</span>
            <p>{completedView ? "Nothing completed yet." : "Nothing here. Type above to add a task."}</p>
          </div>
        )}
        {sectioned &&
          (adding ? (
            <div className="add-section">
              <InlineInput
                placeholder="Section name"
                onCommit={(v) => {
                  void addSection((view as { id: string }).id, v);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <button type="button" className="ghost-btn add-section" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> Add section
            </button>
          ))}
      </div>
    </div>
  );
}
