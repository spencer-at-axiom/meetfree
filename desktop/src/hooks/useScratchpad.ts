import { useState, useEffect, useCallback, useRef } from 'react';
import { scratchpadGet, scratchpadUpsert } from '@/services/contextService';

export function useScratchpad(meetingId: string | null) {
  const [content, setContentState] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meetingIdRef = useRef(meetingId);

  useEffect(() => {
    meetingIdRef.current = meetingId;
  }, [meetingId]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) {
      setContentState('');
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    scratchpadGet({ meetingId })
      .then((asset) => {
        if (!cancelled) {
          setContentState(asset?.content ?? '');
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const setContent = useCallback((next: string) => {
    setContentState(next);
    const id = meetingIdRef.current;
    if (!id) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const currentId = meetingIdRef.current;
      if (!currentId) return;

      setIsSaving(true);
      setError(null);
      scratchpadUpsert({ meetingId: currentId, content: next })
        .catch((e) => {
          if (meetingIdRef.current === currentId) {
            setError(e instanceof Error ? e.message : String(e));
          }
        })
        .finally(() => {
          if (meetingIdRef.current === currentId) {
            setIsSaving(false);
          }
        });
    }, 800);
  }, []);

  return { content, setContent, isLoading, isSaving, error };
}
