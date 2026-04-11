export type OnboardingPermission = 'microphone' | 'systemAudio';
export type MacPreferencePane = 'Privacy_Microphone' | 'Privacy_ListenEvent';

export interface SummaryTriggerPayloadInput {
  transcriptText: string;
  provider: string;
  modelName: string;
  meetingId: string;
  customPrompt: string;
  templateId: string;
}

export function buildSetAppPreferencesPayload<T>(preferences: T): { preferences: T } {
  return { preferences };
}

export function getPermissionSettingsPane(permission: OnboardingPermission): MacPreferencePane {
  return permission === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ListenEvent';
}

export function buildProcessTranscriptPayload(
  input: SummaryTriggerPayloadInput
): {
  text: string;
  model: string;
  modelName: string;
  meetingId: string;
  chunkSize: number;
  overlap: number;
  customPrompt: string;
  templateId: string;
} {
  return {
    text: input.transcriptText,
    model: input.provider,
    modelName: input.modelName,
    meetingId: input.meetingId,
    chunkSize: 40000,
    overlap: 1000,
    customPrompt: input.customPrompt,
    templateId: input.templateId,
  };
}
