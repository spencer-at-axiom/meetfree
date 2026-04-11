'use client';

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  ModelConfig,
  ModelSaveOptions,
  ModelSettingsModal,
  sanitizeModelConfig,
} from '@/components/ModelSettingsModal';
import { Switch } from './ui/switch';
import { useConfig } from '@/contexts/ConfigContext';
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_PROVIDER,
} from '@/constants/modelDefaults';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from '@/components/settingsShared';

interface SummaryModelSettingsProps {
  refetchTrigger?: number; // Change this to trigger refetch
  mode?: 'full' | 'models' | 'processing';
}

const SETTINGS_TOGGLE_CONTROL_CLASS =
  'flex w-full items-center sm:min-h-[20px] sm:justify-end';

const SETTINGS_TOGGLE_SWITCH_CLASS =
  'h-5 w-9 data-[state=checked]:bg-slate-950 data-[state=unchecked]:bg-slate-200';

export function SummaryModelSettings({
  refetchTrigger,
  mode = 'full',
}: SummaryModelSettingsProps) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: DEFAULT_SUMMARY_MODEL,
    whisperModel: 'large-v3',
    apiKey: null,
    ollamaEndpoint: null
  });

  const { isAutoSummary, toggleIsAutoSummary } = useConfig();
  const showAutoSummaryToggle = mode !== 'models';
  const showProviderSettings = mode !== 'processing';

  // Reusable fetch function
  const fetchModelConfig = useCallback(async () => {
    try {
      const data = await invoke('model_cfg_get') as any;
      if (data && data.provider !== null) {
        // Fetch Custom OpenAI config if that's the active provider
        if (data.provider === 'custom-openai') {
          try {
            const customConfig = (await invoke('custom_openai_cfg_get')) as any;
            if (customConfig) {
              data.customOpenAIDisplayName = customConfig.displayName || null;
              data.customOpenAIEndpoint = customConfig.endpoint || null;
              data.customOpenAIModel = customConfig.model || null;
              data.maxTokens = customConfig.maxTokens || null;
              data.temperature = customConfig.temperature || null;
              data.topP = customConfig.topP || null;
              data.hasStoredApiKey = !!customConfig.hasStoredApiKey;
              // For custom-openai, model field should match customOpenAIModel
              data.model = customConfig.model || data.model;
            }
          } catch (err) {
            console.error('Failed to fetch custom OpenAI config:', err);
          }
        }
        setModelConfig(data);
      }
    } catch (error) {
      console.error('Failed to fetch model config:', error);
      toast.error('Failed to load model settings');
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchModelConfig();
  }, [fetchModelConfig]);

  // Refetch when trigger changes (optional external control)
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      fetchModelConfig();
    }
  }, [refetchTrigger, fetchModelConfig]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);

  // Save handler
  const handleSaveModelConfig = async (
    config: ModelConfig,
    options?: ModelSaveOptions
  ) => {
    try {
      await invoke('model_cfg_set', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      const sanitizedConfig = sanitizeModelConfig(config);
      setModelConfig(sanitizedConfig);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', sanitizedConfig);

      if (!options?.silent) {
        toast.success('Model settings saved successfully');
      }
    } catch (error) {
      console.error('Error saving model config:', error);
      if (!options?.silent) {
        toast.error('Failed to save model settings');
      }
      throw error;
    }
  };

  return (
    <div className="space-y-6">
      {showAutoSummaryToggle ? (
        <SettingsSection
          title="Summaries"
        >
          <SettingsCard>
            <SettingsRow
              title="Generate summaries automatically"
            >
              <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
                <Switch
                  checked={isAutoSummary}
                  onCheckedChange={toggleIsAutoSummary}
                  className={SETTINGS_TOGGLE_SWITCH_CLASS}
                />
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      {showProviderSettings ? (
        <SettingsSection>
          <SettingsCard className="pt-1">
            <ModelSettingsModal
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSave={handleSaveModelConfig}
              compact
              skipInitialFetch={true}
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </div>
  );
}



