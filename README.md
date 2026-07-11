# Amethyst

Amethyst is a focused, dark-purple Minecraft vanilla launcher MVP. It uses a
Node.js backend and a **zero-build web UI**: plain HTML, CSS, and JavaScript
served locally by the same Node process. There is no native UI toolchain,
frontend framework, bundler, or extra runtime to install.

> **Legal/download note:** Amethyst does not include or redistribute Minecraft
> client code, libraries, assets, or copyrighted game files. When you install or
> launch a version, it reads Mojang's public version manifest and downloads the
> official files from Mojang/Microsoft-hosted URLs on the user's machine.

## Quick start

Requirements:

- Node.js 18 or newer.
- Java 17 or newer to actually launch Minecraft. Amethyst scans `JAVA_HOME`,
  `JRE_HOME`, `PATH`, and common install directories automatically.
- Internet access for the first version download, version list, and news.

```bash
npm start
```

Amethyst binds to `127.0.0.1` on an available port and opens the launcher in
your browser. If it does not open automatically, use the URL printed in the
terminal. The UI is intentionally just the files in `public/`, so it is fast to
start, easy to customize, and works anywhere Node.js runs.

Useful environment variables:

```bash
AMETHYST_HOME=/path/to/data npm start   # store data somewhere else
AMETHYST_NO_OPEN=1 npm start            # do not open a browser automatically
PORT=8080 npm start                     # use a fixed local port
```

## UI

The web UI is designed to feel like a polished desktop launcher while keeping
the implementation simple:

- A responsive, glassy dark-purple interface with no dependencies.
- Overview dashboard with quick launch, runtime status, and Minecraft news.
- Searchable release and snapshot browser with install-and-play actions.
- Offline account profiles with one-click selection.
- Java detection, memory allocation, and data-directory settings.
- Live download and launch status through Server-Sent Events.
- Keyboard navigation (`1`–`4`) and a mobile bottom navigation bar.

To change the look, edit `public/index.html` and `public/styles.css`. To change
behavior, edit `public/app.js`; the Node server automatically serves those
files. No build command is needed.

An optional Tauri wrapper is still present under `tauri-ui/` for contributors
who want a native webview package, but it is not required for development or
normal use. `npm start` is the simple, supported path.

## Features

- Offline-mode login for MVP accounts.
- Saves accounts and settings locally in `~/.amethyst` (or `AMETHYST_HOME`).
- Downloads and launches official vanilla Minecraft versions from Mojang
  metadata.
- Shows live download, install, and launch progress through SSE.
- Downloads the client jar, libraries, native libraries, asset index, and
  assets from official manifest URLs.
- Memory allocation from `512 MB` to `16 GB`.
- News loaded from Minecraft launcher content, with graceful offline fallback.

## File structure

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

## How official version downloads work

1. `src/launcher/mojangApi.js` fetches Mojang's version manifest from
   `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`.
2. The selected version's metadata is fetched from the official URL in that
   manifest.
3. `src/launcher/minecraft.js` downloads the client jar, allowed libraries,
   OS-specific native jars, the asset index, and asset objects.
4. SHA-1 checksums from Mojang metadata are verified where provided.
5. Launch arguments are built from Mojang's `arguments` or legacy metadata
   using the offline account values.

## Development checks

```bash
npm test
```

## MVP limitations

- Authentication is offline-mode only. Online Microsoft authentication is
  intentionally out of scope for the MVP.
- Multiplayer servers that require authenticated Microsoft sessions will not
  accept offline accounts.
- The launcher downloads official files but does not grant a Minecraft license.
  Users must comply with Minecraft's EULA and applicable terms.

## License

MIT
