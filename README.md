# Amethyst

Amethyst is a **dark purple Minecraft vanilla launcher MVP** built with **Node.js** and native UI options. The launcher logic is in Node.js, but you can choose from multiple native UI frontends.

> Legal/download note: Amethyst does **not** include or redistribute Minecraft client code, libraries, assets, or copyrighted game files. When you install/launch a version, it reads Mojang's public version manifest and downloads the official files from Mojang/Microsoft-hosted URLs on the user's machine.

## UI Options

Choose the UI that best fits your needs:

### 1. Browser UI (Default)
The classic HTML/JS UI served locally. Works everywhere Node.js runs.

```bash
npm start
```

### 2. Qt/QML UI (`qt-ui/`)
**Best for: Native desktop feel with modern, beautiful UI**

Built with Qt6 and QML - the same framework used by Prism Launcher. Provides:
- Native window controls
- Modern declarative UI with smooth animations
- Excellent cross-platform support
- Professional look and feel

**Build (one-command installer):**
```bash
python3 qt-ui/install.py
```

The installer checks for Node.js, CMake and Qt6, downloads anything missing,
and builds the project. After it finishes, run:

```bash
cd qt-ui/build
./Amethyst
```

For manual build instructions, see `qt-ui/README.md`.

### 3. Tauri UI (`tauri-ui/`)
**Best for: Small bundle size with native feel**

Built with Tauri (Rust) - uses the system webview instead of bundled Chromium:
- ~5-10 MB bundle vs ~150 MB for Electron
- Native window decorations
- Rust-powered backend management
- System integration

**Build:**
```bash
cd tauri-ui
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

## Features

- Pure CLI — no HTML, no web JavaScript, no browser, no frontend.
- Offline-mode accounts.
- Local storage in `~/.amethyst` (or `AMETHYST_HOME`).
- Auto-detects Java (JAVA_HOME, PATH, common locations).
- Downloads + verifies official vanilla versions (client, libraries, natives, assets).
- Robust downloader using native Node.js `http`/`https` streams (fixes previous freezes/hangs during install).
- Interactive menu or direct CLI commands.
- Memory control and Java override.
- Optional web server mode (`--server`) only if you really want the old browser UI.

## Requirements

- Node.js 18 or newer (for the backend).
- Java is required to actually launch Minecraft. Amethyst will try to detect Java automatically; if it cannot, install Java or set a Java path override in the UI.
- Internet access is needed for first-time version downloads/news/version list.
- Native library extraction uses:
  - `unzip` on Linux/macOS.
  - PowerShell `Expand-Archive` on Windows.

### Qt UI Additional Requirements
- Qt 6.5+ with modules: Core, Gui, Widgets, Qml, Quick, QuickControls2, Network
- CMake 3.16+
- C++20 compiler

### Tauri UI Additional Requirements
- Rust toolchain
- WebView2 (Windows), WebKit (macOS/Linux)

## Quick start (Browser UI)

```bash
# Interactive menu (easiest)
node src/main.js

# Direct commands (no prompts)
node src/main.js list
node src/main.js install 1.21.1
node src/main.js launch 1.21.1

# Help
node src/main.js help
```

### Make it even easier (optional one-time)

```bash
# Linux / macOS
chmod +x src/main.js
./src/main.js install 1.21.1

# Or create a tiny alias/script
echo 'node "$(dirname "$0")/src/main.js" "$@"' > amethyst && chmod +x amethyst
./amethyst install 1.21.3
```

### Environment variables

```bash
AMETHYST_HOME=/custom/path node src/main.js
```

## Optional: Old browser UI mode

Only if you want the web interface:

```bash
node src/main.js --server
# or
node src/main.js server
```

Then open the printed URL in a browser.

## How to install a version (CLI)

```bash
node src/main.js install 1.20.6
# or with version from interactive menu
```

Progress and logs are printed directly in the terminal. Downloads are reliable and no longer freeze.

## File structure (key files)

```text
Amethyst/
├── src/
│   ├── main.js          # Entry point (CLI by default)
│   ├── cli.js           # Pure terminal UI + commands
│   ├── launcher/
│   │   ├── downloader.js   # Robust Node http downloads (no web streams)
│   │   ├── minecraft.js
│   │   └── ...
├── package.json         # Zero runtime deps
└── ...
```

## Development / checks (optional)

```bash
node --check src/main.js
npm test   # if you have npm
```

This project uses **zero npm dependencies** at runtime. Everything is built-in Node.js modules.

## File structure (simplified for CLI)

```text
Amethyst/
├── LICENSE
├── README.md
├── package.json
├── .gitignore
├── public/                    # Browser UI assets
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── qt-ui/                     # Qt/QML UI (C++)
│   ├── CMakeLists.txt
│   ├── src/
│   └── qml/
├── tauri-ui/                  # Tauri UI (Rust + HTML)
│   ├── package.json
│   ├── src-tauri/
│   └── src/
├── src/                       # Shared backend (Node.js)
│   ├── main.js
│   ├── server.js
│   ├── config.js
│   └── launcher/
│       ├── accounts.js
│       ├── downloader.js
│       ├── javaLocator.js
│       ├── minecraft.js
│       ├── mojangApi.js
│       ├── news.js
│       ├── os.js
│       ├── rules.js
│       └── store.js
└── test/
    └── rules.test.js
```

The `public/` folder only exists for the optional `--server` mode.

## How official version downloads work

1. `src/launcher/mojangApi.js` fetches Mojang's version manifest from `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`.
2. The selected version's metadata is fetched from the official URL in that manifest.
3. `src/launcher/minecraft.js` downloads:
   - the official client jar from `version.downloads.client.url`,
   - allowed libraries from `library.downloads.artifact.url`,
   - OS-specific native library jars from `library.downloads.classifiers`,
   - the asset index from `version.assetIndex.url`,
   - asset objects from `https://resources.download.minecraft.net/<prefix>/<hash>`.
4. SHA-1 checksums from Mojang metadata are verified where provided.
5. Launch arguments are built from Mojang's `arguments`/legacy metadata using the offline account values.

## Development checks

```bash
npm test
```

## MVP limitations

- Authentication is offline-mode only.
- Multiplayer requiring Microsoft login will not work with offline accounts.
- You must own Minecraft and comply with its EULA.
