#!/usr/bin/env python3
"""
Amethyst Qt UI one-command installer.

This script checks for Node.js, CMake and Qt6, downloads anything that is
missing, then configures and builds the Qt UI.

Usage:
    python3 qt-ui/install.py
    python3 qt-ui/install.py --build-type Debug --qt-version 6.8.0
"""

from __future__ import annotations

import argparse
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Union

DEFAULT_QT_VERSION = "6.5.3"
MIN_NODE_MAJOR = 18
MIN_CMAKE_VERSION = (3, 16)


def log(message: str) -> None:
    print("[amethyst-install] " + message)


def run(cmd: List[str], *, check: bool = True, cwd: Optional[Union[Path, str]] = None, **kwargs) -> subprocess.CompletedProcess:
    log("Running: " + " ".join(cmd))
    return subprocess.run(cmd, check=check, cwd=cwd, text=True, **kwargs)


def parse_version(output: str) -> tuple[int, ...]:
    match = re.search(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", output)
    if not match:
        return (0,)
    return tuple(int(x) for x in match.groups() if x is not None)


def check_python() -> None:
    if sys.version_info < (3, 9):
        log("ERROR: Python 3.9 or newer is required.")
        sys.exit(1)


def check_node() -> Path:
    node = shutil.which("node")
    if not node:
        log("ERROR: Node.js is required but was not found in PATH.")
        log("       Install it from https://nodejs.org/ (LTS recommended).")
        sys.exit(1)
    result = run([node, "--version"], capture_output=True)
    version = parse_version(result.stdout)
    if version[0] < MIN_NODE_MAJOR:
        log(f"ERROR: Node.js {version[0]} found, but Node.js {MIN_NODE_MAJOR}+ is required.")
        sys.exit(1)
    log(f"Found Node.js {result.stdout.strip()} at {node}")
    return Path(node)


def find_cmake() -> List[str]:
    """Return a command list for a suitable CMake, or an empty list."""
    cmake = shutil.which("cmake")
    if not cmake:
        return []
    result = run([cmake, "--version"], capture_output=True, check=False)
    version = parse_version(result.stdout)
    if version < MIN_CMAKE_VERSION:
        log(f"CMake {'.'.join(map(str, version))} is too old (need {'.'.join(map(str, MIN_CMAKE_VERSION))}+).")
        return []
    return [cmake]


def ensure_cmake() -> List[str]:
    cmake = find_cmake()
    if cmake:
        return cmake
    log("CMake not found (or too old). Installing cmake via pip...")
    run([sys.executable, "-m", "pip", "install", "--user", "--upgrade", "cmake"])
    cmake = find_cmake()
    if cmake:
        return cmake
    # Fall back to invoking cmake as a Python module (pip may not have added
    # the script directory to PATH).
    try:
        result = run([sys.executable, "-m", "cmake", "--version"], capture_output=True, check=False)
        if result.returncode == 0:
            log("Using cmake via python -m cmake")
            return [sys.executable, "-m", "cmake"]
    except Exception:
        pass
    log("ERROR: Still could not find CMake after installing it via pip.")
    log("       Try restarting your terminal or installing CMake manually from https://cmake.org/download/")
    sys.exit(1)


def default_qt_arch() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Linux":
        return "linux_gcc_64"
    if system == "Darwin":
        return "macos"
    if system == "Windows":
        # Prefer MinGW when it is already on PATH, otherwise MSVC.
        if shutil.which("gcc") or shutil.which("g++"):
            return "win64_mingw"
        return "win64_msvc2019_64"
    log(f"ERROR: Unsupported platform: {system}")
    sys.exit(1)


def qt_host() -> str:
    system = platform.system()
    if system == "Linux":
        return "linux"
    if system == "Darwin":
        return "mac"
    if system == "Windows":
        return "windows"
    log(f"ERROR: Unsupported platform: {system}")
    sys.exit(1)


def find_system_qt() -> Optional[Path]:
    """Look for an existing Qt6 installation using qmake6/qmake."""
    for qmake_name in ("qmake6", "qmake"):
        qmake = shutil.which(qmake_name)
        if not qmake:
            continue
        try:
            result = run([qmake, "-query", "QT_INSTALL_LIBS"], capture_output=True, check=False)
            libdir = Path(result.stdout.strip())
            prefix = libdir.parent
            if (prefix / "lib" / "cmake" / "Qt6").is_dir():
                log(f"Found system Qt6 via {qmake}: {prefix}")
                return prefix
        except Exception:
            continue
    return None


def find_qt_in_dir(qt_dir: Path, version: str, arch: str) -> Optional[Path]:
    """Guess the Qt prefix created by aqtinstall and search as a fallback."""
    install_subdir = arch.split("_", 1)[1] if "_" in arch else arch
    candidate = qt_dir / version / install_subdir
    if (candidate / "lib" / "cmake" / "Qt6").is_dir():
        return candidate
    # Fallback: search recursively for Qt6 cmake config.
    for cmake_dir in qt_dir.rglob("lib/cmake/Qt6"):
        return cmake_dir.parent.parent
    return None


def ensure_aqt() -> None:
    if shutil.which("aqt"):
        return
    log("Installing aqtinstall (Qt downloader) via pip...")
    run([sys.executable, "-m", "pip", "install", "--user", "--upgrade", "aqtinstall"])
    if not shutil.which("aqt"):
        log("ERROR: aqtinstall was installed but 'aqt' is not on PATH.")
        log("       Add Python's user script directory to PATH and try again.")
        sys.exit(1)


def install_qt(qt_dir: Path, version: str, arch: str) -> Path:
    ensure_aqt()
    log(f"Downloading Qt {version} ({arch}) into {qt_dir} ...")
    log("This may take several minutes depending on your connection.")
    qt_dir.mkdir(parents=True, exist_ok=True)
    run([
        sys.executable, "-m", "aqt", "install-qt",
        qt_host(), "desktop", version, arch,
        "--modules", "qtbase", "qtdeclarative",
        "--outputdir", str(qt_dir)
    ])
    prefix = find_qt_in_dir(qt_dir, version, arch)
    if not prefix:
        log("ERROR: Qt was downloaded but the expected cmake files were not found.")
        sys.exit(1)
    log(f"Qt installed at {prefix}")
    return prefix


def ensure_qt(qt_dir: Optional[Path], version: str, arch: str, skip_qt_check: bool) -> Optional[Path]:
    system_qt = None if skip_qt_check else find_system_qt()
    if system_qt:
        return system_qt
    if qt_dir:
        prefix = find_qt_in_dir(qt_dir, version, arch)
        if prefix:
            log(f"Using previously downloaded Qt at {prefix}")
            return prefix
        return install_qt(qt_dir, version, arch)
    log("ERROR: --qt-dir is required when no system Qt6 is found.")
    sys.exit(1)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the Amethyst Qt UI. Downloads Qt6/CMake automatically if they are missing."
    )
    parser.add_argument("--build-type", default="Release", choices=["Release", "Debug", "RelWithDebInfo", "MinSizeRel"])
    parser.add_argument("--qt-version", default=DEFAULT_QT_VERSION, help="Qt version to download if needed.")
    parser.add_argument("--qt-arch", default=default_qt_arch(), help="aqtinstall arch (e.g. linux_gcc_64, macos, win64_msvc2019_64).")
    parser.add_argument("--qt-dir", type=Path, default=Path(__file__).parent / ".qt", help="Directory for downloaded Qt.")
    parser.add_argument("--skip-qt-check", action="store_true", help="Always download Qt even if a system Qt exists.")
    parser.add_argument("--clean", action="store_true", help="Delete the build directory before configuring.")
    parser.add_argument("-j", "--jobs", type=int, default=os.cpu_count() or 2, help="Parallel build jobs.")
    args = parser.parse_args()

    check_python()
    check_node()

    qt_ui_dir = Path(__file__).parent.resolve()
    project_root = qt_ui_dir.parent.resolve()
    build_dir = qt_ui_dir / "build"

    cmake_cmd = ensure_cmake()
    qt_prefix = ensure_qt(args.qt_dir, args.qt_version, args.qt_arch, args.skip_qt_check)

    if args.clean and build_dir.exists():
        log("Cleaning existing build directory...")
        shutil.rmtree(build_dir)

    configure_cmd = cmake_cmd + [
        "-S", str(qt_ui_dir),
        "-B", str(build_dir),
        "-DCMAKE_BUILD_TYPE=" + args.build_type,
    ]
    if qt_prefix:
        configure_cmd.append("-DCMAKE_PREFIX_PATH=" + str(qt_prefix))

    log("Configuring the project with CMake...")
    run(configure_cmd)

    log("Building Amethyst...")
    run(cmake_cmd + ["--build", str(build_dir), "--parallel", str(args.jobs)])

    log("")
    log("Build complete!")
    log(f"  Binary: {build_dir / 'Amethyst'}")
    log(f"  Run it with: cd qt-ui/build && ./Amethyst")
    log("")
    log("Tip: You can rebuild later with: cd qt-ui && cmake --build build --parallel")
    return 0


if __name__ == "__main__":
    sys.exit(main())
