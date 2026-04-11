import { invoke as invokeTauri } from '@tauri-apps/api/core';
import type { Transcript } from '@/types';
import type { ModelConfig } from '@/components/ModelSettingsModal';
import { buildProcessTranscriptPayload } from '@/lib/tauriContracts';
import {
  parseSummaryPayloadFromApiData,
  type SummaryPayload,
} from '@/contracts/summaryContract';
import Analytics from '@/lib/analytics';
import { isOllamaNotInstalledError } from '@/lib/utils';

export interface SumRes {
  status: string;
  data?: unknown;
  error?: string;
  meetingName?: string;
}

export async function load(meetId: string): Promise<SummaryPayload | null> {
  const raw = await invokeTauri('api_get_summary', {
    meetingId: meetId,
  }) as { data?: unknown };

  if (!raw?.data) {
    return null;
  }

  const parsed = parseSummaryPayloadFromApiData(raw.data);
  if (!parsed.ok) {
    console.error('Existing summary payload is not valid v0.1.0:', parsed.error);
    return null;
  }

  return parsed.data;
}

export async function fetch(meetId: string): Promise<Transcript[]> {
  console.log('Fetching all transcripts for meeting:', meetId);

  const first = await invokeTauri('meeting_transcripts_get', {
    meetingId: meetId,
    limit: 1,
    offset: 0,
  }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

  const total = first.total_count;
  console.log(`Total transcripts in database: ${total}`);

  if (total === 0) {
    return [];
  }

  const full = await invokeTauri('meeting_transcripts_get', {
    meetingId: meetId,
    limit: total,
    offset: 0,
  }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

  console.log(`Fetched ${full.transcripts.length} transcripts from database`);
  return full.transcripts;
}

export function fmtTxt(rows: Transcript[]): string {
  const fmt = (secs: number | undefined, stamp: string): string => {
    if (secs === undefined) {
      return stamp;
    }

    const total = Math.floor(secs);
    const mins = Math.floor(total / 60);
    const left = total % 60;
    return `[${mins.toString().padStart(2, '0')}:${left.toString().padStart(2, '0')}]`;
  };

  return rows
    .map((row) => `${fmt(row.audio_start_time, row.timestamp)} ${row.text}`)
    .join('\n');
}

export async function kick({
  meetId,
  madeAt,
  cfg,
  tpl,
  txt,
  prompt,
}: {
  meetId: string;
  madeAt: string;
  cfg: ModelConfig;
  tpl: string;
  txt: string;
  prompt: string;
}): Promise<string> {
  const minsAgo = (Date.now() - new Date(madeAt).getTime()) / 60000;

  await Analytics.trackSummaryGenerationStarted(
    cfg.provider,
    cfg.model,
    txt.length,
    minsAgo
  );

  if (prompt.trim().length > 0) {
    await Analytics.trackCustomPromptUsed(prompt.trim().length);
  }

  const out = await invokeTauri(
    'api_process_transcript',
    buildProcessTranscriptPayload({
      transcriptText: txt,
      provider: cfg.provider,
      modelName: cfg.model,
      meetingId: meetId,
      customPrompt: prompt,
      templateId: tpl,
    })
  ) as { process_id: string };

  return out.process_id;
}

export function needMdl(err: string): boolean {
  return err.includes('model is required') ||
    err.includes('"model":"required"') ||
    (err.toLowerCase().includes('model') && err.toLowerCase().includes('required'));
}

export async function chkOll(cfg: ModelConfig): Promise<'ok' | 'none' | 'miss' | 'err'> {
  try {
    const endpoint = cfg.ollamaEndpoint || null;
    const rows = await invokeTauri<Array<{ name: string }>>('get_ollama_models', { endpoint });
    if (!rows || rows.length === 0) {
      return 'none';
    }
    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isOllamaNotInstalledError(msg)) {
      return 'miss';
    }
    return 'err';
  }
}

export async function haltReq(meetId: string): Promise<void> {
  await invokeTauri('api_cancel_summary', {
    meetingId: meetId,
  });
}
