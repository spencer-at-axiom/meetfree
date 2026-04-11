@echo off
REM Development script for Windows with CUDA GPU acceleration
REM Optimized for RTX 2000+ series GPUs (Turing, Ampere, Ada, Hopper)
REM CUDA 13.x + MSVC requires the conforming preprocessor for whisper-rs-sys

echo.
echo ========================================
echo   MeetFree - CUDA GPU Development
echo ========================================
echo.
echo Starting Tauri development with CUDA GPU acceleration...
echo.

REM Set CUDA architecture for modern NVIDIA GPUs
REM 75 = Turing (RTX 2000), 86 = Ampere (RTX 3000), 89 = Ada (RTX 4000), 90 = Hopper
set CMAKE_CUDA_ARCHITECTURES=75;80;86;89;90
set CMAKE_CUDA_STANDARD=17
if defined CL (
    set "CL=%CL% /Zc:preprocessor"
) else (
    set "CL=/Zc:preprocessor"
)

echo CUDA Architectures: %CMAKE_CUDA_ARCHITECTURES%
echo MSVC CL Flags: %CL%
echo.

REM Run Tauri dev with CUDA feature
pnpm run tauri dev -- --features cuda
