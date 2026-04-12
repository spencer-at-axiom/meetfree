# QA Matrix

This matrix covers the highest-risk desktop regression workflows, verified against the current codebase on April 11, 2026.

## Verification Snapshot

| ID | Workflow | Status | Notes |
| --- | --- | --- | --- |
| 1 | Microphone-only recording | Verified in code | Start, pause, resume, stop, shutdown progress, and post-stop navigation all exist in the active recording flow. |
| 2 | Microphone + system audio | Verified in code | Dual-source capture, readiness checks, and platform-specific loopback or monitor handling are implemented. |
| 3 | Tray stop from another route | Verified in code | Tray stop calls the canonical backend finalization path and the UI listens for the resulting backend stop event. |
| 4 | Keyboard shortcut stop from another route | Verified in code | A dedicated `Cmd/Ctrl+Shift+R` shortcut now dispatches a stop request and uses the shared recording finalization flow. |
| 5 | Selected microphone disconnected | Verified in code | Readiness validates the saved microphone and blocks recording with a selected-device error when unavailable. |
| 6 | Selected system audio source disconnected | Verified in code | Readiness validates the saved system-audio device and blocks recording when the selected source is unavailable. |
| 7 | Reload during recording | Verified in code | Recording state re-syncs from the backend on mount and resumes polling when a recording is already active. |
| 8 | IndexedDB recovery | Verified in code | Recovery detection, transcript preview, recovery save path, optional audio checkpoint recovery, and cleanup are implemented. |
| 9 | Structured review workflow | Verified in code and targeted UI tests | Summary-tab review supports meeting speakers, action items, and decisions with explicit review-state actions and inline provenance evidence. |
| 10 | Speaker identity inspection | Verified in code and targeted UI tests | Identity browser supports search, sort, quick-open inspection, grouped action-item review, and manual voice-profile CRUD. |
| 11 | Context-aware summary prompt assembly | Verified in code and backend tests | Summary generation loads a meeting context package and merges scratchpad, tags, and text attachment content into the prompt when present. |
| 12 | Tag-filtered transcript search | Verified in code, backend tests, and desktop UI wiring | Backend transcript search accepts `tagId`, the meetings page now exposes a tag filter, and meeting tags can be managed from the Context tab and Settings. |
| 13 | Attachment picker and text ingestion | Verified in code and backend tests | The Context tab can now open a native file picker, store attachment metadata, and preload text previews for common text formats while leaving binary files metadata-only. |
| 14 | Embedding retrieval foundation | Verified in code and backend tests | Embedding status, reindex, and semantic-search commands now work for supported providers, and backend tests now cover an embed-and-search round-trip. |

## Release-Blocking Regression Smoke Tests

### 1. Microphone Only Recording

- Goal: Confirm a standard microphone-only recording starts, pauses, resumes, stops, and lands on the recap page.
- Setup:
  - Select a working microphone.
  - Leave system audio unselected.
  - Choose a valid transcription model.
- Steps:
  1. Open the home route.
  2. Start recording.
  3. Speak a few short phrases.
  4. Pause recording.
  5. Resume recording.
  6. Stop recording from the UI.
  7. Wait for finalization to complete.
- Expected:
  - Start succeeds without extra prompts.
  - Live transcript appears segment by segment.
  - Pause and resume update the active-state UI correctly.
  - Finalization overlay shows real shutdown stages.
  - App lands on the meeting details page with the Summary tab selected.

### 2. Microphone + System Audio

- Goal: Confirm dual-source capture works when the platform exposes a usable loopback or monitor source.
- Setup:
  - Use macOS, Windows, or Linux.
  - Select a valid microphone.
  - Select a valid system-audio source exposed by the local audio stack.
  - Choose a valid transcription model.
- Steps:
  1. Open the home route.
  2. Start recording.
  3. Speak through the microphone and play short system audio.
  4. Stop recording from the UI.
- Expected:
  - Readiness reports the setup as recordable when the selected system-audio source is available.
  - Recording starts without device-selection errors.
  - Stop finalizes cleanly and creates a meeting.

### 3. Tray Stop From Another Route

- Goal: Verify non-home-route stop handling still converges on the canonical finalization flow.
- Setup:
  - Start a recording from the home route.
  - Navigate to a different route such as Meetings or Settings.
- Steps:
  1. While recording is active, move to another route.
  2. Stop recording from the tray menu.
  3. Wait for finalization to complete.
- Expected:
  - The app does not lose stop ownership when the home page unmounts.
  - Finalization completes once.
  - The meeting details page opens for the finalized meeting.
  - No duplicate stop toasts or duplicate finalization events appear.

### 4. Keyboard Shortcut Stop From Another Route

- Goal: Confirm the global stop shortcut converges on the same finalization flow even away from the record route.
- Setup:
  - Start a recording.
  - Navigate away from the home route.
- Steps:
  1. Trigger `Cmd/Ctrl+Shift+R`.
  2. Wait for finalization to complete.
- Expected:
  - Stop uses the same canonical finalization path as the UI and tray stop flows.
  - Meeting opens once after finalization.
  - No stale loading or orphaned recording state remains.

### 5. Selected Microphone Disconnected

- Goal: Verify readiness truthfully reports a saved microphone choice that is no longer available.
- Setup:
  - Save a specific microphone as the preferred mic.
  - Disconnect or disable that microphone.
- Steps:
  1. Return to the home route.
  2. Wait for readiness to refresh.
  3. Attempt to start recording.
- Expected:
  - Setup card shows the microphone as unavailable.
  - Start is blocked with a clear, user-facing reason.
  - The message refers to the selected device rather than a generic default-device error.

### 6. Selected System Audio Device Disconnected

- Goal: Verify readiness truthfully reports a saved system-audio source that is no longer available.
- Setup:
  - Save a specific system-audio source as preferred.
  - Disconnect or disable that source.
- Steps:
  1. Return to the home route.
  2. Wait for readiness to refresh.
  3. Attempt to start recording with system audio still selected.
- Expected:
  - Setup card shows the system-audio issue clearly.
  - Start is blocked if the selected system-audio source is unavailable.
  - The error refers to the selected source, not a generic platform or default-device message.

### 7. Reload During Recording

- Goal: Confirm backend-synced recording state survives a page refresh.
- Steps:
  1. Start recording.
  2. Reload the current route.
  3. Verify active-state UI after reload.
  4. Stop recording.
- Expected:
  - Recording state recovers without falling back to a false ready state.
  - Duration and paused state remain aligned with backend state.

## Confidence Checks

### 8. IndexedDB Recovery

- Goal: Confirm transcript recovery still works after an interrupted session.
- Steps:
  1. Start recording and speak long enough to generate transcript segments.
  2. Interrupt the app before normal stop finalization.
  3. Reopen the app and follow the recovery path.
- Expected:
  - Recovery affordance appears when local transcript data exists.
  - Transcript preview loads before recovery.
  - Recovered transcript is attached to the restored meeting flow.
  - Audio recovery is attempted when checkpoint files are still available.

### 9. Stop Finalization Deduplication

- Goal: Confirm repeated stop signals still converge on one finalized meeting.
- Setup:
  - Start a recording.
  - Use at least one non-UI stop source such as the tray menu.
- Steps:
  1. Trigger a stop action.
  2. Observe the resulting meeting open flow and toast behavior.
  3. Verify the app only finalizes once.
- Expected:
  - Only one meeting finalization result is processed.
- The app does not produce duplicate navigation, duplicate success toasts, or duplicate meeting refreshes.

### 10. Structured Review Persistence

- Goal: Confirm structured review edits persist through refresh-oriented workflows.
- Setup:
  - Use a meeting with a generated summary and structured review data.
- Steps:
  1. Open the meeting details Summary tab.
  2. Rename one meeting speaker locally and save it.
  3. Edit one action item title or owner and save it.
  4. Edit one decision title and save it.
  5. Refresh the page or reload the meeting details route.
- Expected:
  - Saved speaker, action item, and decision edits remain visible after reload.
  - Review badges remain consistent with the saved state.
  - Transcript-backed items show source evidence before acceptance.
  - Weak-evidence items are visibly distinguishable and easy to reject or keep under review.

### 11. Speaker Identity Inspection and Voice Profiles

- Goal: Confirm speaker identity editing and voice-profile metadata workflows work end to end.
- Setup:
  - Use an identity with at least one linked meeting speaker.
- Steps:
  1. Open the speaker identities route.
  2. Search or sort the identity list.
  3. Open one identity detail page from the list or a quick-open link.
  4. Edit the identity name or notes and save.
  5. Add a voice profile with provider, model version, sample count, and payload or notes.
  6. Edit that voice profile and save again.
  7. Delete the voice profile.
- Expected:
  - Search and sort make it easy to find the target identity.
  - Identity updates persist after reload.
  - Voice profile create, update, and delete actions succeed and refresh the inspector state correctly.

## Sign-Off Rule

- Automated gates must pass through the repo smoke scripts:
  - Windows PowerShell: `powershell -ExecutionPolicy Bypass -File scripts/release-smoke.ps1`
  - macOS/Linux shell: `bash scripts/release-smoke.sh`
- Manual sign-off requires the recording smoke tests above plus the structured-review and identity-inspection checks to pass on the target release build.

Current verification note (run locally on April 11, 2026):

- `cargo check -p meetfree --lib` passed.
- `cargo test -p meetfree --lib` passed with `261 passed`, `0 failed`, and `4 ignored`.
- `cargo fmt -p meetfree -- --check` passed.
- `cargo clippy -p meetfree -- -D warnings` passed.
- `pnpm.cmd run lint` passed in `desktop/`.
- `pnpm.cmd run test` passed in `desktop/` with `15` test files and `61` tests green.

## Priority Action Checklist

### P0

- Add automated coverage for the new `Cmd/Ctrl+Shift+R` stop shortcut from a non-home route so the shipped behavior is tested end to end.
- Add integration coverage for tray stop from a non-home route so both non-UI stop paths are verified beyond unit-level dedupe tests.
- Add integration coverage for reload-during-recording recovery so backend re-sync is exercised in a real app flow.

### P1

- Add automated readiness tests for saved-device disconnect scenarios for both microphone and system-audio selections.
- Consider promoting IndexedDB recovery to a scripted smoke flow if the test harness grows to support crash-and-relaunch scenarios.
- Keep this matrix aligned with the release smoke scripts so the manual checklist and scripted gates do not drift.
