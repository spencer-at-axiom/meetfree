import { useCallback, useRef, useState } from 'react';
import { useMeetings } from '@/contexts/MeetingsContext';
import type { ModelConfig } from '@/components/ModelSettingsModal';
import type { SummaryPayload } from '@/contracts/summaryContract';
import type { MeetingDetails } from '@/types/meeting';
import { showErr, showLoad, showNeedMdl, showOll0, showOllErr, showOllMiss, showRun, showStop, showTxtErr, showNoTxt, msg, type SumSt } from './sumMsg';
import { chkOll, fetch, fmtTxt, haltReq, kick, load } from './sumSvc';
import { makePol } from './sumPol';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import Analytics from '@/lib/analytics';
import { startStreamingSummary } from '@/services/summaryStreamingService';

interface SumOpt {
  meeting: MeetingDetails;
  modelConfig: ModelConfig;
  isModelConfigLoading: boolean;
  selectedTemplate: string;
  onMeetingUpdated?: () => Promise<void>;
  updateMeetingTitle: (title: string) => void;
  setAiSummary: (summary: SummaryPayload | null) => void;
  onOpenModelSettings?: () => void;
}

export interface SumApi {
  sumSt: SumSt;
  sumErr: string | null;
  streamProgress: number | undefined;
  streamMsg: string | undefined;
  gen: (prompt?: string) => Promise<void>;
  regen: () => Promise<void>;
  halt: () => Promise<void>;
  msg: (st: SumSt) => string;
}

export function useSum({
  meeting,
  modelConfig,
  isModelConfigLoading,
  selectedTemplate,
  onMeetingUpdated,
  updateMeetingTitle,
  setAiSummary,
  onOpenModelSettings,
}: SumOpt): SumApi {
  const [sumSt, setSt] = useState<SumSt>('idle');
  const [sumErr, setErr] = useState<string | null>(null);
  const [orig, setOrig] = useState('');
  const [streamProgress, setStreamProgress] = useState<number | undefined>(undefined);
  const [streamMsg, setStreamMsg] = useState<string | undefined>(undefined);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const { startSummaryPolling, stopSummaryPolling } = useMeetings();

  const proc = useCallback(async ({
    txt,
    prompt = '',
    isRe = false,
  }: {
    txt: string;
    prompt?: string;
    isRe?: boolean;
  }) => {
    setSt(isRe ? 'regenerating' : 'processing');
    setErr(null);

    try {
      if (!txt.trim()) {
        throw new Error('No transcript text available. Please add some text first.');
      }

      if (!isRe) {
        setOrig(txt);
      }

      console.log('Processing transcript with template:', selectedTemplate);
      showRun(isRe, modelConfig);

      const procId = await kick({
        meetId: meeting.id,
        madeAt: meeting.created_at,
        cfg: modelConfig,
        tpl: selectedTemplate,
        txt,
        prompt,
      });

      console.log('Process ID:', procId);

      startSummaryPolling(
        meeting.id,
        procId,
        makePol({
          meetId: meeting.id,
          isRe,
          cfg: modelConfig,
          onUp: onMeetingUpdated,
          setTtl: updateMeetingTitle,
          setSum: setAiSummary,
          setSt,
          setErr,
          onOpen: onOpenModelSettings,
        })
      );
    } catch (err) {
      console.error(`Failed to ${isRe ? 'regenerate' : 'generate'} summary:`, err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setErr(errMsg);
      setSt('error');

      await Analytics.trackSummaryGenerationCompleted(
        modelConfig.provider,
        modelConfig.model,
        false,
        undefined,
        errMsg
      );

      showErr(isRe, errMsg);
    }
  }, [
    meeting.id,
    meeting.created_at,
    modelConfig,
    onMeetingUpdated,
    onOpenModelSettings,
    selectedTemplate,
    setAiSummary,
    startSummaryPolling,
    updateMeetingTitle,
  ]);

  const genStream = useCallback(async (isRe: boolean = false) => {
    setSt('streaming');
    setErr(null);
    setStreamProgress(0);
    setStreamMsg('Initializing...');

    try {
      showRun(isRe, modelConfig);

      const { unlisten } = await startStreamingSummary(
        meeting.id,
        selectedTemplate,
        {
          onProgress: (p) => {
            setStreamProgress(p.progress);
            setStreamMsg(p.message);
          },
          onChunk: () => {},
          onError: (e) => {
            setErr(e.error);
            setSt('error');
            setStreamProgress(undefined);
            setStreamMsg(undefined);
            showErr(isRe, e.error);
          },
          onComplete: async () => {
            setStreamProgress(undefined);
            setStreamMsg(undefined);
            try {
              const summary = await load(meeting.id);
              if (summary) {
                setAiSummary(summary);
              }
              setSt('completed');
              await onMeetingUpdated?.();
            } catch {
              setSt('completed');
            }
          },
        },
      );

      streamCleanupRef.current = unlisten;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setErr(errMsg);
      setSt('error');
      setStreamProgress(undefined);
      setStreamMsg(undefined);
      showErr(isRe, errMsg);
    }
  }, [meeting.id, modelConfig, selectedTemplate, setAiSummary, onMeetingUpdated]);

  const gen = useCallback(async (prompt: string = '') => {
    if (isModelConfigLoading) {
      console.log('Model configuration is still loading, please wait...');
      showLoad();
      return;
    }

    console.log('Fetching all transcripts for summary generation...');
    let rows;
    try {
      rows = await fetch(meeting.id);
    } catch (err) {
      console.error('Error fetching all transcripts:', err);
      showTxtErr();
      return;
    }

    if (!rows.length) {
      console.log('No transcripts available for summary');
      showNoTxt();
      return;
    }

    console.log(`Proceeding with ${rows.length} transcripts`);
    console.log('Starting summary generation with config:', {
      provider: modelConfig.provider,
      model: modelConfig.model,
      template: selectedTemplate,
    });

    if (!modelConfig.model?.trim()) {
      showNeedMdl();
      onOpenModelSettings?.();
      return;
    }

    if (modelConfig.provider === 'ollama') {
      const oll = await chkOll(modelConfig);
      if (oll === 'none') {
        showOll0();
        return;
      }
      if (oll === 'miss') {
        showOllMiss(() => {
          void invokeTauri('external_url_open', { url: 'https://ollama.com/download' });
        });
        return;
      }
      if (oll === 'err') {
        showOllErr();
        return;
      }
    }

    if (!prompt.trim()) {
      await genStream(false);
    } else {
      await proc({
        txt: fmtTxt(rows),
        prompt,
      });
    }
  }, [isModelConfigLoading, meeting.id, modelConfig, onOpenModelSettings, proc, selectedTemplate, genStream]);

  const regen = useCallback(async () => {
    if (!orig.trim()) {
      console.error('No original transcript available for regeneration');
      return;
    }

    await proc({
      txt: orig,
      isRe: true,
    });
  }, [orig, proc]);

  const halt = useCallback(async () => {
    console.log('Stopping summary generation for meeting:', meeting.id);

    if (streamCleanupRef.current) {
      streamCleanupRef.current();
      streamCleanupRef.current = null;
    }

    try {
      await haltReq(meeting.id);
      console.log('Backend cancellation request sent for meeting:', meeting.id);
    } catch (err) {
      console.error('Failed to cancel summary generation:', err);
    }

    stopSummaryPolling(meeting.id);
    setSt('idle');
    setErr(null);
    setStreamProgress(undefined);
    setStreamMsg(undefined);
    showStop();
  }, [meeting.id, stopSummaryPolling]);

  return {
    sumSt,
    sumErr,
    streamProgress,
    streamMsg,
    gen,
    regen,
    halt,
    msg: (st: SumSt) => msg(st, streamMsg),
  };
}
