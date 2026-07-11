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

**Build and run (Python is not required):**
```bash
# Linux/macOS
./qt-ui/build.sh --run

# Windows
qt-ui\build.bat --run

# Or on every platform, using the Node.js runtime already required by Amethyst
npm run qt:run
```

The helper checks Node.js, CMake, and Qt, then configures and builds the native executable. See [`qt-ui/README.md`](qt-ui/README.md) for prerequisites and manual build instructions.

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

- Offline-mode login for MVP accounts.
- Saves accounts and settings locally in `~/.amethyst` (or `AMETHYST_HOME`).
- Automatically scans installed Java from `JAVA_HOME`, `JRE_HOME`, `PATH`, and common install directories.
- Downloads and launches official vanilla Minecraft versions from Mojang metadata.
- **Mod loader support: Fabric, Forge, NeoForge, and Quilt.** Select a mod loader and version from the UI, then drop mods into the `mods` folder.
- Shows live download/install/launch progress through Server-Sent Events.
- Downloads client jar, libraries, native libraries, asset index, and assets from official manifest URLs.
- Memory allocation slider (`512 MB` to `16 GB`).
- News panel loaded from Minecraft launcher content, with graceful offline fallback.
- Dark purple responsive UI.

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
- Python is **not** required; the setup helper uses Node.js, which the launcher backend already requires.

### Tauri UI Additional Requirements
- Rust toolchain
- WebView2 (Windows), WebKit (macOS/Linux)

## Quick start (Browser UI)

```bash
npm start
```

The backend binds to `127.0.0.1` on an available port and opens the UI in your browser. If the browser does not open automatically, copy the URL printed in the terminal.

Useful environment variables:

```bash
AMETHYST_HOME=/path/to/data npm start   # store accounts/settings/game files somewhere else
AMETHYST_NO_OPEN=1 npm start            # do not auto-open a browser
PORT=8080 npm start                     # choose a fixed local port
```

## File structure

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
│       ├── modloaders.js
│       ├── mojangApi.js
│       ├── news.js
│       ├── os.js
│       ├── rules.js
│       └── store.js
└── test/
    └── rules.test.js
```

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

## Mod loader support

Amethyst supports the following mod loaders:

| Mod loader | API source | Notes |
|------------|-----------|-------|
| **Fabric** | `meta.fabricmc.net` | Lightweight mod loader; fetches profile JSON with libraries and main class |
| **Forge** | `maven.minecraftforge.net` | Fetches Forge profile JSON with libraries and launch config |
| **NeoForge** | `maven.neoforged.net` | Modern fork of Forge for 1.20.1+ |
| **Quilt** | `meta.quiltmc.org` | Fabric-compatible fork with additional features |

### How it works

1. The user selects a Minecraft version and a mod loader type in the UI.
2. Amethyst fetches the available loader versions from the mod loader's API.
3. When installing, the vanilla base version is downloaded first, then the mod loader's profile JSON is fetched and merged with the vanilla metadata (libraries, main class, arguments).
4. The mod loader's additional libraries are downloaded from their respective Maven repositories.
5. A `mods` directory is created in the game directory.
6. On launch, the mod loader's main class is used instead of vanilla's, and the merged classpath includes both vanilla and mod loader libraries.
7. The mod loader automatically scans the `mods` directory for `.jar` mod files at startup.

### Where to put mods

Mods go in the `mods` folder inside the game directory (default: `~/.amethyst/minecraft/mods`). The game directory path is shown in the top bar of the launcher UI.

## Development checks

```bash
npm test
```

## MVP limitations

- Authentication is offline-mode only. Online Microsoft authentication is intentionally out of scope for the MVP.
- Multiplayer servers that require authenticated Microsoft sessions will not accept offline accounts.
- The launcher downloads official files but does not grant a Minecraft license. Users must comply with Minecraft's EULA and applicable terms.
