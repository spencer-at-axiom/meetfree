import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useMeetings } from '@/contexts/MeetingsContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingReadiness } from '@/hooks/useRecordingReadiness';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService, type RecordingReadiness } from '@/services/recordingService';
import Analytics from '@/lib/analytics';
import { txtErr } from './recMsg';
import { useBeg } from './useBeg';
import { useEvt } from './useEvt';
import { useFin } from './useFin';

type ModFn = (name: 'modelSelector', message?: string) => void;

export interface RecApi {
  isRec: boolean;
  isDis: boolean;
  isAuto: boolean;
  rdySt: ReturnType<typeof useRecordingReadiness>['readinessState'];
  canRec: boolean;
  rdy: RecordingReadiness | null;
  isChk: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  rsm: () => Promise<void>;
  fresh: () => Promise<RecordingReadiness | null>;
}

export function useRec(showModal?: ModFn): RecApi {
  const [isDis, setDis] = useState(false);
  const [isAuto, setAuto] = useState(false);

  const { clearTranscripts, setMeetingTitle, transcriptsRef, flushBuffer, meetingTitle } = useTranscripts();
  const { setIsMeetingActive, refetchMeetings, setCurrentMeeting } = useMeetings();
  const { selectedDevices, transcriptModelConfig } = useConfig();
  const rec = useRecordingState();
  const { setStatus } = rec;

  const mic = selectedDevices?.micDevice ?? null;
  const sys = selectedDevices?.systemDevice ?? null;
  const prvd = transcriptModelConfig?.provider ?? 'parakeet';
  const model = transcriptModelConfig?.model ?? '';
  const { readinessState, canRecord, readiness, isChecking, checkReadiness } = useRecordingReadiness({
    enabled: !rec.isRecording,
    autoCheckDeps: [mic, sys, prvd, model],
  });

  useEffect(() => {
    setIsMeetingActive(rec.isRecording);
  }, [rec.isRecording, setIsMeetingActive]);

  useEffect(() => {
    if (
      rec.status === RecordingStatus.IDLE ||
      rec.status === RecordingStatus.ERROR ||
      rec.status === RecordingStatus.COMPLETED
    ) {
      setDis(false);
    }
  }, [rec.status]);

  const { beg, fail } = useBeg({
    chkRdy: checkReadiness,
    setSt: setStatus,
    showModal,
    setTtl: setMeetingTitle,
    clrTxt: clearTranscripts,
    setAct: setIsMeetingActive,
    mic,
    sys,
  });

  const { fin, stop } = useFin({
    flush: flushBuffer,
    ttl: meetingTitle,
    txtsRef: transcriptsRef,
    refetch: refetchMeetings,
    setCur: setCurrentMeeting,
    setAct: setIsMeetingActive,
    clrTxt: clearTranscripts,
    setSt: setStatus,
    setDis,
  });

  useEvt({
    isRec: rec.isRecording,
    isAuto,
    setAuto,
    beg,
    fail,
    fin,
  });

  const start = useCallback(async () => {
    try {
      await beg('controller');
    } catch (err) {
      fail(err, 'controller', 'Failed to start recording');
      toast.error('Failed to start recording', {
        description: txtErr(err, 'Unknown error'),
      });
    }
  }, [beg, fail]);

  const pause = useCallback(async () => {
    try {
      await recordingService.pauseRecording();
      Analytics.trackButtonClick('pause_recording', 'controller');
    } catch (err) {
      toast.error('Failed to pause recording', {
        description: txtErr(err, 'Unknown error'),
      });
    }
  }, []);

  const rsm = useCallback(async () => {
    try {
      await recordingService.resumeRecording();
      Analytics.trackButtonClick('resume_recording', 'controller');
    } catch (err) {
      toast.error('Failed to resume recording', {
        description: txtErr(err, 'Unknown error'),
      });
    }
  }, []);

  return {
    isRec: rec.isRecording,
    isDis,
    isAuto,
    rdySt: readinessState,
    canRec: canRecord,
    rdy: readiness,
    isChk: isChecking,
    start,
    stop,
    pause,
    rsm,
    fresh: checkReadiness,
  };
}
