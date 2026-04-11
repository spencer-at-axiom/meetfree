import Analytics from '@/lib/analytics';
import type { ModelConfig } from '@/components/ModelSettingsModal';
import type { SummaryPayload } from '@/contracts/summaryContract';
import { parseSummaryPayloadFromApiData } from '@/contracts/summaryContract';
import { load, needMdl, type SumRes } from './sumSvc';
import { showErr, showOk, showReErr } from './sumMsg';

interface PolOpt {
  meetId: string;
  isRe: boolean;
  cfg: ModelConfig;
  onUp?: () => Promise<void>;
  setTtl: (ttl: string) => void;
  setSum: (sum: SummaryPayload | null) => void;
  setSt: (st: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'streaming' | 'completed' | 'error') => void;
  setErr: (err: string | null) => void;
  onOpen?: () => void;
}

export function makePol({
  meetId,
  isRe,
  cfg,
  onUp,
  setTtl,
  setSum,
  setSt,
  setErr,
  onOpen,
}: PolOpt) {
  return async (res: SumRes) => {
    console.log('Summary status:', res);

    if (res.status === 'cancelled') {
      console.log('Summary generation was cancelled');
      try {
        const old = await load(meetId);
        if (old) {
          console.log('Restored previous summary after cancellation');
          setSum(old);
          setSt('completed');
        } else {
          setSt('idle');
        }
      } catch (err) {
        console.error('Failed to reload summary after cancellation:', err);
        setSt('idle');
      }

      setErr(null);
      return;
    }

    if (res.status === 'error' || res.status === 'failed') {
      console.error('Backend returned error:', res.error);
      const err = res.error || `Summary ${isRe ? 'regeneration' : 'generation'} failed`;

      if (isRe) {
        try {
          const old = await load(meetId);
          if (old) {
            console.log('Restored previous summary after regeneration failure');
            setSum(old);
            setSt('completed');
            setErr(null);
            showReErr(err);

            await Analytics.trackSummaryGenerationCompleted(
              cfg.provider,
              cfg.model,
              false,
              undefined,
              err
            );
            return;
          }
        } catch (reloadErr) {
          console.error('Failed to reload summary after error:', reloadErr);
        }
      }

      setErr(err);
      setSt('error');
      showErr(isRe, err);

      if (needMdl(err)) {
        console.log('Model required error detected, opening model settings...');
        onOpen?.();
      }

      await Analytics.trackSummaryGenerationCompleted(
        cfg.provider,
        cfg.model,
        false,
        undefined,
        err
      );
      return;
    }

    if (res.status === 'completed' && res.data) {
      console.log('Summary generation completed:', res.data);

      const parsed = parseSummaryPayloadFromApiData(res.data);
      if (!parsed.ok) {
        const err = 'Summary generation completed with invalid contract payload.';
        console.error(err, parsed.error);

        setErr(err);
        setSt('error');

        await Analytics.trackSummaryGenerationCompleted(
          cfg.provider,
          cfg.model,
          false,
          undefined,
          err
        );
        return;
      }

      const ttl = typeof res.meetingName === 'string' ? res.meetingName : null;
      if (ttl) {
        setTtl(ttl);
      }

      setSum(parsed.data);
      setSt('completed');
      showOk();

      await Analytics.trackSummaryGenerationCompleted(
        cfg.provider,
        cfg.model,
        true
      );

      if (ttl && onUp) {
        await onUp();
      }
    }
  };
}
