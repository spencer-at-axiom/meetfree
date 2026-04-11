# MeetFree v0.4.0 Release Notes

Release date: April 11, 2026  
Status: Ready to ship

## Overview

MeetFree `v0.4.0` turns post-meeting recap data into durable application records.

This release adds:

- reusable speaker identities
- stable meeting-speaker review records
- structured action items
- structured decisions
- transcript-backed provenance for extracted artifacts
- review workflows for correcting speakers, action items, decisions, and voice-profile metadata

This is a foundation release for later live-copilot work. It improves trust and editability after a meeting; it does not yet add a live in-call assistant.

## Shipped Scope

### Structured action items and decisions

MeetFree now persists action items and decisions as first-class database rows rather than treating them only as recap text.

What ships in `v0.4.0`:

- summary save synchronizes structured action items and decisions
- BlockNote structured sections are preferred over markdown fallback
- heuristic extraction is now gated by transcript evidence before new durable rows are created
- extracted rows store transcript linkage, timing, and source excerpts when evidence is found
- reviewed rows survive summary regeneration

What this means:

- recap text is no longer the only source of truth
- exports can use structured rows directly
- low-signal heuristic guesses are less likely to be persisted as real records

### Speaker identity management

MeetFree now supports reusable speaker identities across meetings.

What ships in `v0.4.0`:

- create reusable speaker identities
- link and unlink meeting speakers to identities
- rename speakers locally inside a meeting
- inspect where an identity appears across meetings
- review action items owned by that identity
- merge duplicate identities

What this means:

- reviewed speaker naming survives diarization reruns
- action ownership can be attached to a reusable person record
- duplicate identity cleanup is now an explicit workflow instead of a database-only concern

### Voice profile metadata workflow

`v0.4.0` now includes a practical voice-profile management surface for reusable identity records.

What ships in `v0.4.0`:

- create voice-profile rows from the identity inspector
- edit profile type, provider, model version, sample count, and payload or notes
- delete obsolete voice-profile rows
- merge operations reattach voice profiles when identities are merged

What this does not mean:

- there is no automatic acoustic training pipeline in `v0.4.0`
- there is no automatic cross-meeting voice matching based on these profiles yet

The voice-profile workflow is intentionally a metadata and persistence layer for later matching work.

### Review workflows

The Summary tab now includes a structured review panel for:

- meeting speakers
- action items
- decisions
- explicit `accept`, `reject`, and `needs review` review-state actions for structured artifacts
- transcript-backed or weak-evidence provenance presentation inside the review flow

The speaker identity inspector now supports:

- editing identity name and notes
- reviewing grouped action items
- reviewing meetings where the identity appears
- managing voice-profile metadata

The speaker identity browser now supports:

- quick-open from meeting review into identity inspection
- lightweight search and sort over reusable identities
- visible counts that help explain where an identity is used

### Export behavior

Markdown, PDF, and DOCX export now prefer structured action items and decisions when present, while remaining compatible with older meetings that only have recap text.

## Technical Summary

`v0.4.0` adds or operationalizes:

- `speaker_identities`
- `voice_profiles`
- `meeting_speakers`
- `action_items`
- `decisions`

Backend additions include:

- repository modules for structured entities
- review-oriented Tauri commands
- speaker reconciliation persistence
- transcript-evidence provenance search
- decision-to-action-item relationship linking

Frontend additions include:

- structured review panel in meeting details
- speaker identity manager and merge workflow
- identity inspector with edit and voice-profile CRUD flows

## Validation Status

Validated during the current sprint:

- `node scripts/check-tauri-command-contract.js`
- targeted Vitest coverage for:
  - structured review panel
  - speaker identity manager browsing and navigation
  - identity merge dialog
  - identity inspector edit and voice-profile flows
- `cargo check -p meetfree --lib`
- `cargo test -p meetfree --lib`
- `powershell -ExecutionPolicy Bypass -File scripts/release-smoke.ps1`

## Known Limitations

### Extraction

- extraction is stronger and more evidence-driven than earlier `v0.4.0` iterations, but it is still rule-based rather than model-native structured extraction
- owner linking still depends on meeting-speaker and identity names lining up reasonably well
- action-item and decision confidence is not stored as a first-class schema field in this release

### Voice profiles

- voice profiles are metadata and payload records only in `v0.4.0`
- no automatic embedding generation or retraining job is included yet
- no automatic identity suggestion is driven by stored voice profiles yet

### Identity management

- merge is one-way and archives the source identity
- there is no undo flow yet

## Deferred Beyond v0.4.0

The following remain intentionally out of scope:

- live in-call copilot or chat
- live suggestion generation during meetings
- automatic voice-profile training and matching
- cross-meeting semantic retrieval
- cloud sync
- team collaboration

## Upgrade Notes

For the current development phase:

- the baseline schema is the source of truth
- local development databases may be reset when schema changes materially
- legacy meetings remain readable and exportable
- structured rows are created or refreshed when summary flows run through the new `v0.4.0` paths
