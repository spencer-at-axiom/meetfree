'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useGlobalRecordingController } from '@/contexts/RecordingSessionControllerProvider';
import { useModalState } from '@/hooks/useModalState';
import { useRecordPageRecovery } from '@/hooks/useRecordPageRecovery';
import { useRecordingKeyboardShortcut } from '@/hooks/useRecordingKeyboardShortcut';
import Analytics from '@/lib/analytics';
import { SettingsModals } from '@/app/_components/SettingsModal';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { ActiveRecording } from './ActiveRecording';
import { RecordingFinalizeOverlay } from './RecordingFinalizeOverlay';
import { RecordingReadyView } from './RecordingReadyView';
import { RecordingTranscriptPane } from './RecordingTranscriptPane';

export function RecordPage() {
  const { transcriptModelConfig } = useConfig();
  const recordingState = useRecordingState();
  const { status, isStopping, isProcessing, hasCompletedInitialSync, isRecording } = recordingState;
  const { modals, messages, showModal, hideModal } = useModalState(transcriptModelConfig);
  const {
    isRecordingDisabled,
    readinessState,
    canRecord,
    readiness,
    handleStart,
    handleStop,
    handlePause,
    handleResume,
    registerShowModal,
  } = useGlobalRecordingController();

  useEffect(() => {
    Analytics.trackPageView('home');
  }, []);

  useEffect(() => {
    return registerShowModal(showModal);
  }, [registerShowModal, showModal]);

  useRecordingKeyboardShortcut({
    isRecording,
    isRecordingDisabled,
    onStart: handleStart,
    onStop: handleStop,
  });

  const { recoveryDialogProps } = useRecordPageRecovery({
    hasCompletedInitialSync,
    isRecording,
    status,
  });

  const isProcessingStop = status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex h-full flex-col bg-gray-50/50"
    >
      <SettingsModals
        modals={modals}
        messages={messages}
        onClose={hideModal}
      />

      <TranscriptRecovery {...recoveryDialogProps} />

      {isRecording ? (
        <ActiveRecording
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
        >
          <RecordingTranscriptPane
            isProcessingStop={isProcessingStop}
            isStopping={isStopping}
          />
        </ActiveRecording>
      ) : (
        <RecordingReadyView
          onStartRecording={handleStart}
          readinessState={readinessState}
          readiness={readiness}
          canRecord={canRecord}
          isDisabled={isRecordingDisabled}
        />
      )}

      <RecordingFinalizeOverlay sidebarCollapsed={false} />
    </motion.div>
  );
}
