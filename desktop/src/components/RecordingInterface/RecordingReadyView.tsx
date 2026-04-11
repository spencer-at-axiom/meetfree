'use client';

import { Play, Square } from 'lucide-react';

import type { RecordingReadiness } from '@/services/recordingService';
import type { ReadinessState } from '@/hooks/useRecordingReadiness';
import { RecordingCanvasShell } from './RecordingCanvasShell';
import { RecordingTranscriptPane } from './RecordingTranscriptPane';

interface RecordingReadyViewProps {
  onStartRecording: () => void;
  readinessState: ReadinessState;
  readiness: RecordingReadiness | null;
  canRecord: boolean;
  isDisabled?: boolean;
}

function formatStatusLabel(
  readinessState: ReadinessState,
  issue?: string
) {
  switch (readinessState) {
    case 'checking':
      return 'Checking setup';
    case 'missing_model':
      return 'Model required';
    case 'model_downloading':
      return 'Model downloading';
    case 'missing_microphone':
      return 'Microphone required';
    case 'system_audio_unavailable':
      return issue || 'System audio unavailable';
    case 'configuration_error':
      return issue || 'Configuration issue';
    default:
      return 'Ready';
  }
}

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return '00:00:00';
  }

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function RecordingReadyView({
  onStartRecording,
  readinessState,
  readiness,
  canRecord,
  isDisabled = false,
}: RecordingReadyViewProps) {
  const statusLabel = formatStatusLabel(readinessState, readiness?.issues?.[0]);
  const helperMessage = canRecord
    ? null
    : readiness?.issues?.[0] || 'Recording is not ready yet.';

  return (
    <RecordingCanvasShell
      statusLabel={statusLabel}
      durationLabel={formatDuration(0)}
      tone={canRecord ? 'ready' : readinessState === 'checking' ? 'finalizing' : 'paused'}
      helperMessage={helperMessage}
      primaryAction={{
        icon: Play,
        label: 'Start recording',
        onClick: onStartRecording,
        disabled: isDisabled || !canRecord,
      }}
      secondaryAction={{
        icon: Square,
        label: 'Stop recording',
        onClick: () => undefined,
        disabled: true,
      }}
    >
      <RecordingTranscriptPane
        isProcessingStop={false}
        isStopping={false}
        emptyStateMode="ready"
      />
    </RecordingCanvasShell>
  );
}
