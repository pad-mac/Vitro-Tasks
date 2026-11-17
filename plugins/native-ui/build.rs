// The plugin has no commands: the page talks to the Swift side through a
// WebKit message handler (see ios/Sources/NativeUIPlugin.swift).
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
