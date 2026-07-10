: Amethyst Qt UI

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
- Automatic retry on HTTP/network errors during version installs
- Responsive layout

## One-Command Install (Recommended)

The easiest way to build the Qt UI is with the included installer. It checks for
Node.js, CMake and Qt6, downloads anything missing, and builds the project.

**Linux / macOS:**
```bash
cd Amethyst
python3 qt-ui/install.py
```

**Windows:**
```bat
cd Amethyst
python qt-ui\install.py
```

Or using npm from the project root:
```bash
npm run qt:install
npm run qt:build
```

After the build finishes, run:
```bash
cd qt-ui/build
./Amethyst
```

### Installer Options
```bash
python3 qt-ui/install.py --help
```
Common options:
- `--build-type Debug` - build with debug symbols
- `--qt-version 6.8.0` - choose a different Qt version to download
- `--qt-dir /path/to/qt` - where to keep the downloaded Qt files
- `--clean` - delete the build directory before configuring

## Manual Build

If you already have Qt6 and CMake installed:

### Prerequisites

- **Qt 6.5+** with modules: Core, Gui, Widgets, Qml, Quick, QuickControls2, Network
- **CMake 3.16+**
- **C++20 compatible compiler**
  - GCC 11+
  - Clang 14+
  - MSVC 2022+

**Linux (Ubuntu/Debian):**
```bash
sudo apt install qt6-base-dev qt6-qmltooling qtdeclarative6-dev cmake build-essential
```

**macOS (Homebrew):**
```bash
brew install qt6 cmake
```

**Windows:**
Download Qt from https://www.qt.io/download or use the one-command installer above.

### Build

```bash
cd qt-ui
cmake --preset default
cmake --build build --parallel
```

Or the classic way:
```bash
cd qt-ui
mkdir build && cd build
cmake ..
cmake --build . --parallel
```

### Run

```bash
# From the build directory
./Amethyst

# Or from the project root (after build)
./qt-ui/build/Amethyst
```

## Troubleshooting

### Qt6 not found
Run the installer instead of CMake directly, or point CMake at your Qt install:
```bash
cmake -DCMAKE_PREFIX_PATH=/path/to/Qt/6.x.x/<arch> -S qt-ui -B qt-ui/build
```

### Downloads fail while installing a Minecraft version
The backend now automatically retries failed HTTP requests with exponential
backoff. If a download keeps failing, check your internet connection or try a
different network.

### Backend connection errors
The Qt app starts the Node.js backend automatically and finds a free port. Make
sure Node.js 18+ is installed and on PATH.

## Architecture

```
qt-ui/
├── CMakeLists.txt          # CMake build configuration
├── CMakePresets.json       # Ready-to-use CMake presets
├── install.py              # One-command installer/downloader
├── build.sh / build.bat    # Thin wrapper scripts
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
│   └── DownloadDialog.qml   # Download progress / retry dialog
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
5. **Resilient Downloads** - HTTP requests automatically retry on timeouts, connection resets, 5xx and 429 errors

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
