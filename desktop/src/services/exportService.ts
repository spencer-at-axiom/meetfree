/**
 * Export service - provides TypeScript wrappers for Tauri export commands
 * Supports Markdown, PDF, and DOCX formats for single and batch exports
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  ExportFormat,
  MeetingExportResult,
  BatchExportResponse,
  DiarizationResult,
} from '@/types/export';

/**
 * Export a single meeting in the specified format
 */
export async function exportMeeting(
  meetingId: string,
  format: ExportFormat,
  destinationRoot?: string,
  preview: boolean = false
): Promise<MeetingExportResult> {
  const commandMap: Record<ExportFormat, string> = {
    markdown: 'meeting_export_markdown',
    pdf: 'meeting_export_pdf',
    docx: 'meeting_export_docx',
  };

  const command = commandMap[format];
  if (!command) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  return invoke<MeetingExportResult>(command, {
    meeting_id: meetingId,
    destination_root: destinationRoot,
    preview,
  });
}

/**
 * Batch export multiple meetings in the specified format
 */
export async function batchExportMeetings(
  meetingIds: string[],
  format: ExportFormat,
  destinationRoot: string
): Promise<BatchExportResponse> {
  const commandMap: Record<ExportFormat, string> = {
    markdown: 'meetings_export_markdown_batch',
    pdf: 'meetings_export_pdf_batch',
    docx: 'meetings_export_docx_batch',
  };

  const command = commandMap[format];
  if (!command) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  return invoke<BatchExportResponse>(command, {
    meeting_ids: meetingIds,
    destination_root: destinationRoot,
  });
}

/**
 * Start diarization for a meeting
 * Automatically identifies and labels different speakers in the audio
 */
export async function startDiarization(
  meetingId: string,
  audioPath: string
): Promise<DiarizationResult> {
  return invoke<DiarizationResult>('start_diarization', {
    meeting_id: meetingId,
    audio_path: audioPath,
  });
}

/**
 * Export types/formats helper
 */
export const EXPORT_FORMATS: ExportFormat[] = ['markdown', 'pdf', 'docx'];

export const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  markdown: 'Markdown with YAML frontmatter - portable and editable',
  pdf: 'Professional PDF - great for sharing and printing',
  docx: 'Word document - editable in Microsoft Word, Google Docs, LibreOffice',
};

export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  markdown: 'md',
  pdf: 'pdf',
  docx: 'docx',
};
