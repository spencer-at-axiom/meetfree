# Building

## Product Of Record

The product of record in this repository is the native desktop app under `desktop/`.

## Prerequisites

- Rust 1.77 or newer
- Node.js 20 or newer
- `pnpm`
- the standard platform build toolchain for Tauri on your OS

## Desktop Workflow

From `desktop/`:

```bash
pnpm install
pnpm run tauri:dev
pnpm run tauri:build
```

Useful local checks:

```bash
pnpm lint
pnpm build
```

## Workspace Checks

From the repository root:

```bash
cargo check -p meetfree
cargo build -p llama-helper
```

If you want the current Rust unit/integration test status:

```bash
cargo test -p meetfree --lib
```

## Windows Note

If PowerShell blocks `pnpm.ps1` because of execution policy, use the Windows command wrapper instead:

```bash
pnpm.cmd lint
pnpm.cmd build
```

## Tauri Packaging Notes

- the desktop app bundles external binaries for `llama-helper` and `ffmpeg`
- packaging uses the configuration in `desktop/src-tauri/tauri.conf.json`
- GPU-related build features are defined in `desktop/src-tauri/Cargo.toml`

## Suggested Validation Order

1. `cargo check -p meetfree`
2. `pnpm lint`
3. `pnpm build`
4. `pnpm run tauri:dev`

Use `cargo test -p meetfree --lib` before release work, not just before packaging.
