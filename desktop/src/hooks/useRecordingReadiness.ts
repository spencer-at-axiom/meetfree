import { useState, useEffect, useCallback, type DependencyList } from 'react';
import { recordingService, RecordingReadiness } from '@/services/recordingService';

export type ReadinessState = 
  | 'ready'
  | 'missing_model'
  | 'model_downloading'
  | 'missing_microphone'
  | 'system_audio_unavailable'
  | 'configuration_error'
  | 'checking';

export interface UseRecordingReadinessReturn {
  readinessState: ReadinessState;
  canRecord: boolean;
  readiness: RecordingReadiness | null;
  isChecking: boolean;
  error: string | null;
  checkReadiness: () => Promise<RecordingReadiness | null>;
}

interface UseRecordingReadinessOptions {
  autoCheckDeps?: DependencyList;
  enabled?: boolean;
}

/**
 * Hook for checking recording readiness status.
 * Translates backend readiness into UI-friendly states.
 * 
 * States:
 * - ready: All systems go, user can start recording
 * - missing_model: Transcription model not configured or not available
 * - model_downloading: Transcription model is currently downloading
 * - missing_microphone: No microphone device available
 * - system_audio_unavailable: System audio not available (may be platform limitation)
 * - configuration_error: Configuration issue preventing recording
 * - checking: Currently checking readiness status
 */
export function useRecordingReadiness({
  autoCheckDeps = [],
  enabled = true,
}: UseRecordingReadinessOptions = {}): UseRecordingReadinessReturn {
  const [readiness, setReadiness] = useState<RecordingReadiness | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkReadiness = useCallback(async (): Promise<RecordingReadiness | null> => {
    setIsChecking(true);
    setError(null);

    try {
      const result = await recordingService.getRecordingReadiness();
      setReadiness(result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check recording readiness';
      setError(errorMessage);
      setReadiness(null);
      console.error('[useRecordingReadiness] Failed to check readiness:', err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check readiness on mount and whenever its recording dependencies change
  useEffect(() => {
    if (!enabled) {
      return;
    }

    void checkReadiness();
  }, [checkReadiness, enabled, ...autoCheckDeps]);

  const readinessState: ReadinessState = isChecking 
    ? 'checking' 
    : readiness?.status || 'configuration_error';

  const canRecord = readiness?.can_record ?? false;

  return {
    readinessState,
    canRecord,
    readiness,
    isChecking,
    error,
    checkReadiness,
  };
}
