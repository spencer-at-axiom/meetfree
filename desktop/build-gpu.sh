#!/bin/bash
# GPU-accelerated build script for Meetfree
# Automatically detects and builds with optimal GPU features

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Ã°Å¸Å¡â‚¬ Meetfree GPU-Accelerated Build Script${NC}"
echo ""

# Export CUDA flags for Linux/NVIDIA
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Modern CUDA architectures (RTX 2000+ series)
    # 75 = Turing (RTX 2000), 80 = Ampere (A100), 86 = Ampere (RTX 3000)
    # 89 = Ada (RTX 4000), 90 = Hopper (H100)
    export CMAKE_CUDA_ARCHITECTURES=75;80;86;89;90
    export CMAKE_CUDA_STANDARD=17
    export CMAKE_POSITION_INDEPENDENT_CODE=ON
    echo "🐧 Linux/CUDA: CMAKE_CUDA_ARCHITECTURES=$CMAKE_CUDA_ARCHITECTURES"
fi

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
  OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  OS="linux"
else
  echo -e "${RED}Ã¢ÂÅ’ Unsupported OS: $OSTYPE${NC}"
  exit 1
fi

# Function to check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Find the correct directory for desktop app commands
if [ -f "package.json" ]; then
  DESKTOP_DIR="."
elif [ -f "desktop/package.json" ]; then
  cd desktop || {
    echo -e "${RED}Ã¢ÂÅ’ Failed to change to frontend directory${NC}"
    exit 1
  }
  DESKTOP_DIR="."
else
  echo -e "${RED}Ã¢ÂÅ’ Could not find package.json${NC}"
  echo -e "${RED}   Make sure you're in the project root or desktop directory${NC}"
  exit 1
fi

echo ""
echo -e "${BLUE}Ã°Å¸â€œÂ¦ Building Meetfree...${NC}"
echo ""

# Check for pnpm or npm
if command_exists pnpm; then
  PKG_MGR="pnpm"
elif command_exists npm; then
  PKG_MGR="npm"
else
  echo -e "${RED}Ã¢ÂÅ’ Neither npm nor pnpm found${NC}"
  exit 1
fi

# Detect GPU feature if not already set
if [ -z "$TAURI_GPU_FEATURE" ]; then
    echo -e "${BLUE}Ã°Å¸â€Â Detecting GPU features...${NC}"
    # Run the detection script and capture output
    TAURI_GPU_FEATURE=$(node scripts/auto-detect-gpu.js)
fi

if [ -n "$TAURI_GPU_FEATURE" ]; then
    echo -e "${GREEN}Ã¢Å“â€¦ Detected GPU feature: $TAURI_GPU_FEATURE${NC}"
    export TAURI_GPU_FEATURE
else
    echo -e "${YELLOW}Ã¢Å¡Â Ã¯Â¸Â No specific GPU feature detected or forced${NC}"
fi

# Build meetfree-llm-service
echo ""
echo -e "${BLUE}Ã°Å¸Â¦â„¢ Building meetfree-llm-service sidecar (release)...${NC}"

SERVICE_DIR="meetfree-llm-service"
if [ ! -d "$SERVICE_DIR" ]; then
    # Try to find it relative to script location
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    SERVICE_DIR="$SCRIPT_DIR/../meetfree-llm-service"
fi

if [ ! -d "$SERVICE_DIR" ]; then
    echo -e "${RED}Ã¢ÂÅ’ Could not find meetfree-llm-service directory${NC}"
    exit 1
fi

# Determine meetfree-llm-service features
# Note: llama-cpp-2 does NOT support coreml, only metal/cuda/vulkan
# So for macOS Apple Silicon (which returns 'coreml' for Whisper), use 'metal' for meetfree-llm-service
SERVICE_FEATURES=""
if [ -n "$TAURI_GPU_FEATURE" ]; then
    LLAMA_FEATURE="$TAURI_GPU_FEATURE"
    if [ "$LLAMA_FEATURE" = "coreml" ]; then
        LLAMA_FEATURE="metal"
        echo -e "${YELLOW}   Note: llama-cpp-2 doesn't support CoreML, using Metal instead${NC}"
    fi
    SERVICE_FEATURES="--features $LLAMA_FEATURE"
fi

echo -e "   Building in $SERVICE_DIR with features: ${SERVICE_FEATURES:-none}"
(cd "$SERVICE_DIR" && cargo build --release $SERVICE_FEATURES)

if [ $? -ne 0 ]; then
    echo -e "${RED}Ã¢ÂÅ’ Failed to build meetfree-llm-service${NC}"
    exit 1
fi

echo -e "${GREEN}Ã¢Å“â€¦ meetfree-llm-service built successfully${NC}"

# Detect target triple
echo ""
echo -e "${BLUE}Ã°Å¸Å½Â¯ Detecting target triple...${NC}"
TARGET_TRIPLE=$(rustc -vV | grep "host:" | awk '{print $2}')
echo -e "   Target: $TARGET_TRIPLE"

# Copy binary
BINARIES_DIR="$DESKTOP_DIR/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Clean old binaries
find "$BINARIES_DIR" -name "meetfree-llm-service*" -delete

BASE_BINARY="meetfree-llm-service"
SIDECAR_BINARY="meetfree-llm-service-$TARGET_TRIPLE"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    BASE_BINARY="meetfree-llm-service.exe"
    SIDECAR_BINARY="meetfree-llm-service-$TARGET_TRIPLE.exe"
fi

# The binary is in the workspace target directory, which is one level up from desktop.
WORKSPACE_ROOT="$DESKTOP_DIR/.."
SRC_PATH="$WORKSPACE_ROOT/target/release/$BASE_BINARY"
DEST_PATH="$BINARIES_DIR/$SIDECAR_BINARY"

if [ ! -f "$SRC_PATH" ]; then
    # Fallback: check if we are running from root and target is in root
    SRC_PATH="target/release/$BASE_BINARY"
fi

if [ -f "$SRC_PATH" ]; then
    cp "$SRC_PATH" "$DEST_PATH"
    echo -e "${GREEN}Ã¢Å“â€¦ Copied binary to $DEST_PATH${NC}"
else
    echo -e "${RED}Ã¢ÂÅ’ Binary not found at $SRC_PATH${NC}"
    # List contents of target/release to help debugging
    echo -e "${YELLOW}Contents of target/release:${NC}"
    ls -la "$WORKSPACE_ROOT/target/release/" || ls -la "target/release/"
    exit 1
fi

# Build using npm scripts
echo -e "${BLUE}Building complete Tauri application...${NC}"
echo ""

# NO_STRIP true due to issues with bundling appImage
NO_STRIP=true $PKG_MGR run tauri:build

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}Ã¢Å“â€¦ Build completed successfully!${NC}"
  echo ""
  echo -e "${GREEN}Ã°Å¸Å½â€° Complete Tauri application built with GPU acceleration!${NC}"
else
  echo ""
  echo -e "${RED}Ã¢ÂÅ’ Build failed${NC}"
  exit 1
fi

