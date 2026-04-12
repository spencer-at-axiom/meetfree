PRAGMA foreign_keys = OFF;

ALTER TABLE embeddings RENAME TO embeddings_old;

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

INSERT INTO embeddings (id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at)
SELECT id, source_type, source_id, meeting_id, embedding, model_name, dimensions, created_at
FROM embeddings_old;

DROP TABLE embeddings_old;

CREATE INDEX IF NOT EXISTS idx_embeddings_source
ON embeddings(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_meeting
ON embeddings(meeting_id);

PRAGMA foreign_keys = ON;
