@echo off
echo ========================================
echo Running Cargo Check
echo ========================================
cd desktop\src-tauri
cargo check
if %ERRORLEVEL% NEQ 0 (
    echo Cargo check failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo Running Cargo Tests
echo ========================================
cargo test --lib
if %ERRORLEVEL% NEQ 0 (
    echo Cargo tests failed!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo Starting Development Server
echo ========================================
cd ..
call pnpm run tauri:dev

pause
