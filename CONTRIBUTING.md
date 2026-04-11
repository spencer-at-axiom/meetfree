# Contributing

## Branching

- Branch from `main`.
- Keep each branch focused on one change set.
- Open pull requests back to `main` unless the repository maintainers specify a different target.

## Development Areas

- Desktop app UI: [`desktop/src/`](desktop/src/)
- Tauri and Rust core: [`desktop/src-tauri/`](desktop/src-tauri/)
- Workspace manifest: [`Cargo.toml`](Cargo.toml)

## Expected Workflow

1. Install the required toolchain and platform prerequisites.
2. Install dependencies for the desktop app.
3. Make the code change.
4. Run the narrowest relevant verification you can from this machine.
5. Update documentation whenever behavior, architecture, or build steps change.

## Prerequisites

- Rust `1.80` or newer
- Node.js `20.x`
- `pnpm 8.x`
- `cmake` for native model dependencies (`whisper-rs`, ONNX Runtime)
- Windows CUDA builds: CUDA Toolkit plus MSVC's conforming preprocessor flag (`/Zc:preprocessor`) for `whisper-rs`
- Windows GPU builds: Vulkan SDK when building the Vulkan variant
- Linux development: WebKitGTK 4.1 packages plus audio/build dependencies used in CI
- Network access or an internal mirror for the FFmpeg sidecar download used during Tauri builds

## Useful Commands

From [`desktop/`](desktop/):

```bash
pnpm install
pnpm run tauri:dev
pnpm run tauri:build
pnpm run tauri:dev:cpu
pnpm run tauri:dev:cuda
pnpm run tauri:dev:vulkan
pnpm run tauri:dev:metal
pnpm run lint
pnpm run test
```

From the repository root:

```bash
cargo check -p meetfree
cargo test -p meetfree --lib
cargo metadata --no-deps --format-version 1
pwsh -File scripts/release-smoke.ps1
# macOS/Linux equivalent:
bash scripts/release-smoke.sh
```

## Platform Notes

- The `tauri:dev` and `tauri:build` scripts auto-detect a usable backend. Use the explicit `:cpu`, `:cuda`, `:vulkan`, `:metal`, or `:coreml` variants only when you need to force a specific backend.
- Windows NVIDIA/CUDA note:
  Set `CL=/Zc:preprocessor` in the same shell before `pnpm run tauri:dev:cuda` or `pnpm run tauri:build:cuda` if you are launching them directly. This avoids the CUDA 13.x + MSVC failure where `whisper-rs-sys` reports that `cl.exe` is using the traditional preprocessor.
- Linux developers should install the same WebKitGTK 4.1 packages pinned in [`.github/workflows/quality.yml`](.github/workflows/quality.yml).
- System audio capture supports all desktop platforms:
  - macOS: Core Audio tap path
  - Windows: WASAPI-hosted loopback-compatible input sources (for example Stereo Mix / What U Hear, depending on audio driver)
  - Linux: PulseAudio/PipeWire monitor sources (availability depends on monitor source exposure)

## Documentation Standard

- Only document behavior that is present in the current codebase or explicitly planned in the active change set.
- Remove or correct stale claims in the same change that exposes them.
- Prefer one source of truth over status-summary duplicates.
