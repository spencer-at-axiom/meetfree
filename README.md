![MeetFree Banner](docs/meetfree_banner.png)

# MeetFree

MeetFree is a local-first desktop app for meeting capture, transcription, search, and summaries.

Built with Tauri, Next.js, and Rust. Data stays on-device by default.

## Why MeetFree

- Reliable backend-owned recording finalization
- Fast transcript retrieval with SQLite FTS5
- Professional export formats: Markdown, PDF, and DOCX
- Speaker identification with diarization
- First-class import and retranscribe workflows
- Flexible summary providers, including Ollama

## v0.3.0 Is Complete

Current product highlights:

- Reliable recording finalization with durable metadata
- Transcript search with BM25 ranking and useful filters
- Markdown, PDF, and DOCX export for single and batch workflows
- Native speaker diarization through sherpa-onnx
- Local transcription with Parakeet or Whisper
- System audio capture on macOS, Windows, and Linux when the local audio stack exposes a usable loopback or monitor source
- Multiple summary providers, including local Ollama
- Vocabulary corrections across transcript, summary, and export flows
- Truthful readiness checks and recap-first post-meeting flow

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Rust 1.80+
- Platform-specific build tools, as described in [CONTRIBUTING.md](CONTRIBUTING.md)

### Windows CUDA Note

When running the desktop app with NVIDIA CUDA on Windows, `whisper-rs` currently needs MSVC's conforming preprocessor enabled.

- `cmd.exe`: `set CL=/Zc:preprocessor`
- PowerShell: `$env:CL="/Zc:preprocessor"`

Set that in the same shell before `pnpm --dir desktop run tauri:dev:cuda` or `pnpm --dir desktop run tauri:build:cuda`.
The Windows CUDA helper scripts in [`desktop/`](desktop/) now set this automatically.

### Run Locally

```bash
pnpm --dir desktop install
pnpm --dir desktop tauri:dev
```

### Release Checks

```bash
pwsh -File scripts/release-smoke.ps1
# macOS/Linux equivalent:
bash scripts/release-smoke.sh
```

## Code Map

- Frontend: `desktop/src/`
- Native backend: `desktop/src-tauri/src/`
- Database migrations: `desktop/src-tauri/migrations/`
- Audio and transcription pipeline: `desktop/src-tauri/src/audio/`
- Summary engine: `desktop/src-tauri/src/summary/`
- Export pipeline: `desktop/src-tauri/src/export/`
- Diarization: `desktop/src-tauri/src/diarization/`

For the current product workflow and repository guidance, see [AGENTS.md](AGENTS.md).
For the database schema, see [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
For manual desktop smoke checks, see [docs/QA_MATRIX.md](docs/QA_MATRIX.md).

## Privacy

- Recording, transcription, and storage run locally by default
- Cloud providers are optional and user-configured
- Provider API keys are stored in OS-backed secure storage
- Local summary options are available through Ollama
- Analytics is disabled in the current build; the shim is a no-op and does not send data

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for complete privacy details.
