import { useState, useEffect, useCallback } from 'react';
import {
  contextAssetCreate,
  contextAssetList,
  contextAssetDelete,
} from '@/services/contextService';
import type { MeetingContextAsset } from '@/services/contextService';

export function useContextAssets(meetingId: string | null) {
  const [assets, setAssets] = useState<MeetingContextAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!meetingId) {
      setAssets([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    contextAssetList({ meetingId })
      .then((list) => {
        if (!cancelled) {
          setAssets(list.filter((a) => a.asset_type !== 'scratchpad'));
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

  const createAsset = useCallback(
    async (
      assetType: string,
      options?: {
        title?: string;
        content?: string;
        filePath?: string;
        fileMimeType?: string;
        fileSizeBytes?: number;
      }
    ) => {
      if (!meetingId) {
        throw new Error('meetingId is required');
      }
      const asset = await contextAssetCreate({
        meetingId,
        assetType,
        ...options,
      });
      if (asset.asset_type !== 'scratchpad') {
        setAssets((prev) => [...prev, asset]);
      }
      return asset;
    },
    [meetingId]
  );

  const deleteAsset = useCallback(async (assetId: string) => {
    await contextAssetDelete({ assetId });
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
  }, []);

  return { assets, createAsset, deleteAsset, isLoading };
}
