# Data Model

MeetFree uses SQLite for local data persistence with FTS5 for full-text search.

## Database Location

The SQLite database is stored in the Tauri app data directory:
- macOS: `~/Library/Application Support/com.meetfree.ai/`
- Windows: `%APPDATA%\com.meetfree.ai\`
- Linux: `~/.local/share/com.meetfree.ai/`
- Database file: `meeting_minutes.sqlite`
- WAL files: `meeting_minutes.sqlite-wal` and `meeting_minutes.sqlite-shm`

## Schema Overview

### Core Tables

#### meetings
Stores meeting metadata and recording information.

```sql
CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    folder_path TEXT,
    source_type TEXT NOT NULL DEFAULT 'recorded',
    language TEXT,
    duration_seconds REAL,
    recording_started_at TEXT,
    recording_ended_at TEXT,
    markdown_export_path TEXT,
    pdf_export_path TEXT,
    docx_export_path TEXT,
    diarization_status TEXT DEFAULT 'not_started'
);
```

**Fields:**
- `id`: UUID primary key
- `title`: User-editable meeting title
- `created_at`, `updated_at`: ISO 8601 timestamps
- `folder_path`: Meeting recordings folder used by open-folder and export flows
- `source_type`: `recorded` or `imported`
- `language`: Language code (for example `en` or `es`)
- `duration_seconds`: Total recording duration
- `recording_started_at`, `recording_ended_at`: Recording timestamps
- `markdown_export_path`, `pdf_export_path`, `docx_export_path`: Last export file paths
- `diarization_status`: `not_started`, `in_progress`, `completed`, or `failed`

#### transcripts
Stores transcript segments with timestamps.

```sql
CREATE TABLE transcripts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    transcript TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    raw_transcript TEXT,
    processing_version TEXT NOT NULL DEFAULT 'v0.2.0',
    audio_start_time REAL,
    audio_end_time REAL,
    duration REAL,
    speaker TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

**Fields:**
- `id`: UUID primary key
- `meeting_id`: Foreign key to the meetings table
- `transcript`: Cleaned transcript text with vocabulary rules applied
- `raw_transcript`: Original transcript before vocabulary corrections
- `timestamp`: Segment creation timestamp
- `audio_start_time`, `audio_end_time`: Segment timing offsets used for playback and export alignment
- `duration`: Segment duration
- `speaker`: Source speaker label for the segment (for example `mic` or `system`)
- `processing_version`: Schema version for migrations

#### transcripts_fts
FTS5 virtual table for full-text search with BM25 ranking.

```sql
CREATE VIRTUAL TABLE transcripts_fts
USING fts5(
  transcript,
  content='transcripts',
  content_rowid='rowid'
);
```

Automatically synchronized with the `transcripts` table via triggers.

#### speaker_turns
Stores speaker diarization results (v0.3.0).

```sql
CREATE TABLE speaker_turns (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    speaker_number INTEGER NOT NULL,
    speaker_name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

**Fields:**
- `speaker_number`: Numeric speaker identifier (1, 2, 3, and so on)
- `speaker_name`: Optional user-assigned speaker name
- `start_ms`, `end_ms`: Speaker turn boundaries in milliseconds
- `text`: Transcript text for this speaker turn
- `confidence`: Diarization confidence score (0.0-1.0)

**Indexes:**
- `idx_speaker_turns_meeting`: Fast lookup by meeting
- `idx_speaker_turns_speaker`: Fast lookup by meeting and speaker
- `idx_speaker_turns_timestamps`: Fast range queries by time

#### vocabulary_entries
Stores vocabulary correction rules (v0.2.0).

```sql
CREATE TABLE vocabulary_entries (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'meeting')),
  scope_id TEXT,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Fields:**
- `scope_type`: `global` (all meetings) or `meeting` (specific meeting)
- `scope_id`: Meeting ID when `scope_type` is `meeting`, `NULL` for global rules
- `source_text`: Text to find and replace
- `target_text`: Replacement text
- `case_sensitive`: `0` (false) or `1` (true)

**Indexes:**
- `idx_vocabulary_entries_scope`: Fast lookup by scope
- `idx_vocabulary_entries_scope_source_ci`: Unique constraint for case-insensitive rules
- `idx_vocabulary_entries_scope_source_cs`: Unique constraint for case-sensitive rules

### Configuration Tables

#### settings
Stores summary provider configuration.

```sql
CREATE TABLE settings (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    whisperModel TEXT NOT NULL,
    ollamaEndpoint TEXT,
    customOpenAIConfig TEXT
);
```

**Note:** API keys are not stored in SQLite. They are stored in OS-backed secure storage (Keychain, Credential Manager, Secret Service).

**Supported providers:**
- `ollama`: Local Ollama instance
- `openai`: OpenAI API
- `claude`: Claude API
- `groq`: Groq API
- `openrouter`: OpenRouter API
- `custom-openai`: Custom OpenAI-compatible endpoint

#### transcript_settings
Stores transcription provider configuration.

```sql
CREATE TABLE transcript_settings (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL
);
```

**Supported providers:**
- `localWhisper`: Local Whisper models
- `parakeet`: Local Parakeet ONNX models

### Summary Pipeline Table

#### summary_processes
Tracks summary generation status and stores canonical summary payloads.

```sql
CREATE TABLE summary_processes (
    meeting_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT,
    result TEXT,
    start_time TEXT,
    end_time TEXT,
    chunk_count INTEGER DEFAULT 0,
    processing_time REAL DEFAULT 0.0,
    metadata TEXT,
    result_backup TEXT,
    result_backup_timestamp TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);
```

## Data Flow

### Recording Workflow
1. User starts recording -> Meeting record created with `source_type='recorded'` and a recording folder path
2. Audio captured -> Transcription engine processes chunks
3. Transcript segments -> Stored in `transcripts` table with timestamps
4. Vocabulary rules applied -> `transcript` field contains cleaned text, `raw_transcript` contains original
5. FTS5 index updated -> Triggers automatically sync `transcripts_fts`
6. User stops recording -> Meeting metadata finalized (duration, end time)

### Import Workflow
1. User imports audio file -> Meeting record created with `source_type='imported'`
2. Audio decoded -> Transcription engine processes
3. Same as recording workflow steps 3-5

### Diarization Workflow
1. User requests diarization -> `diarization_status='in_progress'`
2. sherpa-onnx (native Rust) -> Identifies speaker segments
3. Speaker segments mapped to transcript -> `speaker_turns` table populated
4. Status updated -> `diarization_status='completed'` or `failed`

### Export Workflow
1. User exports meeting -> Fetch meeting metadata and transcripts
2. Apply vocabulary rules -> Use `transcript` field (already cleaned)
3. Fetch speaker turns (if diarized) -> Join with `speaker_turns` table
4. Render format -> Markdown, PDF, or DOCX
5. Store export path -> Update `markdown_export_path`, `pdf_export_path`, or `docx_export_path`

### Search Workflow
1. User enters query -> Parse search terms
2. Execute FTS5 query -> `SELECT * FROM transcripts_fts WHERE transcript MATCH ?`
3. Apply filters -> Date range, source type, summary status
4. Sort by relevance -> BM25 ranking
5. Join with meetings -> Return meeting metadata with matching segments

## Migrations

Database schema is managed through SQL migration files in `desktop/src-tauri/migrations/`.

**Migration naming:** `YYYYMMDDHHMMSS_description.sql`

**Current baseline migration:**
- `20260411000000_v040_baseline_schema.sql`: Squashed baseline schema for fresh development installs

Migrations are applied automatically on app startup via `sqlx::migrate!()`.

**Developer note:** this baseline replaced the historical migration chain. Existing local databases created before the squash should be reset before running new builds.

## Connection Pooling

SQLite connection pool configuration:
- Max connections: 10
- WAL mode: Enabled for concurrent reads
- Foreign keys: Enabled
- Busy timeout: 10 seconds

## Backup and Recovery

**Automatic recovery:**
- WAL corruption detection and recovery on startup
- Checkpoint recovery for incomplete transactions

**Manual backup:**
- Database file can be copied while app is running (WAL mode)
- Location: Use "Open Database Folder" command in app

**No cloud sync:** All data remains local by design.
