import { toast } from 'sonner';
import type { RecordingReadiness } from '@/services/recordingService';

type ModFn = (name: 'modelSelector', message?: string) => void;

export function blkKey(st: RecordingReadiness['status']): string | null {
  switch (st) {
    case 'model_downloading':
      return 'start_recording_blocked_downloading';
    case 'missing_model':
      return 'start_recording_blocked_missing';
    case 'missing_microphone':
      return 'start_recording_blocked_no_mic';
    case 'system_audio_unavailable':
      return 'start_recording_blocked_system_audio';
    case 'configuration_error':
      return 'start_recording_blocked_config';
    default:
      return null;
  }
}

export function showBk(rdy: RecordingReadiness, showModal?: ModFn): void {
  switch (rdy.status) {
    case 'model_downloading':
      toast.info('Model download in progress', {
        description: 'Please wait for the transcription model to finish downloading before recording.',
        duration: 5000,
      });
      return;
    case 'missing_model':
      toast.error('Transcription model not ready', {
        description: `Please download a ${rdy.provider} model before recording.`,
        duration: 5000,
      });
      showModal?.('modelSelector', 'Transcription model setup required');
      return;
    case 'missing_microphone':
      toast.error('No microphone available', {
        description: 'Please connect a microphone device before recording.',
        duration: 5000,
      });
      return;
    case 'system_audio_unavailable':
      toast.error('Selected system audio is unavailable', {
        description: rdy.issues.join(', ') || 'Choose another system audio source or switch to microphone-only recording.',
        duration: 6000,
      });
      return;
    case 'configuration_error':
      toast.error('Configuration error', {
        description: rdy.issues.join(', ') || 'Please check your recording configuration.',
        duration: 5000,
      });
      return;
    default:
      return;
  }
}

export function txtErr(err: unknown, alt: string): string {
  return err instanceof Error ? err.message : alt;
}
