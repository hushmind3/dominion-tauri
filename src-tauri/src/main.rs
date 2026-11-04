#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Sidecar(Mutex<Option<Child>>);

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4317)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&data).ok();
            let port = free_port();
            let node = std::env::var("DOMINION_NODE").unwrap_or_else(|_| "node".into());
            let child = Command::new(node)
                .arg("server/index.mjs")
                .env("DOMINION_PORT", port.to_string())
                .env("DOMINION_HOST", "127.0.0.1")
                .env("DOMINION_DATA", data.join("runtime"))
                .spawn()
                .ok();
            app.manage(Sidecar(Mutex::new(child)));
            let url = format!("http://127.0.0.1:{}/", port);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.navigate(url.parse().unwrap());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<Sidecar>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
