//! Native iOS parts around the web view. Everything happens in Swift; this
//! crate only registers the Swift plugin with Tauri.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_ui);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-ui")
        .setup(|_app, api| {
            #[cfg(target_os = "ios")]
            api.register_ios_plugin(init_plugin_native_ui)?;
            let _ = api;
            Ok(())
        })
        .build()
}
