# Amethyst <img src="https://raw.githubusercontent.com/MinLOL12/Amethyst/main/build/icon.png" width="30">

[![GitHub](https://img.shields.io/badge/github-repo-blue?logo=github)](https://github.com/MinLOL12/Amethyst) ![Coverage](https://img.shields.io/badge/coolometer-100%25-orange)
###### The main branch may be outdated at points.

Amethyst is a dark-purple Minecraft launcher packaged as a native **Electron
desktop application**. Its Node.js backend and zero-build HTML/CSS/JavaScript
UI run together inside the app, so Windows users can launch Amethyst from an
installer or a portable `.exe` without installing Node.js.

> **Legal/download note:** Amethyst does not include or redistribute Minecraft
> client code, libraries, assets, or copyrighted game files. When you install or
> launch a version, it reads Mojang's public version manifest and downloads the
> official files from Mojang/Microsoft-hosted URLs on the user's machine.

> **Security note:** Amethyst binds to `127.0.0.1` (localhost) only. Do **not** port
> forward the launcher's port to the internet. The backend has no authentication
> and exposes full control over the local system (file access, process launch,
> Java downloads, etc.). Exposing it publicly would allow remote code execution.

## Install on Windows

Download either Windows artifact from the latest GitHub release or workflow
run:

- **`Amethyst-Launcher-Setup-…-x64.exe`** — installer with Start Menu and
  optional desktop shortcuts.
- **`Amethyst-Launcher-…-portable.exe`** — standalone executable; no install
  required.

Java is not bundled because Minecraft versions require different runtimes.
Amethyst detects installed Java versions and can download managed runtimes from
Adoptium. Internet access is required for first-time game downloads, metadata,
news, and optional Microsoft login.

Application data remains in `~/.amethyst`, so upgrading or uninstalling the
desktop app does not remove instances or accounts.

## Run from source

Contributors need Node.js 22.12 or newer:

```bash
npm ci
npm start          # Electron desktop app
npm run start:web  # optional browser-hosted development mode
```

The Electron app starts its backend on an unused `127.0.0.1` port and displays
the complete launcher in its own secured window. Browser mode prints its local
URL and opens the system browser.

Useful environment variables:

```bash
AMETHYST_HOME=/path/to/data npm start       # store data somewhere else
AMETHYST_NO_OPEN=1 npm run start:web        # do not open a browser automatically
PORT=8080 npm run start:web                 # use a fixed browser-mode port
AMETHYST_MS_CLIENT_ID=your-entra-public-client-id npm start  # optional OAuth client
# Optional with a custom sovereign-cloud/authority registration:
AMETHYST_MS_DEVICE_CODE_URL=https://authority/devicecode AMETHYST_MS_TOKEN_URL=https://authority/token npm start
```

The web UI is intentionally just the files in `public/`: it starts quickly,
works anywhere Node.js runs, and can be customized without a build step.

## UI

The browser UI is designed to feel like a polished desktop launcher while
keeping the implementation simple:

- Responsive glassy dark-purple interface with inline SVG iconography.
- Overview dashboard with quick launch, runtime status, recent activity, news,
  and file shortcuts.
- Instance browser with isolated profiles and per-instance settings.
- Searchable official release and snapshot browser.
- Offline and Microsoft account profiles.
- Java detection and managed Java downloads.
- Live download queue, speed, ETA, install, launch, and log feedback.
- Keyboard navigation (`1`–`4`) and mobile navigation.

To change the look, edit `public/index.html` and `public/styles.css`. To change
behavior, edit `public/app.js`; the Node server automatically serves those
files. No build command is needed.

## Features

### Microsoft account login and skins

- Multiple Microsoft and offline accounts.
- Device-code OAuth without an embedded password form.
- Remember login with refresh tokens.
- Switch accounts without reauthenticating when a session is stored.
- Change a Microsoft account's official Java Edition skin from the Accounts page.
- Preview classic/slim and legacy skin PNGs before applying them.
- Import a local PNG, a direct HTTPS PNG URL, or a NameMC / The Skindex skin page; quick links are also provided for Planet Minecraft and Nova Skin.

Offline accounts cannot publish an official skin because Minecraft's profile service requires an authenticated, game-owning Microsoft account. For offline accounts, use a client-side skin mod such as **CustomSkinLoader** (Fabric/Forge/NeoForge/Quilt) to load custom skins from a local file or skin server.

### Installations and instances

- Create multiple profiles with isolated game directories.
- Configure per-instance Java versions and custom JVM arguments.
- Use different Minecraft versions and loaders per instance.
- Rename, duplicate, delete, export, and import instances as ZIP files.

### Mod loaders

- Fabric
- Forge
- NeoForge
- Quilt
- Vanilla

Forge and NeoForge modpacks use isolated game directories. Before the official installer runs, Amethyst creates a compatible `launcher_profiles.json` inside the instance, so the installer does not incorrectly ask the user to run Mojang's launcher first.

### Java manager

- Detect Java from `JAVA_HOME`, `PATH`, and common locations.
- Download the correct Temurin JDK automatically through Adoptium.
- Choose Java per installation.

### Downloads, settings, and logs

- Queue downloads with progress, speed, and estimated time remaining.
- Configure RAM, resolution, fullscreen, JVM arguments, and launch arguments.
- View live game logs, search logs, copy output, and inspect crash reports.
- Open instance folders, saves, mods, screenshots, resource packs, logs, and
  crash reports from the launcher.

### Official Minecraft files

Amethyst downloads and verifies official vanilla game files from Mojang
metadata, including the client jar, libraries, native libraries, asset index,
and asset objects. It does not grant a Minecraft license; users must comply
with Minecraft's EULA and applicable terms.

## Data and file structure

Data is stored under `~/.amethyst` or the directory set by `AMETHYST_HOME`:

```text
~/.amethyst/
├── accounts.json
├── settings.json
├── instances.json
├── instances/<name>/
├── java/
├── minecraft/
├── logs/
└── exports/
```

The repository is organized as:

```text
Amethyst/
├── README.md
├── LICENSE
├── package.json
├── public/                    # zero-build browser UI
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/                       # Node.js backend
│   ├── main.js
│   ├── server.js
│   └── launcher/
│       ├── accounts.js
│       ├── downloader.js
│       ├── downloadQueue.js
│       ├── folders.js
│       ├── forgeInstaller.js
│       ├── instances.js
│       ├── javaLocator.js
│       ├── javaManager.js
│       ├── logs.js
│       ├── minecraft.js
│       ├── minecraftPaths.js
│       ├── microsoftAuth.js
│       ├── modLoaders.js
│       ├── mojangApi.js
│       ├── news.js
│       ├── os.js
│       ├── rules.js
│       ├── skins.js
│       └── store.js
└── test/
    ├── features.test.js
    └── rules.test.js
```

## Development and packaging

```bash
npm test
npm run pack         # unpacked app for the current platform
npm run build:win    # NSIS installer + portable Windows .exe
npm run build:linux  # AppImage + Debian package
npm run build:mac    # macOS DMG (run on macOS for signing)
```

Windows packages are built automatically on pull requests and pushes to
`main`. The workflow uploads both `.exe` files as build artifacts and attaches
them to GitHub releases. Release builds are currently unsigned, so Windows may
display a SmartScreen warning until a code-signing certificate is configured.

## MVP limitations

- Microsoft authentication requires a configured Azure application client ID
  when the default client is unavailable.
- Offline accounts cannot join servers that require authenticated Microsoft
  sessions.
- The launcher downloads official files but does not include or redistribute
  Minecraft code or assets.

## License

MIT
