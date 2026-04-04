# Technical Design

## Product Thesis

This fork should be a reliable local-first meeting capture workstation.

That means:

- fast start to recording
- dependable stop and save behavior
- locally stored transcript history
- useful summary generation with clear privacy choices
- minimal setup friction for a single-user desktop workflow

It should not try to be a general-purpose AI control panel.

## What The Product Is Today

Today the codebase is already capable of:

- recording meetings
- capturing microphone and optional system audio
- transcribing locally
- storing meetings and transcripts locally
- generating summaries from local or external models
- importing and retranscribing audio
- recovering interrupted sessions

The product surface is wider than the release definition.

## What The Product Should Be

For v0.1.0, MeetFree should be:

- a single-user desktop app
- optimized for local-first capture and post-meeting notes
- opinionated around one default workflow
- explicit about when external providers are used

The core product promise should be:

1. Record a meeting locally.
2. Watch the transcript arrive locally.
3. Stop recording without losing work.
4. Open the saved meeting immediately.
5. Generate a useful summary with either a local model or an intentionally chosen external provider.

## Primary User

The primary user is an individual professional who wants:

- private meeting notes
- offline-friendly capture
- searchable transcript history
- summaries without a cloud-first workspace product

This is not yet a team collaboration product.

## Product Principles

### 1. Local First By Default

The default experience should work with:

- Parakeet for transcription
- Built-in AI or Ollama for summaries
- local SQLite storage

External providers are advanced options, not the primary story.

### 2. Reliability Over Breadth

The app should prefer:

- fewer providers
- fewer toggles
- fewer background assumptions

if that makes the recording and save path more reliable.

### 3. Clear Privacy Boundaries

Users should always know:

- what stays local
- what leaves the machine
- where API keys are stored

### 4. One Happy Path

The first-run and daily-use experience should be obvious:

1. finish onboarding
2. press record
3. stop
4. review transcript
5. generate summary

## Required Design Decisions

### A. Backend-Owned Recording Finalization

This is the most important change.

The backend should own:

- end-of-recording finalization
- transcript completion boundaries
- final persistence of recordings and transcript segments
- emission of a single durable "meeting saved" result

The frontend should render status, not orchestrate the critical save path.

### B. Narrow Provider Tiers

The provider strategy should become:

- Default local transcription: Parakeet
- Default local summary: Built-in AI
- Advanced local summary: Ollama
- Expert external summary: OpenAI, Claude, Groq, OpenRouter, custom OpenAI-compatible endpoints

If provider breadth creates support burden, hide expert providers behind an advanced section instead of making them part of the primary flow.

### C. Secure Secret Storage

Provider API keys now use OS-native credential storage for release builds.

Current behavior:

- Windows Credential Manager
- macOS Keychain
- Secret Service via the platform keyring backend where available

Non-secret provider settings remain in SQLite. Release validation still needs to confirm the keyring behavior on each supported platform.

### D. Summary Readiness Must Be Truthful

Onboarding currently allows the user to continue before the summary model is definitely ready. That can be acceptable, but only if the app then behaves honestly:

- transcription is ready
- summary may still be downloading
- summary UI shows readiness clearly
- the default provider does not imply availability that does not exist yet

### E. Beta Features Need A Real Policy

Import and retranscription can stay in the repo, but v0.1.0 must choose one of these:

- graduate it to supported behavior, or
- hide it by default and label it experimental

"beta but enabled by default" is not a stable release stance.

### F. Command Ownership Should Be Clear

`desktop/src-tauri/src/lib.rs` is currently a large registry and setup hub. Even if the command surface stays broad, ownership should be clearer:

- recording commands
- summary commands
- settings/config commands
- onboarding commands
- diagnostics/import/retranscription commands

The issue is maintainability, not just aesthetics.

## Proposed v0.1.0 Product Boundary

### In Scope

- onboarding
- recording controls
- microphone and optional system audio capture
- local transcription
- meeting history
- meeting search
- transcript review
- local summary generation
- optional external summary generation
- recovery after interruption
- update delivery
- device and storage settings

### Out of Scope

- speaker diarization
- collaboration and shared workspaces
- cloud sync
- PDF export
- DOCX export
- calendar integrations
- team analytics

## Release Quality Bars

v0.1.0 should not ship unless:

- recording start, stop, and save are dependable
- the app can recover from interrupted recording sessions
- onboarding leads users to a working transcription path
- summary generation readiness is explicit and accurate
- documentation matches the codebase
- tests for core deterministic logic pass in CI

## Bottom Line

The right direction is already present:

- native desktop
- local-first
- privacy-aware
- model-flexible

The technical design needs to become more opinionated so the first release feels like one product instead of a collection of adjacent capabilities.
