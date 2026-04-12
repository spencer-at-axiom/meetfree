# MeetFree v0.5.0 Implementation Plan and Forward Roadmap

Last updated: April 11, 2026
Status: Draft
Baseline: v0.4.0 complete
Parent document: `docs/PRODUCT_VISION_TO_V1.md`

## 1. Release Objective

`v0.5.0` establishes the context ingestion layer, provider capability infrastructure, and embedding foundation required for later meeting memory (v0.6) and live copilot (v0.7+) work. It also addresses technical debt identified during the v0.4.0 architecture review.

This release has three pillars:

1. **Context layer**: scratchpad, attachments, calendar enrichment, tags
2. **Intelligence infrastructure**: provider capability registry, structured extraction via provider-native features, embedding pipeline foundation
3. **Engineering hardening**: frontend state architecture refactoring, CI improvements, naming/readability pass

## 2. Sequencing Rationale

The product vision defines five capability layers:

- Layer A: Capture Reliability (v0.1–v0.3, complete)
- Layer B: Durable Structured Data (v0.4, complete)
- **Layer C: Context Ingestion (v0.5, this release)**
- Layer D: Meeting Memory and Retrieval (v0.6)
- Layer E: Live Copilot (v0.7–v1.0)

v0.5 is the last foundation release before user-facing intelligence features dominate the roadmap. Infrastructure decisions made here directly constrain how good the copilot can be.

---

## 3. v0.5.0 Phased Implementation Plan

### Phase 1. CI and Engineering Hardening

**Rationale:** Fix the gaps that create regression risk before adding new surface area.

#### 1.1 Add Rust Tests to Merge Gate

- [ ] Update `.github/workflows/quality.yml` to run `cargo test -p meetfree --lib --locked` in the `rust` job (not just `cargo check`)
- [ ] Add `cargo fmt -- --check` step to the `rust` job (toolchain already installs `rustfmt`)
- [ ] Add `cargo clippy -p meetfree -- -D warnings` step to the `rust` job (toolchain already installs `clippy`)
- [ ] Verify merge gate catches a deliberately broken test before merging the change

Exit condition: The merge gate rejects PRs that break Rust unit tests, formatting, or lints.

#### 1.2 Remove Dead Dependencies

- [ ] Audit `desktop/src-tauri/Cargo.toml` for unused `criterion` dev-dependency (no `[[bench]]` entries exist)
- [ ] Audit `desktop/package.json` for duplicate `radix-ui` vs `@radix-ui/*` scoped packages
- [ ] Remove or justify each finding
- [ ] Verify `eslint-config-next` version alignment with Next.js 16

#### 1.3 Documentation Alignment

- [ ] Update `lib.rs` header version from `0.3.0` to `0.5.0`
- [ ] Align `AGENTS.md` reference to `useRecordingSessionController` with actual implementation (`useRec` + `RecCtx` + split hooks)
- [ ] Update `DATA_MODEL.md` to include v0.4.0 tables (speaker_identities, voice_profiles, meeting_speakers, action_items, decisions) and v0.5.0 tables once added

---

### Phase 2. Frontend Architecture Refactoring

**Rationale:** The current context architecture will not scale to the copilot layer. Split now while the surface area is manageable.

#### 2.1 Decompose ConfigContext (573 lines → 4 focused modules)

Current `ConfigContext.tsx` mixes: summary model config, transcription config, recording device preferences, language, Ollama model catalog, UI flags, notification settings, storage paths, and app preferences.

Proposed splits:

- [ ] **`SummaryModelContext`** — `modelConfig`, `setModelConfig`, Ollama model list, `model-config-updated` listener
- [ ] **`TranscriptionConfigContext`** — `transcriptModelConfig`, `setTranscriptModelConfig`, `setTranscriptModelConfigPersisted`
- [ ] **`RecordingDevicesContext`** — `selectedDevices`, `setSelectedDevices`, `setSelectedDevicesPersisted`, language selection
- [ ] **`AppPreferencesContext`** — UI flags (`showConfidenceIndicator`, `isAutoSummary`), notification settings, storage locations, app preferences, `loadPreferences`

Implementation rules:
- Each new context should be under 150 lines
- Move `contexts/config/storage.ts` helpers into the appropriate new context or keep as shared utility
- Preserve the existing `useConfig()` hook as a facade that composes the four sub-hooks (backward compatibility during migration)
- Add a deprecation comment on the facade hook

Validation:
- [ ] Existing `configService` tests still pass
- [ ] Settings page renders correctly with split contexts
- [ ] Recording page model selection still works
- [ ] No `useConfig()` call-site changes are required in this phase (facade covers it)

#### 2.2 Decompose TranscriptContext (601 lines → 3 focused modules)

Current `TranscriptContext.tsx` mixes: live transcript pipeline (buffering, ordering, dedup, flush), IndexedDB recovery, scroll behavior, and session metadata.

Proposed splits:

- [ ] **`useTranscriptBuffer` hook** — Map buffer, sequence ordering, dedup, timer-based flush, stale discard (pure logic, no React context)
- [ ] **`useTranscriptRecovery` hook** — IndexedDB init, `recording-started`/`recording-stopped` listeners, session storage, reload sync
- [ ] **`TranscriptContext`** (slim) — transcript list state, `addTranscript`, `clearTranscripts`, `meetingTitle`, auto-scroll ref; consumes the two hooks above

Implementation rules:
- `useTranscriptBuffer` should be independently testable without React context
- Auto-scroll should become a standalone `useAutoScroll(containerRef, dependencyArray)` hook

Validation:
- [ ] Live recording transcript display still works
- [ ] Reload recovery still works
- [ ] Add unit tests for `useTranscriptBuffer` (ordering, dedup, stale discard)

#### 2.3 Extract Summary Polling from MeetingsContext

- [ ] Move `startSummaryPolling` / `stopSummaryPolling` / `activeSummaryPolls` out of `MeetingsContext` into a dedicated `useSummaryJobManager` hook
- [ ] Wire `useSum` to consume the new hook directly instead of going through `MeetingsContext`
- [ ] `MeetingsContext` (267 lines) should drop to ~180 lines: meeting list, current meeting, search, refetch

Validation:
- [ ] Summary generation and polling still work from meeting details
- [ ] Meeting list search is unaffected

#### 2.4 Naming Readability Pass

- [ ] Rename abbreviated hook/module names in `hooks/rec/` to human-readable names:
  - `useBeg` → `useRecordingStart`
  - `useFin` → `useRecordingFinalize`
  - `useEvt` → `useRecordingEvents`
  - `recMsg` → `recordingMessages`
  - `recAna` → `recordingAnalytics`
  - `recUts` → `recordingUtils`
  - `useRcx` → `useRecordingContext`
- [ ] Rename abbreviated hook/module names in `hooks/meeting-details/`:
  - `useSum` → `useSummaryGeneration`
  - `sumMsg` → `summaryMessages`
  - `sumSvc` → `summaryService` (or `summaryCommands` to avoid collision with `services/summaryStreamingService.ts`)
  - `sumPol` → `summaryPolling`
- [ ] Rename abbreviated types in components:
  - `SumSt` → `SummaryState`
  - `SumTab` → `SummaryTab` (already the file name)
  - `TabPrp` → `TabProps`
  - `rdySt` → `readyState`
- [ ] Remove `any` types in `SummaryTab.tsx` (`sumRef`, `rows`, `tpls`) and replace with proper types

Implementation rules:
- Use IDE rename/refactor to catch all references
- Update test file imports to match
- Do NOT change Tauri command names or backend identifiers in this pass

Validation:
- [ ] All frontend tests pass after rename
- [ ] Lint passes
- [ ] Manual smoke of recording and summary flows

---

### Phase 3. Provider Capability Registry

**Rationale:** The LLM abstraction must evolve from "same prompt, different HTTP endpoint" to "same intent, capability-adapted execution" before the copilot layer.

#### 3.1 Define Provider Capability Model

Add new file: `desktop/src-tauri/src/summary/provider_capabilities.rs`

- [ ] Define `ProviderCapabilities` struct:
  ```
  - supports_tool_use: bool
  - supports_json_mode: bool
  - supports_streaming: bool
  - max_context_tokens: Option<usize>
  - supports_system_prompt: bool
  - supports_embeddings: bool
  ```
- [ ] Define `fn capabilities_for_provider(provider: &LLMProvider, model_name: &str) -> ProviderCapabilities`
  - Use known defaults per provider (e.g., OpenAI gpt-4o supports tool use; Ollama depends on model)
  - For Ollama: query `ModelMetadataCache` (already exists) for context size; default `supports_tool_use: false` with opt-in override
  - For Custom OpenAI: user-configurable capabilities stored in `customOpenAIConfig` JSON
- [ ] Expose capability queries as Tauri commands for frontend use (model selection UI can show capability badges)

Exit condition: The system knows what each configured provider can do without hardcoding assumptions at every call site.

#### 3.2 Capability-Aware Structured Extraction

Replace the markdown-parse-and-regex extraction pipeline with a capability-branching approach.

- [ ] **Path A (tool-use capable providers):** Add a dedicated extraction pass after summary generation that uses the provider's tool-use or JSON mode to return structured action items and decisions directly
  - Define tool schemas for `extract_action_items` and `extract_decisions` compatible with OpenAI function calling format (also works for Claude, Groq)
  - Response is structured JSON — no markdown parsing needed
  - Add to `llm_client.rs`: `pub async fn generate_structured_extraction(client: &Client, request: StructuredExtractionRequest) -> Result<StructuredExtractionResult, String>`
- [ ] **Path B (JSON-mode capable providers without tool use):** Use constrained JSON output with a schema prompt
  - Same structured result, different request shape
- [ ] **Path C (no structured output support):** Keep existing `structured_artifacts.rs` markdown parsing + `extraction_heuristics.rs` as fallback
  - This remains the Ollama path for most local models
- [ ] **Orchestration:** `structured_artifacts.rs` gains a new entry point: `extract_structured_artifacts_adaptive(capabilities, ...)` that branches on provider capabilities

Implementation rules:
- The tool-use schemas should be defined once in Rust and shared across providers
- Extraction is always a separate pass from summary generation (DD-4 from v0.4.0 design: summary persists independently)
- The extraction pass is optional — if it fails, the meeting still has its summary

Validation:
- [ ] Tool-use extraction produces equivalent or better results than markdown parsing on test cases
- [ ] Fallback path still works for Ollama models
- [ ] Extraction failure does not block summary save
- [ ] Add unit tests for each extraction path

#### 3.3 Update LLM Client for Structured Requests

Extend `llm_client.rs` to support:

- [ ] Tool-use / function-calling requests (OpenAI format, adaptable to Claude Messages format)
- [ ] JSON mode requests (OpenAI `response_format: { type: "json_object" }`)
- [ ] Make Claude `max_tokens` configurable via `LLMTransportConfig` instead of hardcoded `2048`
- [ ] Add `temperature` / `top_p` / `max_tokens` passthrough for all providers (not just Custom OpenAI)

Implementation rules:
- Do not break the existing `generate_summary` signature; add new functions alongside it
- Share HTTP client and auth logic
- Maintain the `CancellationToken` pattern

---

### Phase 4. Context Layer — Schema and Backend

**Rationale:** This is the core v0.5 product feature — the meeting-scoped context sources that will ground the live copilot.

#### 4.1 Schema Design

Add new migration: `desktop/src-tauri/migrations/20260413000000_v050_context_layer.sql`

- [ ] **`meeting_context_assets`** table:
  ```sql
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
      metadata TEXT, -- JSON for type-specific metadata
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_context_assets_meeting
  ON meeting_context_assets(meeting_id);
  CREATE INDEX IF NOT EXISTS idx_context_assets_type
  ON meeting_context_assets(meeting_id, asset_type);
  ```

- [ ] **`tags`** table:
  ```sql
  CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      color TEXT,
      created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_normalized_name
  ON tags(normalized_name);
  ```

- [ ] **`meeting_tags`** junction table:
  ```sql
  CREATE TABLE IF NOT EXISTS meeting_tags (
      meeting_id TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (meeting_id, tag_id),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  ```

#### 4.2 Rust Models and Repositories

- [ ] Add models to `database/models.rs`:
  - `MeetingContextAssetModel`
  - `TagModel`
  - `MeetingTagModel`

- [ ] Add repository: `database/repositories/context_asset.rs`
  - `create_asset(pool, meeting_id, new_asset) -> Result<MeetingContextAssetModel>`
  - `list_assets(pool, meeting_id) -> Result<Vec<MeetingContextAssetModel>>`
  - `get_asset(pool, asset_id) -> Result<Option<MeetingContextAssetModel>>`
  - `update_asset(pool, asset_id, updates) -> Result<bool>`
  - `delete_asset(pool, asset_id) -> Result<bool>`
  - `get_scratchpad(pool, meeting_id) -> Result<Option<MeetingContextAssetModel>>` (convenience: returns the single scratchpad asset)
  - `upsert_scratchpad(pool, meeting_id, content) -> Result<MeetingContextAssetModel>` (create-or-update)

- [ ] Add repository: `database/repositories/tag.rs`
  - `create_tag(pool, name, color) -> Result<TagModel>`
  - `list_tags(pool) -> Result<Vec<TagModel>>`
  - `delete_tag(pool, tag_id) -> Result<bool>`
  - `tag_meeting(pool, meeting_id, tag_id) -> Result<()>`
  - `untag_meeting(pool, meeting_id, tag_id) -> Result<()>`
  - `list_meeting_tags(pool, meeting_id) -> Result<Vec<TagModel>>`
  - `list_meetings_for_tag(pool, tag_id) -> Result<Vec<String>>` (meeting IDs)

- [ ] Register in `database/repositories/mod.rs`

Validation:
- [ ] Repository integration tests for all CRUD operations
- [ ] Scratchpad upsert behavior tested (create on first call, update on subsequent)
- [ ] Cascade delete tested (delete meeting → assets and tags removed)

#### 4.3 Tauri Commands

- [ ] Add context asset commands:
  - `context_asset_create`
  - `context_asset_list`
  - `context_asset_update`
  - `context_asset_delete`
  - `scratchpad_get`
  - `scratchpad_upsert`

- [ ] Add tag commands:
  - `tag_create`
  - `tag_list`
  - `tag_delete`
  - `meeting_tag_add`
  - `meeting_tag_remove`
  - `meeting_tags_list`

- [ ] Register all in `command_registry.rs`
- [ ] Update `scripts/check-tauri-command-contract.js` if new patterns require it

#### 4.4 Context Assembly Service

Add new module: `desktop/src-tauri/src/context/mod.rs`

- [ ] Define `MeetingContextPackage` struct:
  ```
  - meeting_metadata: MeetingModel
  - transcript_segments: Vec<TranscriptModel>
  - speaker_turns: Vec<SpeakerTurnModel>
  - identified_speakers: Vec<MeetingSpeakerModel>
  - action_items: Vec<ActionItemModel>
  - decisions: Vec<DecisionModel>
  - scratchpad: Option<String>
  - attachments: Vec<MeetingContextAssetModel>
  - tags: Vec<TagModel>
  - vocabulary_rules: Vec<VocabularyEntryModel>
  ```

- [ ] Implement `assemble_meeting_context(pool, meeting_id) -> Result<MeetingContextPackage>`
  - Single service call that loads everything needed for summary generation, export, and (later) copilot
  - Replaces the ad-hoc assembly in `export/common.rs` (`collect_export_context`) — refactor exports to use this

- [ ] Update summary generation to consume `MeetingContextPackage`:
  - Scratchpad content is included in summary prompts when present
  - Attachment titles/metadata are included as context (not full file content in v0.5)
  - Tags are included in summary prompt as meeting metadata

Validation:
- [ ] Context assembly loads all entity types correctly
- [ ] Summary generation with scratchpad content produces meaningfully different output
- [ ] Export still works via the new assembly path
- [ ] Empty context (no scratchpad, no attachments) degrades gracefully to current behavior

---

### Phase 5. Context Layer — Frontend

#### 5.1 Scratchpad UI

- [ ] Add scratchpad panel to meeting details page as a new tab or sidebar section
  - Rich text editor (reuse BlockNote, already in the stack)
  - Auto-save with debounce via `scratchpad_upsert`
  - Load on meeting detail mount via `scratchpad_get`
- [ ] Add scratchpad indicator in meeting list (icon/badge when scratchpad has content)
- [ ] Add scratchpad content inclusion toggle in summary generation UI ("Include notes in summary")

#### 5.2 Attachment Management UI

- [ ] Add attachment section to meeting details page
  - File drop zone or file picker
  - Display attachment list with type icon, name, size
  - Delete attachment
  - Store files in meeting folder (alongside audio); store metadata via `context_asset_create`
- [ ] Support text-based attachments (`.txt`, `.md`, `.csv`) for content extraction in v0.5; binary files stored as references only

#### 5.3 Tag System UI

- [ ] Add tag management to meeting details page header
  - Tag chips with add/remove
  - Create new tag inline with optional color
  - Autocomplete from existing tags
- [ ] Add tag filter to meetings list page
  - Filter by one or more tags
  - Tags visible in meeting list rows
- [ ] Add tag management section to settings page (rename, delete, color)

#### 5.4 Calendar Enrichment (Optional — Cut-Line Candidate)

- [ ] Read local calendar entries (ICS format or OS calendar API) for meeting time range
  - Display calendar event title, attendees, description as read-only meeting context
  - Store as `calendar_event` type context asset
  - On macOS: EventKit entitlement (already has entitlements file)
  - On Windows/Linux: ICS file import only (no native API)
- [ ] Calendar metadata included in summary prompt when present

Note: Calendar integration adds platform-specific complexity. If schedule pressure appears, defer to v0.5.1 or v0.6 and keep the schema in place.

#### 5.5 Frontend Services and State

- [ ] Add `contextService.ts` — Tauri invoke wrappers for all context and tag commands
- [ ] Add `useContextAssets(meetingId)` hook — load, create, update, delete assets
- [ ] Add `useScratchpad(meetingId)` hook — get/upsert with debounced auto-save
- [ ] Add `useTags()` hook — global tag list, create, delete
- [ ] Add `useMeetingTags(meetingId)` hook — tag/untag for specific meeting

---

### Phase 6. Embedding Pipeline Foundation

**Rationale:** v0.6 (Meeting Memory) and v0.7 (Live Copilot) both require semantic retrieval. Starting the embedding infrastructure now avoids compressing the most complex part of the roadmap.

#### 6.1 Embedding Provider Trait

Add new module: `desktop/src-tauri/src/embeddings/mod.rs`

- [ ] Define `EmbeddingProvider` trait:
  ```rust
  #[async_trait]
  pub trait EmbeddingProvider: Send + Sync {
      async fn embed_text(&self, text: &str) -> Result<Vec<f32>, String>;
      async fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, String>;
      fn dimensions(&self) -> usize;
      fn model_name(&self) -> &str;
  }
  ```

- [ ] Implement `OllamaEmbeddingProvider` — uses Ollama's `/api/embeddings` endpoint with configurable model
- [ ] Implement `OnnxEmbeddingProvider` — local ONNX model (similar pattern to Parakeet; can use a small model like `all-MiniLM-L6-v2`)
- [ ] Implement `OpenAIEmbeddingProvider` — uses OpenAI's `/v1/embeddings` endpoint (works for OpenAI, OpenRouter, and custom endpoints)
- [ ] Provider selection follows the same pattern as summary providers: user configures in settings, with local ONNX as default

#### 6.2 Embedding Storage

- [ ] Add migration for embedding storage:
  ```sql
  CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY NOT NULL,
      source_type TEXT NOT NULL CHECK (
          source_type IN ('transcript_segment', 'context_asset', 'meeting_summary')
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
  ```

- [ ] Add `EmbeddingsRepository`:
  - `store_embedding(pool, source_type, source_id, meeting_id, embedding, model_name, dimensions)`
  - `get_embeddings_for_meeting(pool, meeting_id) -> Vec<EmbeddingRow>`
  - `find_similar(pool, query_embedding, limit, meeting_id_filter) -> Vec<SimilarityResult>` — cosine similarity in Rust (SQLite doesn't have native vector ops; compute in application layer for v0.5)
  - `delete_embeddings_for_source(pool, source_type, source_id)`
  - `has_embeddings(pool, meeting_id) -> bool`

#### 6.3 Background Embedding Pipeline

- [ ] Add `EmbeddingPipelineService`:
  - Triggered after transcript save (post-recording finalization)
  - Triggered after summary save
  - Triggered after context asset save
  - Runs in background (`tokio::spawn`), does not block user-facing flows
  - Emits progress events: `embedding-progress`, `embedding-complete`, `embedding-error`
  - Respects cancellation (e.g., if meeting is deleted during embedding)

- [ ] Add Tauri commands:
  - `embedding_status(meeting_id)` — returns whether embeddings exist and are current
  - `embedding_reindex(meeting_id)` — re-embed all sources for a meeting
  - `embedding_search(query, meeting_id_filter, limit)` — semantic search (for v0.6, exposed early for testing)

- [ ] Settings integration:
  - Embedding provider selection in settings (default: local ONNX)
  - Optional: disable embeddings entirely for users who don't want the compute cost

Implementation rules:
- Embedding dimensions are stored per-row to support model migration
- If the user changes embedding model, existing embeddings should be marked stale (not deleted — re-index on demand)
- v0.5 stores embeddings and supports similarity queries but does NOT surface semantic search in the UI (that's v0.6)

Validation:
- [ ] Embeddings are generated after recording finalization
- [ ] Similarity search returns reasonable results for test queries
- [ ] Embedding pipeline failure does not affect recording or summary flows
- [ ] Add integration tests for embed + search round-trip

---

### Phase 7. Template and Summary Improvements

#### 7.1 Context-Aware Summary Prompts

- [ ] Update `processor.rs` to accept `MeetingContextPackage` instead of raw text
- [ ] Update template `to_section_instructions()` to include context source references
- [ ] When scratchpad is present: include as "User notes" section in the summary prompt
- [ ] When tags are present: include as meeting metadata in the prompt
- [ ] When calendar event is present: include event title, attendees, description

#### 7.2 Summary Generation Updated to Consume Context

- [ ] Update `SummaryJob` to carry optional context metadata
- [ ] Update `api_process_transcript` to load context via `assemble_meeting_context` before generating
- [ ] Ensure vocabulary rules are still applied from the context package

#### 7.3 Streaming Summary Frontend Wiring

The vision doc notes streaming summary frontend wiring is pending from earlier versions.

- [ ] Complete `summaryStreamingService.ts` integration in `useSummaryGeneration` (renamed from `useSum`)
- [ ] Add streaming indicator in SummaryTab (progressive text rendering during generation)
- [ ] Fallback to polling for providers that don't support streaming

---

### Phase 8. Export and Search Updates

#### 8.1 Export Context Integration

- [ ] Update `export/common.rs` `ExportContext` to include context assets and tags
- [ ] Update markdown export to include scratchpad section when present
- [ ] Update PDF/DOCX export to include scratchpad section when present
- [ ] Add tags to export metadata/frontmatter

#### 8.2 Search Updates

- [ ] Add tag-based filtering to `transcript_search_with_filters`
- [ ] Add context asset text to FTS index (scratchpad content, text attachment content)
  - New FTS table or extend existing triggers — design decision needed
- [ ] Frontend search filters: add tag filter chips alongside existing date/source/summary filters

---

### Phase 9. Testing and Release Hardening

#### 9.1 Backend Test Coverage

- [ ] Add tests for `provider_capabilities.rs` — capability resolution for each provider
- [ ] Add tests for structured extraction via tool-use path (mock HTTP responses)
- [ ] Add tests for context assembly service
- [ ] Add tests for embedding pipeline (embed + search round-trip)
- [ ] Add tests for tag and context asset repositories

#### 9.2 Frontend Test Coverage

- [ ] Add tests for `useTranscriptBuffer` (extracted from TranscriptContext)
- [ ] Add tests for `useScratchpad` hook
- [ ] Add tests for `useContextAssets` hook
- [ ] Add tests for `useTags` / `useMeetingTags` hooks
- [ ] Add tests for context-aware summary generation flow

#### 9.3 QA Matrix Update

- [ ] Update `docs/QA_MATRIX.md` for context layer workflows
- [ ] Add manual smoke steps for: scratchpad editing, attachment management, tag filtering, context-aware summary generation
- [ ] Add regression steps for: existing recording flow, existing export flow, existing search flow

#### 9.4 Release Documentation

- [ ] Write `docs/RELEASE_NOTES_v0.5.0.md`
- [ ] Update `CHANGELOG.md` with v0.5.0 entries
- [ ] Update `AGENTS.md` implementation status
- [ ] Update `DATA_MODEL.md` with new tables
- [ ] Bump version in `package.json`, `Cargo.toml`, `tauri.conf.json`

---

## 4. v0.5.0 Scope Cut Lines

If schedule pressure appears, keep these items in v0.5.0:

**Must ship:**
- CI hardening (Phase 1.1)
- Frontend ConfigContext decomposition (Phase 2.1)
- Provider capability registry (Phase 3.1)
- Context layer schema and backend (Phase 4)
- Scratchpad UI (Phase 5.1)
- Tag system UI (Phase 5.3)
- Context assembly service (Phase 4.4)
- Context-aware summary generation (Phase 7.1, 7.2)

**Cut or defer first:**
- Calendar enrichment (Phase 5.4) → defer to v0.5.1 or v0.6
- Attachment UI for binary files (Phase 5.2, non-text files) → defer, keep text-only
- Embedding pipeline (Phase 6) → defer to v0.5.1 if needed, but strongly prefer shipping in v0.5
- Streaming summary frontend wiring (Phase 7.3) → defer to v0.6
- Frontend naming pass (Phase 2.4) → defer but don't let it compound further
- TranscriptContext decomposition (Phase 2.2) → defer to v0.5.1
- Search updates (Phase 8.2) → defer FTS extension to v0.6, ship tag filters only

---

## 5. Forward Roadmap: v0.6 through v1.0

### v0.6.0 — Meeting Memory and Retrieval

**Objective:** Support cross-meeting retrieval over structured and unstructured meeting artifacts.

#### Planned Deliverables

- [ ] **People view**: dedicated page showing all meetings, action items, and decisions per speaker identity
- [ ] **Global action item view**: cross-meeting list with status filters, owner filters, due date sorting
- [ ] **Global decision view**: cross-meeting list with filters
- [ ] **Semantic search**: UI surface for embedding-based search (infrastructure from v0.5)
  - Search bar supports natural language queries
  - Results ranked by semantic similarity with FTS/BM25 as fallback
  - Results show source meeting, timestamp, and relevant snippet
- [ ] **Advanced search filters**: tag, speaker, task state, decision, date range — composable
- [ ] **Retrieval interfaces** (backend): abstract services for transcript windows, speaker history, task/decision state, attachment chunks, prior meeting lookup
  - These interfaces are designed for copilot consumption in v0.7 but exposed for search UI first
- [ ] **Lightweight automation handoff**: optional webhook on meeting finalization
  - POST structured JSON (meeting metadata, action items, decisions, summary) to user-configured URL
  - No cloud dependency — user provides their own endpoint
  - Fire-and-forget with retry and error logging

#### Architecture Notes

- Retrieval services must not couple directly to SQLite tables — introduce repository-backed interfaces that the copilot can call without knowing storage details
- Embedding search should support both single-meeting and cross-meeting modes
- People view should link to meeting details with context preservation (back navigation)
- **Provider capability registry dependency**: Semantic search must use the v0.5 capability registry to determine which embedding provider is available and select the appropriate retrieval path. Search quality depends on which embedding model the user has configured — the UI should surface this clearly (e.g., "Semantic search powered by [model name]" or "Enable semantic search by configuring an embedding provider")

#### Cut Line

- Webhook/automation → defer to v0.6.1 if needed
- Semantic retrieval over attachments → defer if embedding quality for non-transcript content is poor

---

### v0.7.0 — Live Copilot Alpha

**Objective:** Ship the first in-meeting copilot workflow with transcript-first grounding.

#### Planned Deliverables

- [ ] **Copilot panel**: in-meeting sidebar or floating panel with chat interface
  - Rendered during active recording
  - Collapsible/dismissable — copilot must not interfere with recording UX
  - Conversation persisted per meeting session
- [ ] **Transcript-window retrieval**: query the last N seconds/segments of transcript
  - "What was just said?" / "Catch up on the last 2 minutes"
  - Uses embedding search over recent segments for relevance ranking
- [ ] **Meeting-so-far summary**: on-demand summary of current meeting progress
  - Uses the same summary pipeline but operating on partial transcript
  - Result is conversational (chat response), not stored as the meeting's summary
- [ ] **Free-form chat**: ask questions about the current meeting
  - Grounded in current transcript via retrieval
  - Provider-agnostic — uses the configured summary provider for chat
  - Streaming responses in the panel
- [ ] **Source attribution**: responses include references to transcript segments
  - Clickable references scroll to the transcript position
  - Attribution model works with any provider's output
- [ ] **Evaluation harness (v1)**: ship alongside the copilot, not after
  - Capture copilot queries, responses, and retrieved context in a debug log
  - Measure: response latency, retrieval hit rate, user feedback (thumbs up/down)
  - **Multi-provider evaluation**: capture provider identity with every logged interaction so quality and latency can be compared across providers; this is essential for a provider-agnostic product — users need to understand the tradeoff they're making
  - No automated quality scoring yet — capture data for v0.9

#### Architecture Notes

- Copilot chat is a separate conversation model from summary generation — different prompts, different context assembly
- The context assembly service from v0.5 is extended with a `window` parameter for partial-transcript assembly
- **Capability-adaptive prompt construction**: The copilot orchestration layer must consume the provider capability registry (built in v0.5 Phase 3) to adapt its behavior per-provider:
  - Context budget: truncate or chunk the transcript window based on `max_context_tokens` for the configured provider
  - Tool use: if available, use tool-calling for structured queries ("list action items assigned to X"); otherwise, prompt-based extraction with parsing
  - Streaming: all copilot responses should stream when the provider supports it; show a loading state when it doesn't
  - System prompt: most providers support it, but the orchestration must handle the edge case where they don't
- Latency targets must be defined before implementation begins:
  - Catch-up response: target < 5 seconds for local models, < 3 seconds for cloud
  - Free-form chat: target < 8 seconds for local, < 5 seconds for cloud
  - These are initial targets — refine based on v0.7 alpha testing
- **Provider latency variance UX**: When a local model is significantly slower than cloud alternatives, the product must handle this gracefully:
  - Show elapsed time during generation so the user has expectations
  - If a response exceeds the target latency, surface a non-intrusive hint that a cloud provider may be faster (not a hard push — respect user choice)
  - Never block the recording UX waiting for a copilot response — all copilot interactions are async relative to the recording state machine
  - Consider a "cancel and retry" affordance for slow responses
- Copilot panel UX decision: sidebar tab vs floating window
  - Sidebar is simpler (single Tauri window)
  - Floating panel is more aligned with market UX (Fireflies, Krisp) but requires Tauri multi-window
  - Recommend: start with sidebar tab in v0.7, evaluate floating panel for v0.8

#### Cut Line

- Speaker-aware queries → v0.8
- Cross-meeting retrieval in copilot → v0.8
- Proactive suggestions → v0.8+

---

### v0.8.0 — Live Copilot Beta

**Objective:** Expand the live layer to use the full grounding stack.

#### Planned Deliverables

- [ ] **Speaker-aware queries**: "What did Sarah say about the timeline?"
  - Requires meeting-speaker identity resolution from v0.4 + retrieval from v0.6
  - Speaker filter on transcript retrieval
- [ ] **Context-aware queries**: copilot responses grounded in scratchpad, attachments, calendar metadata
  - Context assembly includes all context assets for the current meeting
  - "Based on the agenda, what haven't we covered yet?"
- [ ] **Cross-meeting retrieval in copilot**: "What did we decide about pricing in last week's meeting?"
  - Opt-in per query or per session (privacy: user controls what history is searchable)
  - Retrieval bounded by time range or explicit meeting selection
- [ ] **In-meeting drafting**: generate response drafts, email summaries, or follow-up messages grounded in meeting content
- [ ] **Live extraction surfacing**: display action items and decisions as they're detected during the meeting (not just post-meeting)
  - Uses the structured extraction pipeline on partial transcript
  - Extraction results shown in copilot panel with "confirm" action
- [ ] **Evidence and citation model (v1)**: define the internal evidence format
  - Transcript span references (meeting_id, transcript_id, start_ms, end_ms)
  - Attachment references (asset_id, content_range)
  - Prior meeting references (meeting_id, entity_type, entity_id)
  - UI renders evidence inline in copilot responses
  - **Provider-agnostic design**: The evidence model must be constructed by the orchestration layer from retrieval results, not extracted from provider-specific response formats. Some providers may return structured citations natively; the system must produce equivalent citations regardless of provider by mapping retrieved context back to source entities

#### Architecture Notes

- Cross-meeting retrieval requires a clear privacy boundary — user must opt in per session or globally
- Evidence model should be a shared data structure consumed by both copilot UI and export
- Live extraction should reuse the same `StructuredArtifactsService` with a "provisional" flag — items are not persisted until meeting finalization unless user explicitly confirms

---

### v0.9.0 — Quality, Evaluation, and Launch Hardening

**Objective:** Prepare the product for v1.0 where live copilot is the main value proposition.

#### Planned Deliverables

- [ ] **Evaluation harness (v2)**: automated quality scoring
  - Catch-up quality: compare copilot summaries vs full-meeting summaries on held-out meetings
  - Task extraction quality: precision/recall vs human-annotated test set
  - Decision extraction quality: same
  - Speaker attribution correctness: verify queries about specific speakers return correct segments
  - Grounding fidelity: percentage of copilot claims traceable to a cited source
  - **Cross-provider comparison**: run the evaluation suite against every supported provider to produce a quality/latency/cost matrix; this is the data that lets users make informed provider choices and lets the team identify where the capability registry needs tuning
- [ ] **Latency regression tracking**: CI-runnable benchmarks for retrieval and copilot response times
  - Criterion benchmarks (the dev dependency already exists in Cargo.toml)
  - Track: embedding generation time, similarity search time, context assembly time, full copilot response time
- [ ] **Privacy and consent UX**: finalized flows for
  - What data leaves the device (per-provider transparency)
  - What data is included in copilot context (per-session control)
  - Cross-meeting retrieval opt-in UI
- [ ] **Provider fallback strategy**: graceful degradation when configured provider is unavailable
  - Copilot should work in "transcript-only local" mode if cloud provider is unreachable
  - Clear user messaging about degraded capability
- [ ] **Onboarding for live copilot**: updated first-run flow
  - Explain copilot capabilities and privacy model
  - Model selection guidance (local vs cloud tradeoffs)
  - Quick-start tutorial for in-meeting use
- [ ] **Proactive suggestions** (conditional): only if quality and interruptibility are acceptable
  - "It sounds like an action item was just discussed — confirm?"
  - Must be dismissable and non-intrusive
  - Gate behind quality metrics from evaluation harness

#### Architecture Notes

- Evaluation harness should run as a CLI tool or Rust binary, not embedded in the app
- Privacy UX must be auditable — consider a "data sent" log accessible to the user
- Proactive suggestions should be disabled by default and gated behind a quality threshold

---

### v1.0.0 — Live Meeting Copilot

**Objective:** Launch a technically coherent system where live assistance and post-meeting follow-through share the same data model and evidence graph.

#### Launch Criteria

- [ ] Live transcript is stable enough for continuous in-meeting use
- [ ] Live chat and catch-up are grounded and low-friction
- [ ] Speaker identity and structured artifacts are durable
- [ ] Attached context improves answers in measurable ways (evaluation harness confirms)
- [ ] Post-meeting recap, tasks, decisions, and exports remain strong even when live features are unused
- [ ] Privacy model is clear and auditable
- [ ] Provider-agnostic: product works well with any supported provider; no provider is required for core functionality
- [ ] Performance targets met across local and cloud providers
- [ ] Documentation, onboarding, and release infrastructure are production-quality

---

## 6. Open Engineering Questions for v0.5

These should be resolved during Phase 3–4 implementation:

1. **Embedding model default**: Which local ONNX embedding model to bundle? `all-MiniLM-L6-v2` is small (80MB) and well-understood. Is quality sufficient for meeting transcript retrieval?
2. **Embedding storage format**: Store as raw `f32` BLOB or quantize to `f16` / `u8`? Tradeoff is storage size vs similarity accuracy.
3. **Context asset size limits**: Should scratchpad and text attachments have a size cap for prompt inclusion? What's the right default (e.g., 10,000 characters)?
4. **FTS extension vs separate index**: Should context asset text go into the existing `transcripts_fts` table or get a new FTS table? Separate is cleaner; shared is simpler for search UI.
5. **Calendar API scope**: Is OS-level calendar access worth the platform-specific complexity in v0.5, or should we ship ICS import only?

---

## 7. Success Metrics for v0.5

### Engineering Metrics
- Merge gate catches Rust test regressions (zero false-pass rate)
- Frontend context providers each under 150 lines
- Provider capability queries are used by at least extraction and (later) copilot orchestration

### Product Metrics
- Percentage of meetings with scratchpad content
- Percentage of meetings with at least one tag
- Summary quality improvement when context is included (manual evaluation on test meetings)
- Embedding pipeline completion rate (percentage of meetings with embeddings)
- Time from recording stop to embeddings available

### Forward Indicators
- Retrieval quality on test queries over embedded meetings (precision@5)
- Context assembly latency (target < 200ms for a single meeting)
