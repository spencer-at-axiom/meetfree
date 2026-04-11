'use client';

import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useRecordingState } from '@/contexts/RecordingStateContext';

interface RecordingFinalizeOverlayProps {
  sidebarCollapsed?: boolean;
}

export function RecordingFinalizeOverlay({ sidebarCollapsed = false }: RecordingFinalizeOverlayProps) {
  const { shutdownProgress, status, statusMessage } = useRecordingState();

  // Only show during finalization stages
  const shouldShow = status === 'stopping' || status === 'processing' || status === 'saving';

  if (!shouldShow) {
    return null;
  }

  // Map backend stages to human-readable messages
  const getStageMessage = () => {
    if (shutdownProgress) {
      switch (shutdownProgress.stage) {
        case 'stopping_audio':
          return 'Stopping audio capture...';
        case 'processing_transcripts':
          return 'Processing remaining transcript chunks...';
        case 'unloading_model':
          return 'Unloading speech recognition model...';
        case 'finalizing':
          return 'Finalizing recording and cleaning up resources...';
        case 'complete':
          return 'Recording stopped successfully';
        default:
          return shutdownProgress.message || 'Finalizing recording...';
      }
    }

    // Fallback to status message
    if (statusMessage) {
      return statusMessage;
    }

    // Default messages based on status
    switch (status) {
      case 'stopping':
        return 'Stopping recording...';
      case 'processing':
        return 'Processing transcripts...';
      case 'saving':
        return 'Saving meeting...';
      default:
        return 'Finalizing recording...';
    }
  };

  const progress = shutdownProgress?.progress ?? 0;
  const message = getStageMessage();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-4 left-0 right-0 z-50"
    >
      <div
        className="flex justify-center pl-8 transition-[margin] duration-300"
        style={{
          marginLeft: sidebarCollapsed ? '4rem' : '16rem'
        }}
      >
        <div className="w-2/3 max-w-[750px] flex justify-center">
          <div className="bg-white rounded-lg shadow-xl border border-gray-200 px-6 py-4 min-w-[400px]">
            <div className="space-y-3">
              {/* Message */}
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin flex-shrink-0" />
                <span className="text-sm font-medium text-gray-900">{message}</span>
              </div>

              {/* Progress Bar */}
              {progress > 0 && (
                <div className="space-y-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-blue-600 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">
                      {shutdownProgress?.stage === 'stopping_audio' && 'Step 1 of 4'}
                      {shutdownProgress?.stage === 'processing_transcripts' && 'Step 2 of 4'}
                      {shutdownProgress?.stage === 'unloading_model' && 'Step 3 of 4'}
                      {shutdownProgress?.stage === 'finalizing' && 'Step 4 of 4'}
                      {shutdownProgress?.stage === 'complete' && 'Complete'}
                    </span>
                    <span className="text-xs font-medium text-gray-700">{progress}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
