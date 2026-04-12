# AGENTS.md

This repository's product of record is the native Tauri desktop application in [`desktop/`](desktop/).

## Release Status

**v0.5.0 In Progress** — Context ingestion layer, provider capability registry, embedding pipeline foundation, and engineering hardening on top of the v0.4.0 foundation (structured meeting intelligence, speaker identities, review workflows).

## Stack

- Tauri 2
- Next.js 16
- React 18
- Rust
- SQLite via `sqlx`
- Local transcription via Whisper and Parakeet
- Summary providers via Ollama, OpenAI, Claude, Groq, OpenRouter, and custom OpenAI-compatible endpoints
- Export formats: Markdown, PDF (genpdf), DOCX (docx-rs by bokuweb)

## What Is Active

- Desktop UI in [`desktop/src/`](desktop/src/)
- Native commands and services in [`desktop/src-tauri/src/`](desktop/src-tauri/src/)
- Local database initialization in [`desktop/src-tauri/src/database/manager.rs`](desktop/src-tauri/src/database/manager.rs)
- Audio capture and transcription pipeline in [`desktop/src-tauri/src/audio/`](desktop/src-tauri/src/audio/)
- Summary templates in [`desktop/src-tauri/src/summary/`](desktop/src-tauri/src/summary/)
- Export infrastructure in [`desktop/src-tauri/src/export/`](desktop/src-tauri/src/export/)
- Speaker identity and structured review in [`desktop/src-tauri/src/database/repositories/`](desktop/src-tauri/src/database/repositories/)
- Diarization pipeline in [`desktop/src-tauri/src/diarization/`](desktop/src-tauri/src/diarization/)

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the database schema and content model.

## What Is Not Active

- There is no separate FastAPI backend path to maintain in this fork.
- Team/collaborative workspaces and cloud sync remain out of scope for this single-user fork.

## Implementation Status

### Fully Implemented (v0.4.0)
- Desktop UI with Next.js 16 and React 18
- Audio recording (microphone) on all platforms
- Local transcription with Whisper and Parakeet models
- Real-time transcription status tracking
- Meeting management (CRUD operations) with durable finalization
- SQLite FTS5 search with BM25 ranking, date/source/summary filters
- Markdown export (single and batch) with YAML frontmatter
- PDF export (single and batch) with professional formatting
- DOCX export (single and batch) with Open XML compliance
- Speaker diarization via sherpa-onnx integration (native Rust, no external dependencies)
- Summary generation with multiple providers (Ollama, OpenAI, Claude, Groq, OpenRouter, custom endpoints)
- Template system for summaries
- Vocabulary rules (global and meeting-scoped) with live preview
- Audio import and retranscription as first-class workflows
- Auto-updater
- Onboarding flow with model validation
- Notification system (core functionality)
- Database migrations and schema management
- Transcript cleanup and vocabulary corrections across display, export, and summary
- **Reusable speaker identities** with create, link, unlink, rename, inspect, and merge workflows
- **Manual voice profiles** with provider/model metadata and CRUD
- **Structured action items and decisions** as first-class database entities with transcript-backed provenance
- **Review UI** for meeting speakers, action items, and decisions with accept/reject/needs-review states
- **Structured export assembly** preferring canonical action-item and decision rows
- **Decision-to-action-item relationship linking**
- **Provider capability registry** with per-provider feature detection (tool use, JSON mode, streaming, context size, embeddings)
- **Meeting context assets** (scratchpad, attachments, calendar events, notes) with full CRUD
- **Tag system** for meeting organization with create, delete, tag/untag, and filtered search
- **Context assembly service** producing a unified MeetingContextPackage for summary, export, and copilot
- **Embedding storage and retrieval** with cosine similarity search (SQLite BLOB storage, application-layer similarity)
- **Embedding provider abstraction** with Ollama and OpenAI-compatible implementations
- **CI merge gate** now runs `cargo test`, `cargo fmt`, and `cargo clippy` (previously only `cargo check`)

### Platform-Specific Limitations
- System audio capture availability depends on platform audio stack exposure:
  - macOS: Core Audio tap
  - Windows: WASAPI-hosted loopback-compatible input sources (for example Stereo Mix / What U Hear, depending on audio driver)
  - Linux: PulseAudio/PipeWire monitor sources (availability depends on monitor source exposure)

### Not Yet Implemented (Future Releases)
- Team/collaborative workspaces (out of scope for single-user release)
- Cloud sync (not in product vision)
- Cross-meeting speaker identification via acoustic matching (planned for v0.5+)
- Voice profile training and automatic speaker matching (planned for v0.5+)
- Context-aware summary generation consuming scratchpad/tags/attachments (planned for v0.5 completion)
- Calendar enrichment via OS calendar APIs (planned for v0.5.1 or v0.6)
- Meeting memory and cross-meeting retrieval (planned for v0.6)
- Live meeting copilot (planned for v0.7+)
- Streaming summary generation (backend implemented, frontend wiring pending)

### Test Coverage
- Backend: Comprehensive unit tests across all core modules (audio, transcription, export, database, summary, diarization)
- Frontend: Hook/service coverage for recording session control, keyboard stop/start behavior, summary generation workflow, IndexedDB, updater services, speaker identity UI, and structured review panel

### Known Issues
- System audio capture on Windows/Linux depends on environment-specific loopback/monitor devices being exposed by the active driver/stack

## Recording Workflow

The recording workflow follows a clear state machine: `Ready -> Recording -> Finalizing -> Recap`.

### Recording States
- **Ready**: Idle recording canvas with readiness checks and start controls
- **Recording**: Active audio capture with live transcription (segment-based, not token-by-token)
- **Paused**: Recording paused, can be resumed
- **Finalizing**: Post-recording processing (stopping audio, processing transcripts, unloading model, saving)
- **Recap**: Post-meeting summary view (default landing page after recording)

### Key Components
- **RecordingReadyView**: Idle recording canvas with readiness status and minimal start controls
- **ActiveRecording**: Recording interface with status-aware display and backend-synced duration
- **RecordingFinalizeOverlay**: Granular shutdown progress with backend stage mapping
- **RecordingTranscriptPane**: Live transcript display during recording
- **useRecordingSessionController**: Unified controller for all recording lifecycle operations

### State Management
- **RecordingStateContext**: Single source of truth for recording state, synced with backend via polling and events
- Backend events: `recording-started`, `recording-stopped`, `recording-paused`, `recording-resumed`, `recording-shutdown-progress`
- All stop paths (UI, tray, keyboard shortcuts) converge to the same finalization flow

### Transcription
- Segment-based transcription (not real-time streaming)
- Status messages reflect actual system behavior: "Listening for speech", "Transcribing latest segment", "Paused", "Finalizing transcript"
- VirtualizedTranscriptView handles both small lists (animated) and large lists (virtualized for performance)

### Post-Recording Flow
- Automatic navigation to meeting details page with `?source=recording` parameter
- Default tab is "Summary" (recap-first experience)
- Auto-summary generation respects user preferences and model availability

## Meeting Details Page

The meeting details page is recap-first, prioritizing the AI summary over raw transcripts.

### Navigation
- Default view after recording: Summary tab
- Keyboard shortcuts: Cmd/Ctrl+1 (Transcript), Cmd/Ctrl+2 (Summary)
- Header shows meeting date, duration, segment count, and quick actions (open folder, export)

### Summary Tab
- Clear loading states: generating, error with retry, empty state with generate button
- BlockNote editor for rich text summary editing
- Template system for structured summaries
- Multiple AI providers supported (Ollama, OpenAI, Claude, Groq, OpenRouter, custom endpoints)

### Transcript Tab
- Paginated transcript loading for performance
- Infinite scroll with lazy loading
- Retranscription support
- Diarization settings (when available)

## Useful Commands

From [`desktop/`](desktop/):

```bash
pnpm install
pnpm run tauri:dev
pnpm run tauri:build
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

## Documentation Rule

Keep documentation aligned with the current codebase. Remove stale claims instead of preserving marketing copy that no longer matches implementation.
