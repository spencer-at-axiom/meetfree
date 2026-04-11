import React, { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Mic, Sparkles, Check, Loader2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePlatform } from '@/hooks/usePlatform';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';

type DownloadStatus = 'waiting' | 'downloading' | 'completed' | 'error';

interface DownloadState {
  status: DownloadStatus;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  error?: string;
}

export function DownloadProgressStep() {
  const {
    goNext,
    selectedSummaryModel,
    setSelectedSummaryModel,
    parakeetDownloaded,
    setParakeetDownloaded,
    summaryModelDownloaded,
    setSummaryModelDownloaded,
    startBackgroundDownloads,
    completeOnboarding,
  } = useOnboarding();

  const platform = usePlatform();
  const isMac = platform === 'macos';
  const [recommendedModel, setRecommendedModel] = useState<string>('gemma3:1b');

  const [parakeetState, setParakeetState] = useState<DownloadState>({
    status: parakeetDownloaded ? 'completed' : 'waiting',
    progress: parakeetDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: 670,
    speedMbps: 0,
  });

  const [gemmaState, setGemmaState] = useState<DownloadState>({
    status: summaryModelDownloaded ? 'completed' : 'waiting',
    progress: summaryModelDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: 806, // 1b model size
    speedMbps: 0,
  });

  const [isCompleting, setIsCompleting] = useState(false);
  const downloadStartedRef = useRef(false);
  const retryingRef = useRef(false);
  const retryingSummaryRef = useRef(false);

  // Retry download handler
  const handleRetryDownload = async () => {
    // Prevent multiple simultaneous retries
    if (retryingRef.current) {
      console.log('[DownloadProgressStep] Retry already in progress, ignoring');
      return;
    }

    console.log('[DownloadProgressStep] Retrying Parakeet download');
    retryingRef.current = true;

    // Reset error state
    setParakeetState((prev) => ({
      ...prev,
      status: 'waiting',
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      speedMbps: 0,
    }));

    try {
      await invoke('parakeet_retry_download', { modelName: PARAKEET_MODEL });
      // Progress events will update state
    } catch (error) {
      console.error('[DownloadProgressStep] Retry failed:', error);
      setParakeetState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Retry failed',
      }));

      toast.error('Download retry failed', {
        description: 'Please check your connection and try again.',
      });
    } finally {
      // Allow retry again after 2 seconds
      setTimeout(() => {
        retryingRef.current = false;
      }, 2000);
    }
  };

  // Retry Ollama model download handler
  const handleRetrySummaryDownload = async () => {
    // Prevent multiple simultaneous retries
    if (retryingSummaryRef.current) {
      console.log('[DownloadProgressStep] Summary retry already in progress, ignoring');
      return;
    }

    console.log('[DownloadProgressStep] Retrying Ollama model download');
    retryingSummaryRef.current = true;

    // Reset error state
    setGemmaState((prev) => ({
      ...prev,
      status: 'downloading',
      error: undefined,
      progress: 0,
      downloadedMb: 0,
      speedMbps: 0,
    }));

    try {
      // Call Ollama pull command
      await invoke('pull_ollama_model', { modelName: selectedSummaryModel || recommendedModel });
    } catch (error) {
      console.error('[DownloadProgressStep] Summary retry failed:', error);
      setGemmaState((prev) => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Retry failed',
      }));

      toast.error('Ollama model download retry failed', {
        description: 'Please check your connection and try again.',
      });
    } finally {
      // Allow retry again after 2 seconds
      setTimeout(() => {
        retryingSummaryRef.current = false;
      }, 2000);
    }
  };

  // Fetch recommended Ollama model on mount
  useEffect(() => {
    const fetchRecommendation = async () => {
      try {
        // Use a recommended Ollama model for local summaries
        const model = 'gemma3:1b'; // Default recommended model
        setRecommendedModel(model);
        setSelectedSummaryModel(model);  // Update context
      } catch (error) {
        console.error('Failed to get recommended model:', error);
        // Keep default gemma3:1b
      }
    };

    fetchRecommendation();
  }, []);

  // Start downloads on mount
  useEffect(() => {
    if (downloadStartedRef.current) return;
    downloadStartedRef.current = true;

    startDownloads();
  }, []);

  // Listen to Parakeet download progress
  useEffect(() => {
    const unlistenProgress = listen<{
      modelName: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status?: string;
    }>('parakeet-model-download-progress', (event) => {
      const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      if (modelName === PARAKEET_MODEL) {
        setParakeetState((prev) => ({
          ...prev,
          status: status === 'completed' ? 'completed' : 'downloading',
          progress,
          downloadedMb: downloaded_mb ?? prev.downloadedMb,
          totalMb: total_mb ?? prev.totalMb,
          speedMbps: speed_mbps ?? prev.speedMbps,
        }));

        if (status === 'completed' || progress >= 100) {
          setParakeetDownloaded(true);
        }
      }
    });

    const unlistenComplete = listen<{ modelName: string }>(
      'parakeet-model-download-complete',
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({ ...prev, status: 'completed', progress: 100 }));
          setParakeetDownloaded(true);
        }
      }
    );

    const unlistenError = listen<{ modelName: string; error: string }>(
      'parakeet-model-download-error',
      (event) => {
        if (event.payload.modelName === PARAKEET_MODEL) {
          setParakeetState((prev) => ({
            ...prev,
            status: 'error',
            error: event.payload.error,
          }));
        }
      }
    );

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  // Listen to Ollama model download progress (always downloading for Ollama)
  useEffect(() => {
    const unlisten = listen<{
      model: string;
      progress: number;
      downloaded_mb?: number;
      total_mb?: number;
      speed_mbps?: number;
      status: string;
      error?: string;
    }>('ollama-model-download-progress', (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status, error } = event.payload;
      if (model === selectedSummaryModel || model === 'gemma3:1b' || model === 'gemma3:4b') {
        setGemmaState((prev) => ({
          ...prev,
          status: status === 'completed'
            ? 'completed'
            : status === 'error'
            ? 'error'
            : 'downloading',
          progress,
          downloadedMb: downloaded_mb ?? prev.downloadedMb,
          totalMb: total_mb ?? prev.totalMb,
          speedMbps: speed_mbps ?? prev.speedMbps,
          error: status === 'error' ? error : undefined,
        }));

        if (status === 'completed' || progress >= 100) {
          setSummaryModelDownloaded(true);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [selectedSummaryModel]);

  const startDownloads = async () => {
    // Always download both Parakeet and Gemma (system-recommended)
    if (!parakeetDownloaded || !summaryModelDownloaded) {
      try {
        if (!parakeetDownloaded) {
          setParakeetState((prev) => ({ ...prev, status: 'downloading' }));
        }
        if (!summaryModelDownloaded) {
          setGemmaState((prev) => ({ ...prev, status: 'downloading' }));
        }
        await startBackgroundDownloads(true);  // Always download both
      } catch (error) {
        console.error('Failed to start downloads:', error);
        if (!parakeetDownloaded) {
          setParakeetState((prev) => ({ ...prev, status: 'error', error: String(error) }));
        }
      }
    }
  };

  const handleContinue = async () => {
    // Verify actual model availability (catches state drift)
    try {
      await invoke('parakeet_init');
      const actuallyAvailable = await invoke<boolean>('parakeet_has_available_models');

      if (actuallyAvailable && !parakeetDownloaded) {
        console.log('[DownloadProgressStep] Model available but state not updated');
        setParakeetDownloaded(true);
        setParakeetState((prev) => ({
          ...prev,
          status: 'completed',
          progress: 100,
        }));
      } else if (!actuallyAvailable && parakeetState.status === 'error') {
        toast.error('Transcription engine required', {
          description: 'Please retry the download before continuing.',
        });
        return;
      }
    } catch (error) {
      console.warn('[DownloadProgressStep] Failed to verify model:', error);
    }

    // Check if downloads are complete for toast notification
    const downloadsComplete = parakeetState.status === 'completed' &&
      gemmaState.status === 'completed';

    // Show toast if downloads still in progress
    if (!downloadsComplete) {
      toast.info('Downloads will continue in the background', {
        description: 'Recording is ready now. Local summaries will unlock after the Summary Engine finishes downloading.',
        duration: 5000,
      });
    }

    if (isMac) {
      // macOS: Go to Permissions step (will complete after permissions granted)
      goNext();
    } else {
      // Non-macOS: Complete onboarding immediately (downloads continue in background)
      setIsCompleting(true);
      try {
        await completeOnboarding();

        // Small delay to ensure state is saved before reload
        await new Promise(resolve => setTimeout(resolve, 100));

        window.location.reload();
      } catch (error) {
        console.error('Failed to complete onboarding:', error);
        toast.error('Failed to complete setup', {
          description: 'Please try again.',
        });
        setIsCompleting(false);
      }
    }
  };

  const renderDownloadCard = (
    title: string,
    icon: React.ReactNode,
    state: DownloadState,
    modelSize: string,
    badgeLabel: string
  ) => (
    <div className="rounded-3xl border border-gray-200 bg-white p-[18px] shadow-sm">
      <div className="mb-3.5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-gray-900 sm:text-[14px]">{title}</h3>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                {badgeLabel}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-gray-500">{modelSize}</p>
          </div>
        </div>
        <div>
          {state.status === 'waiting' && (
            <span className="text-[12px] text-gray-500">Waiting...</span>
          )}
          {state.status === 'downloading' && (
            <Loader2 className="w-5 h-5 text-gray-700 animate-spin" />
          )}
          {state.status === 'completed' && (
            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-4 h-4 text-green-600" />
            </div>
          )}
          {state.status === 'error' && (
            <span className="text-sm text-red-500">Failed</span>
          )}
        </div>
      </div>

      {(state.status === 'downloading' || state.status === 'completed') && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gray-700 to-gray-900 transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-gray-600">
              {state.downloadedMb.toFixed(1)} MB / {state.totalMb.toFixed(1)} MB
            </span>
            <div className="flex items-center gap-2">
              {state.speedMbps > 0 && (
                <span className="text-gray-500">
                  {state.speedMbps.toFixed(1)} MB/s
                </span>
              )}
              <span className="font-semibold text-gray-900">
                {Math.round(state.progress)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {state.status === 'error' && state.error && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-[12px] font-medium text-red-600">Download Error</p>
          <p className="mt-1 text-[11px] text-red-500">{state.error}</p>
          {(title === 'Transcription Engine' || title === 'Summary Engine') && (
            <button
              onClick={title === 'Transcription Engine' ? handleRetryDownload : handleRetrySummaryDownload}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-[12px] font-medium text-white transition-colors hover:bg-gray-800"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <OnboardingContainer
      title="Download Local Engines"
      step={2}
      totalSteps={isMac ? 3 : 2}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="w-full space-y-4">
          {renderDownloadCard(
            'Transcription Engine',
            <Mic className="w-5 h-5 text-gray-600" />,
            parakeetState,
            '~670 MB',
            'Required'
          )}

          {renderDownloadCard(
            'Summary Engine',
            <Sparkles className="w-5 h-5 text-gray-600" />,
            gemmaState,
            recommendedModel === 'gemma3:4b' ? '~2.5 GB' : '~806 MB',
            'Optional'
          )}
        </div>

        <AnimatePresence>
          {parakeetDownloaded && !summaryModelDownloaded && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-[12px] text-emerald-900"
            >
              <div className="flex items-start gap-3">
                <Download className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-700" />
                <div>
                  <p className="font-medium">You can continue while summaries finish downloading</p>
                  <p className="mt-1 text-emerald-800/90">
                    Recording is ready. Local summaries will become available when this download completes.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full max-w-sm">
          <Button
            onClick={handleContinue}
            disabled={!parakeetDownloaded || isCompleting}
            className="h-10.5 w-full rounded-xl bg-gray-950 text-[13px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {(isCompleting || !parakeetDownloaded) ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              isMac ? 'Continue to permissions' : 'Finish setup'
            )}
          </Button>
        </div>
      </div>
    </OnboardingContainer>
  );
}
