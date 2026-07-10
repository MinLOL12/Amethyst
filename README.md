# Amethyst

Amethyst is a **dark purple Minecraft vanilla launcher MVP** built with **Node.js** and browser UI assets. It is intentionally **not Python** and has no npm runtime dependencies.

> Legal/download note: Amethyst does **not** include or redistribute Minecraft client code, libraries, assets, or copyrighted game files. When you install/launch a version, it reads Mojang's public version manifest and downloads the official files from Mojang/Microsoft-hosted URLs on the user's machine.

## Features

- Offline-mode login for MVP accounts.
- Saves accounts and settings locally in `~/.amethyst` (or `AMETHYST_HOME`).
- Automatically scans installed Java from `JAVA_HOME`, `JRE_HOME`, `PATH`, and common install directories.
- Downloads and launches official vanilla Minecraft versions from Mojang metadata.
- Shows live download/install/launch progress through Server-Sent Events.
- Downloads client jar, libraries, native libraries, asset index, and assets from official manifest URLs.
- Memory allocation slider (`512 MB` to `16 GB`).
- News panel loaded from Minecraft launcher content, with graceful offline fallback.
- Dark purple responsive UI.

## Requirements

- Node.js 18 or newer.
- Java is required to actually launch Minecraft. Amethyst will try to detect Java automatically; if it cannot, install Java or set a Java path override in the UI.
- Internet access is needed for first-time version downloads/news/version list.
- Native library extraction uses:
  - `unzip` on Linux/macOS.
  - PowerShell `Expand-Archive` on Windows.

## Quick start

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

## Standalone Desktop App (Electron)

Amethyst can be packaged as a standalone desktop application with a proper installer wizard. The installer lets you:

- **Choose install location** (e.g., `C:\Program Files\Amethyst`, `D:\Games\Amethyst`, etc.)
- **Create a desktop shortcut** automatically
- **Pin to your taskbar** with one click
- **Add to Start Menu** under Games category
- **Launch immediately** after install

### Running in Electron (development)

```bash
npm run electron:dev
```

### Building the installer

```bash
# Build for current platform
npm run dist

# Build for Windows specifically
npm run dist:win

# Build NSIS installer only
npm run dist:nsis
```

The installer output will be in the `dist/` directory. The NSIS installer provides:
- Custom install directory selection
- Desktop shortcut creation
- Start Menu shortcut
- Taskbar pinning option
- Uninstaller

### Installer features

The NSIS installer wizard includes:
1. **Welcome page** - Introduction to Amethyst
2. **License agreement** - MIT license
3. **Install location** - Choose any drive/folder (default: `%LOCALAPPDATA%\Programs\Amethyst`)
4. **Start Menu folder** - Choose where to create shortcuts
5. **Installation progress** - File extraction progress
6. **Finish page** - Option to launch Amethyst immediately

After installation, you can also use the in-app "Desktop & Taskbar" section to:
- Create or recreate the desktop shortcut
- Pin/unpin from taskbar at any time

## File structure

```text
Amethyst/
├── LICENSE
├── README.md
├── package.json
├── .gitignore
├── public/
│   ├── index.html          # Dark purple launcher UI
│   ├── styles.css          # Amethyst theme and layout
│   └── app.js              # Browser-side API calls, progress UI, settings forms
├── src/
│   ├── main.js             # App entry point; starts local launcher server
│   ├── server.js           # Static UI, REST API, and Server-Sent Events
│   ├── config.js           # App constants and default paths/settings
│   └── launcher/
│       ├── accounts.js     # Offline account creation and persisted settings
│       ├── downloader.js   # Official file download, checksum, progress bus
│       ├── javaLocator.js  # Java auto-detection and version parsing
│       ├── minecraft.js    # Install/build classpath/launch vanilla versions
│       ├── mojangApi.js    # Mojang version manifest and metadata helpers
│       ├── news.js         # Minecraft launcher news feed with fallback
│       ├── os.js           # OS/classpath helpers for Minecraft metadata
│       ├── rules.js        # Mojang rule evaluation for libraries/arguments
│       └── store.js        # Atomic JSON persistence helpers
└── test/
    └── rules.test.js       # Lightweight unit smoke tests
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

## Development checks

```bash
npm test
```

This project currently avoids external packages so the MVP can run with a plain Node.js install.

## MVP limitations

- Authentication is offline-mode only. Online Microsoft authentication is intentionally out of scope for the MVP.
- Multiplayer servers that require authenticated Microsoft sessions will not accept offline accounts.
- The launcher downloads official files but does not grant a Minecraft license. Users must comply with Minecraft's EULA and applicable terms.
