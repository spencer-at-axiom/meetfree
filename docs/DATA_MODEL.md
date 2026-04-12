# Data Model

MeetFree uses SQLite for local persistence, with FTS5 for transcript search and application-layer cosine similarity over stored embedding blobs.

This document reflects the active schema and related data flows in the current codebase on April 11, 2026.

## Storage Location

The database path is resolved from Tauri's app-data directory and stored as:

- Database file: `meeting_minutes.sqlite`
- WAL files: `meeting_minutes.sqlite-wal` and `meeting_minutes.sqlite-shm`
- Tauri app identifier: `com.meetfree.ai`

Platform-specific app-data roots come from Tauri's `app_handle.path().app_data_dir()` resolution for the current OS.

## Migration Source Of Truth

The active squashed baseline migration file is:

- `desktop/src-tauri/migrations/20260411000000_v040_baseline_schema.sql`

The filename still says `v040`, but the file contents now define the active `v0.5.0` baseline schema. Database startup runs `sqlx::migrate!()` and then the summary-contract startup migration.

## Active Tables

### Core Meeting Data

#### `meetings`

Stores the top-level meeting record.

Key columns:

- `id`
- `title`
- `created_at`, `updated_at`
- `folder_path`
- `source_type`
- `language`
- `duration_seconds`
- `recording_started_at`, `recording_ended_at`
- `markdown_export_path`, `pdf_export_path`, `docx_export_path`
- `diarization_status`

Indexes:

- `idx_meetings_created_at`
- `idx_meetings_updated_at`
- `idx_meetings_source_type`

#### `transcripts`

Stores transcript segments for a meeting.

Key columns:

- `id`
- `meeting_id`
- `transcript`
- `timestamp`
- `raw_transcript`
- `processing_version`
- `audio_start_time`, `audio_end_time`
- `duration`
- `speaker`

Indexes:

- `idx_transcripts_meeting`
- `idx_transcripts_meeting_audio_start`

#### `summary_processes`

Stores summary job state and canonical summary payloads.

Key columns:

- `meeting_id`
- `status`
- `created_at`, `updated_at`
- `error`
- `result`
- `start_time`, `end_time`
- `chunk_count`
- `processing_time`
- `metadata`
- `result_backup`
- `result_backup_timestamp`

#### `settings`

Stores non-secret summary-provider configuration.

Key columns:

- `id`
- `provider`
- `model`
- `whisperModel`
- `ollamaEndpoint`
- `customOpenAIConfig`

Secret API keys are stored in OS-backed secure storage, not in SQLite.

#### `transcript_settings`

Stores transcription-provider configuration.

Key columns:

- `id`
- `provider`
- `model`

#### `vocabulary_entries`

Stores global and meeting-scoped cleanup rules.

Key columns:

- `id`
- `scope_type`
- `scope_id`
- `source_text`
- `target_text`
- `case_sensitive`
- `created_at`, `updated_at`

Indexes:

- `idx_vocabulary_entries_scope`
- `idx_vocabulary_entries_scope_source_ci`
- `idx_vocabulary_entries_scope_source_cs`

### Structured Review And Identity Layer

#### `speaker_identities`

Reusable person records across meetings.

Key columns:

- `id`
- `display_name`
- `normalized_name`
- `notes`
- `created_at`, `updated_at`
- `archived_at`

Index:

- `idx_speaker_identities_normalized_name`

#### `voice_profiles`

Manual or future embedding-backed profile metadata attached to a `speaker_identity`.

Key columns:

- `id`
- `speaker_identity_id`
- `profile_kind`
- `provider`
- `model_version`
- `sample_count`
- `profile_payload`
- `created_at`, `updated_at`
- `last_trained_at`

Index:

- `idx_voice_profiles_identity`

#### `meeting_speakers`

Stable meeting-scoped speaker review records layered above raw diarization output.

Key columns:

- `id`
- `meeting_id`
- `diarization_speaker_number`
- `display_name_override`
- `speaker_identity_id`
- `review_status`
- `match_confidence`
- `is_active`
- `created_at`, `updated_at`
- `last_reviewed_at`
- `last_generated_at`

Indexes:

- `idx_meeting_speakers_meeting`
- `idx_meeting_speakers_identity`
- `idx_meeting_speakers_active_number`

#### `action_items`

Durable action-item rows extracted from meeting content.

Key columns:

- `id`
- `meeting_id`
- `title`
- `details`
- `owner_speaker_identity_id`
- `owner_display_name`
- `due_date`
- `status`
- `review_status`
- `source_transcript_id`
- `source_start_ms`, `source_end_ms`
- `source_excerpt`
- `extraction_method`
- `extraction_version`
- `created_at`, `updated_at`

Indexes:

- `idx_action_items_meeting`
- `idx_action_items_owner`
- `idx_action_items_status`

#### `decisions`

Durable decision rows extracted from meeting content.

Key columns:

- `id`
- `meeting_id`
- `title`
- `details`
- `review_status`
- `source_transcript_id`
- `source_start_ms`, `source_end_ms`
- `source_excerpt`
- `extraction_method`
- `extraction_version`
- `related_action_item_ids`
- `created_at`, `updated_at`

Indexes:

- `idx_decisions_meeting`
- `idx_decisions_review_status`

#### `speaker_turns`

Raw diarization output, optionally linked to a `meeting_speaker`.

Key columns:

- `id`
- `meeting_id`
- `meeting_speaker_id`
- `speaker_number`
- `speaker_name`
- `start_ms`, `end_ms`
- `text`
- `confidence`
- `created_at`

Indexes:

- `idx_speaker_turns_meeting`
- `idx_speaker_turns_speaker`
- `idx_speaker_turns_timestamps`

### Context And Retrieval Foundation

#### `meeting_context_assets`

Meeting-scoped context records used for summary, export, and future retrieval.

Supported `asset_type` values:

- `scratchpad`
- `attachment`
- `calendar_event`
- `note`

Key columns:

- `id`
- `meeting_id`
- `asset_type`
- `title`
- `content`
- `file_path`
- `file_mime_type`
- `file_size_bytes`
- `metadata`
- `sort_order`
- `created_at`, `updated_at`

Indexes:

- `idx_context_assets_meeting`
- `idx_context_assets_type`

#### `tags`

Global tag definitions.

Key columns:

- `id`
- `name`
- `normalized_name`
- `color`
- `created_at`

Index:

- `idx_tags_normalized_name`

#### `meeting_tags`

Junction table between meetings and tags.

Key columns:

- `meeting_id`
- `tag_id`
- `created_at`

Primary key:

- `(meeting_id, tag_id)`

#### `embeddings`

Stored vector representations for future semantic retrieval.

Supported `source_type` values:

- `transcript_segment`
- `context_asset`
- `meeting_summary`
- `meeting_context`

Key columns:

- `id`
- `source_type`
- `source_id`
- `meeting_id`
- `embedding`
- `model_name`
- `dimensions`
- `created_at`

Indexes:

- `idx_embeddings_source`
- `idx_embeddings_meeting`

Notes:

- Embeddings are stored as SQLite `BLOB` values containing `f32` bytes.
- Similarity is computed in Rust, not via a SQLite vector extension.
- The `embedding_search` Tauri command now embeds the query with the configured supported provider and scores stored vectors in application code.

### Full-Text Search

#### `transcripts_fts`

Virtual FTS5 table over transcript text.

Definition:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts
USING fts5(
  transcript,
  content='transcripts',
  content_rowid='rowid'
);
```

Triggers keep `transcripts_fts` synchronized after transcript insert, update, and delete operations.

## Active Data Flows

### Recording And Import

1. A meeting row is created in `meetings`.
2. Transcript segments are written to `transcripts`.
3. `transcripts_fts` is maintained automatically through triggers.
4. Summary generation and export later consume the saved meeting/transcript state.

### Summary Generation

The summary command path now assembles a `MeetingContextPackage` from:

- meeting metadata
- transcript segments
- speaker turns
- identified meeting speakers
- action items
- decisions
- scratchpad content
- non-scratchpad context assets
- meeting tags
- effective vocabulary rules

That package is then formatted into prompt context and merged into the summary request when non-empty.

### Structured Artifact Persistence

Summary save writes the canonical summary payload into `summary_processes` and then synchronizes durable `action_items` and `decisions`.

### Export

Export assembly prefers durable structured action items and decisions when available and now also carries:

- scratchpad content
- tags
- vocabulary rules

### Search

Transcript search supports:

- full-text query
- date range filtering
- source-type filtering
- summary-present filtering
- backend `tagId` filtering

### Embedding Foundation

The repository includes:

- embedding storage and deletion helpers
- meeting-level embedding presence checks
- cosine-similarity ranking over stored vectors
- Ollama and OpenAI-compatible embedding providers

Automatic embedding generation now runs in the background after transcript saves, retranscription/import completion, and context or tag updates for supported providers. There is still no dedicated semantic-search UI in the desktop app.

## Connection And Recovery Behavior

Database manager behavior verified in code:

- SQLite WAL mode is enabled
- foreign keys are enabled
- busy timeout is 10 seconds
- max pool size is 10 connections
- startup retries corrupted-WAL recovery by deleting orphaned WAL/SHM files and reopening the database
- shutdown checkpoints WAL state with `PRAGMA wal_checkpoint(TRUNCATE)`
