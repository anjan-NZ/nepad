@echo off
REM Assumes VS Build Tools 2022 is installed at the default location.
REM Tauri + MSVC requires VS Build Tools regardless of who runs this —
REM if yours is installed elsewhere, edit the path below or run this
REM from inside a VS Developer Command Prompt instead.
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
cd /d "%~dp0"
npm run tauri dev
