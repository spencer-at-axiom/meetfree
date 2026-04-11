'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useMeetings } from '@/contexts/MeetingsContext';
import { RecordingStatus } from '@/contexts/RecordingStateContext';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';

interface UseRecordPageRecoveryProps {
  hasCompletedInitialSync: boolean;
  isRecording: boolean;
  status: RecordingStatus;
}

const FINALIZING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.STOPPING,
  RecordingStatus.PROCESSING_TRANSCRIPTS,
  RecordingStatus.SAVING,
]);

export function useRecordPageRecovery({
  hasCompletedInitialSync,
  isRecording,
  status,
}: UseRecordPageRecoveryProps) {
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const { refetchMeetings } = useMeetings();
  const router = useRouter();
  const {
    recoverableMeetings,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  } = useTranscriptRecovery();

  useEffect(() => {
    if (!hasCompletedInitialSync || isRecording || FINALIZING_STATUSES.has(status)) {
      return;
    }

    const performStartupChecks = async () => {
      try {
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (_error) {
          // Non-critical cleanup operation - continue startup
        }

        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (_error) {
          // Non-critical cleanup operation - continue startup
        }

        await checkForRecoverableTranscripts();
      } catch (_error) {
        // Recovery checks are non-blocking for the record page
      }
    };

    void performStartupChecks();
  }, [checkForRecoverableTranscripts, hasCompletedInitialSync, isRecording, status]);

  useEffect(() => {
    if (recoverableMeetings.length === 0) {
      return;
    }

    const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
    if (!shownThisSession) {
      setShowRecoveryDialog(true);
      sessionStorage.setItem('recovery_dialog_shown', 'true');
    }
  }, [recoverableMeetings]);

  const handleRecovery = useCallback(async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (!result.success) {
        return;
      }

      toast.success('Meeting recovered successfully!', {
        description: result.audioRecoveryStatus?.status === 'success'
          ? 'Transcripts and audio recovered'
          : 'Transcripts recovered (no audio available)',
        action: result.meetingId ? {
          label: 'View Meeting',
          onClick: () => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          },
        } : undefined,
        duration: 10000,
      });

      await refetchMeetings();

      const hasRemainingMeetings = recoverableMeetings.some(
        (recoverableMeeting) => recoverableMeeting.meetingId !== meetingId
      );
      if (!hasRemainingMeetings) {
        sessionStorage.removeItem('recovery_dialog_shown');
      }

      if (result.meetingId) {
        setTimeout(() => {
          router.push(`/meeting-details?id=${result.meetingId}`);
        }, 2000);
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  }, [recoverMeeting, recoverableMeetings, refetchMeetings, router]);

  const handleDialogClose = useCallback(() => {
    setShowRecoveryDialog(false);
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  }, [recoverableMeetings.length]);

  return {
    recoveryDialogProps: {
      isOpen: showRecoveryDialog,
      onClose: handleDialogClose,
      recoverableMeetings,
      onRecover: handleRecovery,
      onDelete: deleteRecoverableMeeting,
      onLoadPreview: loadMeetingTranscripts,
    },
  };
}
