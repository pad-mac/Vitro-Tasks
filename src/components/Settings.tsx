import { useEffect, useMemo, useState } from "react";
import { todayKey } from "../lib/dates";
import { isMobile, isTauri, saveTextFile } from "../lib/platform";
import { isTickTickBackup, isVitroCsv } from "../lib/transfer";
import { ACTIONS, DEFAULT_SHORTCUTS, comboFromEvent, shortcutRecording, type ActionId } from "../lib/shortcuts";
import { TEXT_SIZES, hiddenSmartViews, useStore, type ImportResult, type Theme } from "../store";
import { PALETTES, defaultPalette } from "../lib/palettes";
import { SMART_VIEWS } from "../lib/views";
import { SMART_ICONS } from "./Sidebar";
import type { SyncServer } from "../db/sync";
import { Icon } from "./ui";


/** Which of All, Today, Next 7 Days, … the sidebar shows. */
function SidebarSection() {
  const raw = useStore((s) => s.settings["sidebar:hidden"]);
  const setShown = useStore((s) => s.setSmartShown);
  const hidden = useMemo(() => hiddenSmartViews({ "sidebar:hidden": raw ?? "[]" }), [raw]);
  return (
    <section>
      <span className="micro">Sidebar</span>
      <div className="toggle-list">
        {SMART_VIEWS.map((v) => {
          const on = !hidden.includes(v.id);
          return (
            <button type="button" key={v.id} className="toggle-row" role="switch" aria-checked={on} onClick={() => void setShown(v.id, !on)}>
              <Icon name={SMART_ICONS[v.id]} size={16} />
              <span>{v.name}</span>
              <i className={`switch ${on ? "is-on" : ""}`} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One sync server: its name, address and token; on or off; where new lists go; remove. */
function ServerRow({ server, several }: { server: SyncServer; several: boolean }) {
  const st = useStore((s) => s.serverSync[server.id]);
  const updateServer = useStore((s) => s.updateServer);
  const removeServer = useStore((s) => s.removeServer);
  const setDefault = useStore((s) => s.setDefaultServer);
  const isDefault = useStore((s) => s.defaultServer === server.id);
  const syncNow = useStore((s) => s.syncNow);
  const [name, setName] = useState(server.name);
  const [url, setUrl] = useState(server.url);
  const [token, setToken] = useState(server.token);
  const [confirm, setConfirm] = useState(false);
  const changed = name.trim() !== server.name || url.trim().replace(/\/+$/, "") !== server.url || token.trim() !== server.token;
  const status = !server.enabled
    ? "Off: its lists are hidden and it is not synced."
    : st?.status === "syncing"
      ? "Syncing…"
      : st?.status === "error"
        ? (st.message ?? "Sync failed")
        : st?.last
          ? `Synced at ${new Date(st.last).toLocaleTimeString()}${st.version && st.version !== "dev" ? ` · server ${st.version}` : ""}`
          : "Connected";
  return (
    <div className={`server-card ${server.enabled ? "" : "is-off"}`}>
      <div className="server-top">
        <input className="server-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Server name" />
        {several && (
          <button type="button" className={`server-default ${isDefault ? "is-active" : ""}`} title="New lists and Inbox tasks go to this server" onClick={() => void setDefault(server.id)}>
            {isDefault ? "Default" : "Make default"}
          </button>
        )}
        <button type="button" className="server-toggle" title={server.enabled ? "On: click to hide its lists and stop syncing" : "Off: click to show its lists and sync"} onClick={() => void updateServer(server.id, { enabled: !server.enabled })}>
          <i className={`switch ${server.enabled ? "is-on" : ""}`} />
        </button>
      </div>
      <div className="form-row">
        <label>Server URL</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tasks.example.org" />
      </div>
      <div className="form-row">
        <label>Token</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="VITRO_TOKEN of your server" />
      </div>
      {server.enabled && st?.outdated && (
        <div className="server-warn" role="status">
          <b>This server needs an update.</b> It runs an older version than the app, so not everything set here reaches your other devices. Once, on the server, in the folder you cloned the repository to (from then on it updates itself):
          <code>git pull && cd server && docker compose up -d</code>
          The apps then send what it missed again by themselves.
        </div>
      )}
      <div className="form-actions">
        <span className={`sync-state sync-${server.enabled ? (st?.status === "idle" && st.outdated ? "outdated" : (st?.status ?? "idle")) : "off"}`}>
          <i className="sync-dot" />
          {status}
        </span>
        {confirm ? (
          <>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button type="button" className="btn is-danger" onClick={() => void removeServer(server.id)}>
              {several ? "Remove its lists from this device" : "Disconnect"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setConfirm(true)} title={several ? "Its lists leave this device; they stay on the server" : "Tasks stay on this device"}>
              {several ? "Remove" : "Disconnect"}
            </button>
            {changed ? (
              <button type="button" className="btn is-primary" disabled={!url.trim()} onClick={() => void updateServer(server.id, { name: name.trim() || server.name, url, token })}>
                Save and sync
              </button>
            ) : (
              server.enabled && (
                <button type="button" className="btn" onClick={() => void syncNow()}>
                  Sync now
                </button>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Several servers: each keeps its own lists; the views show those of all servers that are on. */
function ServersSection() {
  const servers = useStore((s) => s.servers);
  const addServer = useStore((s) => s.addServer);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const open = adding || servers.length === 0;
  const add = async () => {
    await addServer({ name, url, token });
    setName("");
    setUrl("");
    setToken("");
    setAdding(false);
  };
  return (
    <section>
      <span className="micro">Sync servers</span>
      {servers.map((x) => (
        <ServerRow key={x.id} server={x} several={servers.length > 1} />
      ))}
      {open ? (
        <div className="server-card is-new">
          <div className="form-row">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={servers.length ? "Work" : "Home"} />
          </div>
          <div className="form-row">
            <label>Server URL</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tasks.example.org" />
          </div>
          <div className="form-row">
            <label>Token</label>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="VITRO_TOKEN of your server" />
          </div>
          <div className="form-actions">
            <span className="sync-state sync-off">
              <i className="sync-dot" />
              {servers.length ? "Its lists join the others." : "Not connected. Tasks stay on this device."}
            </span>
            {servers.length > 0 && (
              <button type="button" className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
            )}
            <button type="button" className="btn is-primary" disabled={!url.trim()} onClick={() => void add()}>
              Add and sync
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn server-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={13} /> Add server
        </button>
      )}
      <p className="form-hint">
        {servers.length
          ? `Each server keeps its own lists; the views show the lists of every server that is on, together. Switch one off${isMobile ? "" : " (here or in the title bar)"} to hide its lists. New lists and Inbox tasks go to the default server; a list or task moved onto another server's list goes over to that server.`
          : "The first server takes the lists on this device. Add more to keep, say, work and private lists on separate servers."}
      </p>
    </section>
  );
}

function DataSection() {
  const exportCsv = useStore((s) => s.exportCsv);
  const importCsv = useStore((s) => s.importCsv);
  const importTickTick = useStore((s) => s.importTickTick);
  const [includeDone, setIncludeDone] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const summary = (r: ImportResult) => {
    const parts = [`${r.lists} list${r.lists === 1 ? "" : "s"}`, `${r.sections} section${r.sections === 1 ? "" : "s"}`, `${r.tasks} task${r.tasks === 1 ? "" : "s"}`];
    let text = `Imported ${parts.join(", ")}.`;
    if (r.skipped) text += ` ${r.skipped} already here, left as they are${r.repeats ? ` (${r.repeats} of them got their repeat rule)` : ""}.`;
    if (r.notes) {
      const lost: string[] = [];
      if (r.notes.repeating) lost.push(`${r.notes.repeating} repeat rules this app cannot follow`);
      if (r.notes.reminders) lost.push(`${r.notes.reminders} reminders`);
      if (r.notes.tags.length) lost.push(`tags (${r.notes.tags.join(", ")})`);
      if (lost.length) text += ` Not carried over: ${lost.join(", ")}.`;
    }
    return text;
  };
  const pick = (onText: (text: string) => Promise<string | null>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void run(async () => onText(await file.text()));
  };

  return (
    <section>
      <span className="micro">Data</span>
      <div className="data-row">
        <div>
          <b>Export</b>
          <p className="form-hint">All lists, sections, tasks (completed ones too) and view settings as one CSV file that can be imported again.</p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const path = await saveTextFile(`vitro-tasks-${todayKey()}.csv`, await exportCsv());
              return path ? `Saved ${path}` : null;
            })
          }
        >
          <Icon name="download" size={14} /> Export CSV
        </button>
      </div>
      <div className="data-row">
        <div>
          <b>Import</b>
          <p className="form-hint">A Vitro Tasks export. Rows that are already here stay unless the file has a newer version.</p>
        </div>
        <label className={`btn ${busy ? "is-disabled" : ""}`}>
          <Icon name="upload" size={14} /> Import CSV
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={pick(async (text) => {
            if (isTickTickBackup(text)) return summary(await importTickTick(text, includeDone));
            if (!isVitroCsv(text)) throw new Error("This file is neither a Vitro Tasks export nor a TickTick backup.");
            return summary(await importCsv(text));
          })} />
        </label>
      </div>
      <div className="data-row">
        <div>
          <b>Import from TickTick</b>
          <p className="form-hint">
            The backup CSV from TickTick (Settings → Account → Generate backup). Folders become lists with sublists, columns become sections,
            checklists become subtasks, the tag “deadline” becomes a deadline. Importing the same backup again only adds what is new.
          </p>
          <label className="check-row">
            <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> Include completed tasks
          </label>
        </div>
        <label className={`btn ${busy ? "is-disabled" : ""}`}>
          <Icon name="upload" size={14} /> Choose backup
          <input type="file" accept=".csv,text/csv" hidden disabled={busy} onChange={pick(async (text) => {
            if (!isTickTickBackup(text)) throw new Error("This is not a TickTick backup CSV.");
            return summary(await importTickTick(text, includeDone));
          })} />
        </label>
      </div>
      {busy && <p className="form-hint">Working…</p>}
      {message && <p className={message.error ? "form-error" : "form-ok"}>{message.text}</p>}
    </section>
  );
}

function ShortcutRow({ id, label }: { id: ActionId; label: string }) {
  const shortcuts = useStore((s) => s.shortcuts);
  const setShortcuts = useStore((s) => s.setShortcuts);
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    shortcutRecording.active = true;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(false);
      if (e.key === "Backspace" || e.key === "Delete") {
        void setShortcuts({ ...shortcuts, [id]: "" });
        return setRecording(false);
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      // A key combination belongs to one action: take it away from any other.
      const next = { ...shortcuts };
      for (const k of Object.keys(next) as ActionId[]) if (next[k] === combo) next[k] = "";
      next[id] = combo;
      void setShortcuts(next);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      shortcutRecording.active = false;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [recording, shortcuts, setShortcuts, id]);
  return (
    <div className="shortcut-row">
      <span>{label}</span>
      <button type="button" className={`kbd-btn ${recording ? "is-recording" : ""}`} onClick={() => setRecording(!recording)}>
        {recording ? "Press keys…" : shortcuts[id] ? <kbd>{shortcuts[id]}</kbd> : <span className="faint">None</span>}
      </button>
    </div>
  );
}

/** Which palette new lists take their colours from (every palette stays in the list menu). */
/** UI text size: four stops on a slider, small A to large A (3 is the original size). Kept per device. */
function TextSize() {
  const value = useStore((s) => s.textSize);
  const setTextSize = useStore((s) => s.setTextSize);
  const last = TEXT_SIZES.length;
  return (
    <div className="text-size">
      <span className="palette-head">Text size</span>
      <div className="ts-row">
        <span className="ts-a ts-a-sm" aria-hidden>A</span>
        <div className="ts-slider" style={{ "--p": (value - 1) / (last - 1) } as React.CSSProperties}>
          <div className="ts-track">
            {TEXT_SIZES.map((_, i) => (
              <i key={i} className={i + 1 <= value ? "is-on" : ""} style={{ left: `${(i / (last - 1)) * 100}%` }} />
            ))}
          </div>
          <input type="range" min={1} max={last} step={1} value={value} aria-label="Text size" aria-valuetext={["Smallest", "Small", "Default", "Large"][value - 1]} onChange={(e) => setTextSize(Number(e.target.value))} />
        </div>
        <span className="ts-a ts-a-lg" aria-hidden>A</span>
      </div>
    </div>
  );
}

function PaletteChoice() {
  const settings = useStore((s) => s.settings);
  const setPalette = useStore((s) => s.setPalette);
  const current = defaultPalette(settings).id;
  return (
    <div className="palette-choice" role="radiogroup" aria-label="Colours for new lists">
      <span className="palette-head">Colours for new lists</span>
      {PALETTES.map((p) => (
        <button type="button" key={p.id} role="radio" aria-checked={p.id === current} className={`toggle-row palette-row ${p.id === current ? "is-active" : ""}`} onClick={() => void setPalette(p.id)}>
          <span>{p.name}</span>
          <span className="palette-dots">
            {p.colors.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span className="palette-check">{p.id === current && <Icon name="check" size={14} />}</span>
        </button>
      ))}
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const shortcut = useStore((s) => s.shortcut);
  const shortcutError = useStore((s) => s.shortcutError);
  const setShortcut = useStore((s) => s.setShortcut);
  const version = useStore((s) => s.version);
  const update = useStore((s) => s.update);
  const checkUpdate = useStore((s) => s.checkUpdate);
  const installUpdate = useStore((s) => s.installUpdate);
  const [keys, setKeys] = useState(shortcut);
  const setShortcuts = useStore((s) => s.setShortcuts);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Settings</b>
          <button type="button" className="icon-btn push" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>
        {isMobile && <h1 className="m-settings-title">Settings</h1>}

        <section>
          <span className="micro">Appearance</span>
          <div className="segmented">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button type="button" key={t} className={theme === t ? "is-active" : ""} onClick={() => void setTheme(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <TextSize />
          <PaletteChoice />
        </section>

        <SidebarSection />

        {!isMobile && (
        <>
        <section>
          <span className="micro">Shortcuts</span>
          <div className="shortcuts">
            {ACTIONS.map((a) => (
              <ShortcutRow key={a.id} id={a.id} label={a.label} />
            ))}
          </div>
          <p className="form-hint">
            Click a shortcut and press the new keys. Backspace removes it, Escape cancels. Single keys only work while you are not typing.{" "}
            <button type="button" className="text-btn inline" onClick={() => void setShortcuts(DEFAULT_SHORTCUTS)}>
              Reset all
            </button>
          </p>
        </section>

        <section>
          <span className="micro">Quick add</span>
          <div className="form-row">
            <label htmlFor="shortcut">Global shortcut</label>
            <input id="shortcut" value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Ctrl+Space" />
            <button type="button" className="btn" disabled={!isTauri() || !keys.trim()} onClick={() => void setShortcut(keys.trim())}>
              Apply
            </button>
          </div>
          {shortcutError && <p className="form-error">Could not register “{keys}”: {shortcutError}</p>}
          {!isTauri() && <p className="form-hint">The global shortcut only exists in the desktop app.</p>}
          <p className="form-hint">
            Syntax in every add field: <code>tomorrow 14:00</code> planned · <code>^fri</code> or <code>^24.12.</code> deadline ·{" "}
            <code>!high</code> priority · <code>#list</code>
          </p>
        </section>
        </>
        )}

        <DataSection />

        {isMobile ? (
          <section>
            <span className="micro">Updates</span>
            <span className="sync-state">Version {version || "…"}</span>
            <p className="form-hint">
              New versions arrive through SideStore. Add this source there once:{" "}
              <code className="selectable">https://github.com/pad-mac/Vitro-Tasks/releases/latest/download/vitro-tasks.altsource.json</code>
            </p>
          </section>
        ) : (
        <section>
          <span className="micro">Updates</span>
          <div className="form-actions">
            <span className="sync-state">
              Version {version || "…"}
              {update.status === "checking" && " · checking…"}
              {update.status === "none" && " · up to date"}
              {update.status === "available" && ` · ${update.version} is available`}
              {update.status === "installing" && ` · installing ${update.version} (${Math.round((update.progress ?? 0) * 100)}%)`}
              {update.status === "error" && ` · check failed: ${update.message}`}
            </span>
            <button type="button" className="btn" disabled={!isTauri() || update.status === "checking" || update.status === "installing"} onClick={() => void checkUpdate()}>
              Check for updates
            </button>
            {update.status === "available" && (
              <button type="button" className="btn is-primary" onClick={() => void installUpdate()}>
                Install and restart
              </button>
            )}
          </div>
          <p className="form-hint">Updates come from the releases of the Vitro-Tasks repository on GitHub and are checked automatically.</p>
        </section>
        )}

        <ServersSection />
      </div>
    </div>
  );
}
