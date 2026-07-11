# Amethyst Qt UI

A native desktop UI for the Amethyst Minecraft launcher, built with **Qt6** and **QML**.

## Why Qt/QML?

- **Native Performance** - No browser overhead, direct system integration
- **Beautiful UI** - Modern declarative QML allows for polished, animated interfaces
- **Cross-Platform** - Runs on Windows, macOS, and Linux
- **Professional** - The same framework used by Prism Launcher and many other desktop apps

## Features

- Modern dark purple theme
- Native window controls
- Smooth animations and transitions
- Server-Sent Events for real-time progress updates
- Responsive layout

## Building

### Prerequisites

- **Node.js 18+** (also used by the launcher backend)
- **Qt 6.5+**
- **CMake 3.16+**
- **C++20 compatible compiler**
  - GCC 11+
  - Clang 14+
  - MSVC 2022+

**Python is not required.** The included setup helper is written in Node.js and
uses only built-in Node modules.

### Install Qt and CMake

**Windows:**

Install CMake with `winget install Kitware.CMake` and download Qt 6.5+ from
https://www.qt.io/download. If Qt is not on the normal CMake search path, pass
its compiler-specific prefix with `--qt-dir`, for example:

```bat
qt-ui\build.bat --qt-dir C:\Qt\6.8.0\msvc2022_64 --run
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt install qt6-base-dev qt6-declarative-dev qml6-module-qtquick-controls cmake build-essential
```

Package names can differ by distribution.

**macOS (Homebrew):**

```bash
brew install qt@6 cmake
```

### One-command setup, build, and run

From the project root:

```bash
# Linux/macOS
./qt-ui/build.sh --run

# Windows
qt-ui\build.bat --run
```

The same helper can be called directly on every platform:

```bash
node qt-ui/install.js --run
# or
npm run qt:run
```

Useful options include `--clean`, `--build-type Debug`, `--qt-dir <path>`,
`--jobs <count>`, and `--configure-only`. Run `node qt-ui/install.js --help`
for the complete list.

### Manual build

If you prefer to invoke CMake yourself:

```bash
cmake -S qt-ui -B qt-ui/build -DCMAKE_BUILD_TYPE=Release
cmake --build qt-ui/build --config Release --parallel
./qt-ui/build/Amethyst
```

On Windows, the executable may be at `qt-ui\build\Release\Amethyst.exe`.

## Architecture

```
qt-ui/
├── CMakeLists.txt          # CMake build configuration
├── CMakePresets.json       # Release and debug CMake presets
├── install.js              # Python-free setup/build/run helper
├── build.sh / build.bat    # Platform-friendly wrappers
├── src/
│   ├── main.cpp             # Application entry point
│   ├── amaranthlauncher.h   # Main window controller
│   ├── amaranthlauncher.cpp
│   ├── apiclient.h          # HTTP client for Node.js backend
│   └── apiclient.cpp
├── qml/
│   ├── main.qml             # Main window layout
│   ├── HomePage.qml         # Home screen
│   ├── VersionsPage.qml     # Version browser
│   ├── AccountsPage.qml     # Account management
│   ├── SettingsPage.qml     # Settings panel
│   └── DownloadDialog.qml   # Download progress dialog
└── resources/
    └── amaranth.qrc         # Qt resource file
```

## How It Works

1. **Qt Frontend** - The UI is built with QML for a modern, responsive experience
2. **Node.js Backend** - The original Amethyst backend (in `src/`) handles:
   - Minecraft version downloads
   - Java detection
   - Game launching
3. **Communication** - Qt app starts the Node.js backend as a subprocess and communicates via HTTP API
4. **Real-time Updates** - Server-Sent Events (SSE) provide live download/install progress

## Requirements

- Node.js 18+ (for the backend)
- Qt 6.5+ with modules:
  - Core
  - Gui
  - Widgets
  - Qml
  - Quick
  - QuickControls2
  - Network

## License

MIT - Same as the main Amethyst project
