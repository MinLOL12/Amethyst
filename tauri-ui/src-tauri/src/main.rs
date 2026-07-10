#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State, Window};

struct AppState {
    backend_process: Mutex<Option<std::process::Child>>,
    backend_port: Mutex<u16>,
}

// Tauri commands
#[tauri::command]
fn start_backend(state: State<AppState>) -> Result<u16, String> {
    let mut process_guard = state.backend_process.lock().map_err(|e| e.to_string())?;
    
    // Kill existing backend if running
    if process_guard.is_some() {
        return Ok(*state.backend_port.lock().unwrap());
    }
    
    // Find Node.js
    let node_path = if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    };
    
    // Get app path (where package.json/src/main.js is)
    let app_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap().to_path_buf())
        .unwrap_or_default();
    
    // Start Node.js backend
    let mut child = Command::new(node_path)
        .args(&[app_dir.join("src/main.js").to_string_lossy().as_ref()])
        .env("AMETHYST_NO_OPEN", "1")
        .spawn()
        .map_err(|e| format!("Failed to start backend: {}", e))?;
    
    // Wait for backend to start and get port
    let port = wait_for_backend(&mut child)?;
    
    *process_guard = Some(child);
    *state.backend_port.lock().unwrap() = port;
    
    Ok(port)
}

fn wait_for_backend(child: &mut std::process::Child) -> Result<u16, String> {
    // Try common ports
    let ports = [3000, 3001, 3002, 3003, 3004, 3005];
    
    for port in ports {
        if check_port(port) {
            return Ok(port);
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    Err("Backend failed to start".to_string())
}

fn check_port(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/api/status", port);
    reqwest::blocking::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(1))
        .send()
        .is_ok()
}

#[tauri::command]
fn stop_backend(state: State<AppState>) -> Result<(), String> {
    let mut process_guard = state.backend_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = process_guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_data_root() -> String {
    std::env::var("AMETHYST_HOME")
        .or_else(|_| dirs::data_dir().map(|p| p.join("Amethyst").to_string_lossy().to_string()))
        .unwrap_or_else(|_| ".amethyst".to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn maximize_window(window: Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn start_dragging(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            backend_process: Mutex::new(None),
            backend_port: Mutex::new(0),
        })
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            get_data_root,
            get_app_version,
            minimize_window,
            maximize_window,
            close_window,
            start_dragging,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
