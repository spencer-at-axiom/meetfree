# MeetFree App Icons

This directory contains icon assets for the MeetFree Tauri application.

## Status

- `icon.png`: main source icon
- `icon.ico`: Windows icon bundle
- `icon.icns`: macOS icon bundle
- `32x32.png`, `128x128.png`, `256x256.png`, `512x512.png`, `1024x1024.png`: generated PNG sizes

## Generate Icons

From `desktop/`:

```bash
pnpm install
pnpm run icons:generate
```

The generation flow:

1. Builds PNG sizes from `desktop/public/logo.png`
2. Generates a Windows `.ico` bundle when the local toolchain supports it
3. Creates `icon.iconset` assets that can be converted into `.icns` on macOS

## macOS Notes

If a macOS packaging step reports an `.icns` issue, regenerate it on macOS:

```bash
cd desktop
bash scripts/generate-icns-macos.sh
```

Or run:

```bash
iconutil -c icns icon.iconset -o icon.icns
```

## Source Asset

The source image is `desktop/public/logo.png`. Replace that file and rerun the icon generation script if branding changes.
