import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import Analytics from '@/lib/analytics';

type SummaryStatus = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';

interface RecordingStoppedPayload {
  message: string;
  folder_path?: string;
  meeting_name?: string;
  meeting_id?: string;
  transcript_count?: number;
  transcription_timed_out?: boolean;
  save_error?: string;
}

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void
): UseRecordingStopReturn {
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript
  } = recordingState;

  const {
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setIsMeetingActive,
  } = useSidebar();

  const router = useRouter();

  const stopInProgressRef = useRef(false);
  const recordingStoppedPayloadRef = useRef<RecordingStoppedPayload | null>(null);
  const payloadWaitersRef = useRef<Array<(payload: RecordingStoppedPayload) => void>>([]);

  useEffect(() => {
    let unlistenStopped: (() => void) | undefined;
    let unlistenStarted: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        unlistenStopped = await listen<RecordingStoppedPayload>('recording-stopped', (event) => {
          const payload = event.payload;
          recordingStoppedPayloadRef.current = payload;

          const waiters = [...payloadWaitersRef.current];
          payloadWaitersRef.current = [];
          waiters.forEach((resolve) => resolve(payload));
        });

        unlistenStarted = await listen('recording-started', () => {
          recordingStoppedPayloadRef.current = null;
          payloadWaitersRef.current = [];
        });
      } catch (error) {
        console.error('Failed to setup recording stop listeners:', error);
      }
    };

    setupListeners();

    return () => {
      unlistenStopped?.();
      unlistenStarted?.();
    };
  }, []);

  const waitForRecordingStoppedPayload = useCallback((): Promise<RecordingStoppedPayload> => {
    if (recordingStoppedPayloadRef.current) {
      return Promise.resolve(recordingStoppedPayloadRef.current);
    }

    return new Promise((resolve, reject) => {
      const waiter = (payload: RecordingStoppedPayload) => {
        window.clearTimeout(timeoutId);
        payloadWaitersRef.current = payloadWaitersRef.current.filter((candidate) => candidate !== waiter);
        resolve(payload);
      };

      const timeoutId = window.setTimeout(() => {
        payloadWaitersRef.current = payloadWaitersRef.current.filter((candidate) => candidate !== waiter);
        reject(new Error('Timed out waiting for recording completion from the backend'));
      }, 5000);

      payloadWaitersRef.current.push(waiter);
    });
  }, []);

  const handleRecordingStop = useCallback(async (isCallApi: boolean) => {
    if (stopInProgressRef.current) {
      return;
    }
    stopInProgressRef.current = true;

    try {
      if (!isCallApi) {
        throw new Error('Failed to stop recording');
      }

      setStatus(RecordingStatus.STOPPING, 'Stopping recording...');
      setIsRecording(false);
      setIsRecordingDisabled(true);

      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Finalizing recording...');
      const stopPayload = await waitForRecordingStoppedPayload();

      flushBuffer();
      await new Promise((resolve) => setTimeout(resolve, 250));

      const meetingId = stopPayload.meeting_id;
      const meetingName = stopPayload.meeting_name || meetingTitle || 'New Meeting';
      const transcriptCount = stopPayload.transcript_count ?? transcriptsRef.current.length;

      if (!meetingId) {
        throw new Error(stopPayload.save_error || 'Meeting save completed without returning an ID');
      }

      setStatus(RecordingStatus.SAVING, 'Refreshing meeting library...');
      await markMeetingAsSaved();
      await refetchMeetings();
      setCurrentMeeting({ id: meetingId, title: meetingName });
      setStatus(RecordingStatus.COMPLETED);

      toast.success('Recording saved successfully!', {
        description: stopPayload.transcription_timed_out
          ? `${transcriptCount} transcript segments saved. Transcription hit the shutdown timeout, so some late segments may be missing.`
          : `${transcriptCount} transcript segments saved.`,
        action: {
          label: 'View Meeting',
          onClick: () => {
            router.push(`/meeting-details?id=${meetingId}`);
            Analytics.trackButtonClick('view_meeting_from_toast', 'recording_complete');
          }
        },
        duration: 10000,
      });

      try {
        const freshTranscripts = [...transcriptsRef.current];
        let durationSeconds = 0;
        if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
          const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
          durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
        }

        const transcriptWordCount = freshTranscripts
          .map(t => t.text.split(/\s+/).length)
          .reduce((a, b) => a + b, 0);

        const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;
        const meetingsToday = await Analytics.getMeetingsCountToday();

        await Analytics.trackMeetingCompleted(meetingId, {
          duration_seconds: durationSeconds,
          transcript_segments: transcriptCount,
          transcript_word_count: transcriptWordCount,
          words_per_minute: wordsPerMinute,
          meetings_today: meetingsToday
        });

        await Analytics.updateMeetingCount();

        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('analytics.json');
        const totalMeetings = await store.get<number>('total_meetings');

        if (totalMeetings === 1) {
          const daysSinceInstall = await Analytics.calculateDaysSince('first_launch_date');
          await Analytics.track('user_activated', {
            meetings_count: '1',
            days_since_install: daysSinceInstall?.toString() || 'null',
            first_meeting_duration_seconds: durationSeconds.toString()
          });
        }
      } catch (analyticsError) {
        console.error('Failed to track meeting completion analytics:', analyticsError);
      }

      setIsMeetingActive(false);
      setIsRecordingDisabled(false);

      setTimeout(() => {
        router.push(`/meeting-details?id=${meetingId}&source=recording`);
        clearTranscripts();
        Analytics.trackPageView('meeting_details');
        setStatus(RecordingStatus.IDLE);
      }, 2000);
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      if (isCallApi) {
        setIsMeetingActive(false);
      }
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
      setIsRecordingDisabled(false);

      if (isCallApi) {
        toast.error('Failed to save meeting', {
          description: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } finally {
      recordingStoppedPayloadRef.current = null;
      stopInProgressRef.current = false;
    }
  }, [
    setStatus,
    setIsRecording,
    setIsRecordingDisabled,
    waitForRecordingStoppedPayload,
    flushBuffer,
    meetingTitle,
    transcriptsRef,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    setIsMeetingActive,
    router,
    clearTranscripts,
  ]);

  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    (window as Window & { handleRecordingStop?: (callApi?: boolean) => void }).handleRecordingStop = (callApi: boolean = true) => {
      handleRecordingStopRef.current(callApi);
    };

    return () => {
      delete (window as Window & { handleRecordingStop?: (callApi?: boolean) => void }).handleRecordingStop;
    };
  }, []);

  const summaryStatus: SummaryStatus = status === RecordingStatus.PROCESSING_TRANSCRIPTS ? 'processing' : 'idle';

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
