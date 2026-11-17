import { useEffect, useState } from "react";
import { todayKey } from "../lib/dates";
import { isMobile, isTauri, saveTextFile } from "../lib/platform";
import { isTickTickBackup, isVitroCsv } from "../lib/transfer";
import { ACTIONS, DEFAULT_SHORTCUTS, comboFromEvent, shortcutRecording, type ActionId } from "../lib/shortcuts";
import { DEFAULT_HIGHLIGHT, useStore, type ImportResult, type Theme } from "../store";
import { Icon } from "./ui";

const HIGHLIGHTS: [string, string][] = [
  ["Silver", DEFAULT_HIGHLIGHT],
  ["Graphite", "#7a7f86"],
  ["Champagne", "#cdb88f"],
  ["Rose gold", "#cf9f92"],
  ["Steel blue", "#86a0c4"],
  ["Sage", "#98ad95"],
  ["Lavender", "#aaa0c8"],
];

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
    if (r.skipped) text += ` ${r.skipped} already here, left as they are.`;
    if (r.notes) {
      const lost: string[] = [];
      if (r.notes.repeating) lost.push(`${r.notes.repeating} repeat rules`);
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
      <button type="button" className={`kbd-btn ${recording ? "is-recording pearl" : ""}`} onClick={() => setRecording(!recording)}>
        {recording ? "Press keys…" : shortcuts[id] ? <kbd>{shortcuts[id]}</kbd> : <span className="faint">None</span>}
      </button>
    </div>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const shortcut = useStore((s) => s.shortcut);
  const shortcutError = useStore((s) => s.shortcutError);
  const setShortcut = useStore((s) => s.setShortcut);
  const syncConfig = useStore((s) => s.syncConfig);
  const sync = useStore((s) => s.sync);
  const saveSyncConfig = useStore((s) => s.saveSyncConfig);
  const syncNow = useStore((s) => s.syncNow);
  const version = useStore((s) => s.version);
  const update = useStore((s) => s.update);
  const checkUpdate = useStore((s) => s.checkUpdate);
  const installUpdate = useStore((s) => s.installUpdate);
  const [url, setUrl] = useState(syncConfig?.url ?? "");
  const [token, setToken] = useState(syncConfig?.token ?? "");
  const [keys, setKeys] = useState(shortcut);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
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
          <span className="micro">Highlight</span>
          <div className="highlights">
            {HIGHLIGHTS.map(([name, c]) => (
              <button
                type="button"
                key={c}
                title={name}
                aria-label={name}
                className={`hl-swatch ${highlight.toLowerCase() === c ? "is-active" : ""}`}
                style={{ ["--hl" as string]: c }}
                onClick={() => void setHighlight(c)}
              />
            ))}
            <label className={`hl-swatch hl-custom ${HIGHLIGHTS.some(([, c]) => c === highlight.toLowerCase()) ? "" : "is-active"}`} title="Custom colour" style={{ ["--hl" as string]: highlight }}>
              <input type="color" value={highlight} onChange={(e) => void setHighlight(e.target.value)} />
              <Icon name="plus" size={12} />
            </label>
          </div>
          <p className="form-hint">Selected days, times and other highlights take this colour as a quiet pearl finish.</p>
        </section>

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

        <section>
          <span className="micro">Sync server</span>
          <div className="form-row">
            <label htmlFor="sync-url">Server URL</label>
            <input id="sync-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tasks.example.org" />
          </div>
          <div className="form-row">
            <label htmlFor="sync-token">Token</label>
            <input id="sync-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="VITRO_TOKEN of your server" />
          </div>
          <div className="form-actions">
            <span className={`sync-state sync-${sync.status}`}>
              <i className="sync-dot" />
              {sync.status === "off" && "Not connected. Tasks stay on this device."}
              {sync.status === "syncing" && "Syncing…"}
              {sync.status === "idle" && (sync.last ? `Synced at ${new Date(sync.last).toLocaleTimeString()}` : "Connected")}
              {sync.status === "error" && (sync.message ?? "Sync failed")}
            </span>
            {syncConfig && (
              <button type="button" className="btn" onClick={() => void syncNow()}>
                Sync now
              </button>
            )}
            <button type="button" className="btn is-primary" onClick={() => void saveSyncConfig(url.trim() ? { url, token } : null)}>
              {url.trim() ? "Save and sync" : "Disconnect"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
