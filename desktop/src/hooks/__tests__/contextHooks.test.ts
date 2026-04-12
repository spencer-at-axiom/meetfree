import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContextAssets } from '../useContextAssets';
import { useScratchpad } from '../useScratchpad';
import { useMeetingTags, useTags } from '../useTags';
import type { MeetingContextAsset, Tag } from '@/services/contextService';

const mocks = vi.hoisted(() => ({
  scratchpadGet: vi.fn(),
  scratchpadUpsert: vi.fn(),
  contextAssetCreate: vi.fn(),
  contextAssetUpdate: vi.fn(),
  contextAssetList: vi.fn(),
  contextAssetDelete: vi.fn(),
  tagCreate: vi.fn(),
  tagList: vi.fn(),
  tagDelete: vi.fn(),
  meetingTagAdd: vi.fn(),
  meetingTagRemove: vi.fn(),
  meetingTagsList: vi.fn(),
}));

vi.mock('@/services/contextService', () => ({
  scratchpadGet: mocks.scratchpadGet,
  scratchpadUpsert: mocks.scratchpadUpsert,
  contextAssetCreate: mocks.contextAssetCreate,
  contextAssetUpdate: mocks.contextAssetUpdate,
  contextAssetList: mocks.contextAssetList,
  contextAssetDelete: mocks.contextAssetDelete,
  tagCreate: mocks.tagCreate,
  tagList: mocks.tagList,
  tagDelete: mocks.tagDelete,
  meetingTagAdd: mocks.meetingTagAdd,
  meetingTagRemove: mocks.meetingTagRemove,
  meetingTagsList: mocks.meetingTagsList,
}));

const baseAsset: MeetingContextAsset = {
  id: 'asset-1',
  meeting_id: 'meeting-1',
  asset_type: 'note',
  title: 'Agenda',
  content: 'Discuss roadmap',
  file_path: null,
  file_mime_type: null,
  file_size_bytes: null,
  metadata: null,
  sort_order: 0,
  created_at: '2026-04-11T10:00:00Z',
  updated_at: '2026-04-11T10:00:00Z',
};

const scratchpadAsset: MeetingContextAsset = {
  ...baseAsset,
  id: 'scratchpad-1',
  asset_type: 'scratchpad',
  title: 'Notes',
  content: 'Remember follow-ups',
};

const baseTag: Tag = {
  id: 'tag-1',
  name: 'Engineering',
  normalized_name: 'engineering',
  color: null,
  created_at: '2026-04-11T10:00:00Z',
};

describe('context hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads scratchpad content and autosaves debounced updates', async () => {
    mocks.scratchpadGet.mockResolvedValue(scratchpadAsset);
    mocks.scratchpadUpsert.mockResolvedValue({
      ...scratchpadAsset,
      content: 'Updated notes',
    });

    const { result } = renderHook(() => useScratchpad('meeting-1'));

    await waitFor(() => {
      expect(result.current.content).toBe('Remember follow-ups');
    });

    act(() => {
      result.current.setContent('Updated notes');
    });

    expect(mocks.scratchpadUpsert).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    await waitFor(() => {
      expect(mocks.scratchpadUpsert).toHaveBeenCalledWith({
        meetingId: 'meeting-1',
        content: 'Updated notes',
      });
    }, { timeout: 1500 });
  });

  it('filters scratchpad from asset list and keeps local CRUD state in sync', async () => {
    const createdAsset: MeetingContextAsset = {
      ...baseAsset,
      id: 'asset-2',
      asset_type: 'attachment',
      title: 'Briefing',
      content: 'Customer notes',
      file_path: 'C:\\briefing.md',
      file_mime_type: 'text/markdown',
      file_size_bytes: 1200,
    };

    mocks.contextAssetList.mockResolvedValue([scratchpadAsset, baseAsset]);
    mocks.contextAssetCreate.mockResolvedValue(createdAsset);
    mocks.contextAssetUpdate.mockResolvedValue(true);
    mocks.contextAssetDelete.mockResolvedValue(true);

    const { result } = renderHook(() => useContextAssets('meeting-1'));

    await waitFor(() => {
      expect(result.current.assets).toEqual([baseAsset]);
    });

    await act(async () => {
      await result.current.createAsset('attachment', {
        title: createdAsset.title ?? undefined,
        content: createdAsset.content ?? undefined,
        filePath: createdAsset.file_path ?? undefined,
        fileMimeType: createdAsset.file_mime_type ?? undefined,
        fileSizeBytes: createdAsset.file_size_bytes ?? undefined,
      });
    });

    expect(result.current.assets.map((asset) => asset.id)).toEqual(['asset-1', 'asset-2']);

    await act(async () => {
      await result.current.updateAsset('asset-2', {
        title: 'Updated Briefing',
        content: 'Customer notes and risks',
      });
    });

    expect(result.current.assets.find((asset) => asset.id === 'asset-2')).toMatchObject({
      title: 'Updated Briefing',
      content: 'Customer notes and risks',
    });

    await act(async () => {
      await result.current.deleteAsset('asset-1');
    });

    expect(result.current.assets.map((asset) => asset.id)).toEqual(['asset-2']);
  });

  it('loads, creates, and deletes global tags', async () => {
    const createdTag: Tag = {
      ...baseTag,
      id: 'tag-2',
      name: 'Customer',
      normalized_name: 'customer',
      color: '#334455',
    };

    mocks.tagList.mockResolvedValue([baseTag]);
    mocks.tagCreate.mockResolvedValue(createdTag);
    mocks.tagDelete.mockResolvedValue(true);

    const { result } = renderHook(() => useTags());

    await waitFor(() => {
      expect(result.current.tags).toEqual([baseTag]);
    });

    await act(async () => {
      await result.current.createTag('Customer', '#334455');
    });

    expect(result.current.tags.map((tag) => tag.id)).toEqual(['tag-1', 'tag-2']);

    await act(async () => {
      await result.current.deleteTag('tag-1');
    });

    expect(result.current.tags).toEqual([createdTag]);
  });

  it('refreshes meeting tags after add and rolls back on failed removal', async () => {
    const planningTag: Tag = {
      ...baseTag,
      id: 'tag-2',
      name: 'Planning',
      normalized_name: 'planning',
    };

    mocks.meetingTagsList
      .mockResolvedValueOnce([baseTag])
      .mockResolvedValueOnce([baseTag, planningTag])
      .mockResolvedValueOnce([baseTag, planningTag]);
    mocks.meetingTagAdd.mockResolvedValue(undefined);
    mocks.meetingTagRemove.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useMeetingTags('meeting-1'));

    await waitFor(() => {
      expect(result.current.tags).toEqual([baseTag]);
    });

    await act(async () => {
      await result.current.addTag('tag-2');
    });

    expect(result.current.tags).toEqual([baseTag, planningTag]);
    expect(mocks.meetingTagAdd).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      tagId: 'tag-2',
    });

    await act(async () => {
      await result.current.removeTag('tag-2');
    });

    await waitFor(() => {
      expect(result.current.tags).toEqual([baseTag, planningTag]);
    });
    expect(mocks.meetingTagRemove).toHaveBeenCalledWith({
      meetingId: 'meeting-1',
      tagId: 'tag-2',
    });
  });
});
