-- v0.5.0 baseline schema (migration squash)
-- This migration replaces historical incremental migrations with a single
-- product-aligned schema for fresh development installs.
-- Includes: v0.4 structured entities + v0.5 context layer, tags, embeddings.

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

CREATE TABLE IF NOT EXISTS speaker_identities (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_speaker_identities_normalized_name
ON speaker_identities(normalized_name)
WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS voice_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    speaker_identity_id TEXT NOT NULL,
    profile_kind TEXT NOT NULL CHECK (
        profile_kind IN ('manual', 'embedding_v1')
    ),
    provider TEXT,
    model_version TEXT,
    sample_count INTEGER NOT NULL DEFAULT 0,
    profile_payload TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_trained_at TEXT,
    FOREIGN KEY (speaker_identity_id) REFERENCES speaker_identities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_identity
ON voice_profiles(speaker_identity_id);

CREATE TABLE IF NOT EXISTS meeting_speakers (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    diarization_speaker_number INTEGER,
    display_name_override TEXT,
    speaker_identity_id TEXT,
    review_status TEXT NOT NULL CHECK (
        review_status IN ('unreviewed', 'suggested', 'confirmed', 'rejected')
    ) DEFAULT 'unreviewed',
    match_confidence REAL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_reviewed_at TEXT,
    last_generated_at TEXT,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (speaker_identity_id) REFERENCES speaker_identities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_speakers_meeting
ON meeting_speakers(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_speakers_identity
ON meeting_speakers(speaker_identity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_speakers_active_number
ON meeting_speakers(meeting_id, diarization_speaker_number)
WHERE is_active = 1 AND diarization_speaker_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT,
    owner_speaker_identity_id TEXT,
    owner_display_name TEXT,
    due_date TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('open', 'completed', 'dismissed')
    ) DEFAULT 'open',
    review_status TEXT NOT NULL CHECK (
        review_status IN ('unreviewed', 'accepted', 'edited', 'rejected')
    ) DEFAULT 'unreviewed',
    source_transcript_id TEXT,
    source_start_ms INTEGER,
    source_end_ms INTEGER,
    source_excerpt TEXT,
    extraction_method TEXT NOT NULL,
    extraction_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_speaker_identity_id) REFERENCES speaker_identities(id) ON DELETE SET NULL,
    FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_action_items_meeting
ON action_items(meeting_id);

CREATE INDEX IF NOT EXISTS idx_action_items_owner
ON action_items(owner_speaker_identity_id);

CREATE INDEX IF NOT EXISTS idx_action_items_status
ON action_items(status, review_status);

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    title TEXT NOT NULL,
    details TEXT,
    review_status TEXT NOT NULL CHECK (
        review_status IN ('unreviewed', 'accepted', 'edited', 'rejected')
    ) DEFAULT 'unreviewed',
    source_transcript_id TEXT,
    source_start_ms INTEGER,
    source_end_ms INTEGER,
    source_excerpt TEXT,
    extraction_method TEXT NOT NULL,
    extraction_version TEXT NOT NULL,
    related_action_item_ids TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_meeting
ON decisions(meeting_id);

CREATE INDEX IF NOT EXISTS idx_decisions_review_status
ON decisions(review_status);

CREATE TABLE IF NOT EXISTS speaker_turns (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    meeting_speaker_id TEXT,
    speaker_number INTEGER NOT NULL,
    speaker_name TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY(meeting_speaker_id) REFERENCES meeting_speakers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_meeting
ON speaker_turns(meeting_id);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_speaker
ON speaker_turns(meeting_id, speaker_number);

CREATE INDEX IF NOT EXISTS idx_speaker_turns_timestamps
ON speaker_turns(meeting_id, start_ms, end_ms);

-- v0.5.0: Context ingestion layer

CREATE TABLE IF NOT EXISTS meeting_context_assets (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    asset_type TEXT NOT NULL CHECK (
        asset_type IN ('scratchpad', 'attachment', 'calendar_event', 'note')
    ),
    title TEXT,
    content TEXT,
    file_path TEXT,
    file_mime_type TEXT,
    file_size_bytes INTEGER,
    metadata TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_context_assets_meeting
ON meeting_context_assets(meeting_id);

CREATE INDEX IF NOT EXISTS idx_context_assets_type
ON meeting_context_assets(meeting_id, asset_type);

-- v0.5.0: Tag system

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_normalized_name
ON tags(normalized_name);

CREATE TABLE IF NOT EXISTS meeting_tags (
    meeting_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, tag_id),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- v0.5.0: Embedding storage for semantic retrieval

CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('transcript_segment', 'context_asset', 'meeting_summary', 'meeting_context')
    ),
    source_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    embedding BLOB NOT NULL,
    model_name TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_source
ON embeddings(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_meeting
ON embeddings(meeting_id);

-- Full-text search

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
