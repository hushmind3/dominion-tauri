#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{webview::WebviewWindowBuilder, Manager, WebviewUrl};

struct Sidecar(Mutex<Option<Child>>);

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(4317)
}

fn server_root(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(res) = app.path().resource_dir() {
        if res.join("sidecar/server/index.mjs").exists() { return res.join("sidecar"); }
    }
    std::env::current_dir().unwrap_or_else(|_| ".".into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let root = server_root(app.handle());
            let data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&data).ok();
            let port = free_port();
            let node = std::env::var("DOMINION_NODE").unwrap_or_else(|_| "node".into());
            let child = Command::new(node)
                .arg(root.join("server/index.mjs"))
                .env("DOMINION_PORT", port.to_string())
                .env("DOMINION_HOST", "127.0.0.1")
                .env("DOMINION_DATA", data.join("runtime"))
                .current_dir(root.clone())
                .spawn()
                .ok();
            app.manage(Sidecar(Mutex::new(child)));
            let url = format!("http://127.0.0.1:{}/", port);
            let addr = format!("127.0.0.1:{}", port);
            for _ in 0..150 {
                if std::net::TcpStream::connect_timeout(
                    &addr.parse().unwrap(),
                    std::time::Duration::from_millis(200),
                )
                .is_ok()
                {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().unwrap()),
            )
            .title("DOMINION")
            .inner_size(1291.0, 850.0)
            .min_inner_size(740.0, 600.0)
            .center()
            .build()?;
            let _ = win.set_focus();
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
