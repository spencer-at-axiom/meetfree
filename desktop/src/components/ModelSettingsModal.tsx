import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { useOllamaDownload } from '@/contexts/OllamaDownloadContext';
import { ProviderModelStack } from '@/components/ProviderModelStack';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfig } from '@/contexts/ConfigContext';
import {
  SETTINGS_LABEL_CLASS,
  SETTINGS_OUTLINE_BUTTON_CLASS,
  SETTINGS_SELECT_TRIGGER_CLASS,
  SETTINGS_SOLID_BUTTON_CLASS,
  SETTINGS_TEXT_INPUT_CLASS,
} from '@/components/settingsShared';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock, Unlock, Eye, EyeOff, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, ExternalLink, Plus } from 'lucide-react';
import { cn, isOllamaNotInstalledError } from '@/lib/utils';
import { toast } from 'sonner';
import {
  DEFAULT_SUMMARY_PROVIDER,
} from '@/constants/modelDefaults';

export interface ModelConfig {
  provider: 'ollama' | 'groq' | 'claude' | 'openai' | 'openrouter' | 'custom-openai';
  model: string;
  whisperModel: string;
  apiKey?: string | null;
  ollamaEndpoint?: string | null;
  hasStoredKey?: boolean;
  // Custom OpenAI fields
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  hasStoredApiKey?: boolean;
}

const SECRET_BACKED_PROVIDERS = new Set(['claude', 'groq', 'openai', 'openrouter']);

export function sanitizeModelConfig(config: ModelConfig): ModelConfig {
  const typedApiKey = config.apiKey?.trim() || null;
  const typedCustomApiKey = config.customOpenAIApiKey?.trim() || null;

  return {
    ...config,
    apiKey: null,
    customOpenAIApiKey: null,
    hasStoredKey:
      SECRET_BACKED_PROVIDERS.has(config.provider) &&
      Boolean(config.hasStoredKey || typedApiKey),
    hasStoredApiKey:
      config.provider === 'custom-openai' &&
      Boolean(config.hasStoredApiKey || typedCustomApiKey),
  };
}

interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  prompt_price?: string;
  completion_price?: string;
}

interface OpenAIModel {
  id: string;
}

interface GroqModel {
  id: string;
  owned_by?: string;
}

// Fallback models for when API fetch fails or no API key provided
const OPENAI_FALLBACK_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3',
  'o3-mini',
];

const CLAUDE_FALLBACK_MODELS = [
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-3-5-sonnet-latest',
];

const GROQ_FALLBACK_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

interface ModelSettingsModalProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig, options?: ModelSaveOptions) => Promise<void> | void;
  autoSave?: boolean;
  compact?: boolean;
  skipInitialFetch?: boolean; // Optional: skip fetching config from backend if parent manages it
}

export interface ModelSaveOptions {
  silent?: boolean;
}

export function ModelSettingsModal({
  modelConfig: propsModelConfig,
  setModelConfig: propsSetModelConfig,
  onSave,
  autoSave = true,
  compact = false,
  skipInitialFetch = false,
}: ModelSettingsModalProps) {
  // Use ConfigContext if available, fallback to props for backward compatibility
  const configContext = useConfig();
  const modelConfig = configContext?.modelConfig || propsModelConfig;
  const setModelConfig = configContext?.setModelConfig || propsSetModelConfig;

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(!!modelConfig.hasStoredKey);
  const [isLockButtonVibrating, setIsLockButtonVibrating] = useState<boolean>(false);
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [, setOpenRouterError] = useState<string>('');
  const [isLoadingOpenRouter, setIsLoadingOpenRouter] = useState<boolean>(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState<string>(modelConfig.ollamaEndpoint || '');
  const [isLoadingOllama, setIsLoadingOllama] = useState<boolean>(false);
  const [lastFetchedEndpoint, setLastFetchedEndpoint] = useState<string>(modelConfig.ollamaEndpoint || '');
  const [endpointValidationState, setEndpointValidationState] = useState<'valid' | 'invalid' | 'none'>('none');
  const [hasAutoFetched, setHasAutoFetched] = useState<boolean>(false);
  const hasSyncedFromParent = useRef<boolean>(false);
  const hasLoadedInitialConfig = useRef<boolean>(false);
  const [, setAutoGenerateEnabled] = useState<boolean>(true);
  const [isEndpointSectionCollapsed, setIsEndpointSectionCollapsed] = useState<boolean>(true); // Collapsed by default
  const [ollamaNotInstalled, setOllamaNotInstalled] = useState<boolean>(false); // Track if Ollama is not installed

  // Custom OpenAI state
  const [customOpenAIEndpoint, setCustomOpenAIEndpoint] = useState<string>(modelConfig.customOpenAIEndpoint || '');
  const [customOpenAIModel, setCustomOpenAIModel] = useState<string>(modelConfig.customOpenAIModel || '');
  const [customOpenAIApiKey, setCustomOpenAIApiKey] = useState<string>('');
  const [customMaxTokens, setCustomMaxTokens] = useState<string>(modelConfig.maxTokens?.toString() || '');
  const [customTemperature, setCustomTemperature] = useState<string>(modelConfig.temperature?.toString() || '');
  const [customTopP, setCustomTopP] = useState<string>(modelConfig.topP?.toString() || '');
  const [isCustomOpenAIAdvancedOpen, setIsCustomOpenAIAdvancedOpen] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [isAutoSaving, setIsAutoSaving] = useState<boolean>(false);

  // Dynamic model fetching state for OpenAI and Groq (Claude uses curated fallbacks; no list API in app)
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [isLoadingOpenAI, setIsLoadingOpenAI] = useState<boolean>(false);
  const [isLoadingGroq, setIsLoadingGroq] = useState<boolean>(false);

  // Use global download context instead of local state
  const { isDownloading, getProgress, downloadingModels } = useOllamaDownload();

  // Cache models by endpoint to avoid refetching when reverting endpoint changes
  const modelsCache = useRef<Map<string, OllamaModel[]>>(new Map());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitializedAutosaveRef = useRef<boolean>(false);
  const lastPersistedSignatureRef = useRef<string>('');
  const isPersistingRef = useRef<boolean>(false);

  // URL validation helper
  const validateOllamaEndpoint = (url: string): boolean => {
    if (!url.trim()) return true; // Empty is valid (uses default)
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Debounced URL validation with visual feedback
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = ollamaEndpoint.trim();

      if (!trimmed) {
        setEndpointValidationState('none');
      } else if (validateOllamaEndpoint(trimmed)) {
        setEndpointValidationState('valid');
      } else {
        setEndpointValidationState('invalid');
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [ollamaEndpoint]);

  // Auto-unlock when API key becomes empty, 
  useEffect(() => {
    const hasContent = !!apiKey?.trim();
    if (!hasContent) {
      setIsApiKeyLocked(false);
    }
  }, [apiKey]);

  const modelOptions: Record<string, string[]> = {
    ollama: models.map((model) => model.name),
    claude: CLAUDE_FALLBACK_MODELS,
    groq: groqModels.length > 0 ? groqModels : GROQ_FALLBACK_MODELS,
    openai: openaiModels.length > 0 ? openaiModels : OPENAI_FALLBACK_MODELS,
    openrouter: openRouterModels.map((m) => m.id),
    'custom-openai': customOpenAIModel ? [customOpenAIModel] : [], // User specifies model manually
  };

  const requiresApiKey =
    modelConfig.provider === 'claude' ||
    modelConfig.provider === 'groq' ||
    modelConfig.provider === 'openai' ||
    modelConfig.provider === 'openrouter';
  const hasStoredProviderKey = requiresApiKey && Boolean(modelConfig.hasStoredKey);
  const hasStoredCustomOpenAIKey = modelConfig.provider === 'custom-openai' && Boolean(modelConfig.hasStoredApiKey);
  const hasUsableProviderKey = Boolean(apiKey.trim()) || hasStoredProviderKey;
  // Check if Ollama endpoint has changed but models haven't been fetched yet
  const ollamaEndpointChanged = modelConfig.provider === 'ollama' &&
    ollamaEndpoint.trim() !== lastFetchedEndpoint.trim();

  // Custom OpenAI validation
  const isCustomOpenAIInvalid = modelConfig.provider === 'custom-openai' && (
    !customOpenAIEndpoint.trim() ||
    !customOpenAIModel.trim()
  );

  const parseOptionalInt = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : null;
  };

  const parseOptionalFloat = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const maxTokensIsInvalid = customMaxTokens.trim() !== '' && parseOptionalInt(customMaxTokens) === null;
  const temperatureIsInvalid = customTemperature.trim() !== '' && parseOptionalFloat(customTemperature) === null;
  const topPIsInvalid = customTopP.trim() !== '' && parseOptionalFloat(customTopP) === null;
  const hasInvalidCustomOpenAINumbers =
    modelConfig.provider === 'custom-openai' &&
    (maxTokensIsInvalid || temperatureIsInvalid || topPIsInvalid);

  const hasSelectedModel = modelConfig.provider === 'custom-openai'
    ? Boolean(customOpenAIModel.trim())
    : Boolean(modelConfig.model?.trim());

  const isDoneDisabled =
    (requiresApiKey && !hasUsableProviderKey) ||
    (modelConfig.provider === 'ollama' && ollamaEndpointChanged) ||
    isCustomOpenAIInvalid ||
    hasInvalidCustomOpenAINumbers ||
    !hasSelectedModel;

  useEffect(() => {
    const fetchModelConfig = async () => {
      // If parent component manages config, skip fetch and just mark as loaded
      if (skipInitialFetch) {
        hasLoadedInitialConfig.current = true;
        return;
      }

      try {
        const data = (await invoke('model_cfg_get')) as any;
        if (data && data.provider !== null) {
          setModelConfig(data);
          setApiKey('');
          setIsApiKeyLocked(Boolean(data.hasStoredKey));

          // Sync ollamaEndpoint state with fetched config
          if (data.ollamaEndpoint) {
            setOllamaEndpoint(data.ollamaEndpoint);
            // Don't set lastFetchedEndpoint here - it will be set after successful model fetch
          }
          hasLoadedInitialConfig.current = true; // Mark that initial config is loaded

          // Fetch Custom OpenAI config if that's the active provider
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = (await invoke('custom_openai_cfg_get')) as any;
              if (customConfig) {
                setCustomOpenAIEndpoint(customConfig.endpoint || '');
                setCustomOpenAIModel(customConfig.model || '');
                setCustomOpenAIApiKey('');
                setCustomMaxTokens(customConfig.maxTokens?.toString() || '');
                setCustomTemperature(customConfig.temperature?.toString() || '');
                setCustomTopP(customConfig.topP?.toString() || '');
              }
            } catch (err) {
              console.error('Failed to fetch custom OpenAI config:', err);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
        hasLoadedInitialConfig.current = true; // Mark as loaded even on error
      }
    };

    fetchModelConfig();
  }, [skipInitialFetch]);

  // Auto-generate setting removed - this feature is not implemented in backend
  // Keeping state for potential future use, but not fetching from backend
  useEffect(() => {
    // Default to true for now
    setAutoGenerateEnabled(true);
  }, []);

  // Sync ollamaEndpoint state when modelConfig.ollamaEndpoint changes from parent
  useEffect(() => {
    const endpoint = modelConfig.ollamaEndpoint || '';
    if (endpoint !== ollamaEndpoint) {
      setOllamaEndpoint(endpoint);
      // Don't set lastFetchedEndpoint here - only after successful model fetch
    }
    // Only mark as synced if we have a valid provider (prevents race conditions during init)
    if (modelConfig.provider) {
      hasSyncedFromParent.current = true; // Mark that we've received prop value
    }
  }, [modelConfig.ollamaEndpoint, modelConfig.provider]);

  // Sync custom OpenAI state from modelConfig (context or props)
  useEffect(() => {
    if (modelConfig.provider === 'custom-openai') {
      console.log('Syncing custom OpenAI fields from ConfigContext:', {
        endpoint: modelConfig.customOpenAIEndpoint,
        model: modelConfig.customOpenAIModel,
        hasApiKey: !!modelConfig.hasStoredApiKey,
      });

      // Always sync from modelConfig (which comes from context if available)
      setCustomOpenAIEndpoint(modelConfig.customOpenAIEndpoint || '');
      setCustomOpenAIModel(modelConfig.customOpenAIModel || '');
      setCustomOpenAIApiKey('');
      setCustomMaxTokens(modelConfig.maxTokens?.toString() || '');
      setCustomTemperature(modelConfig.temperature?.toString() || '');
      setCustomTopP(modelConfig.topP?.toString() || '');
    }
  }, [
    modelConfig.provider,
    modelConfig.customOpenAIEndpoint,
    modelConfig.customOpenAIModel,
    modelConfig.maxTokens,
    modelConfig.temperature,
    modelConfig.topP,
    modelConfig.hasStoredApiKey,
  ]);

  // Reset hasAutoFetched flag and clear models when switching away from Ollama
  useEffect(() => {
    if (modelConfig.provider !== 'ollama') {
      setHasAutoFetched(false); // Reset flag so it can auto-fetch again if user switches back
      setModels([]); // Clear models list
      setError(''); // Clear any error state
      setOllamaNotInstalled(false); // Reset installation status
    }
  }, [modelConfig.provider]);

  // Handle endpoint changes - restore cached models or clear
  useEffect(() => {
    if (modelConfig.provider === 'ollama' &&
      ollamaEndpoint.trim() !== lastFetchedEndpoint.trim()) {

      // Check if we have cached models for this endpoint (including empty endpoint = default)
      const cachedModels = modelsCache.current.get(ollamaEndpoint.trim());

      if (cachedModels && cachedModels.length > 0) {
        // Restore cached models and update tracking
        setModels(cachedModels);
        setLastFetchedEndpoint(ollamaEndpoint.trim());
        setError('');
      } else {
        // No cache - clear models and allow refetch
        setHasAutoFetched(false);
        setModels([]);
        setError('');
      }
    }
  }, [ollamaEndpoint, lastFetchedEndpoint, modelConfig.provider]);

  // Reset transient API key state when provider or stored-key presence changes
  useEffect(() => {
    if (!requiresApiKey || modelConfig.provider === 'custom-openai') {
      setApiKey('');
      setIsApiKeyLocked(false);
      return;
    }

    setApiKey('');
    setShowApiKey(false);
    setIsApiKeyLocked(Boolean(modelConfig.hasStoredKey));
  }, [modelConfig.provider, modelConfig.hasStoredKey, requiresApiKey]);

  // Manual fetch function for Ollama models
  const fetchOllamaModels = async (silent = false) => {
    const trimmedEndpoint = ollamaEndpoint.trim();

    // Validate URL if provided
    if (trimmedEndpoint && !validateOllamaEndpoint(trimmedEndpoint)) {
      const errorMsg = 'Invalid Ollama endpoint URL. Must start with http:// or https://';
      setError(errorMsg);
      if (!silent) {
        toast.error(errorMsg);
      }
      return;
    }

    setIsLoadingOllama(true);
    setError(''); // Clear previous errors

    try {
      const endpoint = trimmedEndpoint || null;
      const modelList = (await invoke('get_ollama_models', { endpoint })) as OllamaModel[];
      setModels(modelList);
      setLastFetchedEndpoint(trimmedEndpoint); // Track successful fetch

      // Cache the fetched models for this endpoint
      modelsCache.current.set(trimmedEndpoint, modelList);

      // Successfully fetched models, Ollama is installed
      setOllamaNotInstalled(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to load Ollama models';
      setError(errorMsg);

      // Check if error indicates Ollama is not installed
      if (isOllamaNotInstalledError(errorMsg)) {
        setOllamaNotInstalled(true);
      } else {
        setOllamaNotInstalled(false);
      }

      if (!silent) {
        toast.error(errorMsg);
      }
      console.error('Error loading models:', err);
    } finally {
      setIsLoadingOllama(false);
    }
  };

  // Auto-fetch models on initial load only (not on endpoint changes)
  useEffect(() => {
    let mounted = true;

    const initialLoad = async () => {
      // Only auto-fetch on initial load if:
      // 1. Provider is ollama
      // 2. Haven't fetched yet
      // 3. Component is still mounted
      // If skipInitialFetch is true, fetch silently (no error toasts)
      if (modelConfig.provider === 'ollama' &&
        !hasAutoFetched &&
        mounted) {
        await fetchOllamaModels(skipInitialFetch); // Silent if skipInitialFetch=true
        setHasAutoFetched(true);
      }
    };

    initialLoad();

    return () => {
      mounted = false;
    };
  }, [modelConfig.provider]); // Only depend on provider, NOT endpoint

  const loadOpenRouterModels = async () => {
    if (openRouterModels.length > 0) return; // Already loaded

    try {
      setIsLoadingOpenRouter(true);
      setOpenRouterError('');
      const data = (await invoke('get_openrouter_models')) as OpenRouterModel[];
      setOpenRouterModels(data);
    } catch (err) {
      console.error('Error loading OpenRouter models:', err);
      setOpenRouterError(
        err instanceof Error ? err.message : 'Failed to load OpenRouter models'
      );
    } finally {
      setIsLoadingOpenRouter(false);
    }
  };

  // Fetch OpenAI models from API
  const loadOpenAIModels = async (key: string | null) => {
    setIsLoadingOpenAI(true);
    try {
      const data = (await invoke('get_openai_models', { apiKey: key?.trim() || null })) as OpenAIModel[];
      setOpenaiModels(data.map((m) => m.id));
    } catch (err) {
      console.error('Error loading OpenAI models:', err);
      setOpenaiModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingOpenAI(false);
    }
  };

  // Fetch Groq models from API
  const loadGroqModels = async (key: string | null) => {
    setIsLoadingGroq(true);
    try {
      const data = (await invoke('get_groq_models', { apiKey: key?.trim() || null })) as GroqModel[];
      setGroqModels(data.map((m) => m.id));
    } catch (err) {
      console.error('Error loading Groq models:', err);
      setGroqModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingGroq(false);
    }
  };

  // Auto-fetch OpenAI models when provider is openai and we have an API key
  useEffect(() => {
    if (modelConfig.provider === 'openai' && (apiKey.trim() || hasStoredProviderKey)) {
      loadOpenAIModels(apiKey.trim() || null);
    }
  }, [modelConfig.provider, apiKey, hasStoredProviderKey]);

  // Auto-fetch Groq models when provider is groq and we have an API key
  useEffect(() => {
    if (modelConfig.provider === 'groq' && (apiKey.trim() || hasStoredProviderKey)) {
      loadGroqModels(apiKey.trim() || null);
    }
  }, [modelConfig.provider, apiKey, hasStoredProviderKey]);

  // Restore cached model when async model lists become available
  useEffect(() => {
    const providerModels = modelOptions[modelConfig.provider];
    if (!providerModels || providerModels.length === 0) return;

    // If current model is already valid, nothing to do
    if (modelConfig.model && providerModels.includes(modelConfig.model)) return;

    // Try to restore from localStorage cache
    const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
    const cachedModel = map[modelConfig.provider];
    if (cachedModel && providerModels.includes(cachedModel)) {
      setModelConfig((prev: ModelConfig) => ({ ...prev, model: cachedModel }));
      return;
    }

    // Fall back to the first available model so provider changes cannot remain model-less.
    setModelConfig((prev: ModelConfig) => ({ ...prev, model: providerModels[0] }));
  }, [models, openRouterModels, openaiModels, groqModels, modelConfig.provider, modelConfig.model, setModelConfig]);

  const buildUpdatedConfig = useCallback((): ModelConfig => ({
    ...modelConfig,
    apiKey: typeof apiKey === 'string' ? apiKey.trim() || null : null,
    ollamaEndpoint: modelConfig.provider === 'ollama'
      ? (ollamaEndpoint.trim() || null)
      : (modelConfig.ollamaEndpoint || null),
    hasStoredKey:
      modelConfig.provider !== 'custom-openai' &&
      Boolean(modelConfig.hasStoredKey || apiKey.trim()),
    customOpenAIEndpoint: modelConfig.provider === 'custom-openai' ? customOpenAIEndpoint.trim() : null,
    customOpenAIModel: modelConfig.provider === 'custom-openai' ? customOpenAIModel.trim() : null,
    customOpenAIApiKey:
      modelConfig.provider === 'custom-openai' && customOpenAIApiKey.trim()
        ? customOpenAIApiKey.trim()
        : null,
    maxTokens:
      modelConfig.provider === 'custom-openai'
        ? parseOptionalInt(customMaxTokens)
        : null,
    temperature:
      modelConfig.provider === 'custom-openai'
        ? parseOptionalFloat(customTemperature)
        : null,
    topP:
      modelConfig.provider === 'custom-openai'
        ? parseOptionalFloat(customTopP)
        : null,
    hasStoredApiKey:
      modelConfig.provider === 'custom-openai' &&
      Boolean(modelConfig.hasStoredApiKey || customOpenAIApiKey.trim()),
    model: modelConfig.provider === 'custom-openai' ? customOpenAIModel.trim() : modelConfig.model,
  }), [
    apiKey,
    customMaxTokens,
    customOpenAIApiKey,
    customOpenAIEndpoint,
    customOpenAIModel,
    customTemperature,
    customTopP,
    modelConfig,
    ollamaEndpoint,
  ]);

  const persistConfig = useCallback(
    async (options: ModelSaveOptions = {}) => {
      if (isDoneDisabled) {
        if (!options.silent) {
          toast.error('Complete required fields before saving');
        }
        return;
      }

      const updatedConfig = buildUpdatedConfig();
      if (!updatedConfig.model?.trim()) {
        if (!options.silent) {
          toast.error('Select a model before saving');
        }
        return;
      }

      const signature = JSON.stringify(updatedConfig);
      if (options.silent && signature === lastPersistedSignatureRef.current) {
        return;
      }

      if (isPersistingRef.current) {
        return;
      }

      isPersistingRef.current = true;
      if (options.silent) {
        setIsAutoSaving(true);
      }

      try {
        if (updatedConfig.provider === 'custom-openai') {
          await invoke('custom_openai_cfg_set', {
            endpoint: customOpenAIEndpoint.trim(),
            apiKey: customOpenAIApiKey.trim() || null,
            model: customOpenAIModel.trim(),
            maxTokens: parseOptionalInt(customMaxTokens),
            temperature: parseOptionalFloat(customTemperature),
            topP: parseOptionalFloat(customTopP),
          });
        }

        if (updatedConfig.model) {
          const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
          map[updatedConfig.provider] = updatedConfig.model;
          localStorage.setItem('providerModelMap', JSON.stringify(map));
        }

        await onSave(updatedConfig, options);
        lastPersistedSignatureRef.current = signature;
      } catch (error) {
        if (!options.silent) {
          toast.error('Failed to save model settings');
        }
        throw error;
      } finally {
        isPersistingRef.current = false;
        if (options.silent) {
          setIsAutoSaving(false);
        }
      }
    },
    [
      buildUpdatedConfig,
      customMaxTokens,
      customOpenAIApiKey,
      customOpenAIEndpoint,
      customOpenAIModel,
      customTemperature,
      customTopP,
      isDoneDisabled,
      onSave,
      parseOptionalFloat,
      parseOptionalInt,
    ]
  );

  const handleSave = async () => {
    await persistConfig({ silent: false });
  };

  useEffect(() => {
    if (!autoSave) {
      return;
    }

    if (!hasLoadedInitialConfig.current || !hasSyncedFromParent.current) {
      return;
    }

    const currentSignature = JSON.stringify(buildUpdatedConfig());

    if (!hasInitializedAutosaveRef.current) {
      hasInitializedAutosaveRef.current = true;
      lastPersistedSignatureRef.current = currentSignature;
      return;
    }

    if (isDoneDisabled || currentSignature === lastPersistedSignatureRef.current) {
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistConfig({ silent: true }).catch((error) => {
        console.error('Autosave failed:', error);
      });
    }, 500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [autoSave, buildUpdatedConfig, isDoneDisabled, persistConfig]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  // Test custom OpenAI connection
  const testCustomOpenAIConnection = async () => {
    if (!customOpenAIEndpoint.trim() || !customOpenAIModel.trim()) {
      toast.error('Please enter endpoint URL and model name first');
      return;
    }

    setIsTestingConnection(true);
    try {
      const result = await invoke<{ status: string; message: string }>('custom_openai_conn_test', {
        endpoint: customOpenAIEndpoint.trim(),
        apiKey: customOpenAIApiKey.trim() || null,
        model: customOpenAIModel.trim(),
      });
      toast.success(result.message || 'Connection successful!');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(errorMsg);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const clearStoredProviderKey = async () => {
    if (!SECRET_BACKED_PROVIDERS.has(modelConfig.provider)) {
      return;
    }

    try {
      await invoke('provider_api_key_delete', { provider: modelConfig.provider });
      setApiKey('');
      setShowApiKey(false);
      setIsApiKeyLocked(false);
      setModelConfig((prev: ModelConfig) => ({ ...prev, hasStoredKey: false }));
      toast.success('Stored API key cleared');
    } catch (err) {
      console.error('Failed to clear stored API key:', err);
      toast.error('Failed to clear stored API key');
    }
  };

  const clearStoredCustomOpenAIKey = async () => {
    try {
      await invoke('provider_api_key_delete', { provider: 'custom-openai' });
      setCustomOpenAIApiKey('');
      setModelConfig((prev: ModelConfig) => ({ ...prev, hasStoredApiKey: false }));
      toast.success('Stored custom API key cleared');
    } catch (err) {
      console.error('Failed to clear stored custom API key:', err);
      toast.error('Failed to clear stored custom API key');
    }
  };

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  // Function to download recommended model
  const downloadRecommendedModel = async () => {
    const recommendedModel = 'gemma3:1b'; // Default recommended model

    // Prevent duplicate downloads (defense in depth - backend also checks)
    if (isDownloading(recommendedModel)) {
      toast.info(`${recommendedModel} is already downloading`, {
        description: `Progress: ${Math.round(getProgress(recommendedModel) || 0)}%`
      });
      return;
    }

    try {
      const endpoint = ollamaEndpoint.trim() || null;

      // The download will be tracked by the global context via events
      // Progress toasts are shown automatically by OllamaDownloadContext
      await invoke('pull_ollama_model', {
        modelName: recommendedModel,
        endpoint
      });

      // Refresh the models list after successful download
      await fetchOllamaModels(true);

      // Note: Model is NOT auto-selected - user must explicitly choose it
      // This respects the database as the single source of truth
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to download model';
      console.error('Error downloading model:', err);

      // Check if Ollama is not installed and show appropriate error
      if (isOllamaNotInstalledError(errorMsg)) {
        toast.error('Ollama is not installed', {
          description: 'Please download and install Ollama before downloading models.',
          duration: 7000,
          action: {
            label: 'Download',
            onClick: () => invoke('external_url_open', { url: 'https://ollama.com/download' })
          }
        });
        // Update the installation status flag
        setOllamaNotInstalled(true);
      }
      // Other errors are handled by the context
    }
  };

  // Track previous downloading models to detect completions
  const previousDownloadingRef = useRef<Set<string>>(new Set());

  // Refresh models list when download completes
  useEffect(() => {
    const current = downloadingModels;
    const previous = previousDownloadingRef.current;

    // Check if any downloads completed (were in previous, not in current)
    for (const modelName of previous) {
      if (!current.has(modelName)) {
        // Download completed, refresh models list
        console.log(`[ModelSettingsModal] Download completed for ${modelName}, refreshing list`);
        fetchOllamaModels(true);
        break; // Only refresh once even if multiple completed
      }
    }

    // Update ref for next comparison
    previousDownloadingRef.current = new Set(current);
  }, [downloadingModels]);

  const compactLabelClass = compact
    ? 'text-[13px] font-medium leading-5 text-slate-950'
    : undefined;

  const compactModelControlClass = compact
    ? 'w-full sm:w-[240px]'
    : 'w-full sm:max-w-[320px]';

  return (
    <div className="text-[13px] text-slate-700">
      <div className="space-y-5">
        <ProviderModelStack
          labelClassName={compactLabelClass}
          providerControl={
            <div className={compact ? 'w-full sm:w-[240px]' : 'w-full sm:max-w-[240px]'}>
              <Select
                value={modelConfig.provider}
                onValueChange={(value) => {
                  const provider = value as ModelConfig['provider'];

                  // Clear error state when switching providers
                  setError('');

                  // Save current provider's model to localStorage before switching
                  const map = JSON.parse(localStorage.getItem('providerModelMap') || '{}');
                  if (modelConfig.model) {
                    map[modelConfig.provider] = modelConfig.model;
                    localStorage.setItem('providerModelMap', JSON.stringify(map));
                  }

                  // Try to restore cached model for the new provider
                  const savedModel = map[provider];
                  const providerModels = modelOptions[provider];
                  const defaultModel =
                    providerModels && providerModels.length > 0
                      ? providerModels[0]
                      : provider === DEFAULT_SUMMARY_PROVIDER
                        ? 'gemma3:1b' // Default recommended model
                        : '';
                  const model =
                    savedModel &&
                    (!providerModels ||
                      providerModels.length === 0 ||
                      providerModels.includes(savedModel))
                      ? savedModel
                      : defaultModel;

                  setModelConfig({
                    ...modelConfig,
                    provider,
                    model,
                  });
                  // Load OpenRouter models only when OpenRouter is selected
                  if (provider === 'openrouter') {
                    loadOpenRouterModels();
                  }

                  // Load custom OpenAI config when selected
                  if (provider === 'custom-openai') {
                    invoke<any>('custom_openai_cfg_get')
                      .then((config) => {
                        if (config) {
                          setModelConfig((prev: ModelConfig) => ({
                            ...prev,
                            customOpenAIEndpoint: config.endpoint || null,
                            customOpenAIModel: config.model || null,
                            maxTokens: config.maxTokens || null,
                            temperature: config.temperature || null,
                            topP: config.topP || null,
                            hasStoredApiKey: !!config.hasStoredApiKey,
                            model: config.model || prev.model,
                          }));
                          setCustomOpenAIEndpoint(config.endpoint || '');
                          setCustomOpenAIModel(config.model || '');
                          setCustomOpenAIApiKey('');
                          setCustomMaxTokens(config.maxTokens?.toString() || '');
                          setCustomTemperature(config.temperature?.toString() || '');
                          setCustomTopP(config.topP?.toString() || '');
                        }
                      })
                      .catch((err) => {
                        console.error('Failed to load custom OpenAI config:', err);
                      });
                  }
                }}
              >
                <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent className="max-h-64 overflow-y-auto">
                  <SelectGroup>
                    <SelectLabel>Local</SelectLabel>
                    <SelectItem value="ollama">Ollama</SelectItem>
                  </SelectGroup>

                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Hosted</SelectLabel>
                    <SelectItem value="claude">Anthropic Claude</SelectItem>
                    <SelectItem value="custom-openai">OpenAI-Compatible</SelectItem>
                    <SelectItem value="groq">Groq</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          }
          modelDescription={
            compact ? null : modelConfig.provider === 'custom-openai' ? (
              <p className="text-[12px] text-slate-500">
                Enter the model id exposed by your endpoint.
              </p>
            ) : null
          }
          modelControl={
            modelConfig.provider === 'custom-openai' ? (
              <div className={compactModelControlClass}>
                <Input
                  id="custom-model-inline"
                  value={customOpenAIModel}
                  onChange={(e) => setCustomOpenAIModel(e.target.value)}
                  placeholder="gpt-4, llama-3-70b, etc."
                  className={`${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
                />
              </div>
            ) : modelConfig.provider === 'ollama' ? (
              isLoadingOllama ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Loading models...
                </div>
              ) : models.length > 0 && !ollamaEndpointChanged ? (
                <div className={compactModelControlClass}>
                  <Select
                    value={modelConfig.model}
                    onValueChange={(value) => {
                      setModelConfig((prev: ModelConfig) => ({ ...prev, model: value }));
                    }}
                  >
                    <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((model) => (
                        <SelectItem key={model.id} value={model.name}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">
                  No local models ready. Use the actions below to fetch or download one.
                </p>
              )
            ) : (
              ((modelConfig.provider === 'openrouter' && isLoadingOpenRouter) ||
              (modelConfig.provider === 'openai' && isLoadingOpenAI) ||
              (modelConfig.provider === 'groq' && isLoadingGroq)) ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Loading models...
                </div>
              ) : (
                <div className={compactModelControlClass}>
                  <Select
                    value={
                      modelOptions[modelConfig.provider]?.includes(modelConfig.model)
                        ? modelConfig.model
                        : ''
                    }
                    onValueChange={(value) => {
                      setModelConfig((prev: ModelConfig) => ({ ...prev, model: value }));
                    }}
                    disabled={!modelOptions[modelConfig.provider]?.length}
                  >
                    <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
                      <SelectValue
                        placeholder={
                          modelOptions[modelConfig.provider]?.length
                            ? 'Select model'
                            : 'No models found'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions[modelConfig.provider]?.length ? (
                        modelOptions[modelConfig.provider].map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__no_models__" disabled>
                          No models found.
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )
            )
          }
        />

        {/* Custom OpenAI Configuration Section */}
        {modelConfig.provider === 'custom-openai' && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            <div>
              <Label htmlFor="custom-endpoint" className={SETTINGS_LABEL_CLASS}>Endpoint URL</Label>
              <Input
                id="custom-endpoint"
                value={customOpenAIEndpoint}
                onChange={(e) => setCustomOpenAIEndpoint(e.target.value)}
                placeholder="http://localhost:8000/v1"
                className={`mt-2 ${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
              />
            </div>

            <div>
              <Label htmlFor="custom-api-key" className={SETTINGS_LABEL_CLASS}>API Key</Label>
              <Input
                id="custom-api-key"
                type="password"
                value={customOpenAIApiKey}
                onChange={(e) => setCustomOpenAIApiKey(e.target.value)}
                placeholder={hasStoredCustomOpenAIKey ? 'Stored key on file. Enter a new value to replace it.' : 'Leave empty if not required'}
                className={`mt-2 ${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
              />
              {hasStoredCustomOpenAIKey && !customOpenAIApiKey.trim() && (
                <div className="mt-2 flex items-center justify-between gap-3 border-l border-slate-200 pl-3 text-[11px] text-slate-500">
                  <span>Stored API key on file. Leave blank to keep it, or clear it explicitly.</span>
                    <Button type="button" variant="outline" size="sm" className={SETTINGS_OUTLINE_BUTTON_CLASS} onClick={clearStoredCustomOpenAIKey}>
                    Clear Stored Key
                  </Button>
                </div>
              )}
            </div>

            {/* Advanced Options (Collapsible) */}
            <div>
              <div
                className="flex cursor-pointer items-center justify-between py-2"
                onClick={() => setIsCustomOpenAIAdvancedOpen(!isCustomOpenAIAdvancedOpen)}
              >
                <Label className={SETTINGS_LABEL_CLASS}>Advanced</Label>
                {isCustomOpenAIAdvancedOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {isCustomOpenAIAdvancedOpen && (
                  <div className="mt-2 space-y-3 border-l-2 border-slate-200 pl-3">
                  <div>
                    <Label htmlFor="custom-max-tokens">Max Tokens</Label>
                    <Input
                      id="custom-max-tokens"
                      type="number"
                      value={customMaxTokens}
                      onChange={(e) => setCustomMaxTokens(e.target.value)}
                      placeholder="e.g., 4096"
                      className={`mt-1 ${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
                    />
                  </div>
                  <div>
                    <Label htmlFor="custom-temperature">Temperature (0.0-2.0)</Label>
                    <Input
                      id="custom-temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={customTemperature}
                      onChange={(e) => setCustomTemperature(e.target.value)}
                      placeholder="e.g., 0.7"
                      className={`mt-1 ${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
                    />
                  </div>
                  <div>
                    <Label htmlFor="custom-top-p">Top P (0.0-1.0)</Label>
                    <Input
                      id="custom-top-p"
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={customTopP}
                      onChange={(e) => setCustomTopP(e.target.value)}
                      placeholder="e.g., 0.9"
                      className={`mt-1 ${SETTINGS_TEXT_INPUT_CLASS} font-normal`}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Test Connection Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={testCustomOpenAIConnection}
              disabled={isTestingConnection || !customOpenAIEndpoint.trim() || !customOpenAIModel.trim()}
              className={`${SETTINGS_OUTLINE_BUTTON_CLASS} w-full`}
            >
              {isTestingConnection ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Testing Connection...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Test Connection
                </>
              )}
            </Button>
          </div>
        )}

        {requiresApiKey && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <Label className={SETTINGS_LABEL_CLASS}>API Key</Label>
              {hasStoredProviderKey && !apiKey.trim() && (
                <Button type="button" variant="outline" size="sm" className={SETTINGS_OUTLINE_BUTTON_CLASS} onClick={clearStoredProviderKey}>
                  Clear Stored Key
                </Button>
              )}
            </div>
            <div className="relative mt-1">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey || ''}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={isApiKeyLocked}
                placeholder={hasStoredProviderKey && !apiKey.trim() ? 'Stored key on file. Enter a new value to replace it.' : 'Enter your API key'}
                className={`${SETTINGS_TEXT_INPUT_CLASS} pr-24 font-normal`}
              />
              {isApiKeyLocked && (hasStoredProviderKey || apiKey.trim()) && (
                <div
                  onClick={handleInputClick}
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/50 cursor-not-allowed"
                />
              )}
              <div className="absolute inset-y-0 right-0 pr-1 flex items-center space-x-1">
                {(hasStoredProviderKey || apiKey.trim()) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                    className={isLockButtonVibrating ? 'animate-vibrate text-red-500' : ''}
                    title={isApiKeyLocked ? 'Unlock to edit' : 'Lock to prevent editing'}
                  >
                    {isApiKeyLocked ? <Lock /> : <Unlock />}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            {hasStoredProviderKey && !apiKey.trim() && (
              <p className="mt-2 text-[12px] text-slate-500">
                A stored key exists for this provider. Leave the field blank to keep it, or enter a new value to replace it.
              </p>
            )}
          </div>
        )}

        {modelConfig.provider === 'ollama' && (isLoadingOllama || models.length === 0) && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            {isLoadingOllama ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="mx-auto h-8 w-8 animate-spin mb-2" />
                Loading models...
              </div>
            ) : models.length === 0 ? (
              <div className="space-y-3">
                {ollamaNotInstalled ? (
                  /* Show Ollama download link when not installed */
                  <div className="space-y-4">
                    <Alert className="border-slate-200 bg-transparent">
                      <AlertDescription className="text-[12px] text-slate-700">
                        Ollama is not installed or not running. Please download and install Ollama to use local models.
                      </AlertDescription>
                    </Alert>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => invoke('external_url_open', { url: 'https://ollama.com/download' })}
                      className={`${SETTINGS_OUTLINE_BUTTON_CLASS} w-full`}
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Install Ollama
                    </Button>
                    <div className="text-center text-[12px] text-slate-500">
                      After installing Ollama, restart this application and click "Fetch Models" to continue.
                    </div>
                  </div>
                ) : (
                  /* Show model download option when Ollama is installed but no models */
                  <>
                    <Alert className="mb-4">
                      <AlertDescription>
                        {ollamaEndpointChanged
                          ? 'Endpoint changed. Click "Fetch Models" to load models from the new endpoint.'
                          : 'No local models found. Download gemma3:1b or fetch the current Ollama model list.'}
                      </AlertDescription>
                    </Alert>
                    {!ollamaEndpointChanged && (
                      <div className="space-y-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={downloadRecommendedModel}
                          disabled={isDownloading('gemma3:1b')}
                          className={`${SETTINGS_OUTLINE_BUTTON_CLASS} w-full gap-1.5`}
                        >
                          {isDownloading('gemma3:1b') ? (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                              Downloading gemma3:1b...
                            </>
                          ) : (
                            <>
                              <Plus className="mr-1 h-4 w-4" />
                              Download Model
                            </>
                          )}
                        </Button>

                        {/* Show progress for gemma3:1b download */}
                        {isDownloading('gemma3:1b') && getProgress('gemma3:1b') !== undefined && (
                          <div className="border-l border-slate-200 pl-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[12px] font-medium text-slate-700">Downloading gemma3:1b</span>
                              <span className="text-[12px] font-semibold text-slate-900">
                                {Math.round(getProgress('gemma3:1b')!)}%
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-slate-900 transition-all duration-300"
                                style={{ width: `${getProgress('gemma3:1b')}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {modelConfig.provider === 'ollama' && (
          <div className="border-t border-slate-200 pt-4">
            <div
              className="flex cursor-pointer items-center justify-between py-2"
              onClick={() => setIsEndpointSectionCollapsed(!isEndpointSectionCollapsed)}
            >
              <Label className={SETTINGS_LABEL_CLASS}>
                Advanced
              </Label>
              {isEndpointSectionCollapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {!isEndpointSectionCollapsed && (
              <div className="space-y-3 pt-2">
                <div>
                  <Label className={SETTINGS_LABEL_CLASS}>
                    Custom Ollama Endpoint
                  </Label>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Leave this empty unless Ollama is running on a different URL or another machine.
                  </p>
                </div>
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type="url"
                      value={ollamaEndpoint}
                      onChange={(e) => {
                        setOllamaEndpoint(e.target.value);
                        if (e.target.value.trim() !== lastFetchedEndpoint.trim()) {
                          setModels([]);
                          setError('');
                        }
                      }}
                      placeholder="http://localhost:11434"
                      className={cn(
                        SETTINGS_TEXT_INPUT_CLASS,
                        'pr-10 font-normal',
                        endpointValidationState === 'invalid' && 'border-red-500'
                      )}
                    />
                    {endpointValidationState === 'valid' && (
                      <CheckCircle2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-green-500" />
                    )}
                    {endpointValidationState === 'invalid' && (
                      <XCircle className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-red-500" />
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => fetchOllamaModels()}
                    disabled={isLoadingOllama}
                    variant="outline"
                    className={`${SETTINGS_OUTLINE_BUTTON_CLASS} whitespace-nowrap`}
                  >
                    {isLoadingOllama ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Fetch Models
                      </>
                    )}
                  </Button>
                </div>
                {ollamaEndpointChanged && !error && (
                  <Alert className="border-slate-200 bg-transparent">
                    <AlertDescription className="text-[12px] text-slate-700">
                      Fetch models after changing the Ollama endpoint so the list stays accurate.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {compact && autoSave ? null : (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            {autoSave
              ? isAutoSaving
                ? 'Saving changes...'
                : 'Changes save automatically.'
              : 'Click Save to apply changes.'}
          </p>
          <Button
            className={cn(
              SETTINGS_SOLID_BUTTON_CLASS,
              isDoneDisabled && 'cursor-not-allowed bg-slate-400 hover:bg-slate-400'
            )}
            onClick={handleSave}
            disabled={isDoneDisabled}
          >
            {autoSave ? 'Save Now' : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}



