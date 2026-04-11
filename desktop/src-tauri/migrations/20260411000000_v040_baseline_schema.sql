-- v0.4.0 baseline schema (migration squash)
-- This migration replaces historical incremental migrations with a single
-- product-aligned schema for fresh development installs.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at);
CREATE INDEX IF NOT EXISTS idx_meetings_updated_at ON meetings(updated_at);
CREATE INDEX IF NOT EXISTS idx_meetings_source_type ON meetings(source_type);

CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_audio_start ON transcripts(meeting_id, audio_start_time, timestamp);

CREATE TABLE IF NOT EXISTS summary_processes (
    meeting_id TEXT PRIMARY KEY NOT NULL,
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

CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    whisperModel TEXT NOT NULL,
    ollamaEndpoint TEXT,
    customOpenAIConfig TEXT
);

CREATE TABLE IF NOT EXISTS transcript_settings (
    id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vocabulary_entries (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'meeting')),
    scope_id TEXT,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    case_sensitive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_entries_scope
ON vocabulary_entries(scope_type, scope_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_entries_scope_source_ci
ON vocabulary_entries(scope_type, COALESCE(scope_id, ''), lower(source_text))
WHERE case_sensitive = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_entries_scope_source_cs
ON vocabulary_entries(scope_type, COALESCE(scope_id, ''), source_text)
WHERE case_sensitive = 1;

CREATE TABLE IF NOT EXISTS speaker_turns (
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

CREATE INDEX IF NOT EXISTS idx_speaker_turns_meeting
ON speaker_turns(meeting_id);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_speaker
ON speaker_turns(meeting_id, speaker_number);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_timestamps
ON speaker_turns(meeting_id, start_ms, end_ms);

CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts
USING fts5(
  transcript,
  content='transcripts',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS transcripts_ai
AFTER INSERT ON transcripts
BEGIN
  INSERT INTO transcripts_fts(rowid, transcript)
  VALUES (new.rowid, new.transcript);
END;

CREATE TRIGGER IF NOT EXISTS transcripts_ad
AFTER DELETE ON transcripts
BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, transcript)
  VALUES('delete', old.rowid, old.transcript);
END;

CREATE TRIGGER IF NOT EXISTS transcripts_au
AFTER UPDATE ON transcripts
BEGIN
  INSERT INTO transcripts_fts(transcripts_fts, rowid, transcript)
  VALUES('delete', old.rowid, old.transcript);
  INSERT INTO transcripts_fts(rowid, transcript)
  VALUES (new.rowid, new.transcript);
END;

INSERT INTO transcripts_fts(transcripts_fts) VALUES('rebuild');
