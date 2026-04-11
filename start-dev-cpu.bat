@echo off
echo ========================================
echo Starting MeetFree Development Server
echo (CPU Mode - No CUDA)
echo ========================================
cd desktop
set TAURI_GPU_FEATURE=none
call pnpm run tauri:dev
pause
