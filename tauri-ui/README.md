# Amethyst Tauri UI

A native desktop UI for the Amethyst Minecraft launcher, built with **Tauri** (Rust).

## Why Tauri?

- **Native Feel** - Uses the system's webview (WebKit on macOS/Linux, Edge/WebView2 on Windows)
- **Small Bundle** - 10-50x smaller than Electron
- **Fast** - Rust backend, native performance
- **Native Controls** - Standard window decorations, menus, and system integration
- **Secure** - Rust provides memory safety and sandboxing

## Features

- Native window with proper controls (minimize, maximize, close)
- Modern dark purple theme
- Real-time download progress via Server-Sent Events
- System tray support (optional)
- Small executable size (~5-10 MB vs ~150 MB for Electron)

## Prerequisites

### Windows
- [Node.js 18+](https://nodejs.org/)
- [Rust](https://rustup.rs/)
- Visual Studio Build Tools

### macOS
```bash
brew install node rust
```

### Linux
```bash
# Ubuntu/Debian
sudo apt install nodejs npm cargo libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf

# Fedora
sudo dnf install nodejs npm cargo webkit2gtk3-devel libappindicator3-devel
```

## Building

```bash
cd tauri-ui

# Install dependencies
npm install

# Development mode
npm run tauri dev

# Build for release
npm run tauri build
```

## Project Structure

```
tauri-ui/
├── package.json           # Node.js dependencies
├── src-tauri/
│   ├── Cargo.toml         # Rust dependencies
│   ├── tauri.conf.json    # Tauri configuration
│   └── src/
│       └── main.rs        # Rust backend code
└── src/
    ├── index.html         # Frontend UI
    └── styles.css         # Dark purple theme
```

## How It Works

1. **Rust Backend** - Tauri handles window creation, system integration, and spawning the Node.js process
2. **Node.js Backend** - The original Amethyst backend (in `../src/`) handles:
   - Minecraft version downloads
   - Java detection
   - Game launching
3. **Web Frontend** - The HTML/JS UI runs in the system webview (not bundled Chromium)
4. **IPC** - Tauri commands allow JS to communicate with Rust, which manages the Node.js process

## Configuration

Tauri configuration is in `src-tauri/tauri.conf.json`:
- Window size: 1200x800 (resizable, min 900x600)
- App title: "Amethyst"
- Bundle identifier: com.amethyst.launcher

## License

MIT - Same as the main Amethyst project
