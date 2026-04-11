import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DownloadableModelStatus } from '@/lib/transcriptionModelStatus';

export interface RawModelInfo {
  name: string;
  size_mb: number;
  status: DownloadableModelStatus;
}

export interface ModelOption {
  provider: 'whisper' | 'parakeet';
  name: string;
  displayName: string;
  size_mb: number;
}

interface TranscriptModelConfig {
  provider?: string;
  model?: string;
}

export function useTranscriptionModels(
  transcriptModelConfig: TranscriptModelConfig | undefined
) {
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState(false);
  const userSelectedRef = useRef(false);

  const setSelectedModelKeyWithTracking = useCallback((key: string) => {
    userSelectedRef.current = true;
    setSelectedModelKey(key);
  }, []);

  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    const allModels: ModelOption[] = [];

    try {
      const whisperModels = await invoke<RawModelInfo[]>('whisper_get_available_models');
      const availableWhisper = whisperModels
        .filter((model) => model.status === 'Available')
        .map((model) => ({
          provider: 'whisper' as const,
          name: model.name,
          displayName: `Whisper Local: ${model.name}`,
          size_mb: model.size_mb,
        }));
      allModels.push(...availableWhisper);
    } catch {
      // Continue with the remaining providers.
    }

    try {
      const parakeetModels =
        await invoke<RawModelInfo[]>('parakeet_get_available_models');
      const availableParakeet = parakeetModels
        .filter((model) => model.status === 'Available')
        .map((model) => ({
          provider: 'parakeet' as const,
          name: model.name,
          displayName: `Parakeet Local: ${model.name}`,
          size_mb: model.size_mb,
        }));
      allModels.push(...availableParakeet);
    } catch {
      // Continue with whichever providers are available.
    }

    setAvailableModels(allModels);

    const configuredProvider = transcriptModelConfig?.provider || '';
    const configuredModel = transcriptModelConfig?.model || '';

    const configuredMatch = allModels.find(
      (model) =>
        (configuredProvider === 'localWhisper' &&
          model.provider === 'whisper' &&
          model.name === configuredModel) ||
        (configuredProvider === 'parakeet' &&
          model.provider === 'parakeet' &&
          model.name === configuredModel)
    );

    if (!userSelectedRef.current) {
      if (configuredMatch) {
        setSelectedModelKey(
          `${configuredMatch.provider}:${configuredMatch.name}`
        );
      } else if (allModels.length > 0) {
        setSelectedModelKey(`${allModels[0].provider}:${allModels[0].name}`);
      }
    }

    setLoadingModels(false);
  }, [transcriptModelConfig]);

  const resetSelection = useCallback(() => {
    userSelectedRef.current = false;
  }, []);

  return {
    availableModels,
    selectedModelKey,
    setSelectedModelKey: setSelectedModelKeyWithTracking,
    loadingModels,
    fetchModels,
    resetSelection,
  };
}
