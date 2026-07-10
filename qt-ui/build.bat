@echo off
rem One-liner wrapper for Windows.
rem It runs the Python installer which downloads Qt6/CMake if needed and builds the UI.
setlocal

cd /d "%~dp0"
python install.py %*
