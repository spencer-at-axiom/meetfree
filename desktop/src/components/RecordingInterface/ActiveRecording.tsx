'use client';

import { Pause, Play, Square } from 'lucide-react';
import { RecordingStatus, useRecordingState } from '@/contexts/RecordingStateContext';
import { RecordingCanvasShell } from './RecordingCanvasShell';

interface ActiveRecordingProps {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  children?: React.ReactNode;
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getStatusText(
  status: RecordingStatus,
  isRecording: boolean,
  isPaused: boolean
) {
  if (status === RecordingStatus.STOPPING) return 'Stopping';
  if (status === RecordingStatus.PROCESSING_TRANSCRIPTS) return 'Finalizing';
  if (status === RecordingStatus.SAVING) return 'Saving';
  if (isPaused) return 'Paused';
  if (isRecording) return 'Recording';
  return 'Ready';
}

export function ActiveRecording({
  onPause,
  onResume,
  onStop,
  children,
}: ActiveRecordingProps) {
  const { isRecording, isPaused, recordingDuration, status } = useRecordingState();

  const isFinalizing =
    status === RecordingStatus.STOPPING ||
    status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
    status === RecordingStatus.SAVING;

  const statusText = getStatusText(status, isRecording, isPaused);

  return (
    <RecordingCanvasShell
      statusLabel={statusText}
      durationLabel={formatDuration(recordingDuration)}
      tone={isFinalizing ? 'finalizing' : isPaused ? 'paused' : 'recording'}
      helperMessage={isFinalizing ? 'Finishing the recording and saving your meeting.' : null}
      primaryAction={{
        icon: isPaused ? Play : Pause,
        label: isPaused ? 'Resume recording' : 'Pause recording',
        onClick: isPaused ? onResume : onPause,
        disabled: isFinalizing,
      }}
      secondaryAction={{
        icon: Square,
        label: 'Stop recording',
        onClick: onStop,
        disabled: isFinalizing,
      }}
    >
      {children}
    </RecordingCanvasShell>
  );
}
