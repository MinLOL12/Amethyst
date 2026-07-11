# Amethyst

Amethyst is a **dark purple Minecraft launcher** built with **Node.js** and optional native UI frontends. It supports Microsoft account login, multi-instance profiles, Fabric/Forge/NeoForge/Quilt, Java management, download queues, live logs, and official Mojang downloads.

> Legal/download note: Amethyst does **not** include or redistribute Minecraft client code, libraries, assets, or copyrighted game files. When you install/launch a version, it reads Mojang's public version manifest and downloads the official files from Mojang/Microsoft-hosted URLs on the user's machine.

## Features

### Microsoft account login
- Multiple Microsoft and offline accounts
- Device-code OAuth (no embedded password form)
- Remember login via refresh tokens
- Switch accounts without reauthenticating when a session is stored

### Installations / instances
- Create multiple profiles with isolated game directories
- Per-instance Java version and custom JVM arguments
- Different Minecraft versions and loaders per instance

### Mod loader support
- Fabric
- Forge
- NeoForge
- Quilt
- Vanilla

### Instance management
- Duplicate
- Rename
- Delete
- Export / import as ZIP

### Java manager
- Detect installed Java (`JAVA_HOME`, `PATH`, common locations)
- Download the correct Temurin JDK automatically (Adoptium)
- Choose which Java each installation uses

### Downloads page
- Progress bars
- Download speed
- Estimated time remaining
- Queue multiple downloads

### Game settings
- RAM slider
- Resolution width / height
- Fullscreen toggle
- Custom launch arguments and JVM arguments

### News / home page
- Minecraft news (Mojang launcher content)
- Launcher updates blurb
- Recently played instances
- Quick launch

### Logs
- Live console while Minecraft starts
- Search
- Copy log
- Browse and save crash reports

### File browser shortcuts
- Open `.minecraft` / instance root
- Open saves
- Open mods
- Open screenshots
- Open resource packs
- Open logs / crash-reports

## UI Options

### 1. Browser UI (Default)
```bash
npm start
```

### 2. Qt/QML UI (`qt-ui/`)
```bash
./qt-ui/build.sh --run   # Linux/macOS
qt-ui\build.bat --run    # Windows
npm run qt:run           # cross-platform helper
```

For manual build instructions, see `qt-ui/README.md`.

### 3. Tauri UI (`tauri-ui/`)
```bash
cd tauri-ui
npm install
npm run tauri dev
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

- Node.js 18+
- Java to launch Minecraft (or let Amethyst download one)
- Internet for first-time downloads, news, Microsoft login, and loader metadata

## Quick start

```bash
npm start
```

Environment variables:

```bash
AMETHYST_HOME=/path/to/data npm start
AMETHYST_NO_OPEN=1 npm start
PORT=8080 npm start
AMETHYST_MS_CLIENT_ID=your-azure-app-id npm start   # optional custom OAuth client
```

Data is stored under `~/.amethyst` (or `AMETHYST_HOME`):

```text
~/.amethyst/
├── accounts.json          # accounts (tokens for remembered Microsoft logins)
├── settings.json
├── instances.json
├── instances/<name>/      # per-profile game directories
├── java/                  # managed JDK downloads
├── minecraft/             # shared/default game files when not using instances
├── logs/
└── exports/
```

## Microsoft login notes

Amethyst uses the Microsoft **device code** flow, then Xbox Live → XSTS → Minecraft Services profile lookup. Refresh tokens are stored only when **Remember login** is enabled so you can switch accounts without signing in again.

You must own Minecraft Java Edition on the Microsoft account. Offline accounts remain available for single-player / offline servers.

## Development checks

```bash
npm test
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
├── public/                 # Browser UI
├── src/
│   ├── main.js
│   ├── server.js
│   ├── config.js
│   └── launcher/
│       ├── accounts.js
│       ├── microsoftAuth.js
│       ├── instances.js
│       ├── modLoaders.js
│       ├── javaManager.js
│       ├── javaLocator.js
│       ├── downloadQueue.js
│       ├── downloader.js
│       ├── minecraft.js
│       ├── logs.js
│       ├── folders.js
│       └── ...
├── qt-ui/
├── tauri-ui/
└── test/
```

## License

MIT — see [LICENSE](LICENSE).
