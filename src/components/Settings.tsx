import { useEffect, useState } from "react";
import { isTauri } from "../lib/platform";
import { ACTIONS, DEFAULT_SHORTCUTS, comboFromEvent, shortcutRecording, type ActionId } from "../lib/shortcuts";
import { DEFAULT_HIGHLIGHT, useStore, type Theme } from "../store";
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
          <p className="form-hint">Selected days, times and other highlights take this colour as a brushed metal finish.</p>
        </section>

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
