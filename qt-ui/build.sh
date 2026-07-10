#!/usr/bin/env bash
# One-liner wrapper for Linux/macOS.
# It runs the Python installer which downloads Qt6/CMake if needed and builds the UI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"
python3 install.py "$@"
