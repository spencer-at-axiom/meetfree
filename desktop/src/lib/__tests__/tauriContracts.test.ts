import {
  buildProcessTranscriptPayload,
  buildSetAppPreferencesPayload,
  getPermissionSettingsPane,
} from '@/lib/tauriContracts';

describe('tauri command contract helpers', () => {
  it('builds app preferences save payload with the preferences key', () => {
    const preferences = {
      auto_export_markdown_on_finalize: true,
      transcript_cleanup: {
        enabled: true,
        remove_fillers: false,
      },
      transcription_timeout_seconds: 900,
    };

    expect(buildSetAppPreferencesPayload(preferences)).toEqual({ preferences });
  });

  it('maps onboarding permission to expected macOS settings pane', () => {
    expect(getPermissionSettingsPane('microphone')).toBe('Privacy_Microphone');
    expect(getPermissionSettingsPane('systemAudio')).toBe('Privacy_ListenEvent');
  });

  it('builds summary trigger payload with stable processing defaults', () => {
    expect(
      buildProcessTranscriptPayload({
        transcriptText: 'Hello world',
        provider: 'ollama',
        modelName: 'llama3.2:1b',
        meetingId: 'meeting-123',
        customPrompt: 'Focus on decisions',
        templateId: 'default',
      })
    ).toEqual({
      text: 'Hello world',
      model: 'ollama',
      modelName: 'llama3.2:1b',
      meetingId: 'meeting-123',
      chunkSize: 40000,
      overlap: 1000,
      customPrompt: 'Focus on decisions',
      templateId: 'default',
    });
  });
});
