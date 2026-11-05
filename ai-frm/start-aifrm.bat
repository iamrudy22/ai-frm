@echo off
setlocal EnableExtensions DisableDelayedExpansion

where.exe node.exe >nul 2>&1
if errorlevel 1 (
    echo Node.js 26.12.1 is required. Install it and double-click this file again.
    pause
    exit /b 1
)

node.exe "%~dp0scripts\start-local.mjs" --open-browser
set "AIFRM_EXIT_CODE=%ERRORLEVEL%"
if not "%AIFRM_EXIT_CODE%"=="0" (
    echo.
    echo AIFRM exited with code %AIFRM_EXIT_CODE%.
    pause
)
exit /b %AIFRM_EXIT_CODE%
