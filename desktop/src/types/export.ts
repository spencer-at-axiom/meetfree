/**
 * Export types and interfaces for v0.3.0 multi-format export
 */

export type ExportFormat = 'markdown' | 'pdf' | 'docx';

/**
 * Single meeting export result
 */
export interface MeetingExportResult {
  meeting_id: string;
  output_path?: string;
  wrote_file: boolean;
  markdown_preview?: string;
  pdf_preview?: string;
  docx_preview?: string;
  error?: string;
}

/**
 * Batch export result for a single meeting
 */
export interface BatchExportResult {
  meeting_id: string;
  output_path?: string;
  success: boolean;
  error?: string;
}

/**
 * Response from batch export command
 */
export interface BatchExportResponse {
  results: BatchExportResult[];
}

/**
 * Speaker diarization result
 */
export interface DiarizationResult {
  meeting_id: string;
  success: boolean;
  speaker_count?: number;
  error?: string;
}

/**
 * Speaker turn segment
 */
export interface SpeakerTurn {
  id: string;
  meeting_id: string;
  speaker_number: number;
  speaker_name?: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number;
  created_at: string;
}
