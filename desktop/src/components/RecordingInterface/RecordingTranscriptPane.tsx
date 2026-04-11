'use client';

import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useMemo } from 'react';

/**
 * RecordingTranscriptPane Component
 *
 * Reusable recording-specific transcript display component for the active recording route.
 */

interface RecordingTranscriptPaneProps {
  isProcessingStop: boolean;
  isStopping: boolean;
  emptyStateMode?: 'default' | 'ready';
}

export function RecordingTranscriptPane({
  isProcessingStop,
  isStopping,
  emptyStateMode = 'default',
}: RecordingTranscriptPaneProps) {
  const { transcripts, transcriptContainerRef } = useTranscripts();
  const { isRecording, isPaused } = useRecordingState();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    })),
    [transcripts]
  );

  return (
    <div
      ref={transcriptContainerRef}
      className="flex h-full w-full justify-center overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.85),rgba(248,250,252,0.96)_36%,rgba(241,245,249,1)_100%)]"
    >
      <div className="w-full max-w-5xl px-4 pb-32 pt-24 sm:px-8">
        <div className="mx-auto w-full max-w-[920px]">
            <VirtualizedTranscriptView
              segments={segments}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessingStop}
              isStopping={isStopping}
              enableStreaming={isRecording}
              showConfidence={true}
              emptyStateMode={emptyStateMode}
            />
        </div>
      </div>
    </div>
  );
}
