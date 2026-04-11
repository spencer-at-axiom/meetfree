import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SummaryChunk {
  meeting_id: string;
  chunk_index: number;
  total_chunks: number;
  content: string;
  is_final: boolean;
}

export interface SummaryProgress {
  meeting_id: string;
  stage: string;
  progress: number;
  message: string;
}

export interface SummaryStreamError {
  meeting_id: string;
  error: string;
}

export interface StreamingCallbacks {
  onChunk: (chunk: SummaryChunk) => void;
  onProgress: (progress: SummaryProgress) => void;
  onError: (error: SummaryStreamError) => void;
  onComplete: (finalContent: string) => void;
}

export async function startStreamingSummary(
  meetingId: string,
  templateId: string,
  callbacks: StreamingCallbacks,
): Promise<{ unlisten: () => void }> {
  const unlisteners: UnlistenFn[] = [];

  const unChunk = await listen<SummaryChunk>('summary-chunk', (event) => {
    if (event.payload.meeting_id !== meetingId) return;
    callbacks.onChunk(event.payload);
    if (event.payload.is_final) {
      callbacks.onComplete(event.payload.content);
    }
  });
  unlisteners.push(unChunk);

  const unProgress = await listen<SummaryProgress>('summary-progress', (event) => {
    if (event.payload.meeting_id !== meetingId) return;
    callbacks.onProgress(event.payload);
  });
  unlisteners.push(unProgress);

  const unError = await listen<SummaryStreamError>('summary-error', (event) => {
    if (event.payload.meeting_id !== meetingId) return;
    callbacks.onError(event.payload);
  });
  unlisteners.push(unError);

  invoke('generate_summary_streaming', {
    meetingId,
    templateId,
  }).catch((err) => {
    callbacks.onError({
      meeting_id: meetingId,
      error: typeof err === 'string' ? err : String(err),
    });
  });

  return {
    unlisten: () => {
      for (const fn of unlisteners) fn();
    },
  };
}
