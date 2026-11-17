use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEFAULT_SHORTCUT: &str = "Ctrl+Space";

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Shows the quick add bar, or hides it if it is already open.
fn toggle_quick_add(app: &AppHandle) {
    let Some(w) = app.get_webview_window("quickadd") else {
        return;
    };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("quickadd:shown", ());
    }
}

fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("not a valid shortcut: {e}"))?;
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;
    manager
        .on_shortcut(parsed, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                toggle_quick_add(app);
            }
        })
        .map_err(|e| e.to_string())
}

/// Replaces the global quick add shortcut. Fails if another program owns it.
#[tauri::command]
fn set_quick_add_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    register_shortcut(&app, &shortcut)
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch only focuses the running app.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            set_quick_add_shortcut,
            show_main_window
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // The main window registers the saved shortcut once it has loaded;
            // this default keeps quick add working even before that.
            if let Err(e) = register_shortcut(&handle, DEFAULT_SHORTCUT) {
                eprintln!("could not register {DEFAULT_SHORTCUT}: {e}");
            }

            let open = MenuItem::with_id(app, "open", "Open Vitro Tasks", true, None::<&str>)?;
            let add = MenuItem::with_id(app, "quickadd", "Quick add", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &add, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Vitro Tasks")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quickadd" => toggle_quick_add(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window keeps the app in the tray so the
            // global shortcut stays available. Quit from the tray menu.
            // Detached view windows ("view-…") close for real.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Focused(false) if window.label() == "quickadd" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Vitro Tasks");
}
