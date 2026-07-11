#!/usr/bin/env sh
# Python-free Qt UI setup/build wrapper for Linux and macOS.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$SCRIPT_DIR/install.js" "$@"
