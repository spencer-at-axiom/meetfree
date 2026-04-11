# MeetFree v0.4.0 Technical Design

Last updated: April 11, 2026
Status: Implemented with final release-scope adjustments
Phase assumption: pre-user development phase, no production users, local databases may be reset as needed
Companion documents:

- `docs/PRODUCT_VISION_TO_V1.md`
- `docs/V040_ROADMAP.md`

## 1. Goal

Define an implementation-ready technical design for `v0.4.0` covering:

- schema proposal
- repository interfaces
- development-phase migration strategy
- acceptance-test matrix

This design is intentionally optimized for the current reality:

- MeetFree is still in development
- there are no production users to migrate
- schema correctness and implementation simplicity are more important than preserving historical local dev databases

Implication:

- `v0.4.0` should prioritize a clean canonical schema
- resetting local developer databases is acceptable when the schema changes materially
- the baseline schema file is the primary schema artifact for this release

## 2. Design Objectives

`v0.4.0` should establish the durable entities required by later live-copilot work.

The design must satisfy four requirements:

1. Speaker identity becomes a first-class layer above diarization output.
2. Action items and decisions become first-class entities rather than only summary sections.
3. User-reviewed state survives diarization reruns and summary regeneration inside the new model.
4. Export and later retrieval layers consume structured entities without depending on summary parsing alone.

## 3. Current-State Gaps

### 3.1 Speaker Identity Gap

Today:

- `speaker_turns` stores meeting-local diarization rows
- `speaker_name` is optional text on each turn
- rerunning diarization deletes and recreates all speaker turns

Implication:

- there is no durable meeting-speaker layer
- there is no cross-meeting identity layer
- reviewed speaker state is not structurally protected

### 3.2 Structured Artifact Gap

Today:

- action items and decisions are primarily recap content
- export reconstructs task and decision sections by parsing summary markdown

Implication:

- there is no canonical task or decision entity
- later live-copilot retrieval would depend on summary layout

### 3.3 Provenance Gap

Today:

- transcript segments contain timing data
- speaker turns contain timing data
- structured post-meeting records do not exist as source-linked entities

Implication:

- later grounded retrieval and evidence rendering would require ad hoc inference

## 4. Design Decisions

### DD-1 Introduce a Meeting-Speaker Layer

Add a new `meeting_speakers` table between `speaker_turns` and reusable identities.

Reason:

- `speaker_turns` is generated diarization output
- `meeting_speakers` will hold reviewed meeting-local speaker state
- reusable identities belong above the meeting-local layer

### DD-2 Keep `speaker_turns` as Generated Rows

`speaker_turns` remains the row-level diarization output table. It should gain a foreign key to `meeting_speakers`.

Reason:

- export and transcript mapping already depend on row-level speaker turns
- generated rows can be replaced without losing reviewed state if the meeting-speaker layer persists

### DD-3 Persist Structured Artifacts in Dedicated Tables

Introduce dedicated `action_items` and `decisions` tables rather than encoding these only in summary JSON or markdown.

Reason:

- structured tables allow reliable export, filtering, and retrieval
- summary payloads remain recap renderings rather than canonical task storage

### DD-4 Preserve Summary as a Rendering Layer

Do not require structured artifact persistence to succeed before recap can be saved.

Reason:

- recap generation remains user-visible value on its own
- structured extraction can fail independently without blocking the whole meeting artifact flow

### DD-5 Keep Provenance Inline in v0.4.0

Store transcript evidence directly on `action_items` and `decisions` rather than introducing a generic evidence graph in this release.

Reason:

- simpler implementation
- enough for review UI, export, and later live-copilot groundwork

## 5. Proposed Schema

The schema below should be implemented directly in the baseline schema file because the project is still pre-user.

Target file:

- `desktop/src-tauri/migrations/20260411000000_v040_baseline_schema.sql`

## 5.1 New Tables

### `speaker_identities`

Purpose:

- reusable cross-meeting person records

```sql
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
```

### `voice_profiles`

Purpose:

- acoustic or matching-profile storage for reusable identities

```sql
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
```

### `meeting_speakers`

Purpose:

- stable meeting-local speaker records that preserve reviewed state across diarization reruns

```sql
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
```

### `action_items`

Purpose:

- canonical structured tasks extracted from meetings

```sql
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
```

### `decisions`

Purpose:

- canonical structured decisions extracted from meetings

```sql
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
    FOREIGN KEY (source_transcript_id) REFERENCES transcripts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_meeting
ON decisions(meeting_id);

CREATE INDEX IF NOT EXISTS idx_decisions_review_status
ON decisions(review_status);
```

## 5.2 Changes to Existing Tables

### `speaker_turns`

Add:

- `meeting_speaker_id TEXT`

Desired end-state definition:

```sql
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
```

Implementation notes:

- `speaker_name` remains in `v0.4.0` as a denormalized compatibility field
- code should treat `meeting_speaker_id` plus `meeting_speakers` as canonical

### `summary_processes`

No schema change required in `v0.4.0`.

Implementation rule:

- recap generation remains independent of structured artifact persistence

## 6. Repository Interfaces

The current repository layer uses thin stateless repository structs with `SqlitePool` arguments and transaction-oriented methods. `v0.4.0` should follow the same pattern.

## 6.1 New Repository Modules

Add to `desktop/src-tauri/src/database/repositories/mod.rs`:

```rust
pub mod action_item;
pub mod decision;
pub mod speaker_identity;
```

## 6.2 Proposed Models

The following model types should be added to `database/models.rs` or split into module-local DTOs:

```rust
pub struct SpeakerIdentityModel {
    pub id: String,
    pub display_name: String,
    pub normalized_name: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

pub struct VoiceProfileModel {
    pub id: String,
    pub speaker_identity_id: String,
    pub profile_kind: String,
    pub provider: Option<String>,
    pub model_version: Option<String>,
    pub sample_count: i64,
    pub profile_payload: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_trained_at: Option<String>,
}

pub struct MeetingSpeakerModel {
    pub id: String,
    pub meeting_id: String,
    pub diarization_speaker_number: Option<i64>,
    pub display_name_override: Option<String>,
    pub speaker_identity_id: Option<String>,
    pub review_status: String,
    pub match_confidence: Option<f64>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_reviewed_at: Option<String>,
    pub last_generated_at: Option<String>,
}

pub struct ActionItemModel {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub details: Option<String>,
    pub owner_speaker_identity_id: Option<String>,
    pub owner_display_name: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct DecisionModel {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub details: Option<String>,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
    pub created_at: String,
    pub updated_at: String,
}
```

## 6.3 `SpeakerIdentitiesRepository`

```rust
pub struct SpeakerIdentitiesRepository;

impl SpeakerIdentitiesRepository {
    pub async fn create_identity(
        pool: &SqlitePool,
        display_name: &str,
        notes: Option<&str>,
    ) -> Result<SpeakerIdentityModel, sqlx::Error>;

    pub async fn get_identity(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<Option<SpeakerIdentityModel>, sqlx::Error>;

    pub async fn list_identities(
        pool: &SqlitePool,
    ) -> Result<Vec<SpeakerIdentityModel>, sqlx::Error>;

    pub async fn update_identity_name(
        pool: &SqlitePool,
        identity_id: &str,
        display_name: &str,
    ) -> Result<bool, sqlx::Error>;

    pub async fn merge_identities(
        pool: &SqlitePool,
        source_identity_id: &str,
        target_identity_id: &str,
    ) -> Result<(), sqlx::Error>;

    pub async fn archive_identity(
        pool: &SqlitePool,
        identity_id: &str,
    ) -> Result<bool, sqlx::Error>;

    pub async fn add_voice_profile(
        pool: &SqlitePool,
        new_profile: NewVoiceProfile,
    ) -> Result<VoiceProfileModel, sqlx::Error>;
}
```

## 6.4 `MeetingSpeakersRepository`

```rust
impl SpeakerIdentitiesRepository {
    pub async fn create_meeting_speaker(
        pool: &SqlitePool,
        new_speaker: NewMeetingSpeaker,
    ) -> Result<MeetingSpeakerModel, sqlx::Error>;

    pub async fn list_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<MeetingSpeakerModel>, sqlx::Error>;

    pub async fn link_meeting_speaker_to_identity(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
        speaker_identity_id: &str,
        match_confidence: Option<f64>,
        review_status: &str,
    ) -> Result<bool, sqlx::Error>;

    pub async fn rename_meeting_speaker_local(
        pool: &SqlitePool,
        meeting_speaker_id: &str,
        display_name_override: Option<&str>,
    ) -> Result<bool, sqlx::Error>;

    pub async fn retire_unmatched_meeting_speakers(
        pool: &SqlitePool,
        meeting_id: &str,
        active_ids: &[String],
    ) -> Result<(), sqlx::Error>;
}
```

## 6.5 `ActionItemsRepository`

```rust
pub struct ActionItemsRepository;

impl ActionItemsRepository {
    pub async fn replace_meeting_action_items(
        pool: &SqlitePool,
        meeting_id: &str,
        items: &[NewActionItem],
    ) -> Result<(), sqlx::Error>;

    pub async fn list_meeting_action_items(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<ActionItemModel>, sqlx::Error>;

    pub async fn update_action_item_review(
        pool: &SqlitePool,
        action_item_id: &str,
        review: UpdateActionItemReview,
    ) -> Result<bool, sqlx::Error>;

    pub async fn update_action_item_status(
        pool: &SqlitePool,
        action_item_id: &str,
        status: &str,
    ) -> Result<bool, sqlx::Error>;
}
```

Implementation rule for `v0.4.0`:

- `replace_meeting_action_items` may use a simple policy in development:
  - delete existing rows for the meeting
  - insert the new generated set

If preserving edited rows is implemented in the same release, that is a bonus, not a release prerequisite in the current phase.

## 6.6 `DecisionsRepository`

```rust
pub struct DecisionsRepository;

impl DecisionsRepository {
    pub async fn replace_meeting_decisions(
        pool: &SqlitePool,
        meeting_id: &str,
        decisions: &[NewDecision],
    ) -> Result<(), sqlx::Error>;

    pub async fn list_meeting_decisions(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<DecisionModel>, sqlx::Error>;

    pub async fn update_decision_review(
        pool: &SqlitePool,
        decision_id: &str,
        review: UpdateDecisionReview,
    ) -> Result<bool, sqlx::Error>;
}
```

## 6.7 Service-Layer Changes

Add application services for:

- diarization rerun reconciliation
- structured extraction orchestration
- export context assembly

Suggested services:

```rust
pub struct MeetingSpeakerReconciliationService;
pub struct StructuredArtifactsService;
pub struct MeetingArtifactsQueryService;
```

Responsibilities:

- `MeetingSpeakerReconciliationService`
  - map fresh diarization clusters to `meeting_speakers`
  - preserve reviewed meeting-local state during reruns
  - attach generated `speaker_turns` rows to `meeting_speakers`

- `StructuredArtifactsService`
  - convert extraction output into `action_items` and `decisions`
  - persist summary payload plus structured records transactionally

- `MeetingArtifactsQueryService`
  - assemble combined meeting artifacts for UI and export
  - avoid repeated ad hoc SQL joins in command handlers

## 7. Development-Phase Migration Strategy

Because there are no production users yet, `v0.4.0` should use the simplest workable strategy:

1. update the baseline schema file directly
2. reset local development databases when needed
3. keep any transitional migration code minimal and only if it materially helps development testing

### Recommended Approach

Primary source of truth:

- `desktop/src-tauri/migrations/20260411000000_v040_baseline_schema.sql`

Recommended workflow:

- edit the baseline schema directly to the desired `v0.4.0` end state
- if the schema changes in incompatible ways during development, delete the local SQLite file and rerun the app
- use small one-off data seed helpers or test fixtures rather than complex migration-backfill logic

### Optional Transitional Migration

If the team wants to preserve some local dev data during implementation, an incremental migration may still be added.

However:

- it is not release-critical in the current phase
- it should not drive the schema design
- it should remain minimal

### Explicit Non-Goals for This Phase

Do not optimize `v0.4.0` for:

- safe upgrade of unknown external databases
- lossless migration of every local development artifact
- complicated backfill from legacy summary markdown

## 8. Development Data Rules

The following rules keep implementation simple:

### DR-1 No Automatic Global Identity Backfill

Do not auto-create `speaker_identities` from old `speaker_name` values.

Reason:

- there are no users to preserve
- incorrect merge behavior is worse than simply reseeding test data

### DR-2 Prefer Clean Test Fixtures

Repository and migration tests should create explicit fixture rows for:

- meetings
- transcripts
- speaker turns
- summary payloads

Reason:

- easier to reason about than legacy backfill logic

### DR-3 Treat Existing Summary Parsing as Fallback Only

Export may continue to parse recap sections for older dev meetings, but the new implementation should target structured tables as canonical.

## 9. Acceptance-Test Matrix

The matrix below is the minimum acceptance surface for `v0.4.0` in the current development phase.

| ID | Area | Test Type | Scenario | Acceptance Criteria |
| --- | --- | --- | --- | --- |
| DB-1 | Baseline schema | Rust integration | Fresh in-memory database applies baseline schema cleanly | New tables and indexes exist |
| DB-2 | Baseline schema | Rust integration | `speaker_turns` contains `meeting_speaker_id` foreign key column | Table shape matches design |
| DB-3 | Repositories | Rust integration | Create speaker identity and list identities | Rows persist and reload correctly |
| DB-4 | Repositories | Rust integration | Create meeting speaker and link to identity | Link persists with review metadata |
| DB-5 | Repositories | Rust integration | Replace meeting action items | New rows persist deterministically |
| DB-6 | Repositories | Rust integration | Replace meeting decisions | New rows persist deterministically |
| DIA-1 | Rerun safety | Rust integration | Reconciliation after diarization rerun | Reviewed meeting-speaker state survives and generated turns reattach correctly |
| DIA-2 | Rerun safety | Rust integration | Meeting-local rename survives rerun | `display_name_override` remains authoritative |
| SUM-1 | Structured artifacts | Rust integration | Summary plus structured extraction save together | Summary payload and structured rows both persist |
| SUM-2 | Structured artifacts | Rust integration | Structured extraction fails but summary succeeds | Summary still persists and no partial corrupt rows remain |
| EXP-1 | Export | Rust integration | Markdown export prefers structured tasks and decisions | Export uses structured rows when present |
| EXP-2 | Export | Rust integration | Legacy-style meeting with no structured rows | Export still renders via fallback behavior |
| EXP-3 | Export | Rust integration | Named speakers render from meeting-speaker layer | Export uses local override or linked identity label consistently |
| UI-1 | Review UX | Frontend integration | User edits extracted task | Review state persists on reload |
| UI-2 | Review UX | Frontend integration | User renames meeting speaker locally | Name appears in meeting details and export preview |
| UI-3 | Review UX | Frontend integration | User promotes meeting speaker to reusable identity | Linked state persists on reload |
| QA-1 | Regression | Existing smoke plus added tests | Current recording and finalization flows still pass | Existing release smoke gate remains green |
| QA-2 | Regression | Existing smoke plus added tests | Export formats still render old and new meetings | Markdown, PDF, and DOCX remain usable |

## 10. Implementation Order

Recommended order:

1. update baseline schema
2. update Rust models
3. add repository modules
4. add speaker reconciliation service
5. add structured artifact persistence
6. update export assembly
7. add meeting-details review UI
8. update tests and smoke coverage

## 11. Deferred Work

The following are intentionally deferred beyond `v0.4.0`:

- semantic retrieval over speaker voice profiles
- context attachments
- generic evidence graph table
- cross-meeting assistant queries
- in-meeting copilot UI

## 12. Concrete Deliverables

At minimum, `v0.4.0` should land:

- updated baseline schema implementing the entities above
- updated Rust model definitions
- new repository modules for identities, tasks, and decisions
- service logic for diarization reconciliation and structured artifact persistence
- export changes that prefer structured entities
- acceptance tests covering schema shape, repository behavior, rerun safety, and export fallback

Implemented release-scope note:

- `v0.4.0` now includes manual voice-profile CRUD from the speaker identity inspector.
- Automatic acoustic training and automatic cross-meeting voice matching remain deferred.
- Structured extraction is still rule-based, but heuristic additions are now gated by transcript evidence before persistence.
