import { useState, useEffect, useCallback } from 'react';
import {
  tagCreate,
  tagList,
  tagDelete,
  meetingTagAdd,
  meetingTagRemove,
  meetingTagsList,
  type Tag,
} from '@/services/contextService';

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    tagList()
      .then((data) => {
        if (!cancelled) {
          setTags(data);
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
  }, []);

  const createTag = useCallback(async (name: string, color?: string) => {
    const tag = await tagCreate({ name, color });
    setTags((prev) => [...prev, tag]);
    return tag;
  }, []);

  const deleteTag = useCallback(async (tagId: string) => {
    await tagDelete({ tagId });
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  }, []);

  return { tags, createTag, deleteTag, isLoading };
}

export function useMeetingTags(meetingId: string | null) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) {
      setTags([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    meetingTagsList({ meetingId })
      .then((data) => {
        if (!cancelled) {
          setTags(data);
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

  const addTag = useCallback(
    async (tagId: string) => {
      if (!meetingId) return;
      setIsLoading(true);
      try {
        await meetingTagAdd({ meetingId, tagId });
        const next = await meetingTagsList({ meetingId });
        setTags(next);
      } finally {
        setIsLoading(false);
      }
    },
    [meetingId]
  );

  const removeTag = useCallback(
    async (tagId: string) => {
      if (!meetingId) return;
      setTags((current) => current.filter((t) => t.id !== tagId));
      try {
        await meetingTagRemove({ meetingId, tagId });
      } catch {
        const next = await meetingTagsList({ meetingId });
        setTags(next);
      }
    },
    [meetingId]
  );

  return { tags, addTag, removeTag, isLoading };
}
