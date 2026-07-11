@echo off
rem Python-free Qt UI setup/build wrapper for Windows.
setlocal
node "%~dp0install.js" %*
exit /b %errorlevel%
