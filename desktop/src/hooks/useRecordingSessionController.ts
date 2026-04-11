import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useMeetings } from '@/contexts/MeetingsContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService, RecordingReadiness, RecordingStoppedPayload } from '@/services/recordingService';
import { ReadinessState, useRecordingReadiness } from '@/hooks/useRecordingReadiness';
import {
  buildFinalizationDedupeKey,
  calculateTranscriptWordCount,
  calculateWordsPerMinute,
  cleanupStaleFinalizationEntries,
  generateMeetingTitle,
  trimFinalizationCache,
} from '@/hooks/recordingSession/controllerUtils';
import Analytics from '@/lib/analytics';

// CRITICAL: Use Set for finalization deduplication to prevent memory leak
const finalizationCache = new Set<string>();

export interface UseRecordingSessionControllerReturn {
  // State
  isRecording: boolean;
  isRecordingDisabled: boolean;
  isAutoStarting: boolean;
  readinessState: ReadinessState;
  canRecord: boolean;
  readiness: RecordingReadiness | null;
  isCheckingReadiness: boolean;
  
  // Actions
  handleStart: () => Promise<void>;
  handleStop: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleResume: () => Promise<void>;
  refreshReadiness: () => Promise<RecordingReadiness | null>;
}

/**
 * Unified recording session controller.
 * Consolidates start, stop, pause, resume, routing, toasts, and dedupe logic.
 * 
 * Responsibilities:
 * - Start recording with device configuration and meeting title generation
 * - Stop recording with proper finalization and navigation
 * - Pause/resume recording
 * - Handle backend events (recording-stopped, recording-started, etc.)
 * - Deduplicate stop events
 * - Auto-start from sidebar
 * - Analytics tracking
 * - Toast notifications
 */
export function useRecordingSessionController(
  showModal?: (name: 'modelSelector', message?: string) => void
): UseRecordingSessionControllerReturn {
  const [isRecordingDisabled, setIsRecordingDisabled] = useState(false);
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const { clearTranscripts, setMeetingTitle, transcriptsRef, flushBuffer, meetingTitle } = useTranscripts();
  const { setIsMeetingActive, refetchMeetings, setCurrentMeeting } = useMeetings();
  const { selectedDevices, transcriptModelConfig } = useConfig();
  const recordingState = useRecordingState();
  const { setStatus } = recordingState;
  const router = useRouter();
  const micDeviceName = selectedDevices?.micDevice ?? null;
  const systemDeviceName = selectedDevices?.systemDevice ?? null;
  const transcriptProvider = transcriptModelConfig?.provider ?? 'parakeet';
  const transcriptModel = transcriptModelConfig?.model ?? '';
  const {
    readinessState,
    canRecord,
    readiness,
    isChecking,
    checkReadiness,
  } = useRecordingReadiness({
    enabled: !recordingState.isRecording,
    autoCheckDeps: [micDeviceName, systemDeviceName, transcriptProvider, transcriptModel],
  });

  const stopInProgressRef = useRef(false);
  const lastProcessedFinalizationKeyRef = useRef<string | null>(null);
  const isRecording = recordingState.isRecording;

  // Keep meeting activity aligned with canonical recording context state.
  useEffect(() => {
    setIsMeetingActive(recordingState.isRecording);
  }, [recordingState.isRecording, setIsMeetingActive]);

  // Re-enable recording controls when idle/error/completed
  useEffect(() => {
    if (
      recordingState.status === RecordingStatus.IDLE ||
      recordingState.status === RecordingStatus.ERROR ||
      recordingState.status === RecordingStatus.COMPLETED
    ) {
      setIsRecordingDisabled(false);
    }
  }, [recordingState.status]);

  // Cleanup finalization cache on unmount
  useEffect(() => {
    return () => {
      cleanupStaleFinalizationEntries(finalizationCache);
    };
  }, []);

  // Check if recording model is ready (provider-aware)
  const ensureRecordingModelReady = useCallback(async (analyticsSource: string): Promise<boolean> => {
    const readiness = await checkReadiness();

    if (!readiness) {
      toast.error('Unable to check recording readiness', {
        description: 'Please try again or check your configuration.',
        duration: 5000,
      });
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (readiness.status === 'model_downloading') {
      toast.info('Model download in progress', {
        description: 'Please wait for the transcription model to finish downloading before recording.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_downloading', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (readiness.status === 'missing_model') {
      toast.error('Transcription model not ready', {
        description: `Please download a ${readiness.provider} model before recording.`,
        duration: 5000,
      });
      if (showModal) {
        showModal('modelSelector', 'Transcription model setup required');
      }
      Analytics.trackButtonClick('start_recording_blocked_missing', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (readiness.status === 'missing_microphone') {
      toast.error('No microphone available', {
        description: 'Please connect a microphone device before recording.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_no_mic', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (readiness.status === 'system_audio_unavailable') {
      toast.error('Selected system audio is unavailable', {
        description: readiness.issues.join(', ') || 'Choose another system audio source or switch to microphone-only recording.',
        duration: 6000,
      });
      Analytics.trackButtonClick('start_recording_blocked_system_audio', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (readiness.status === 'configuration_error') {
      toast.error('Configuration error', {
        description: readiness.issues.join(', ') || 'Please check your recording configuration.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_config', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    if (!readiness.can_record) {
      toast.error('Cannot start recording', {
        description: readiness.issues.join(', ') || 'Recording is not ready.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_not_ready', analyticsSource);
      setStatus(RecordingStatus.IDLE);
      return false;
    }

    return true;
  }, [checkReadiness, setStatus, showModal]);

  const runRecordingStart = useCallback(async (analyticsSource: string) => {
    const modelReady = await ensureRecordingModelReady(analyticsSource);
    if (!modelReady) {
      return false;
    }

    const generatedMeetingTitle = generateMeetingTitle();
    setMeetingTitle(generatedMeetingTitle);
    setStatus(RecordingStatus.STARTING, 'Initializing recording...');

    await recordingService.startRecordingWithDevices(
      selectedDevices?.micDevice || null,
      selectedDevices?.systemDevice || null,
      generatedMeetingTitle
    );

    clearTranscripts();
    setIsMeetingActive(true);
    Analytics.trackButtonClick('start_recording', analyticsSource);
    return true;
  }, [
    clearTranscripts,
    ensureRecordingModelReady,
    selectedDevices,
    setIsMeetingActive,
    setMeetingTitle,
    setStatus,
  ]);

  const handleStartFailure = useCallback((error: unknown, analyticsSource: string, fallbackMessage: string) => {
    setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : fallbackMessage);
    Analytics.trackButtonClick('start_recording_error', analyticsSource);
  }, [setStatus]);

  const handleStart = useCallback(async () => {
    try {
      await runRecordingStart('controller');
    } catch (error) {
      handleStartFailure(error, 'controller', 'Failed to start recording');
      toast.error('Failed to start recording', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [handleStartFailure, runRecordingStart]);

  const handleStopFinalization = useCallback(async (payload: RecordingStoppedPayload) => {
    if (stopInProgressRef.current) {
      return;
    }

    stopInProgressRef.current = true;
    try {
      const dedupeKey = buildFinalizationDedupeKey(
        payload.meeting_id,
        payload.finalized_at
      );
      
      // Deduplicate finalization events
      if (
        lastProcessedFinalizationKeyRef.current === dedupeKey ||
        finalizationCache.has(dedupeKey)
      ) {
        return;
      }
      
      lastProcessedFinalizationKeyRef.current = dedupeKey;
      finalizationCache.add(dedupeKey);
      trimFinalizationCache(finalizationCache);

      setStatus(RecordingStatus.STOPPING, 'Stopping recording...');
      setIsRecordingDisabled(true);

      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Finalizing recording...');
      flushBuffer();
      await new Promise((resolve) => setTimeout(resolve, 250));

      if (!payload.meeting_id) {
        throw new Error(payload.save_error || 'Meeting finalization returned no meeting ID');
      }

      const meetingId = payload.meeting_id;
      const meetingName = payload.meeting_title || meetingTitle || 'New Meeting';
      const transcriptCount = payload.transcript_count ?? transcriptsRef.current.length;

      setStatus(RecordingStatus.SAVING, 'Refreshing meeting library...');
      await refetchMeetings();
      setCurrentMeeting({ id: meetingId, title: meetingName });
      setStatus(RecordingStatus.COMPLETED);

      toast.success('Recording saved successfully!', {
        description: payload.transcription_timed_out
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
        const durationSeconds = payload.duration_seconds || 0;
        const transcriptWordCount = calculateTranscriptWordCount(freshTranscripts);
        const wordsPerMinute = calculateWordsPerMinute(
          transcriptWordCount,
          durationSeconds
        );
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
      }, 1200);
    } catch (error) {
      setIsMeetingActive(false);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
      setIsRecordingDisabled(false);
      toast.error('Failed to save meeting', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      stopInProgressRef.current = false;
    }
  }, [
    setStatus,
    flushBuffer,
    meetingTitle,
    transcriptsRef,
    refetchMeetings,
    setCurrentMeeting,
    setIsMeetingActive,
    router,
    clearTranscripts,
  ]);

  const handleStop = useCallback(async () => {
    try {
      setStatus(RecordingStatus.STOPPING, 'Stopping recording...');
      const result = await recordingService.stopAndFinalizeRecording();
      await handleStopFinalization(result);
    } catch (error) {
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Failed to stop recording');
      setIsRecordingDisabled(false);
      toast.error('Failed to stop recording', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, [handleStopFinalization, setStatus]);

  const handlePause = useCallback(async () => {
    try {
      await recordingService.pauseRecording();
      Analytics.trackButtonClick('pause_recording', 'controller');
    } catch (error) {
      toast.error('Failed to pause recording', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await recordingService.resumeRecording();
      Analytics.trackButtonClick('resume_recording', 'controller');
    } catch (error) {
      toast.error('Failed to resume recording', {
        description: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, []);

  // Listen for backend recording-stopped events (from tray/global shortcuts)
  useEffect(() => {
    let isActive = true;
    let cleanup: (() => void) | undefined;

    const setupListener = async () => {
      const unlisten = await recordingService.onRecordingStopped((payload) => {
        console.log('[Controller] Received recording-stopped event from backend:', payload);
        handleStopFinalization(payload);
      });
      
      if (!isActive) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    };

    void setupListener();

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, [handleStopFinalization]);

  // Auto-start from sidebar via sessionStorage flag
  useEffect(() => {
    const checkAutoStartRecording = async () => {
      if (typeof window !== 'undefined') {
        const shouldAutoStart = sessionStorage.getItem('autoStartRecording');
        if (shouldAutoStart === 'true' && !isRecording && !isAutoStarting) {
          setIsAutoStarting(true);
          sessionStorage.removeItem('autoStartRecording');

          try {
            await runRecordingStart('sidebar_auto');
          } catch (error) {
            handleStartFailure(error, 'sidebar_auto', 'Failed to auto-start recording');
            toast.error('Failed to start recording', {
              description: error instanceof Error ? error.message : 'Unknown error occurred',
            });
          } finally {
            setIsAutoStarting(false);
          }
        }
      }
    };

    checkAutoStartRecording();
  }, [isRecording, isAutoStarting, runRecordingStart, handleStartFailure]);

  // Listen for direct recording trigger from sidebar when already on home page
  useEffect(() => {
    const handleDirectStart = async () => {
      if (isRecording || isAutoStarting) {
        return;
      }

      setIsAutoStarting(true);

      try {
        await runRecordingStart('sidebar_direct');
      } catch (error) {
        handleStartFailure(error, 'sidebar_direct', 'Failed to start recording from sidebar');
        toast.error('Failed to start recording', {
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      } finally {
        setIsAutoStarting(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', handleDirectStart);

    return () => {
      window.removeEventListener('start-recording-from-sidebar', handleDirectStart);
    };
  }, [isRecording, isAutoStarting, runRecordingStart, handleStartFailure]);

  return {
    isRecording,
    isRecordingDisabled,
    isAutoStarting,
    readinessState,
    canRecord,
    readiness,
    isCheckingReadiness: isChecking,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    refreshReadiness: checkReadiness,
  };
}
