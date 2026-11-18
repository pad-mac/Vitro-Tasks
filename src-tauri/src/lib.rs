use tauri::AppHandle;

#[cfg(desktop)]
mod desktop {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    pub const DEFAULT_SHORTCUT: &str = "Ctrl+Space";

    pub fn show_main(app: &AppHandle) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }

    /// Shows the quick add bar, or hides it if it is already open.
    pub fn toggle_quick_add(app: &AppHandle) {
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

    pub fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
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

    pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
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
    }

    pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
        match event {
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
        }
    }
}

/// Native adjustments to the iOS web view.
#[cfg(target_os = "ios")]
mod ios {
    use block2::RcBlock;
    use objc2::encode::{Encode, Encoding};
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use std::ffi::CStr;
    use std::ptr::{null_mut, NonNull};

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }
    unsafe impl Encode for CGPoint {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGSize {
        const ENCODING: Encoding = Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl Encode for CGRect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
    }

    unsafe fn ns_string(s: &CStr) -> *mut AnyObject {
        let cls = AnyClass::get(c"NSString").expect("NSString");
        msg_send![cls, stringWithUTF8String: s.as_ptr()]
    }

    /// - The page draws under the status bar and home indicator itself
    ///   (viewport-fit=cover), so the scroll view must not inset it, bounce or
    ///   pan as a whole; scrolling happens inside the page.
    /// - When the keyboard opens, the web view gets shorter instead of the page
    ///   being pushed up, so sheets sit on top of the keyboard and the rest of
    ///   the screen stays where it is.
    pub unsafe fn setup(wk: *mut AnyObject) {
        if wk.is_null() {
            return;
        }
        let scroll: *mut AnyObject = msg_send![wk, scrollView];
        if !scroll.is_null() {
            // UIScrollViewContentInsetAdjustmentNever = 2
            let _: () = msg_send![scroll, setContentInsetAdjustmentBehavior: 2isize];
            let _: () = msg_send![scroll, setBounces: Bool::NO];
            let _: () = msg_send![scroll, setScrollEnabled: Bool::NO];
        }
        let Some(center_cls) = AnyClass::get(c"NSNotificationCenter") else {
            return;
        };
        let center: *mut AnyObject = msg_send![center_cls, defaultCenter];
        let name = ns_string(c"UIKeyboardWillChangeFrameNotification");
        let wk_addr = wk as usize;
        let block = RcBlock::new(move |note: NonNull<AnyObject>| {
            let wk = wk_addr as *mut AnyObject;
            let info: *mut AnyObject = msg_send![note.as_ptr(), userInfo];
            if info.is_null() {
                return;
            }
            let value: *mut AnyObject = msg_send![info, objectForKey: ns_string(c"UIKeyboardFrameEndUserInfoKey")];
            if value.is_null() {
                return;
            }
            let kb: CGRect = msg_send![value, CGRectValue];
            let sup: *mut AnyObject = msg_send![wk, superview];
            if sup.is_null() {
                return;
            }
            let bounds: CGRect = msg_send![sup, bounds];
            // The keyboard frame is in screen coordinates.
            let kb_local: CGRect = msg_send![sup, convertRect: kb, fromView: null_mut::<AnyObject>()];
            let covered = (bounds.origin.y + bounds.size.height - kb_local.origin.y).clamp(0.0, bounds.size.height);
            let frame = CGRect {
                origin: bounds.origin,
                size: CGSize { width: bounds.size.width, height: bounds.size.height - covered },
            };
            let _: () = msg_send![wk, setFrame: frame];
        });
        let _observer: *mut AnyObject = msg_send![
            center,
            addObserverForName: name,
            object: null_mut::<AnyObject>(),
            queue: null_mut::<AnyObject>(),
            usingBlock: &*block
        ];
    }
}

#[cfg(target_os = "ios")]
fn ios_setup(app: &tauri::App) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.with_webview(|webview| unsafe { ios::setup(webview.inner() as *mut objc2::runtime::AnyObject) });
    }
}

/// Replaces the global quick add shortcut. Fails if another program owns it.
#[tauri::command]
fn set_quick_add_shortcut(app: AppHandle, shortcut: String) -> Result<(), String> {
    #[cfg(desktop)]
    return desktop::register_shortcut(&app, &shortcut);
    #[cfg(mobile)]
    {
        let _ = (app, shortcut);
        Ok(())
    }
}

/// Writes an export to the path the user picked in the save dialog.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    #[cfg(desktop)]
    desktop::show_main(&app);
    #[cfg(mobile)]
    let _ = app;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch only focuses the running app.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    #[cfg(target_os = "ios")]
    let builder = builder
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_native_ui::init());
    let builder = builder
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_quick_add_shortcut,
            show_main_window,
            write_text_file
        ])
        .setup(|app| {
            #[cfg(desktop)]
            desktop::setup(app)?;
            #[cfg(target_os = "ios")]
            ios_setup(app);
            let _ = app;
            Ok(())
        });
    #[cfg(desktop)]
    let builder = builder.on_window_event(|window, event| desktop::on_window_event(window, event));
    builder
        .run(tauri::generate_context!())
        .expect("error while running Vitro Tasks");
}
