import { useCallback } from 'react';
import { toast } from 'sonner';
import { RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService, type RecordingReadiness } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { blkKey, showBk } from './recMsg';
import { mkTtl } from './recUts';

type ModFn = (name: 'modelSelector', message?: string) => void;
type SetSt = (st: RecordingStatus, msg?: string) => void;

interface BegOpt {
  chkRdy: () => Promise<RecordingReadiness | null>;
  setSt: SetSt;
  showModal?: ModFn;
  setTtl: (ttl: string) => void;
  clrTxt: () => void;
  setAct: (on: boolean) => void;
  mic: string | null;
  sys: string | null;
}

export function useBeg({
  chkRdy,
  setSt,
  showModal,
  setTtl,
  clrTxt,
  setAct,
  mic,
  sys,
}: BegOpt) {
  const ckRdy = useCallback(async (src: string): Promise<boolean> => {
    const rdy = await chkRdy();

    if (!rdy) {
      toast.error('Unable to check recording readiness', {
        description: 'Please try again or check your configuration.',
        duration: 5000,
      });
      setSt(RecordingStatus.IDLE);
      return false;
    }

    const key = blkKey(rdy.status);
    if (key) {
      showBk(rdy, showModal);
      Analytics.trackButtonClick(key, src);
      setSt(RecordingStatus.IDLE);
      return false;
    }

    if (!rdy.can_record) {
      toast.error('Cannot start recording', {
        description: rdy.issues.join(', ') || 'Recording is not ready.',
        duration: 5000,
      });
      Analytics.trackButtonClick('start_recording_blocked_not_ready', src);
      setSt(RecordingStatus.IDLE);
      return false;
    }

    return true;
  }, [chkRdy, setSt, showModal]);

  const beg = useCallback(async (src: string) => {
    const ready = await ckRdy(src);
    if (!ready) {
      return false;
    }

    const ttl = mkTtl();
    setTtl(ttl);
    setSt(RecordingStatus.STARTING, 'Initializing recording...');

    await recordingService.startRecordingWithDevices(mic, sys, ttl);

    clrTxt();
    setAct(true);
    Analytics.trackButtonClick('start_recording', src);
    return true;
  }, [ckRdy, clrTxt, mic, setAct, setSt, setTtl, sys]);

  const fail = useCallback((err: unknown, src: string, alt: string) => {
    setSt(RecordingStatus.ERROR, err instanceof Error ? err.message : alt);
    Analytics.trackButtonClick('start_recording_error', src);
  }, [setSt]);

  return { beg, fail };
}
