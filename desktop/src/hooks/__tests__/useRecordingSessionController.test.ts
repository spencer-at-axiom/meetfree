import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRec } from '../rec/useRec';
import { recordingService } from '@/services/recordingService';
import Analytics from '@/lib/analytics';

const mocks = vi.hoisted(() => {
  const readyReadiness = {
    status: 'ready' as const,
    can_record: true,
    provider: 'parakeet',
    model: 'general',
    has_microphone: true,
    has_system_audio: false,
    microphone_device: 'Test Mic',
    system_audio_device: null,
    platform_limitations: [],
    issues: [],
  };

  return {
    readyReadiness,
    push: vi.fn(),
    clearTranscripts: vi.fn(),
    setMeetingTitle: vi.fn(),
    flushBuffer: vi.fn(),
    refetchMeetings: vi.fn().mockResolvedValue(undefined),
    setCurrentMeeting: vi.fn(),
    setIsMeetingActive: vi.fn(),
    setStatus: vi.fn(),
    recordingState: {
      isRecording: false,
      isPaused: false,
      status: 'idle',
    },
    checkReadiness: vi.fn().mockResolvedValue(readyReadiness),
    startRecordingWithDevices: vi.fn().mockResolvedValue(undefined),
    stopAndFinalizeRecording: vi.fn(),
    pauseRecording: vi.fn().mockResolvedValue(undefined),
    resumeRecording: vi.fn().mockResolvedValue(undefined),
    onRecordingStoppedUnlisten: vi.fn(),
    onRecordingStopped: vi.fn(),
    recordingStoppedHandler: undefined as ((payload: RecordingStoppedPayload) => void) | undefined,
    toastInfo: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mocks.push,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    error: mocks.toastError,
    success: mocks.toastSuccess,
    dismiss: vi.fn(),
  },
}));

vi.mock('@/contexts/TranscriptContext', () => ({
  useTranscripts: () => ({
    clearTranscripts: mocks.clearTranscripts,
    setMeetingTitle: mocks.setMeetingTitle,
    transcriptsRef: { current: [] },
    flushBuffer: mocks.flushBuffer,
    meetingTitle: 'Test Meeting',
  }),
}));

vi.mock('@/contexts/MeetingsContext', () => ({
  useMeetings: () => ({
    setIsMeetingActive: mocks.setIsMeetingActive,
    refetchMeetings: mocks.refetchMeetings,
    setCurrentMeeting: mocks.setCurrentMeeting,
  }),
}));

vi.mock('@/contexts/ConfigContext', () => ({
  useConfig: () => ({
    transcriptModelConfig: {
      provider: 'parakeet',
      model: 'general',
      apiKey: null,
      hasStoredKey: false,
    },
    selectedDevices: {
      micDevice: 'Test Mic',
      systemDevice: null,
    },
  }),
}));

vi.mock('@/contexts/RecordingStateContext', () => ({
  useRecordingState: () => ({
    isRecording: mocks.recordingState.isRecording,
    isPaused: mocks.recordingState.isPaused,
    status: mocks.recordingState.status,
    setStatus: mocks.setStatus,
  }),
  RecordingStatus: {
    IDLE: 'idle',
    STARTING: 'starting',
    RECORDING: 'recording',
    STOPPING: 'stopping',
    PROCESSING_TRANSCRIPTS: 'processing',
    SAVING: 'saving',
    COMPLETED: 'completed',
    ERROR: 'error',
  },
}));

vi.mock('@/hooks/useRecordingReadiness', () => ({
  useRecordingReadiness: () => ({
    readinessState: 'ready',
    canRecord: true,
    readiness: mocks.readyReadiness,
    isChecking: false,
    error: null,
    checkReadiness: mocks.checkReadiness,
  }),
}));

vi.mock('@/services/recordingService', () => ({
  recordingService: {
    startRecordingWithDevices: mocks.startRecordingWithDevices,
    stopAndFinalizeRecording: mocks.stopAndFinalizeRecording,
    pauseRecording: mocks.pauseRecording,
    resumeRecording: mocks.resumeRecording,
    onRecordingStopped: vi.fn(async (callback: (payload: RecordingStoppedPayload) => void) => {
      mocks.recordingStoppedHandler = callback;
      mocks.onRecordingStopped(callback);
      return mocks.onRecordingStoppedUnlisten;
    }),
  },
}));

vi.mock('@/lib/analytics', () => ({
  default: {
    trackButtonClick: vi.fn(),
    trackMeetingCompleted: vi.fn().mockResolvedValue(undefined),
    updateMeetingCount: vi.fn().mockResolvedValue(undefined),
    getMeetingsCountToday: vi.fn().mockResolvedValue(0),
    calculateDaysSince: vi.fn().mockResolvedValue(1),
    track: vi.fn().mockResolvedValue(undefined),
    trackPageView: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(1),
    }),
  },
}));

let finalizedAtCounter = 0;

function createStopPayload(overrides: Partial<{
  meeting_id: string;
  meeting_title: string;
  transcript_count: number;
  duration_seconds: number;
  source_type: string;
  transcription_timed_out: boolean;
  finalized_at: string;
  save_error: string;
}> = {}) {
  finalizedAtCounter += 1;

  return {
    meeting_id: 'test-meeting-123',
    meeting_title: 'Test Meeting',
    transcript_count: 5,
    duration_seconds: 120,
    source_type: 'ui',
    transcription_timed_out: false,
    finalized_at: `2024-01-01T12:00:${String(finalizedAtCounter).padStart(2, '0')}Z`,
    ...overrides,
  };
}

describe('useRec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkReadiness.mockResolvedValue(mocks.readyReadiness);
    mocks.recordingStoppedHandler = undefined;
    mocks.recordingState.isRecording = false;
    mocks.recordingState.isPaused = false;
    mocks.recordingState.status = 'idle';
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('starts recording after a successful readiness check', async () => {
    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.start();
    });

    expect(mocks.checkReadiness).toHaveBeenCalled();
    expect(recordingService.startRecordingWithDevices).toHaveBeenCalledWith(
      'Test Mic',
      null,
      expect.stringMatching(/^Meeting /)
    );
  });

  it('blocks start when readiness reports unavailable system audio', async () => {
    mocks.checkReadiness.mockResolvedValueOnce({
      ...mocks.readyReadiness,
      status: 'system_audio_unavailable',
      can_record: false,
      issues: ['Selected system audio device is not available'],
    });

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.start();
    });

    expect(recordingService.startRecordingWithDevices).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('Selected system audio is unavailable', {
      description: 'Selected system audio device is not available',
      duration: 6000,
    });
  });

  it('deduplicates stop finalization with the same meeting and timestamp', async () => {
    const payload = createStopPayload({ finalized_at: '2024-01-01T12:00:00Z' });
    mocks.stopAndFinalizeRecording.mockResolvedValue(payload);

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.stop();
    });

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(mocks.refetchMeetings).toHaveBeenCalledTimes(1);
    });
  });

  it('deduplicates stop finalization across keyboard, tray, and route-change stop sources', async () => {
    const payload = createStopPayload({ finalized_at: '2024-01-01T12:00:09Z' });
    mocks.stopAndFinalizeRecording.mockResolvedValue(payload);

    const { result } = renderHook(() => useRec());

    await waitFor(() => {
      expect(recordingService.onRecordingStopped).toHaveBeenCalled();
    });

    await act(async () => {
      await result.current.stop();
    });

    await act(async () => {
      mocks.recordingStoppedHandler?.(payload);
    });

    await act(async () => {
      mocks.recordingStoppedHandler?.(payload);
    });

    await waitFor(() => {
      expect(mocks.refetchMeetings).toHaveBeenCalledTimes(1);
    });
  });

  it('processes stop finalization when timestamps differ', async () => {
    mocks.stopAndFinalizeRecording
      .mockResolvedValueOnce(createStopPayload({ finalized_at: '2024-01-01T12:00:01Z' }))
      .mockResolvedValueOnce(createStopPayload({ finalized_at: '2024-01-01T12:00:02Z' }));

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.stop();
    });

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(mocks.refetchMeetings).toHaveBeenCalledTimes(2);
    });
  });

  it('calls recordingService.pauseRecording when pause is called', async () => {
    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.pause();
    });

    expect(recordingService.pauseRecording).toHaveBeenCalledTimes(1);
    expect(Analytics.trackButtonClick).toHaveBeenCalledWith('pause_recording', 'controller');
  });

  it('calls recordingService.resumeRecording when rsm is called', async () => {
    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.rsm();
    });

    expect(recordingService.resumeRecording).toHaveBeenCalledTimes(1);
    expect(Analytics.trackButtonClick).toHaveBeenCalledWith('resume_recording', 'controller');
  });

  it('handles pause errors gracefully', async () => {
    mocks.pauseRecording.mockRejectedValueOnce(new Error('Pause failed'));

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.pause();
    });

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to pause recording', {
      description: 'Pause failed',
    });
  });

  it('handles resume errors gracefully', async () => {
    mocks.resumeRecording.mockRejectedValueOnce(new Error('Resume failed'));

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.rsm();
    });

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to resume recording', {
      description: 'Resume failed',
    });
  });

  it('tracks analytics after a successful stop', async () => {
    mocks.stopAndFinalizeRecording.mockResolvedValueOnce(
      createStopPayload({
        transcript_count: 10,
        duration_seconds: 300,
      })
    );

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(Analytics.trackMeetingCompleted).toHaveBeenCalledWith(
        'test-meeting-123',
        expect.objectContaining({
          duration_seconds: 300,
          transcript_segments: 10,
        })
      );
    });
  });

  it('shows an error when stop finalization returns no meeting id', async () => {
    mocks.stopAndFinalizeRecording.mockResolvedValueOnce(
      createStopPayload({
        meeting_id: '',
        save_error: 'Database error',
      })
    );

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to save meeting', {
        description: 'Database error',
      });
    });
  });

  it('shows a timeout warning when transcription timed out', async () => {
    mocks.stopAndFinalizeRecording.mockResolvedValueOnce(
      createStopPayload({
        transcription_timed_out: true,
      })
    );

    const { result } = renderHook(() => useRec());

    await act(async () => {
      await result.current.stop();
    });

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Recording saved successfully!',
        expect.objectContaining({
          description: expect.stringContaining('Transcription hit the shutdown timeout'),
        })
      );
    });
  });

  it('registers a listener for backend recording-stopped events', async () => {
    renderHook(() => useRec());

    await waitFor(() => {
      expect(recordingService.onRecordingStopped).toHaveBeenCalled();
    });
  });

  it('cleans up the backend recording-stopped listener on unmount', async () => {
    const { unmount } = renderHook(() => useRec());

    await waitFor(() => {
      expect(recordingService.onRecordingStopped).toHaveBeenCalled();
    });

    unmount();

    expect(mocks.onRecordingStoppedUnlisten).toHaveBeenCalled();
  });

  it('initializes with default controller state', () => {
    const { result } = renderHook(() => useRec());

    expect(result.current.isRec).toBe(false);
    expect(result.current.isDis).toBe(false);
    expect(result.current.isAuto).toBe(false);
  });

  it('uses recording context as the canonical isRecording source', () => {
    mocks.recordingState.isRecording = true;
    const { result } = renderHook(() => useRec());
    expect(result.current.isRec).toBe(true);
  });
});
