import { useEffect, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ParakeetModelManager } from './ParakeetModelManager';
import { ProviderModelStack } from './ProviderModelStack';
import { ModelManager } from './WhisperModelManager';
import { DEFAULT_PARAKEET_MODEL, DEFAULT_WHISPER_MODEL } from '@/constants/modelDefaults';
import { SETTINGS_SELECT_TRIGGER_CLASS } from '@/components/settingsShared';
import type { TranscriptModelProps } from '@/types/config';

export type { TranscriptModelProps } from '@/types/config';

export interface TranscriptSettingsProps {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
  onModelSelect?: () => void;
  compact?: boolean;
  disabled?: boolean;
}

export function TranscriptSettings({
  transcriptModelConfig,
  setTranscriptModelConfig,
  onModelSelect,
  compact = false,
  disabled = false,
}: TranscriptSettingsProps) {
  const minimalLabelClass = 'text-[13px] font-medium leading-5 text-slate-950';
  const minimalControlWidthClass = 'w-full sm:w-[240px]';
  const [uiProvider, setUiProvider] =
    useState<TranscriptModelProps['provider']>(
      transcriptModelConfig.provider === 'localWhisper' ? 'localWhisper' : 'parakeet'
    );

  useEffect(() => {
    setUiProvider(
      transcriptModelConfig.provider === 'localWhisper' ? 'localWhisper' : 'parakeet'
    );
  }, [transcriptModelConfig.provider]);

  const handleProviderChange = (provider: TranscriptModelProps['provider']) => {
    setUiProvider(provider);
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider,
      model:
        provider === transcriptModelConfig.provider
          ? transcriptModelConfig.model
          : provider === 'parakeet'
            ? DEFAULT_PARAKEET_MODEL
            : DEFAULT_WHISPER_MODEL,
      apiKey: null,
      hasStoredKey: false,
    });
  };

  const handleWhisperModelSelect = (modelName: string) => {
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider: 'localWhisper',
      model: modelName,
      apiKey: null,
      hasStoredKey: false,
    });

    onModelSelect?.();
  };

  const handleParakeetModelSelect = (modelName: string) => {
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider: 'parakeet',
      model: modelName,
      apiKey: null,
      hasStoredKey: false,
    });

    onModelSelect?.();
  };

  return (
    <div className={compact ? 'space-y-4 text-[13px] text-slate-700' : 'space-y-6'}>
      <section className={compact ? 'space-y-4' : 'space-y-5'}>
        {!compact && (
          <div className="mb-3">
            <h2 className="text-[13px] font-semibold text-slate-900">Transcript provider</h2>
            <p className="mt-1 text-[12px] text-slate-600">
              Choose the local speech-to-text provider and model.
            </p>
          </div>
        )}

        <ProviderModelStack
          labelClassName={compact ? minimalLabelClass : undefined}
          providerControl={
            <div className={compact ? minimalControlWidthClass : 'w-full sm:max-w-[240px]'}>
              <Select
                value={uiProvider}
                onValueChange={(value) =>
                  handleProviderChange(value as TranscriptModelProps['provider'])
                }
                disabled={disabled}
              >
                <SelectTrigger
                  className={
                    compact
                      ? SETTINGS_SELECT_TRIGGER_CLASS
                      : 'h-10 text-[13px] font-medium focus:border-slate-400 focus:ring-2 focus:ring-slate-200'
                  }
                >
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parakeet">Parakeet Local</SelectItem>
                  <SelectItem value="localWhisper">Whisper Local</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
          providerDescription={
            compact ? null : (
              <p className="text-[12px] text-slate-500">
                {uiProvider === 'parakeet'
                  ? 'Parakeet Local is the best default for most meetings.'
                  : 'Whisper Local offers more model options and broader language coverage.'}
              </p>
            )
          }
          modelDescription={
            compact ? null : (
              <p className="text-[12px] text-slate-500">
                Download, remove, and choose the local speech model you want to run.
              </p>
            )
          }
          modelControl={
            <>
              {uiProvider === 'localWhisper' ? (
                <ModelManager
                  selectedModel={
                    transcriptModelConfig.provider === 'localWhisper'
                      ? transcriptModelConfig.model
                      : undefined
                  }
                  onModelSelect={handleWhisperModelSelect}
                  autoSave
                  className={compact ? minimalControlWidthClass : undefined}
                  compact={true}
                />
              ) : null}

              {uiProvider === 'parakeet' ? (
                <ParakeetModelManager
                  selectedModel={
                    transcriptModelConfig.provider === 'parakeet'
                      ? transcriptModelConfig.model
                      : undefined
                  }
                  onModelSelect={handleParakeetModelSelect}
                  autoSave
                  className={compact ? minimalControlWidthClass : undefined}
                  compact={true}
                />
              ) : null}
            </>
          }
        />
      </section>
    </div>
  );
}



