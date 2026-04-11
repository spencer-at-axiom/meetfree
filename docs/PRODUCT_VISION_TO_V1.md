# MeetFree Product Vision and Engineering Roadmap to v1.0.0

Last updated: April 10, 2026
Status: Draft
Baseline: v0.3.0 complete

## 1. Objective

Define the product and technical path from the current `v0.3.0` baseline to a `v1.0.0` release where `Live Meeting Copilot` is the primary product differentiator.

This document is intended for engineering planning. It defines:

- the `v1.0.0` product target
- the capability set required to reach it
- the sequencing constraints between releases
- the architecture implications of that sequencing

## 2. Product Definition

### v1.0.0 Product Statement

MeetFree `v1.0.0` is a local-first desktop meeting system that:

- captures meetings reliably
- maintains a trustworthy live transcript
- supports in-meeting copilot chat and catch-up workflows
- grounds answers in transcript, speaker identity, local context, and prior meeting memory
- produces durable post-meeting artifacts: summary, action items, decisions, people, and exports

### Primary User Value

MeetFree must provide value in two time domains:

- during the meeting: answer questions, recover context, draft responses, and reduce attention-switching cost
- after the meeting: persist decisions, tasks, and memory in a form that is reviewable, editable, searchable, and exportable

### Product Positioning

MeetFree should optimize for:

- local-first operation
- bot-free desktop capture
- single-user workflows
- explicit privacy and context control
- strong post-meeting follow-through

MeetFree should not optimize for:

- cloud workspace collaboration
- bot-first meeting capture
- team permission systems
- high-volume sales orchestration

## 3. External Validation

The roadmap below was re-checked on April 10, 2026 against official product pages and documentation from adjacent products.

Observed market requirements from current shipping products:

- Live in-meeting interaction is now a real product category.
  - Fireflies documents a desktop floating panel with real-time notes, `Catch Up (Last 1 min)`, `Summarize So Far`, action items, and in-meeting Q&A via AskFred. [Fireflies Live Assist](https://guide.fireflies.ai/articles/2679406774-live-assist-on-the-fireflies-desktop-app-real-time-notes-and-suggestions)
  - Krisp markets real-time transcription plus AI chat across meeting notes. [Krisp AI Note Taker](https://krisp.ai/ai-note-taker/)

- Bot-free capture is viable and user-facing.
  - Notion promotes desktop meeting notes with system-audio capture and consent controls. [Notion AI Meeting Notes](https://www.notion.com/product/ai-meeting-notes)
  - Fireflies explicitly supports system-audio recordings on desktop in addition to bot meetings. [Fireflies Live Assist](https://guide.fireflies.ai/articles/2679406774-live-assist-on-the-fireflies-desktop-app-real-time-notes-and-suggestions)

- Mid-meeting catch-up is no longer optional for top-tier UX.
  - Fireflies exposes both recent-window catch-up and meeting-so-far summaries in the live panel. [Fireflies Live Assist](https://guide.fireflies.ai/articles/2679406774-live-assist-on-the-fireflies-desktop-app-real-time-notes-and-suggestions)
  - Read AI positions real-time meeting tools and catch-up workflows as part of the core experience. [Read AI Meeting Tools](https://www.read.ai/meeting-tools)

- The market has moved beyond transcript-plus-summary.
  - Krisp and Otter promote search and AI chat over meeting history rather than only static summaries. [Krisp AI Note Taker](https://krisp.ai/ai-note-taker/) [Otter](https://otter.ai/)

- Context-aware note generation matters.
  - Granola documents user-authored notes, templates, and chat/edit flows over meeting content as first-class parts of the product. [Granola Help Center](https://docs.granola.ai/help-center)

### Strategic Conclusion

The current market supports the following conclusions:

1. A strong recap is necessary but not differentiating.
2. Live meeting interaction is becoming table stakes for premium meeting products.
3. Trust, grounding, and latency are more important than breadth of "AI features".
4. MeetFree's strongest route is not to copy cloud collaboration models, but to combine:
   - bot-free desktop capture
   - local-first privacy
   - durable post-meeting structure
   - grounded live assistance

## 4. Product Requirements for v1.0.0

### 4.1 Core Functional Requirements

#### FR-1 Capture

MeetFree must:

- record microphone input reliably
- record system audio where the platform permits it
- support imported audio as a first-class source type
- preserve durable meeting lifecycle state through start, pause, resume, stop, and finalization

#### FR-2 Live Transcript

MeetFree must:

- display transcript updates during recording
- preserve source timing metadata
- support transcript cleanup without losing raw evidence
- expose enough transcript structure for downstream live querying and post-meeting extraction

#### FR-3 Speaker Identity

MeetFree must:

- support per-meeting diarization
- promote speakers into reusable identities
- match future meeting speakers to existing identities with confidence and review state
- preserve user corrections across reruns

#### FR-4 Structured Post-Meeting Artifacts

MeetFree must persist first-class records for:

- action items
- decisions
- speaker identities
- meeting metadata
- editable summary payloads

These artifacts must remain linked back to transcript evidence and meeting provenance.

#### FR-5 Context Layer

MeetFree must support context sources that can be attached or referenced at the meeting level:

- user scratchpad notes
- templates
- optional calendar metadata
- local files or prepared context bundles

#### FR-6 Meeting Memory

MeetFree must support retrieval across previous meetings using:

- full-text search
- structured filters
- people and speaker identity
- action item and decision state
- optional semantic retrieval over attached context and past meetings

#### FR-7 Live Meeting Copilot

MeetFree must provide an in-meeting interface that supports:

- free-form chat over the current meeting
- recent-window catch-up
- meeting-so-far recap
- speaker-aware queries
- task and decision queries
- response drafting grounded in current transcript and optional context

#### FR-8 Export and Handoff

MeetFree must export:

- transcript
- summary
- named speakers
- action items
- decisions

MeetFree should additionally support lightweight automation handoff via webhook or local integration without introducing a cloud dependency.

### 4.2 Non-Functional Requirements

#### NFR-1 Privacy

- Local-first must remain the default operating mode.
- The product must explain what leaves the device in hybrid or cloud-assisted modes.
- Context inclusion in live copilot responses must be explicit and reviewable.

#### NFR-2 Reliability

- Recording finalization must remain higher priority than copilot features.
- The live layer must degrade gracefully when models or providers are unavailable.

#### NFR-3 Grounding

- Live responses must have a deterministic grounding policy.
- The system should support evidence references back to transcript spans and context sources.
- Cross-meeting retrieval must be opt-in or clearly bounded.

#### NFR-4 Latency

Initial engineering targets:

- transcript-to-visible update latency should remain low enough to support in-meeting reading
- live copilot responses should be fast enough for in-meeting use, with explicit performance targets defined before `v0.7.0`

#### NFR-5 Auditability

- extracted tasks and decisions must be reviewable and correctable
- speaker identity matches must expose confidence and review state
- summary and live-answer generation paths must be observable in logs and testable in CI where feasible

## 5. Engineering Constraints

The existing codebase already establishes several decisions that this roadmap should preserve:

- product of record is the Tauri desktop app in `desktop/`
- local persistence is SQLite
- summaries already have a durable contract layer
- transcription and diarization are local-first services
- team collaboration and cloud sync are currently out of scope

Implication:

MeetFree should extend the current architecture with additional local entities and retrieval services. It should not pivot into a backend-heavy architecture simply to support live copilot.

## 6. Capability Layers

The roadmap is constrained by dependency ordering. Later layers assume earlier ones exist and are stable.

### Layer A. Capture Reliability

Includes:

- recording state machine correctness
- finalization reliability
- transcript durability
- import and retranscription support

This is foundational for every later capability.

### Layer B. Durable Structured Data

Includes:

- speaker identities
- voice profiles
- action items
- decisions
- evidence links

This is required before the copilot can answer questions about commitments, participants, or outcomes with acceptable trust.

### Layer C. Context Ingestion

Includes:

- scratchpad
- templates
- meeting-scoped attachments
- optional calendar enrichment

This is required before live assistance can be meaningfully grounded beyond the raw transcript.

### Layer D. Meeting Memory

Includes:

- global retrieval across meetings
- people-centric lookup
- task and decision indexing
- semantic or structured retrieval over prior meetings and context

This is required before the copilot can answer cross-meeting questions reliably.

### Layer E. Live Copilot

Includes:

- in-meeting chat
- catch-up
- grounded queries
- drafting
- optional proactive behaviors

This is the differentiating layer and should be built only after Layers A through D are sufficiently mature.

## 7. Versioned Roadmap

### v0.4.0 - Identity and Structured Artifacts

Objective:

Introduce the durable entities required for future copilot grounding.

Required deliverables:

- reusable speaker identity model
- voice profile model
- structured action item model
- structured decision model
- review UI for identity matches and extracted items
- export support for structured entities
- regression hardening of recording and finalization flows

Release gate:

- the system can persist and reload speaker identities, tasks, and decisions without summary parsing as the only source of truth

### v0.5.0 - Context Ingestion and Preparation

Objective:

Add the meeting-scoped context layer required for grounded live assistance.

Required deliverables:

- first-class scratchpad entity
- context attachment model and storage
- template improvements
- optional calendar enrichment
- tag system
- summary generation updated to consume structured context sources

Release gate:

- the system can assemble a meeting context package from transcript, scratchpad, attachments, and metadata

### v0.6.0 - Meeting Memory and Retrieval

Objective:

Support cross-meeting retrieval over structured and unstructured meeting artifacts.

Required deliverables:

- people view
- global action item and decision views
- search and filter by speaker, tag, task state, and decision
- retrieval interfaces for prior meetings and context
- optional webhook or lightweight handoff layer

Release gate:

- the system can answer retrieval queries over prior meetings with deterministic source selection

### v0.7.0 - Live Copilot Alpha

Objective:

Ship the first in-meeting copilot workflow with transcript-first grounding.

Required deliverables:

- in-meeting copilot panel
- transcript-window retrieval
- free-form in-meeting chat
- recent-window catch-up
- meeting-so-far summary
- source attribution model in UI

Release gate:

- live copilot is useful using transcript-only or transcript-plus-metadata grounding, without requiring proactive suggestions

### v0.8.0 - Live Copilot Beta

Objective:

Expand the live layer to use the full grounding stack.

Required deliverables:

- speaker-aware queries
- attachment-aware queries
- scratchpad-aware queries
- optional cross-meeting retrieval
- in-meeting drafting workflows
- live extraction surfacing for tasks and decisions

Release gate:

- live answers are materially improved by context and identity, not just transcript summarization

### v0.9.0 - Quality, Evaluation, and Launch Hardening

Objective:

Prepare the product for a `v1.0.0` launch where live copilot is the main value proposition.

Required deliverables:

- evaluation harness for live-answer quality
- latency targets and regressions tracked
- privacy and consent UX finalized
- provider fallback strategy refined
- onboarding for live copilot workflows
- optional proactive suggestions only if quality and interruptibility are acceptable

Release gate:

- engineering and product can measure live quality, grounding quality, and failure modes before launch

### v1.0.0 - Live Meeting Copilot

Objective:

Launch a technically coherent system where live assistance and post-meeting follow-through share the same data model and evidence graph.

Launch criteria:

- live transcript is stable enough for continuous in-meeting use
- live chat and catch-up are grounded and low-friction
- speaker identity and structured artifacts are durable
- attached context improves answers in measurable ways
- post-meeting recap, tasks, decisions, and exports remain strong even when live features are unused

## 8. Recommended Technical Architecture Directions

### 8.1 Canonical Meeting Artifact Graph

The system should converge on a canonical model where the following are first-class entities:

- meeting
- transcript segment
- speaker turn
- speaker identity
- voice profile
- summary payload
- action item
- decision
- context asset
- context reference

Each entity should support provenance and source linkage where applicable.

### 8.2 Meeting Context Assembly Service

Before `v0.7.0`, introduce a service that can build a bounded context package for:

- summary generation
- export rendering
- live copilot responses

Inputs should include:

- current transcript window
- meeting metadata
- identified speakers
- scratchpad
- attachments
- optional prior meeting memory

### 8.3 Retrieval Abstractions

The live layer should not directly couple to storage tables. Introduce retrieval interfaces for:

- transcript windows
- speaker history
- task and decision state
- attachment chunks
- prior meeting lookup

This keeps live-answer orchestration separable from the persistence layer.

### 8.4 Evidence and Citation Model

Before `v0.8.0`, define an internal evidence model for:

- transcript span references
- attachment references
- prior meeting references

This is required for:

- UI attribution
- debugging
- evaluation
- user trust

### 8.5 Evaluation Harness

Before `v0.9.0`, define a repeatable evaluation set for:

- catch-up quality
- task extraction quality
- decision extraction quality
- speaker-aware answer correctness
- grounding fidelity
- latency regressions

## 9. Success Metrics

### Foundation Metrics

- percentage of meetings with reviewed or accepted speaker identities
- percentage of meetings with structured tasks and decisions
- reduction in manual recap cleanup
- retrieval success rate for speaker and task queries

### Live Metrics

- percentage of active meetings where the copilot panel is opened
- percentage of active meetings with at least one live query
- repeat live usage per user
- live answer latency
- live answer user-rated usefulness
- grounding failure rate

## 10. Open Engineering Questions

- What evidence format should live answers expose to the UI?
- Should transcript-window retrieval and cross-meeting retrieval share a single interface?
- When does speaker identity matching become automatic rather than review-required?
- What retrieval policy should govern prior-meeting context in live queries?
- Which live workflows must remain functional with fully local models only?

## 11. Immediate Follow-On Documents

This document should be followed by:

1. a technical release plan for `v0.4.0`
2. a schema design for speaker identity, tasks, decisions, and context assets
3. a context assembly design
4. a live copilot evaluation plan
