# Amethyst <img src="https://raw.githubusercontent.com/MinLOL12/Amethyst/main/build/icon.png" width="30">

Amethyst is a dark-purple Minecraft launcher built with Node.js and a
**polished zero-build web UI**. The launcher runs locally, serves plain HTML,
CSS, and JavaScript, and requires no frontend framework, bundler, native UI
toolchain, or extra runtime.

> **Legal/download note:** Amethyst does not include or redistribute Minecraft
> client code, libraries, assets, or copyrighted game files. When you install or
> launch a version, it reads Mojang's public version manifest and downloads the
> official files from Mojang/Microsoft-hosted URLs on the user's machine.

> **Security note:** Amethyst binds to `127.0.0.1` (localhost) only. Do **not** port
> forward the launcher's port to the internet. The backend has no authentication
> and exposes full control over the local system (file access, process launch,
> Java downloads, etc.). Exposing it publicly would allow remote code execution.

## Quick start

Requirements:

- Node.js 18 or newer.
- Java 17 or newer to launch Minecraft. Amethyst detects installed Java and can
  manage Java runtimes through the UI.
- Internet access for first-time downloads, news, loader metadata, and optional
  Microsoft login.

```bash
npm start
```

Amethyst binds to `127.0.0.1` on an available port and opens the launcher in
your browser. Browser mode is the default—no extra `server` flag is required.
The terminal only hosts the local backend and must remain open while the
launcher is running.
###### Amethyst will not work on Node.js versions that are older than Node.js 18.

Amethyst always prints the launcher URL on its own line. If the browser cannot
be opened automatically (for example, over SSH or on a headless desktop), click
or copy that URL into a browser.

Useful environment variables:

```bash
AMETHYST_HOME=/path/to/data npm start   # store data somewhere else
AMETHYST_NO_OPEN=1 npm start            # do not open a browser automatically
PORT=8080 npm start                     # use a fixed local port
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

## Development checks

```bash
npm test
```

## MVP limitations

- Microsoft authentication requires a configured Azure application client ID
  when the default client is unavailable.
- Offline accounts cannot join servers that require authenticated Microsoft
  sessions.
- The launcher downloads official files but does not include or redistribute
  Minecraft code or assets.

## License

MIT
