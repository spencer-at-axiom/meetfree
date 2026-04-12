# Changelog

All notable changes to MeetFree are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- v0.5 baseline schema content for `meeting_context_assets`, `tags`, `meeting_tags`, and `embeddings`
- Tauri commands and repository modules for context assets, scratchpad upsert, tags, and assembled meeting context retrieval
- `MeetingContextPackage` assembly for summary, export, and future copilot use
- Frontend `contextService` plus hooks for context assets, scratchpad, tags, preferences, and extracted summary polling
- Provider-capability registry groundwork in Rust with per-provider defaults and unit tests
- Embedding storage repository plus Ollama and OpenAI-compatible embedding provider abstractions
- Capability-query Tauri commands plus background embedding reindexing and semantic search responses
- Meeting details context tab, meetings tag filter, and settings tag-management UI
- Native context-attachment picker flow with text-preview ingestion for common text formats
- `docs/V050_IMPLEMENTATION_PLAN.md` for the current release plan and forward roadmap

### Changed
- App manifests are now versioned `0.5.0`
- Summary generation now merges scratchpad, tags, and text attachment content into the prompt when present
- Markdown, PDF, and DOCX export now include scratchpad and tag metadata when present
- Transcript search filters now support backend tag filtering through `tagId`
- `ConfigContext` and `MeetingsContext` delegate part of their previous responsibilities into extracted hooks
- The merge gate now runs frontend build/lint/test plus Rust `fmt`, `clippy`, `check`, and `test`
- The squashed baseline migration file remains named `20260411000000_v040_baseline_schema.sql`, but its contents now represent the active `v0.5.0` baseline schema

### Known Limitations
- Provider capability queries now exist, but adaptive structured extraction and capability badges are not implemented yet
- Semantic retrieval now works through the Tauri command layer for supported providers, but there is no dedicated semantic-search UI yet
- Context-item management now supports picker-backed text attachment drafts, but richer binary attachment ingestion remains future work

## [0.4.0] - 2026-04-11

### Added
- Structured meeting-intelligence storage for `speaker_identities`, `voice_profiles`, `meeting_speakers`, `action_items`, and `decisions`
- Summary-to-structured persistence for action items and decisions, including transcript-backed provenance where evidence is found
- Reusable speaker identity workflows for create, link, unlink, local rename, inspect, and merge
- Summary-tab review UI for meeting speakers, action items, and decisions
- Explicit `accept`, `reject`, and `needs review` review-state actions plus inline provenance evidence in the structured review panel
- Identity inspector UI for editing identity details and managing voice-profile metadata
- Lightweight speaker-identity browsing polish with search, sort, quick-open navigation, and visible usage counts
- Voice-profile CRUD commands and UI for manual profile records
- Structured export assembly that prefers canonical action-item and decision rows
- Decision-to-action-item relationship linking after persistence
- Targeted backend and frontend test coverage for the new review and identity workflows

### Changed
- Meeting speakers are now stable review records that survive diarization reruns
- Summary regeneration preserves reviewed action items and decisions instead of replacing them blindly
- Structured extraction now prefers BlockNote structure first and only accepts heuristic additions when transcript evidence is strong enough
- Export paths prefer structured entities while remaining compatible with legacy meetings
- Identity inspection now includes editable voice-profile records
- Speaker identity detail inspection now uses a static export-compatible route

### Fixed
- Reviewed speaker names are preserved across diarization reruns
- Reviewed action items and decisions are preserved across summary regeneration
- Identity notes can be truly cleared instead of persisting ambiguous empty-string state
- Transcript provenance tokenization keeps meaningful short technical terms such as `AI`, `UI`, `QA`, `DB`, and `API`
- Merge dialog copy and identity review tests were tightened to avoid false confidence from brittle assertions

### Migration Notes
- **Backward Compatible**: All v0.3.0 meetings continue to work without modification
- **Automatic Migrations**: Database schema migrations run automatically on first launch
- **No Data Loss**: All existing meetings, transcripts, and speaker turns are preserved
- **Opt-In Extraction**: Structured entities are created when you regenerate a summary on existing meetings

### Known Limitations
- Extraction is more evidence-driven than earlier iterations, but still rule-based rather than model-native structured extraction
- Voice profiles are manual metadata records in `0.4.0`; automatic acoustic training and matching remain deferred
- Identity merge is one-way (source -> target, cannot undo)

### Deferred to Future Releases
- Voice profile training and acoustic matching (planned for v0.5.0+)
- Cross-meeting semantic retrieval (planned for v0.5.0+)
- In-meeting copilot UI (planned for v0.5.0+)
- Advanced filtering and search over extracted entities (planned for v0.5.0+)
- Bulk operations on identities and action items (planned for v0.5.0+)

## [0.3.0] - 2026-04-07

### Added
- **PDF Export**: Professional PDF export with genpdf crate, including meeting metadata, timestamps, and speaker labels
- **DOCX Export**: Microsoft Word export with docx-rs crate, Open XML compliant
- **Batch Export**: Export multiple meetings at once in Markdown, PDF, or DOCX formats
- **Speaker Diarization**: Automatic speaker identification via sherpa-onnx (native Rust, bundled)
  - Speaker turn detection and labeling
  - Confidence scoring for diarization results
  - Speaker turn storage in database
  - Integration with export formats
- **Export Path Tracking**: Database columns for tracking last export paths (markdown_export_path, pdf_export_path, docx_export_path)
- **Diarization Status Tracking**: Meeting-level diarization status field (not_started, in_progress, completed, failed)

### Changed
- Export architecture refactored into unified module with format-specific renderers
- Improved vocabulary rule application across display, export, and summary workflows

### Fixed
- Export file collision handling with automatic filename suffixes (filename-1, filename-2, etc.)

### Known Issues
- System audio capture depends on the local audio stack exposing a usable loopback or monitor source on the target platform

## [0.2.0] - 2026-01-04

### Added
- **Full-Text Search**: SQLite FTS5 with BM25 ranking for fast transcript search
- **Advanced Search Filters**: Date range, source type (recorded/imported), and summary status filters
- **Vocabulary Rules**: Global and meeting-scoped vocabulary correction system
  - Case-sensitive and case-insensitive rules
  - Live preview of vocabulary corrections
  - Automatic application to transcripts, exports, and summaries
- **Meeting Metadata**: Enhanced meeting records with source type, language, duration, recording timestamps
- **Raw Transcript Storage**: Preserve original transcripts before vocabulary corrections
- **Processing Version Tracking**: Schema versioning for future migrations
- **Audio Timestamps**: Segment-level audio timing (start_ms, end_ms)

### Changed
- Database schema upgraded with FTS5 virtual table and triggers
- Transcript storage now includes both raw and cleaned versions
- Search results sorted by BM25 relevance score
- Improved transcript retrieval performance with indexed queries

### Fixed
- Transcript search performance issues with large meeting collections
- Vocabulary rule application consistency across different workflows

## [0.1.0] - 2025-09-16

### Added
- **Desktop Application**: Tauri 2 + Next.js 14 + React 18 architecture
- **Audio Recording**: Microphone capture on all platforms (Windows, macOS, Linux)
- **System Audio Capture**: macOS only via Core Audio tap
- **Local Transcription**:
  - Whisper models with GPU acceleration (Metal, CUDA, Vulkan, HipBLAS)
  - Parakeet ONNX models for fast transcription
  - Parallel processing with adaptive worker management
  - Resource monitoring and automatic throttling
- **Audio Import**: Import existing audio files for transcription
- **Retranscription**: Re-transcribe meetings with different models or settings
- **Summary Generation**: Multiple provider support
  - Ollama (local)
  - OpenAI
  - Claude (Anthropic)
  - Groq
  - OpenRouter
  - Custom OpenAI-compatible endpoints
- **Template System**: Customizable summary templates with JSON schema validation
- **Markdown Export**: Export meetings to Markdown with YAML frontmatter
- **Meeting Management**: CRUD operations for meetings and transcripts
- **SQLite Database**: Local-first data storage with automatic migrations
- **Secure Storage**: OS-backed credential storage for API keys (Keychain, Credential Manager, Secret Service)
- **Onboarding Flow**: First-run setup with model validation
- **Auto-Updater**: Automatic update checking and installation
- **Notification System**: Meeting completion and error notifications
- **Audio Processing**:
  - EBU R128 loudness normalization
  - RNNoise-based noise suppression
  - Voice Activity Detection (VAD)
  - Bluetooth playback detection and warnings
- **Device Management**:
  - Audio device enumeration and selection
  - Device reconnection handling
  - Device validation and diagnostics
- **Recording Features**:
  - Pause/resume recording
  - Incremental audio saving with checkpoint recovery
  - Audio level monitoring
  - Recording preferences and folder selection

### Technical Details
- Rust 1.80+ backend with Tauri 2.6
- Node.js 20+ with pnpm 8+
- SQLite with WAL mode for concurrent access
- Connection pooling (max 10 connections)
- FFmpeg integration for audio format support
- Cross-platform audio via cpal crate
- GPU acceleration via whisper-rs features

### Platform Support
- **macOS**: Full support including system audio capture
- **Windows**: Microphone recording only (WASAPI loopback not implemented)
- **Linux**: Microphone recording only (PulseAudio monitor not implemented)

### Known Limitations
- System audio capture only works on macOS
- Windows and Linux require platform-specific implementations for system audio
- No cloud sync (local-first by design)
- No team/collaborative features
- Analytics disabled

## Future Releases (Not Scheduled)

Potential features for consideration in future releases:

- Cross-meeting speaker identification
- Speaker voice profiles
- Action item extraction
- Database encryption (SQLCipher)
- Automatic backup mechanism
- Team/collaborative workspaces (out of scope for single-user focus)
- Cloud sync (not in product vision)

---

## Version History

- **0.4.0** (2026-04-11): Structured meeting intelligence, speaker identities, review workflows, and manual voice-profile management
- **0.3.0** (2026-04-07): PDF/DOCX export, speaker diarization
- **0.2.0** (2026-01-04): FTS5 search, vocabulary rules, metadata enhancements
- **0.1.0** (2025-09-16): Initial release with core recording, transcription, and summary features
