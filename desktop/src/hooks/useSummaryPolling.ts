import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface SummaryPollResult {
  status: string;
  meetingName?: string;
  meeting_id: string;
  start?: string;
  end?: string;
  data?: unknown;
  error?: string;
}

type PollCallback = (result: SummaryPollResult) => void;

const MAX_POLLS = 200;
const POLL_INTERVAL_MS = 5000;

export function useSummaryPolling() {
  const [activePolls, setActivePolls] = useState<Map<string, NodeJS.Timeout>>(new Map());
  const activePollsRef = useRef(activePolls);

  activePollsRef.current = activePolls;

  const stopPolling = useCallback((meetingId: string) => {
    const interval = activePollsRef.current.get(meetingId);
    if (interval) {
      clearInterval(interval);
      setActivePolls((prev) => {
        const next = new Map(prev);
        next.delete(meetingId);
        return next;
      });
    }
  }, []);

  const startPolling = useCallback(
    (meetingId: string, _processId: string, onUpdate: PollCallback) => {
      stopPolling(meetingId);

      let pollCount = 0;

      const pollInterval = setInterval(async () => {
        pollCount++;

        if (pollCount >= MAX_POLLS) {
          clearInterval(pollInterval);
          setActivePolls((prev) => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
          onUpdate({
            status: 'error',
            meeting_id: meetingId,
            error:
              'Summary generation timed out after 15 minutes. Please try again or check your model configuration.',
          });
          return;
        }

        try {
          const result = await invoke<SummaryPollResult>('api_get_summary', {
            meetingId,
          });

          onUpdate(result);

          const terminal =
            result.status === 'completed' ||
            result.status === 'error' ||
            result.status === 'failed' ||
            result.status === 'cancelled';

          if (terminal || (result.status === 'idle' && pollCount > 1)) {
            clearInterval(pollInterval);
            setActivePolls((prev) => {
              const next = new Map(prev);
              next.delete(meetingId);
              return next;
            });
          }
        } catch (error) {
          onUpdate({
            status: 'error',
            meeting_id: meetingId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          clearInterval(pollInterval);
          setActivePolls((prev) => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        }
      }, POLL_INTERVAL_MS);

      setActivePolls((prev) => new Map(prev).set(meetingId, pollInterval));
    },
    [stopPolling],
  );

  useEffect(() => {
    return () => {
      activePollsRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);

  return { activePolls, startPolling, stopPolling };
}
