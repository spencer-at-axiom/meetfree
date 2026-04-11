import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSummaryGeneration } from '../useSummaryGeneration';
import { createMarkdownSummaryPayload } from '@/contracts/summaryContract';
import type { MeetingDetails } from '@/types/meeting';
import type { Transcript } from '@/types';
import type { ModelConfig } from '@/components/ModelSettingsModal';

const mocks = vi.hoisted(() => ({
  startSummaryPolling: vi.fn(),
  stopSummaryPolling: vi.fn(),
  invoke: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  trackSummaryGenerationStarted: vi.fn().mockResolvedValue(undefined),
  trackCustomPromptUsed: vi.fn().mockResolvedValue(undefined),
  trackSummaryGenerationCompleted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/contexts/MeetingsContext', () => ({
  useMeetings: () => ({
    startSummaryPolling: mocks.startSummaryPolling,
    stopSummaryPolling: mocks.stopSummaryPolling,
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/analytics', () => ({
  default: {
    trackSummaryGenerationStarted: mocks.trackSummaryGenerationStarted,
    trackCustomPromptUsed: mocks.trackCustomPromptUsed,
    trackSummaryGenerationCompleted: mocks.trackSummaryGenerationCompleted,
  },
}));

const meeting: MeetingDetails = {
  id: 'meeting-1',
  title: 'Sprint Planning',
  created_at: '2026-04-10T10:00:00Z',
  transcripts: [],
};

const modelConfig: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4',
  whisperModel: 'large-v3',
};

const transcriptRows: Transcript[] = [
  { id: 't1', text: 'Hello team', timestamp: '10:00:01', audio_start_time: 1 },
  { id: 't2', text: 'Let us plan sprint', timestamp: '10:00:04', audio_start_time: 4 },
];

function renderSummaryHook(overrides?: Partial<{
  onMeetingUpdated: () => Promise<void>;
  updateMeetingTitle: (title: string) => void;
  setAiSummary: (summary: ReturnType<typeof createMarkdownSummaryPayload> | null) => void;
  onOpenModelSettings: () => void;
}>) {
  const updateMeetingTitle = overrides?.updateMeetingTitle ?? vi.fn();
  const setAiSummary = overrides?.setAiSummary ?? vi.fn();
  const onMeetingUpdated = overrides?.onMeetingUpdated;
  const onOpenModelSettings = overrides?.onOpenModelSettings;

  const hook = renderHook(() =>
    useSummaryGeneration({
      meeting,
      transcripts: transcriptRows,
      modelConfig,
      isModelConfigLoading: false,
      selectedTemplate: 'default',
      onMeetingUpdated,
      updateMeetingTitle,
      setAiSummary,
      onOpenModelSettings,
    })
  );

  return {
    ...hook,
    updateMeetingTitle,
    setAiSummary,
  };
}

describe('useSummaryGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error when no transcripts exist for summary generation', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'meeting_transcripts_get') {
        return { transcripts: [], total_count: 0, has_more: false };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = renderSummaryHook();

    await act(async () => {
      await result.current.handleGenerateSummary('');
    });

    expect(mocks.startSummaryPolling).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('No transcripts available for summary');
  });

  it('completes summary workflow and updates meeting title on successful polling', async () => {
    const payload = createMarkdownSummaryPayload('## Summary\nAll updates completed.');

    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === 'meeting_transcripts_get') {
        const limit = Number(args.limit ?? 0);
        if (limit === 1) {
          return { transcripts: [transcriptRows[0]], total_count: 2, has_more: true };
        }
        return { transcripts: transcriptRows, total_count: 2, has_more: false };
      }

      if (command === 'api_process_transcript') {
        return { process_id: 'proc-1' };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    mocks.startSummaryPolling.mockImplementation(
      (
        _meetingId: string,
        _processId: string,
        callback: (result: { status: string; data?: unknown; meetingName?: string }) => void
      ) => {
        void callback({
          status: 'completed',
          data: payload,
          meetingName: 'Sprint Planning Updated',
        });
      }
    );

    const setAiSummary = vi.fn();
    const updateMeetingTitle = vi.fn();
    const { result } = renderSummaryHook({
      setAiSummary,
      updateMeetingTitle,
    });

    await act(async () => {
      await result.current.handleGenerateSummary('');
    });

    await waitFor(() => {
      expect(setAiSummary).toHaveBeenCalledWith(payload);
    });
    expect(updateMeetingTitle).toHaveBeenCalledWith('Sprint Planning Updated');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Summary generated successfully!', {
      description: 'Your meeting summary is ready',
      duration: 4000,
    });
    expect(result.current.summaryStatus).toBe('completed');
  });

  it('cancels summary generation and resets local summary status', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'api_cancel_summary') {
        return null;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { result } = renderSummaryHook();

    await act(async () => {
      await result.current.handleStopGeneration();
    });

    expect(mocks.stopSummaryPolling).toHaveBeenCalledWith('meeting-1');
    expect(result.current.summaryStatus).toBe('idle');
    expect(result.current.summaryError).toBeNull();
    expect(mocks.toastInfo).toHaveBeenCalledWith('Summary generation stopped', {
      description: 'You can generate a new summary anytime',
      duration: 3000,
    });
  });
});
