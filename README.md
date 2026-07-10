# Amethyst

**Amethyst** is a **standalone pure-Node.js Minecraft vanilla launcher** (no Python, **zero npm dependencies**, **no browser/HTML/JS required**).

It is a **CLI-first** tool. You run it directly with `node`. No web server, no embedded website, no Electron, no HTML UI needed.

> Legal/download note: Amethyst does **not** include or redistribute Minecraft client code, libraries, assets, or copyrighted game files. When you install/launch a version, it reads Mojang's public version manifest and downloads the official files from Mojang/Microsoft-hosted URLs on the user's machine.

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

- Node.js **18+** (no other runtime or npm packages needed).
- Java 17+ (recommended 21) to actually run Minecraft.
- Internet for first-time downloads of versions.
- Native extraction:
  - `unzip` (Linux/macOS)
  - PowerShell (Windows)

## Quick Start (Standalone CLI — recommended)

No `npm install` required. Just have Node.js:

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
├── src/
│   ├── main.js             # CLI entry (defaults to standalone menu)
│   ├── cli.js              # Interactive + direct commands (no web)
│   ├── server.js           # (optional) web backend only
│   ├── config.js
│   └── launcher/
│       ├── downloader.js   # FIXED: pure Node http/https streams (no freezing)
│       ├── minecraft.js
│       ├── accounts.js
│       └── ...
└── ...
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

This project currently avoids external packages so the MVP can run with a plain Node.js install.

## Important notes

- **Default mode is pure CLI** — no HTML, no browser window, no JavaScript web frontend.
- To use the old web UI you must explicitly run with `--server`.
- Downloads now use stable native Node.js streams instead of web `fetch` + `TransformStream` (the previous cause of "freezes forever" on install).
- No packaging / exe / Electron is used. This is intentionally a lightweight `node` script.

## MVP limitations

- Authentication is offline-mode only.
- Multiplayer requiring Microsoft login will not work with offline accounts.
- You must own Minecraft and comply with its EULA.
