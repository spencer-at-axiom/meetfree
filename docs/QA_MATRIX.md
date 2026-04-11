# QA Matrix

This matrix covers the highest-risk meeting-copilot workflows after the April 8, 2026 stabilization pass.

## Release Blocking Smoke Tests

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
  - Recording starts without device-name mismatch errors.
  - Stop finalizes cleanly and creates a meeting.

### 3. Tray Stop From Another Route

- Goal: Verify global stop ownership works even when the user is not on the home page.
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

- Goal: Confirm non-UI stop paths converge on the same finalization flow.
- Setup:
  - Start a recording.
  - Navigate away from the home route.
- Steps:
  1. Trigger the global stop shortcut.
  2. Wait for finalization to complete.
- Expected:
  - Stop uses the same finalization path as the UI stop button.
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

## Confidence Checks

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

### 8. IndexedDB Recovery

- Goal: Confirm transcript recovery still works after an interrupted session.
- Steps:
  1. Start recording and speak long enough to generate transcript segments.
  2. Interrupt the app before normal stop finalization.
  3. Reopen the app and follow the recovery path.
- Expected:
  - Recovery affordance appears when local transcript data exists.
  - Recovered transcript is attached to the restored meeting flow.

## Sign-Off Rule

- Automated gates must pass:
  - `node scripts/check-tauri-command-contract.js`
  - `pnpm.cmd --dir desktop lint`
  - `pnpm.cmd --dir desktop test`
  - `pnpm.cmd --dir desktop build`
  - `cargo check -p meetfree --locked`
  - `cargo test -p meetfree --lib --locked`
- Manual sign-off requires all six release-blocking smoke tests above to pass on the target release build.
