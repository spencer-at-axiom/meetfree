'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { recordingService } from '@/services/recordingService';

export enum RecordingStatus {
  IDLE = 'idle',
  STARTING = 'starting',
  RECORDING = 'recording',
  STOPPING = 'stopping',
  PROCESSING_TRANSCRIPTS = 'processing',
  SAVING = 'saving',
  COMPLETED = 'completed',
  ERROR = 'error'
}

interface ShutdownProgress {
  stage: 'stopping_audio' | 'processing_transcripts' | 'unloading_model' | 'finalizing' | 'complete';
  message: string;
  progress: number;
}

interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  isActive: boolean;
  recordingDuration: number | null;
  activeDuration: number | null;
  status: RecordingStatus;
  statusMessage?: string;
  shutdownProgress?: ShutdownProgress;
}

interface RecordingStateContextType extends RecordingState {
  setStatus: (status: RecordingStatus, message?: string) => void;
  hasCompletedInitialSync: boolean;
  isStopping: boolean;
  isProcessing: boolean;
  isSaving: boolean;
}

interface RecordingStatusSnapshot {
  status: RecordingStatus;
  isRecording: boolean;
  isPaused: boolean;
}

const RecordingStateContext = createContext<RecordingStateContextType | null>(null);
const RecordingStatusSnapshotContext = createContext<RecordingStatusSnapshot | null>(null);

export const useRecordingState = () => {
  const context = useContext(RecordingStateContext);
  if (!context) {
    throw new Error('useRecordingState must be used within a RecordingStateProvider');
  }
  return context;
};

export const useRecordingStatusSnapshot = () => {
  const context = useContext(RecordingStatusSnapshotContext);
  if (!context) {
    throw new Error('useRecordingStatusSnapshot must be used within a RecordingStateProvider');
  }
  return context;
};

export function RecordingStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    isActive: false,
    recordingDuration: null,
    activeDuration: null,
    status: RecordingStatus.IDLE,
    statusMessage: undefined,
    shutdownProgress: undefined,
  });
  const [hasCompletedInitialSync, setHasCompletedInitialSync] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const setStatus = useCallback((status: RecordingStatus, message?: string) => {
    setState((prev) => ({
      ...prev,
      status,
      statusMessage: message,
      shutdownProgress: [
        RecordingStatus.STOPPING,
        RecordingStatus.PROCESSING_TRANSCRIPTS,
        RecordingStatus.SAVING,
      ].includes(status)
        ? prev.shutdownProgress
        : undefined,
    }));
  }, []);

  const stopPolling = useCallback(() => {
    if (!pollingIntervalRef.current) {
      return;
    }

    clearInterval(pollingIntervalRef.current);
    pollingIntervalRef.current = null;
  }, []);

  const syncWithBackend = useCallback(async () => {
    try {
      const backendState = await recordingService.getRecordingState();

      setState((prev) => ({
        ...prev,
        isRecording: backendState.is_recording,
        isPaused: backendState.is_paused,
        isActive: backendState.is_active,
        recordingDuration: backendState.recording_duration,
        activeDuration: backendState.active_duration,
        status: backendState.is_recording
          ? (prev.status === RecordingStatus.IDLE ? RecordingStatus.RECORDING : prev.status)
          : (prev.status === RecordingStatus.RECORDING ? RecordingStatus.IDLE : prev.status),
      }));

      if (!backendState.is_recording) {
        stopPolling();
      }
    } catch (error) {
      console.error('[RecordingStateContext] Failed to sync with backend:', error);
    }
  }, [stopPolling]);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(() => {
      void syncWithBackend();
    }, 500);
  }, [syncWithBackend]);

  useEffect(() => {
    let isActive = true;
    const unsubscribers: Array<() => void> = [];

    const register = async () => {
      try {
        const unlistenStarted = await recordingService.onRecordingStarted(() => {
          setState((prev) => ({
            ...prev,
            isRecording: true,
            isPaused: false,
            isActive: true,
            status: RecordingStatus.RECORDING,
            shutdownProgress: undefined,
          }));
          startPolling();
        });
        if (!isActive) {
          unlistenStarted();
          return;
        }
        unsubscribers.push(unlistenStarted);

        const unlistenStopped = await recordingService.onRecordingStopped(() => {
          setState((prev) => {
            const newStatus = [
              RecordingStatus.STOPPING,
              RecordingStatus.PROCESSING_TRANSCRIPTS,
              RecordingStatus.SAVING,
            ].includes(prev.status)
              ? prev.status
              : RecordingStatus.STOPPING;

            return {
              ...prev,
              status: newStatus,
              statusMessage: newStatus === RecordingStatus.STOPPING ? 'Stopping recording...' : prev.statusMessage,
              isRecording: false,
              isPaused: false,
              isActive: false,
              recordingDuration: null,
              activeDuration: null,
            };
          });
          stopPolling();
        });
        if (!isActive) {
          unlistenStopped();
          return;
        }
        unsubscribers.push(unlistenStopped);

        const unlistenPaused = await recordingService.onRecordingPaused(() => {
          setState((prev) => ({
            ...prev,
            isPaused: true,
            isActive: false,
          }));
        });
        if (!isActive) {
          unlistenPaused();
          return;
        }
        unsubscribers.push(unlistenPaused);

        const unlistenResumed = await recordingService.onRecordingResumed(() => {
          setState((prev) => ({
            ...prev,
            isPaused: false,
            isActive: true,
          }));
        });
        if (!isActive) {
          unlistenResumed();
          return;
        }
        unsubscribers.push(unlistenResumed);

        const unlistenShutdownProgress = await recordingService.onRecordingShutdownProgress((progress) => {
          setState((prev) => ({
            ...prev,
            shutdownProgress: progress,
            statusMessage: progress.message,
          }));
        });
        if (!isActive) {
          unlistenShutdownProgress();
          return;
        }
        unsubscribers.push(unlistenShutdownProgress);
      } catch (error) {
        console.error('[RecordingStateContext] Failed to set up event listeners:', error);
      }
    };

    void register();

    return () => {
      isActive = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  useEffect(() => {
    const runInitialSync = async () => {
      try {
        await syncWithBackend();
        const isCurrentlyRecording = await recordingService.isRecording();
        if (isCurrentlyRecording) {
          startPolling();
        }
      } catch (error) {
        console.warn('[RecordingStateContext] Failed to check initial recording state:', error);
      } finally {
        setHasCompletedInitialSync(true);
      }
    };

    void runInitialSync();
  }, [startPolling, syncWithBackend]);

  const contextValue = useMemo(() => ({
    ...state,
    setStatus,
    hasCompletedInitialSync,
    isStopping: state.status === RecordingStatus.STOPPING,
    isProcessing: state.status === RecordingStatus.PROCESSING_TRANSCRIPTS,
    isSaving: state.status === RecordingStatus.SAVING,
  }), [state, setStatus, hasCompletedInitialSync]);

  const statusSnapshot = useMemo(
    () => ({
      status: state.status,
      isRecording: state.isRecording,
      isPaused: state.isPaused,
    }),
    [state.status, state.isRecording, state.isPaused]
  );

  return (
    <RecordingStatusSnapshotContext.Provider value={statusSnapshot}>
      <RecordingStateContext.Provider value={contextValue}>
        {children}
      </RecordingStateContext.Provider>
    </RecordingStatusSnapshotContext.Provider>
  );
}
