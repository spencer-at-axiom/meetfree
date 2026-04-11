@echo off
echo ========================================
echo Installing Dependencies
echo ========================================
cd desktop
call npm install -g pnpm
call pnpm install

echo.
echo ========================================
echo Starting Development Server
echo ========================================
call pnpm run tauri:dev

pause
