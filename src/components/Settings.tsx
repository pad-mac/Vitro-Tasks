import { useState } from "react";
import { isTauri } from "../lib/platform";
import { useStore, type Theme } from "../store";
import { Icon } from "./ui";

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
