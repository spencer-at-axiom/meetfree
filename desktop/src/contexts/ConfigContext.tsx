'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import type { TranscriptModelProps } from '@/types/config';
import { SelectedDevices } from '@/components/DeviceSelection';
import { configService, ModelConfig } from '@/services/configService';
import { invoke } from '@tauri-apps/api/core';
import { buildSetAppPreferencesPayload } from '@/lib/tauriContracts';
import {
  DEFAULT_PARAKEET_MODEL,
  DEFAULT_SUMMARY_PROVIDER,
} from '@/constants/modelDefaults';
import {
  normalizeSelectedDeviceName,
  readBooleanPreference,
  readStringPreference,
  seedProviderModelMap,
  writeBooleanPreference,
  writeStringPreference,
} from '@/contexts/config/storage';

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface StorageLocations {
  database: string;
  models: string;
  recordings: string;
}

export interface NotificationSettings {
  recording_notifications: boolean;
  time_based_reminders: boolean;
  meeting_reminders: boolean;
  respect_do_not_disturb: boolean;
  notification_sound: boolean;
  system_permission_granted: boolean;
  consent_given: boolean;
  manual_dnd_mode: boolean;
  notification_preferences: {
    show_recording_started: boolean;
    show_recording_stopped: boolean;
    show_recording_paused: boolean;
    show_recording_resumed: boolean;
    show_transcription_complete: boolean;
    show_meeting_reminders: boolean;
    show_system_errors: boolean;
    meeting_reminder_minutes: number[];
  };
}

export interface TranscriptCleanupPreferences {
  enabled: boolean;
  remove_fillers: boolean;
}

export interface AppPreferences {
  auto_export_markdown_on_finalize: boolean;
  transcript_cleanup: TranscriptCleanupPreferences;
  transcription_timeout_seconds: number;
}

interface ConfigContextType {
  // Model configuration
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;

  // Transcript model configuration
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps)) => void;
  setTranscriptModelConfigPersisted: (config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps)) => Promise<void>;

  // Device configuration
  selectedDevices: SelectedDevices;
  setSelectedDevices: (devices: SelectedDevices) => void;
  setSelectedDevicesPersisted: (devices: SelectedDevices) => Promise<void>;

  // Language preference
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;

  // UI preferences
  showConfidenceIndicator: boolean;
  toggleConfidenceIndicator: (checked: boolean) => void;

  // Ollama models
  models: OllamaModel[];
  modelOptions: Record<ModelConfig['provider'], string[]>;
  error: string;

  // Summary configuration
  isAutoSummary: boolean;
  toggleIsAutoSummary: (checked: boolean) => void;

  // Preference settings (lazy loaded)
  notificationSettings: NotificationSettings | null;
  storageLocations: StorageLocations | null;
  appPreferences: AppPreferences | null;
  isLoadingPreferences: boolean;
  loadPreferences: () => Promise<void>;
  updateNotificationSettings: (settings: NotificationSettings) => Promise<void>;
  updateAppPreferences: (preferences: AppPreferences) => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  // Model configuration state
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: '', // Will be loaded from saved config or set by user
    whisperModel: 'large-v3',
    ollamaEndpoint: null
  });

  // Transcript model configuration state
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: DEFAULT_PARAKEET_MODEL,
    apiKey: null,
    hasStoredKey: false,
  });

  // Persisted setter for transcript model config (updates both React state and Rust backend)
  const setTranscriptModelConfigPersisted = useCallback(async (
    config: TranscriptModelProps | ((prev: TranscriptModelProps) => TranscriptModelProps)
  ) => {
    const newConfig = typeof config === 'function' ? config(transcriptModelConfig) : config;
    
    // Optimistically update React state
    setTranscriptModelConfig(newConfig);
    
    try {
      // Persist to Rust backend
      await invoke('transcript_cfg_set', {
        provider: newConfig.provider,
        model: newConfig.model,
        apiKey: newConfig.apiKey,
        authToken: null,
      });
      console.log('[ConfigContext] Persisted transcript config:', newConfig);
    } catch (error) {
      console.error('[ConfigContext] Failed to persist transcript config:', error);
      // Revert on error
      setTranscriptModelConfig(transcriptModelConfig);
      throw error;
    }
  }, [transcriptModelConfig]);

  // Ollama models list and error state
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>('');

  // Device configuration state
  const [selectedDevices, setSelectedDevices] = useState<SelectedDevices>({
    micDevice: null,
    systemDevice: null
  });

  // Persisted setter for device selection (updates both React state and Rust backend)
  const setSelectedDevicesPersisted = useCallback(async (devices: SelectedDevices) => {
    const previousDevices = selectedDevices;
    const normalizedDevices = {
      micDevice: normalizeSelectedDeviceName(devices.micDevice),
      systemDevice: normalizeSelectedDeviceName(devices.systemDevice),
    };

    // Optimistically update React state
    setSelectedDevices(normalizedDevices);
    
    try {
      // Load current preferences
      const currentPrefs = await configService.getRecordingPreferences();
      
      // Merge with new device selection
      const updatedPrefs = {
        ...currentPrefs,
        preferred_mic_device: normalizedDevices.micDevice,
        preferred_system_device: normalizedDevices.systemDevice,
      };
      
      // Persist to Rust backend
      await invoke('set_recording_preferences', { preferences: updatedPrefs });
      console.log('[ConfigContext] Persisted device preferences:', normalizedDevices);
    } catch (error) {
      console.error('[ConfigContext] Failed to persist device preferences:', error);
      setSelectedDevices(previousDevices);
      throw error;
    }
  }, [selectedDevices]);

  // Language preference state
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    return readStringPreference('primaryLanguage', 'auto');
  });

  // UI preferences state
  const [showConfidenceIndicator, setShowConfidenceIndicator] = useState<boolean>(() => {
    return readBooleanPreference('showConfidenceIndicator', true);
  });

  // Summary configs
  const [isAutoSummary, setisAutoSummary] = useState<boolean>(() => {
    return readBooleanPreference('isAutoSummary', false);
  });

  // Preference settings state (lazy loaded)
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(null);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const preferencesLoadedRef = useRef(false);
  const isLoadingRef = useRef(false);

  // Load app-level preferences at startup so transcript display behavior is consistent
  useEffect(() => {
    const loadAppPreferences = async () => {
      try {
        const preferences = await invoke<AppPreferences>('get_app_preferences');
        setAppPreferences(preferences);
      } catch (error) {
        console.error('[ConfigContext] Failed to load app preferences at startup:', error);
      }
    };

    loadAppPreferences();
  }, []);

  // Load Ollama models (uses saved endpoint, re-runs when endpoint changes after config load)
  useEffect(() => {
    const loadModels = async () => {
      try {
        const endpoint = modelConfig.ollamaEndpoint || null;
        const modelList = await invoke<OllamaModel[]>('get_ollama_models', { endpoint });
        setModels(modelList);
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Ollama models');
        console.error('Error loading models:', err);
      }
    };
    loadModels();
  }, [modelConfig.ollamaEndpoint]);

  // Load transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await configService.getTranscriptConfig();
        if (config) {
          console.log('[ConfigContext] Loaded saved transcript config:', config);
          setTranscriptModelConfig({
            provider: config.provider || 'parakeet',
            model: config.model || DEFAULT_PARAKEET_MODEL,
            apiKey: null,
            hasStoredKey: config.hasStoredKey || false,
          });
        }
      } catch (error) {
        console.error('[ConfigContext] Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, []);

  // Sync language preference to Rust on mount (fixes startup desync bug)
  useEffect(() => {
    if (!selectedLanguage) {
      return;
    }

    invoke('set_language_preference', { language: selectedLanguage })
      .catch(err => {
        console.error('[ConfigContext] Failed to sync language preference to Rust:', err);
      });
  }, [selectedLanguage]);

  // Load model configuration on mount
  useEffect(() => {
    const fetchModelConfig = async () => {
      try {
        const data = await configService.getModelConfig();
        if (data && data.provider) {
          // If provider is custom-openai, fetch the additional config
          if (data.provider === 'custom-openai') {
            try {
              const customConfig = await configService.getCustomOpenAIConfig();
              if (customConfig) {
                // Merge custom config fields into modelConfig
                console.log('[ConfigContext] Loading custom OpenAI config:', {
                  endpoint: customConfig.endpoint,
                  model: customConfig.model,
                });
                const resolvedModel = customConfig.model || data.model || '';
                setModelConfig(prev => ({
                  ...prev,
                  provider: data.provider,
                  model: resolvedModel || prev.model,
                  whisperModel: data.whisperModel || prev.whisperModel,
                  hasStoredKey: data.hasStoredKey || false,
                  customOpenAIEndpoint: customConfig.endpoint,
                  customOpenAIModel: customConfig.model,
                  maxTokens: customConfig.maxTokens,
                  temperature: customConfig.temperature,
                  topP: customConfig.topP,
                  hasStoredApiKey: customConfig.hasStoredApiKey,
                }));

                // Seed per-provider model cache from DB
                if (resolvedModel) {
                  seedProviderModelMap(data.provider, resolvedModel);
                }

                return; // Early return
              }
            } catch (err) {
              console.error('[ConfigContext] Failed to fetch custom OpenAI config:', err);
            }
          }

          // For non-custom-openai providers, just set base config
          setModelConfig(prev => ({
            ...prev,
            provider: data.provider,
            model: data.model || prev.model,
            whisperModel: data.whisperModel || prev.whisperModel,
            ollamaEndpoint: data.ollamaEndpoint,
            hasStoredKey: data.hasStoredKey || false,
            hasStoredApiKey: false,
          }));

          // Seed per-provider model cache from DB
          if (data.model) {
            seedProviderModelMap(data.provider, data.model);
          }
        }
      } catch (error) {
        console.error('Failed to fetch saved model config in ConfigContext:', error);
      }
    };
    fetchModelConfig();
  }, []);

  // Listen for model config updates from other components
  useEffect(() => {
    let isActive = true;
    let cleanup: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('[ConfigContext] Received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });
      if (!isActive) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    };

    void setupListener();

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, []);

  // Load device preferences on mount
  useEffect(() => {
    const loadDevicePreferences = async () => {
      try {
        const prefs = await configService.getRecordingPreferences();
        if (prefs && (prefs.preferred_mic_device || prefs.preferred_system_device)) {
          setSelectedDevices({
            micDevice: normalizeSelectedDeviceName(prefs.preferred_mic_device),
            systemDevice: normalizeSelectedDeviceName(prefs.preferred_system_device)
          });
          console.log('Loaded device preferences:', prefs);
        }
      } catch (error) {
        console.log('No device preferences found or failed to load:', error);
      }
    };
    loadDevicePreferences();
  }, []);

  // Calculate model options based on available models
  const modelOptions = useMemo<Record<ModelConfig['provider'], string[]>>(() => ({
    ollama: models.map(model => model.name),
    claude: ['claude-3-5-sonnet-latest'],
    groq: ['llama-3.3-70b-versatile'],
    openrouter: [],
    openai: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    'custom-openai': [],
  }), [models]);

  // Toggle confidence indicator with localStorage persistence
  const toggleConfidenceIndicator = useCallback((checked: boolean) => {
    setShowConfidenceIndicator(checked);
    writeBooleanPreference('showConfidenceIndicator', checked);
    // Trigger a custom event to notify other components
    window.dispatchEvent(new CustomEvent('confidenceIndicatorChanged', { detail: checked }));
  }, []);

  const toggleIsAutoSummary = useCallback((checked: boolean) => {
    setisAutoSummary(checked);
    writeBooleanPreference('isAutoSummary', checked);
  }, [])

  // Lazy load preference settings (only loads if not already cached)
  const loadPreferences = useCallback(async () => {
    // If already loaded, don't reload
    if (preferencesLoadedRef.current) {
      return;
    }

    // If currently loading, don't start another load
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;
    setIsLoadingPreferences(true);
    try {
      // Load notification settings from backend
      let settings: NotificationSettings | null = null;
      try {
        settings = await invoke<NotificationSettings>('get_notification_settings');
        setNotificationSettings(settings);
      } catch (notifError) {
        console.error('[ConfigContext] Failed to load notification settings:', notifError);
        // Use default values if notification settings fail to load
        setNotificationSettings(null);
      }

      // Load storage locations
      const [dbDir, modelsDir, recordingsDir] = await Promise.all([
        invoke<string>('get_database_directory'),
        invoke<string>('whisper_get_models_directory'),
        invoke<string>('get_default_recordings_folder_path')
      ]);

      setStorageLocations({
        database: dbDir,
        models: modelsDir,
        recordings: recordingsDir
      });

      try {
        const preferences = await invoke<AppPreferences>('get_app_preferences');
        setAppPreferences(preferences);
      } catch (preferencesError) {
        console.error('[ConfigContext] Failed to load app preferences:', preferencesError);
        setAppPreferences({
          auto_export_markdown_on_finalize: false,
          transcript_cleanup: {
            enabled: true,
            remove_fillers: true,
          },
          transcription_timeout_seconds: 600,
        });
      }

      // Mark as loaded
      preferencesLoadedRef.current = true;
    } catch (error) {
      console.error('[ConfigContext] Failed to load preferences:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoadingPreferences(false);
    }
  }, []);

  // Update notification settings
  const updateNotificationSettings = useCallback(async (settings: NotificationSettings) => {
    try {
      await invoke('set_notification_settings', { settings });
      setNotificationSettings(settings);
    } catch (error) {
      console.error('[ConfigContext] Failed to update notification settings:', error);
      throw error; // Re-throw so component can handle error
    }
  }, []);

  const updateAppPreferences = useCallback(async (preferences: AppPreferences) => {
    try {
      const saved = await invoke<AppPreferences>(
        'set_app_preferences',
        buildSetAppPreferencesPayload(preferences)
      );
      setAppPreferences(saved);
    } catch (error) {
      console.error('[ConfigContext] Failed to update app preferences:', error);
      throw error;
    }
  }, []);

  // Wrapper for setSelectedLanguage that persists to localStorage and syncs to Rust
  const handleSetSelectedLanguage = useCallback((lang: string) => {
    setSelectedLanguage(lang);
    writeStringPreference('primaryLanguage', lang);
  }, []);

  const value: ConfigContextType = useMemo(() => ({
    modelConfig,
    setModelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    transcriptModelConfig,
    setTranscriptModelConfig,
    setTranscriptModelConfigPersisted,
    selectedDevices,
    setSelectedDevices,
    setSelectedDevicesPersisted,
    selectedLanguage,
    setSelectedLanguage: handleSetSelectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    appPreferences,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
    updateAppPreferences,
  }), [
    modelConfig,
    isAutoSummary,
    toggleIsAutoSummary,
    transcriptModelConfig,
    setTranscriptModelConfigPersisted,
    selectedDevices,
    setSelectedDevicesPersisted,
    selectedLanguage,
    handleSetSelectedLanguage,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
    models,
    modelOptions,
    error,
    notificationSettings,
    storageLocations,
    appPreferences,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
    updateAppPreferences,
  ]);

  return (
    <ConfigContext.Provider value={value}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
