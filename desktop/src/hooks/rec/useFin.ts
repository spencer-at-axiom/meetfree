import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService, type RecordingStoppedPayload } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { trkEnd } from './recAna';
import { txtErr } from './recMsg';
import { capSet, clrSet, mkKey } from './recUts';

type SetSt = (st: RecordingStatus, msg?: string) => void;

interface FinOpt {
  flush: () => void;
  ttl: string;
  txtsRef: { current: Array<{ text: string }> };
  refetch: () => Promise<void>;
  setCur: (row: { id: string; title: string }) => void;
  setAct: (on: boolean) => void;
  clrTxt: () => void;
  setSt: SetSt;
  setDis: (on: boolean) => void;
}

const finSet = new Set<string>();

export function useFin({
  flush,
  ttl,
  txtsRef,
  refetch,
  setCur,
  setAct,
  clrTxt,
  setSt,
  setDis,
}: FinOpt) {
  const router = useRouter();
  const busyRef = useRef(false);
  const lastRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      clrSet(finSet);
    };
  }, []);

  const fin = useCallback(async (pay: RecordingStoppedPayload) => {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    try {
      const key = mkKey(pay.meeting_id, pay.finalized_at);
      if (lastRef.current === key || finSet.has(key)) {
        return;
      }

      lastRef.current = key;
      finSet.add(key);
      capSet(finSet);

      setSt(RecordingStatus.STOPPING, 'Stopping recording...');
      setDis(true);

      setSt(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Finalizing recording...');
      flush();
      await new Promise((done) => setTimeout(done, 250));

      if (!pay.meeting_id) {
        throw new Error(pay.save_error || 'Meeting finalization returned no meeting ID');
      }

      const meetId = pay.meeting_id;
      const meetTtl = pay.meeting_title || ttl || 'New Meeting';
      const segCnt = pay.transcript_count ?? txtsRef.current.length;

      setSt(RecordingStatus.SAVING, 'Refreshing meeting library...');
      await refetch();
      setCur({ id: meetId, title: meetTtl });
      setSt(RecordingStatus.COMPLETED);

      toast.success('Recording saved successfully!', {
        description: pay.transcription_timed_out
          ? `${segCnt} transcript segments saved. Transcription hit the shutdown timeout, so some late segments may be missing.`
          : `${segCnt} transcript segments saved.`,
        action: {
          label: 'View Meeting',
          onClick: () => {
            router.push(`/meeting-details?id=${meetId}`);
            Analytics.trackButtonClick('view_meeting_from_toast', 'recording_complete');
          },
        },
        duration: 10000,
      });

      try {
        await trkEnd(meetId, pay, [...txtsRef.current]);
      } catch (err) {
        console.error('Failed to track meeting completion analytics:', err);
      }

      setAct(false);
      setDis(false);

      setTimeout(() => {
        router.push(`/meeting-details?id=${meetId}&source=recording`);
        clrTxt();
        Analytics.trackPageView('meeting_details');
        setSt(RecordingStatus.IDLE);
      }, 1200);
    } catch (err) {
      setAct(false);
      setSt(RecordingStatus.ERROR, txtErr(err, 'Unknown error'));
      setDis(false);
      toast.error('Failed to save meeting', {
        description: txtErr(err, 'Unknown error'),
      });
    } finally {
      busyRef.current = false;
    }
  }, [clrTxt, flush, refetch, router, setAct, setCur, setDis, setSt, ttl, txtsRef]);

  const stop = useCallback(async () => {
    try {
      setSt(RecordingStatus.STOPPING, 'Stopping recording...');
      const pay = await recordingService.stopAndFinalizeRecording();
      await fin(pay);
    } catch (err) {
      setSt(RecordingStatus.ERROR, txtErr(err, 'Failed to stop recording'));
      setDis(false);
      toast.error('Failed to stop recording', {
        description: txtErr(err, 'Unknown error'),
      });
    }
  }, [fin, setDis, setSt]);

  return { fin, stop };
}
