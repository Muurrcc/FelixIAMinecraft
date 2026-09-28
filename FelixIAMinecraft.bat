@echo off
rem FelixIAMinecraft launcher: double-click it to install, start, stop or check everything.
rem It only runs the PowerShell scripts in scripts\, with -ExecutionPolicy Bypass for that process alone
rem (the system execution policy is not touched).
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title FelixIAMinecraft
set "PS=powershell.exe -NoProfile -ExecutionPolicy Bypass -File"

if not exist "runtime\node\node.exe" (
    echo FelixIAMinecraft is not installed yet in this folder.
    goto install
)

:menu
echo.
echo  FelixIAMinecraft
echo  ----------------
echo   1. Start everything (Ollama, server, bot, dashboard)
echo   2. Start only the server
echo   3. Stop everything
echo   4. Open the dashboard
echo   5. Status
echo   6. Back up the world now
echo   7. Re-run the installer (repair / update)
echo   0. Exit
echo.
choice /c 12345670 /n /m "Choose an option: "
set "OPT=%errorlevel%"
rem 0 or 255: choice got no usable input (e.g. stdin closed), so don't loop forever.
if "%OPT%"=="0" exit /b 1
if "%OPT%"=="255" exit /b 1
echo.
if "%OPT%"=="1" %PS% scripts\start_all.ps1
if "%OPT%"=="2" %PS% scripts\start_all.ps1 -ServerOnly
if "%OPT%"=="3" %PS% scripts\stop_all.ps1
if "%OPT%"=="4" %PS% scripts\dashboard.ps1
if "%OPT%"=="5" %PS% scripts\status.ps1
if "%OPT%"=="6" %PS% scripts\backup.ps1
if "%OPT%"=="7" goto install
if "%OPT%"=="8" exit /b 0
goto menu

:install
echo.
set "PLAYER="
set /p "PLAYER=Your Minecraft username (3-16 letters, digits or _): "
echo(!PLAYER!| findstr /r /x "[A-Za-z0-9_][A-Za-z0-9_][A-Za-z0-9_][A-Za-z0-9_]*" >nul || (
    echo That is not a valid Minecraft username.
    goto install
)
%PS% scripts\install.ps1 -Player !PLAYER!
if errorlevel 1 (
    echo.
    echo The installer stopped. Read the messages above, fix the problem and choose option 7 to retry.
    pause
)
goto menu
