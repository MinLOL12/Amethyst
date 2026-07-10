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

- **Qt 6.5+** (or Qt 5.15+)
- **CMake 3.16+**
- **C++20 compatible compiler**
  - GCC 11+
  - Clang 14+
  - MSVC 2022+

### Install Qt

**Windows/macOS:**
Download from https://www.qt.io/download

**Linux (Ubuntu/Debian):**
```bash
sudo apt install qt6-base-dev qt6-qmltooling qtdeclarative6-dev cmake build-essential
```

**macOS (Homebrew):**
```bash
brew install qt6 cmake
```

### Build

```bash
cd qt-ui
mkdir build
cd build
cmake ..
cmake --build . --parallel
```

### Run

```bash
# From the build directory
./Amethyst

# Or from the project root (after install)
./qt-ui/build/Amethyst
```

## Architecture

```
qt-ui/
├── CMakeLists.txt          # CMake build configuration
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
