# MeetFree v0.4.0 Progress Tracker

Last updated: April 11, 2026
Status: Complete (Shippable)
Parent document: `docs/PRODUCT_VISION_TO_V1.md`
Technical design companion: `docs/V040_TECHNICAL_DESIGN.md`

## 1. Release Objective

`v0.4.0` establishes the durable structured-data layer required for later `Live Meeting Copilot` work.

At a minimum, this release should give MeetFree:

- reusable speaker identities
- meeting-local reviewed speaker records
- structured action items
- structured decisions
- durable provenance from extracted artifacts back to meeting evidence

`v0.4.0` is primarily a foundation release. UI work is in scope only when it supports review, correction, trust, and future grounding.

## 2. Current Release Status

### Completed in this sprint slice

- [x] Baseline schema updated for `speaker_identities`, `voice_profiles`, `meeting_speakers`, `action_items`, and `decisions`
- [x] Rust models and repository modules added for new structured entities
- [x] Speaker reconciliation and meeting-speaker persistence implemented
- [x] Structured artifact persistence added for action items and decisions
- [x] Summary save flow updated to persist structured artifacts from summary payloads
- [x] Export assembly updated to prefer structured entities where available
- [x] Minimal backend review commands added for speakers, action items, and decisions
- [x] Minimal Summary-tab review UI wired for `meeting_speakers`, `action_items`, and `decisions`
- [x] Speaker identity management UI added for listing, inspection, update, and merge workflows
- [x] Structured extraction improved to prefer BlockNote structure before markdown fallback
- [x] Speaker review UI now shows review badges, unreviewed counts, and confidence cues
- [x] Reviewed action items and decisions preserved across regeneration
- [x] Backend tests added for repository and structured-artifact persistence behavior
- [x] Lightweight UI test added for the review panel
- [x] Lightweight UI test added for speaker-identity merge workflow
- [x] Rust build/test stabilization completed for this slice

### Still open for `v0.4.0`

- [x] Improve extraction quality beyond current rule-based summary parsing
- [x] Expand QA and release-smoke coverage for new review workflows
- [x] Update docs and release notes to reflect the final `v0.4.0` shipped scope
- [x] Add broader automated UI coverage for identity inspection and editing flows
- [x] Add clearer accept/reject/review-state affordances in the structured review UI
- [x] Finish lightweight people-centric browsing surfaces around speaker identities
- [x] Polish review-state visibility and provenance presentation for non-technical users

## 3. Scope

### In Scope

- schema changes for identities, profiles, tasks, and decisions
- extraction pipeline changes for structured outputs
- meeting details UI required to review and correct extracted entities
- export pipeline changes required to consume structured entities
- repository and service changes required for future live grounding

### Out of Scope

- live in-meeting chat
- proactive live suggestions
- meeting-scoped context attachments
- cross-meeting semantic retrieval
- cloud sync
- team collaboration

## 4. Goal Tracker

### Goal A. Cross-Meeting Speaker Identity

- [x] Introduce reusable `speaker_identities`
- [x] Introduce stable `meeting_speakers` layer above generated diarization rows
- [x] Persist reviewed speaker linkage separately from generated speaker-turn state
- [x] Support local rename flow for meeting speakers
- [x] Support linking and unlinking a meeting speaker to a reusable identity
- [x] Support creating a reusable identity from a meeting speaker
- [x] Support identity merge workflow
- [x] Support identity-inspection workflow across meetings
- [x] Add stronger identity confidence/review presentation in the UI
- [x] Add quick-open paths between meeting review and identity inspection
- [x] Add lightweight people-centric browsing polish (search, sort, and navigation cues)

Exit condition:
- A reviewed meeting speaker survives reloads and reruns, and can be linked to a reusable identity without being silently overwritten.

### Goal B. Voice Profile Management

- [x] Add baseline `voice_profiles` schema
- [x] Persist actual reusable voice-profile data
- [x] Add UI for managing voice profiles
- [x] Add create/update/delete workflow for future speaker matching data

Exit condition:
- Manual voice-profile records can be created, updated, inspected, and removed. Automatic acoustic training remains deferred.
  `v0.4.0` does not require automatic voice-profile training or aggressive speaker auto-matching.

### Goal C. Structured Action Items and Decisions

- [x] Add first-class `action_items` table
- [x] Add first-class `decisions` table
- [x] Persist extracted action items and decisions independently of summary markdown layout
- [x] Store extraction metadata and meeting linkage
- [x] Add review/update commands for action items and decisions
- [x] Add minimal UI for reviewing and editing extracted items
- [x] Preserve reviewed items across summary regeneration
- [x] Update exports to consume structured entities when present
- [x] Improve extraction accuracy and evidence quality
- [x] Add clearer accept/reject/review-state affordances in the UI
- [x] Improve review-panel provenance visibility and editing clarity

Exit condition:
- Action items and decisions behave like durable records, not temporary recap text.

### Goal D. Release Hardening

- [x] Get `cargo check -p meetfree --lib` green again
- [x] Get `cargo test -p meetfree --lib` green for this slice
- [x] Add repository tests for new entity lifecycle behavior
- [x] Add structured persistence regression tests
- [x] Add lightweight UI test for the review panel
- [x] Expand end-to-end QA checklist for manual verification
- [x] Update release smoke scripts or documented smoke steps if needed
- [x] Align all shipping docs with final implementation

Exit condition:
- The release is technically stable and documented enough to serve as the foundation for later `v0.5.0` and live-copilot work.

## 5. Phase Tracker

### Phase 1. Schema and Repository Foundation

- [x] Define baseline schema changes
- [x] Implement repository interfaces
- [x] Add schema/repository tests

Phase status: Complete

### Phase 2. Speaker Identity Flow

- [x] Add meeting-speaker and reusable-identity persistence
- [x] Add speaker review commands
- [x] Add minimal speaker review UI
- [x] Add merge and inspection workflows

Phase status: Complete

### Phase 3. Structured Extraction Flow

- [x] Persist structured action items and decisions
- [x] Update summary save path to sync structured artifacts
- [x] Add review/edit commands and UI
- [x] Preserve reviewed records during regeneration
- [x] Improve extraction quality further

Phase status: Complete

### Phase 4. Hardening and Release Readiness

- [x] Stabilize build and tests for current scope
- [x] Add targeted backend coverage
- [x] Add targeted UI coverage
- [x] Expand QA matrix and release-smoke checklist
- [x] Finalize roadmap/design docs for shipped scope

Phase status: Complete

### Phase 5. v0.4.0 Closeout Polish

- [x] Add explicit accept/reject/review-state actions in the structured review panel
- [x] Add lightweight people-centric browsing polish to speaker identities
- [x] Improve provenance visibility so users can understand why an item was extracted
- [x] Run final target-build smoke pass and freeze release notes

Phase status: Complete

## 6. Cut Lines

If schedule pressure appears, keep these items in `v0.4.0`:

- [x] identity schema
- [x] structured action items
- [x] structured decisions
- [x] minimal review UI
- [x] export compatibility
- [x] reviewed-state preservation across regeneration

Cut or defer first:

- [ ] advanced identity merge workflow
- [ ] people-centric browsing surfaces
- [ ] aggressive auto-matching policy
- [ ] non-essential filtering/polish work
- [ ] richer voice-profile workflows

## 7. Acceptance Checklist

`v0.4.0` is ready when all of the following are true:

- [x] reusable speaker identities exist as first-class records
- [x] structured action items and decisions exist as first-class records
- [x] reviewed identity and extraction state survives reloads and reruns in the implemented flows
- [x] exports prefer structured entities when present and remain compatible with legacy meetings
- [x] review UX is clear enough for non-technical users without database access
- [x] lightweight people-centric browsing is sufficient to inspect a speaker across meetings
- [x] extraction provenance is visible enough for users to trust or correct structured artifacts quickly
- [x] QA and release documentation are updated for the shipped workflow
- [x] remaining deferred items are intentionally cut rather than left ambiguous

## 8. Immediate Next Steps

- [x] add explicit accept/reject/review-state controls in the structured review panel
- [x] add quick-open and lightweight browsing polish for speaker identities
- [x] improve provenance visibility in the review panel
- [x] run final target-build smoke pass and release-note freeze
- [ ] continue improving extraction quality so fewer manual edits are needed
- [x] decide whether identity merge and identity inspection are required for the actual `v0.4.0` ship line
- [x] update QA/docs to match the implemented workflow exactly

## 9. Concrete Closeout Checklist (Execution Order)

This section converts the remaining `v0.4.0` work into the recommended implementation order.

### Step 1. Review-State Affordance Pass

- [x] Add explicit `accept`, `reject`, and `needs review` actions for `action_items` and `decisions`
- [x] Ensure review-state labels and badges are consistent across speakers, action items, and decisions
- [x] Make the default visible state obvious when an item is still machine-generated and unreviewed
- [x] Prevent accidental ambiguity between "edited", "accepted", and "still unreviewed"

Implementation target:
- `desktop/src/components/MeetingDetails/StructuredReviewPanel.tsx`
- supporting Tauri commands/types only if current commands are insufficient

Validation:
- targeted Vitest coverage for review-state transitions
- manual verification that accepted/rejected state survives reload and regeneration

### Step 2. Provenance Visibility Pass

- [x] Show transcript-backed evidence for extracted action items and decisions directly in the review flow
- [x] Prefer human-readable provenance presentation over raw internal metadata
- [x] Make it obvious why an item was extracted before the user edits or accepts it
- [x] Ensure low-confidence or weak-evidence items are visually distinguishable

Implementation target:
- `desktop/src/components/MeetingDetails/StructuredReviewPanel.tsx`
- `desktop/src/types/structuredReview.ts`
- backend payload shaping only if needed for better evidence display

Validation:
- targeted Vitest coverage for provenance rendering
- manual verification on at least one transcript-backed and one heuristic fallback item

### Step 3. People-Centric Browsing Polish

- [x] Add quick-open navigation from meeting-speaker review rows to speaker-identity inspection when linked
- [x] Add lightweight search and sort controls to the speaker-identity browsing surface
- [x] Add simple navigation cues or counts so users can understand where an identity is used
- [x] Keep the browsing flow lightweight; do not expand scope into a full people workspace

Implementation target:
- `desktop/src/app/speaker-identities/SpeakerIdentitiesManager.tsx`
- `desktop/src/app/speaker-identities/[id]/SpeakerIdentityInspector.tsx`
- `desktop/src/app/speaker-identities/detail/page.tsx`
- meeting-details entry points needed for quick-open navigation

Validation:
- targeted Vitest coverage for navigation/search/sort behavior
- manual verification of linked-speaker to identity-inspector flow

### Step 4. Final QA and Release Freeze

- [x] Run final command-contract verification
- [x] Run targeted frontend tests for structured review and speaker identity flows
- [x] Run lint on changed frontend files
- [x] Run `cargo check -p meetfree --lib`
- [x] Run `cargo test -p meetfree --lib`
- [x] Run platform-appropriate release-smoke script and confirm `v0.4.0` docs match shipped behavior
- [x] Freeze `RELEASE_NOTES_v0.4.0.md`, `QA_MATRIX.md`, `CHANGELOG.md`, and this roadmap for ship

Validation commands:
- `node scripts/check-tauri-command-contract.js`
- `pnpm --dir desktop exec vitest run ...`
- `pnpm --dir desktop exec eslint ...`
- `cargo check -p meetfree --lib`
- `cargo test -p meetfree --lib`
- `pwsh -File scripts/release-smoke.ps1`

### Step 5. Post-Closeout Improvement Queue

These items should not block ship unless they expose a real quality or trust failure during Steps 1-4.

- [ ] continue improving extraction quality so fewer manual edits are needed
- [ ] evaluate whether additional people-centric filtering belongs in `v0.5.0` instead of `v0.4.0`
- [ ] evaluate whether richer review workflows should be folded into later copilot-facing UX
