# Privacy Policy

## Scope

This policy describes the behavior of the code in this repository.

## Local Data Handling

- Meeting recordings, transcripts, summaries, and settings are stored by the desktop app on the local machine.
- The desktop app initializes its SQLite database in the Tauri app data directory.
- Local transcription is handled by the native app through Whisper or Parakeet.
- Provider configuration is stored locally by the app.
- Provider API keys are stored in OS-backed credential storage when that facility is available on the platform.

## Optional External Providers

Meetfree can generate summaries with external providers if you configure and select them.

The current codebase supports:

- OpenAI
- Claude
- Groq
- OpenRouter
- Custom OpenAI-compatible endpoints

If you use one of these providers, the summary request leaves the local machine and is handled under that provider's terms.

## Local Summary Options

The current codebase also supports local summary generation through:

- Ollama
- BuiltInAI

## Analytics

- Analytics code is currently disabled in this fork.
- The current app ships a no-op analytics shim and does not send analytics events to a remote service.
- If analytics collection is reintroduced later, the privacy policy and consent UX should be updated before release.

## No Blanket Local-Only Claim

This repository should not be described as "no data ever leaves your machine" without qualification.

That statement is only true when:

- You use local transcription, and
- You use local summary providers, and
- Analytics remain disabled.
