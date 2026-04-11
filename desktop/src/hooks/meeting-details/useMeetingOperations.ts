import { useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { MeetingDetails } from '@/types/meeting';
import { exportMeeting, startDiarization } from '@/services/exportService';
import type { ExportFormat } from '@/types/export';

interface UseMeetingOperationsProps {
  meeting: MeetingDetails;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

export function useMeetingOperations({
  meeting,
}: UseMeetingOperationsProps) {

  // Open meeting folder in file explorer
  const handleOpenMeetingFolder = useCallback(async () => {
    try {
      await invokeTauri('meeting_folder_open', { meetingId: meeting.id });
    } catch (error) {
      console.error('Failed to open meeting folder:', error);
      toast.error('Failed to open recording folder', {
        description: getErrorMessage(error),
      });
    }
  }, [meeting.id]);

  const handleExportMarkdown = useCallback(async () => {
    try {
      const result = await invokeTauri<{
        meeting_id: string;
        output_path?: string;
        wrote_file: boolean;
      }>('meeting_export_markdown', {
        meetingId: meeting.id,
      });

      if (result.wrote_file) {
        toast.success('Markdown exported successfully', {
          description: result.output_path || 'Export completed in meeting folder.',
        });
      } else {
        toast.info('Markdown preview generated');
      }
    } catch (error) {
      console.error('Failed to export meeting markdown:', error);
      toast.error('Failed to export markdown', {
        description: getErrorMessage(error),
      });
    }
  }, [meeting.id]);

  // Generic export handler supporting multiple formats
  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        const result = await exportMeeting(meeting.id, format);

        if (result.wrote_file) {
          toast.success(`${format.toUpperCase()} exported successfully`, {
            description: result.output_path || 'Export completed in meeting folder.',
          });
        } else {
          toast.info(`${format.toUpperCase()} preview generated`);
        }
      } catch (error) {
        console.error(`Failed to export meeting as ${format}:`, error);
        toast.error(`Failed to export ${format}`, {
          description: getErrorMessage(error),
        });
      }
    },
    [meeting.id]
  );

  // Convenience handlers for specific formats
  const handleExportPDF = useCallback(async () => {
    await handleExport('pdf');
  }, [handleExport]);

  const handleExportDOCX = useCallback(async () => {
    await handleExport('docx');
  }, [handleExport]);

  // Start diarization for the meeting
  const handleStartDiarization = useCallback(async () => {
    try {
      // Note: We need the audio path. This should be fetched from meeting data or passed as param
      // For now, we'll attempt to construct it from the meeting folder
      const audioPath = `${meeting.folder_path}/audio.wav`;

      toast.loading('Starting speaker identification...');
      const result = await startDiarization(meeting.id, audioPath);

      if (result.success) {
        toast.success('Speaker identification complete', {
          description: `Identified ${result.speaker_count || 0} speakers in the meeting.`,
        });
      } else {
        toast.error('Speaker identification failed', {
          description: result.error || 'Unable to identify speakers.',
        });
      }
    } catch (error) {
      console.error('Failed to start diarization:', error);
      toast.error('Failed to start speaker identification', {
        description: getErrorMessage(error),
      });
    }
  }, [meeting.id, meeting.folder_path]);

  return {
    handleOpenMeetingFolder,
    handleExportMarkdown,
    handleExport,
    handleExportPDF,
    handleExportDOCX,
    handleStartDiarization,
  };
}
