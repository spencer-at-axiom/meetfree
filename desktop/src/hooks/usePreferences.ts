import { useState, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { buildSetAppPreferencesPayload } from '@/lib/tauriContracts';

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

export interface StorageLocations {
  database: string;
  models: string;
  recordings: string;
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

export function usePreferences() {
  const [notificationSettings, setNotificationSettings] =
    useState<NotificationSettings | null>(null);
  const [storageLocations, setStorageLocations] =
    useState<StorageLocations | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const loadedRef = useRef(false);
  const loadingRef = useRef(false);

  // Load app-level preferences at startup for consistent transcript behavior
  useEffect(() => {
    const loadAppPreferences = async () => {
      try {
        const preferences = await invoke<AppPreferences>('get_app_preferences');
        setAppPreferences(preferences);
      } catch (error) {
        console.error('[usePreferences] Failed to load app preferences at startup:', error);
      }
    };

    loadAppPreferences();
  }, []);

  const loadAll = useCallback(async () => {
    if (loadedRef.current || loadingRef.current) return;

    loadingRef.current = true;
    setIsLoading(true);
    try {
      try {
        const settings =
          await invoke<NotificationSettings>('get_notification_settings');
        setNotificationSettings(settings);
      } catch (err) {
        console.error('[usePreferences] Failed to load notification settings:', err);
        setNotificationSettings(null);
      }

      const [dbDir, modelsDir, recordingsDir] = await Promise.all([
        invoke<string>('get_database_directory'),
        invoke<string>('whisper_get_models_directory'),
        invoke<string>('get_default_recordings_folder_path'),
      ]);

      setStorageLocations({
        database: dbDir,
        models: modelsDir,
        recordings: recordingsDir,
      });

      try {
        const preferences =
          await invoke<AppPreferences>('get_app_preferences');
        setAppPreferences(preferences);
      } catch (err) {
        console.error('[usePreferences] Failed to load app preferences:', err);
        setAppPreferences({
          auto_export_markdown_on_finalize: false,
          transcript_cleanup: { enabled: true, remove_fillers: true },
          transcription_timeout_seconds: 600,
        });
      }

      loadedRef.current = true;
    } catch (error) {
      console.error('[usePreferences] Failed to load preferences:', error);
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  const updateNotificationSettings = useCallback(
    async (settings: NotificationSettings) => {
      await invoke('set_notification_settings', { settings });
      setNotificationSettings(settings);
    },
    [],
  );

  const updateAppPreferences = useCallback(
    async (preferences: AppPreferences) => {
      const saved = await invoke<AppPreferences>(
        'set_app_preferences',
        buildSetAppPreferencesPayload(preferences),
      );
      setAppPreferences(saved);
    },
    [],
  );

  return {
    notificationSettings,
    storageLocations,
    appPreferences,
    isLoadingPreferences: isLoading,
    loadPreferences: loadAll,
    updateNotificationSettings,
    updateAppPreferences,
  };
}
