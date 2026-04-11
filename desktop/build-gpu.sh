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

