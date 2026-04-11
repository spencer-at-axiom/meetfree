@echo off
echo ========================================
echo Starting MeetFree Development Server
echo ========================================
cd desktop
call pnpm run tauri:dev
pause
