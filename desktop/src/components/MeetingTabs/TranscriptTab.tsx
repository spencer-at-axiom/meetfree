'use client';

import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import type { TranscriptSegmentData } from '@/types';

interface TranscriptTabProps {
  transcripts: any[];
  customPrompt: string;
  onPromptChange: (prompt: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  meetingId: string;
  meetingFolderPath?: string;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptTab({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptTabProps) {
  return (
    <div className="h-full bg-slate-50/60">
      <TranscriptPanel
        transcripts={transcripts}
        customPrompt={customPrompt}
        onPromptChange={onPromptChange}
        onCopyTranscript={onCopyTranscript}
        onOpenMeetingFolder={onOpenMeetingFolder}
        isRecording={isRecording}
        disableAutoScroll={true}
        usePagination={true}
        segments={segments}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        totalCount={totalCount}
        loadedCount={loadedCount}
        onLoadMore={onLoadMore}
        meetingId={meetingId}
        meetingFolderPath={meetingFolderPath}
        onRefetchTranscripts={onRefetchTranscripts}
      />
    </div>
  );
}
