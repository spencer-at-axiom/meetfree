import { useEffect } from 'react';
import { toast } from 'sonner';
import { recordingService, type RecordingStoppedPayload } from '@/services/recordingService';
import { txtErr } from './recMsg';

interface EvtOpt {
  isRec: boolean;
  isAuto: boolean;
  setAuto: (on: boolean) => void;
  beg: (src: string) => Promise<boolean>;
  fail: (err: unknown, src: string, alt: string) => void;
  fin: (pay: RecordingStoppedPayload) => Promise<void>;
}

export function useEvt({
  isRec,
  isAuto,
  setAuto,
  beg,
  fail,
  fin,
}: EvtOpt): void {
  useEffect(() => {
    let live = true;
    let clean: (() => void) | undefined;

    const boot = async () => {
      const off = await recordingService.onRecordingStopped((pay) => {
        console.log('[useEvt] Received recording-stopped event from backend:', pay);
        void fin(pay);
      });

      if (!live) {
        off();
        return;
      }
      clean = off;
    };

    void boot();

    return () => {
      live = false;
      clean?.();
    };
  }, [fin]);

  useEffect(() => {
    const auto = async () => {
      if (typeof window === 'undefined') {
        return;
      }

      const flag = sessionStorage.getItem('autoStartRecording');
      if (flag !== 'true' || isRec || isAuto) {
        return;
      }

      setAuto(true);
      sessionStorage.removeItem('autoStartRecording');

      try {
        await beg('sidebar_auto');
      } catch (err) {
        fail(err, 'sidebar_auto', 'Failed to auto-start recording');
        toast.error('Failed to start recording', {
          description: txtErr(err, 'Unknown error occurred'),
        });
      } finally {
        setAuto(false);
      }
    };

    void auto();
  }, [beg, fail, isAuto, isRec, setAuto]);

  useEffect(() => {
    const onStart = async () => {
      if (isRec || isAuto) {
        return;
      }

      setAuto(true);
      try {
        await beg('sidebar_direct');
      } catch (err) {
        fail(err, 'sidebar_direct', 'Failed to start recording from sidebar');
        toast.error('Failed to start recording', {
          description: txtErr(err, 'Unknown error occurred'),
        });
      } finally {
        setAuto(false);
      }
    };

    window.addEventListener('start-recording-from-sidebar', onStart);
    return () => {
      window.removeEventListener('start-recording-from-sidebar', onStart);
    };
  }, [beg, fail, isAuto, isRec, setAuto]);
}
