'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import { DeviceSelection } from '@/components/DeviceSelection';
import { LanguageSelection } from '@/components/LanguageSelection';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import {
  TranscriptSettings as ModelSelectionSettings,
} from '@/components/TranscriptSettings';
import { Button } from '@/components/ui/button';
import { useTags } from '@/hooks/useTags';
import { Switch } from '@/components/ui/switch';
import {
  type AppPreferences,
  type NotificationSettings,
  useConfig,
} from '@/contexts/ConfigContext';
import { cn } from '@/lib/utils';
import type { TranscriptModelProps } from '@/types/config';

export const SETTINGS_LABEL_CLASS =
  'text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500';

export const SETTINGS_TEXT_INPUT_CLASS =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-none focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300';

export const SETTINGS_SELECT_TRIGGER_CLASS =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-none focus:border-slate-300 focus:ring-1 focus:ring-slate-300';

export const SETTINGS_OUTLINE_BUTTON_CLASS =
  'h-8 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 shadow-none hover:bg-slate-50';

export const SETTINGS_SOLID_BUTTON_CLASS =
  'h-8 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white shadow-none hover:bg-slate-800';

export const SETTINGS_TOGGLE_CONTROL_CLASS =
  'flex w-full items-center sm:min-h-[20px] sm:justify-end';

export const SETTINGS_TOGGLE_SWITCH_CLASS =
  'h-5 w-9 data-[state=checked]:bg-slate-950 data-[state=unchecked]:bg-slate-200';

type SettingsRowProps = {
  label?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center';
};

type SettingsSectionProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

/**
 * SettingsRow - Flat, minimal setting row with hairline divider
 * No cards, no backgrounds - just clean typography and spacing
 */
export function SettingsRow({
  label,
  title,
  description,
  children,
  className,
  align = 'start',
}: SettingsRowProps) {
  const resolvedLabel = label ?? title ?? '';

  return (
    <div className={cn('py-4', className)}>
      <div
        className={cn(
          'flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:gap-8',
          align === 'center' ? 'sm:items-center' : 'sm:items-start'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-5 text-slate-950">
            {resolvedLabel}
          </div>
          {description && (
            <div className="mt-1 max-w-[56ch] text-[11px] leading-5 text-slate-500">
              {description}
            </div>
          )}
        </div>
        <div className="shrink-0 sm:min-w-[200px] sm:max-w-[320px] sm:justify-self-end">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * SettingsDivider - Hairline divider between settings
 */
export function SettingsDivider() {
  return <div className="h-px bg-slate-200/80" />;
}

/**
 * SettingsCard - Backward-compatible container for older settings modules.
 * Open layout: no boxed card treatment, just a hook for spacing or local overrides.
 */
export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'space-y-0',
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * SettingsSection - Container for a group of settings
 */
export function SettingsSection({
  title,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      {title ? (
        <div className="space-y-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-700">
            {title}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * SettingsGroup - For settings that need custom layout (like folder paths)
 */
export function SettingsGroup({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-4', className)}>
      <div className="space-y-2">
        <div>
          <div className="text-[13px] font-medium leading-5 text-slate-950">
            {label}
          </div>
          {description && (
            <div className="mt-1 max-w-[58ch] text-[11px] leading-5 text-slate-500">
              {description}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function RecordingSettings() {
  const { selectedDevices, setSelectedDevicesPersisted } = useConfig();

  return (
    <div>
      <SettingsSection
        title="Recording"
      >
        <SettingsCard>
          <div>
            <DeviceSelection
              selectedDevices={selectedDevices}
              onDeviceChange={(devices) => {
                void setSelectedDevicesPersisted(devices).catch((error) => {
                  console.error('Failed to save recording devices:', error);
                  toast.error('Failed to update recording devices');
                });
              }}
              variant="minimal"
              showSystemAudioBackendSelector
            />
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

type TranscriptionSettingsMode = 'full' | 'models' | 'processing';

const DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS = 600;

interface TranscriptionSettingsProps {
  mode?: TranscriptionSettingsMode;
}

export function TranscriptionSettings({
  mode = 'full',
}: TranscriptionSettingsProps) {
  const {
    transcriptModelConfig,
    setTranscriptModelConfigPersisted,
    selectedLanguage,
    appPreferences,
    loadPreferences,
    updateAppPreferences,
  } = useConfig();

  const hasNormalizedTimeoutRef = useRef(false);
  const showModelSettings = mode !== 'processing';
  const showProcessingSettings = mode !== 'models';
  const showLanguageWithModels = mode === 'full';
  const showLanguageSection = mode === 'processing';

  const effectivePreferences: AppPreferences = useMemo(
    () =>
      appPreferences ?? {
        auto_export_markdown_on_finalize: false,
        transcript_cleanup: {
          enabled: true,
          remove_fillers: true,
        },
        transcription_timeout_seconds: DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS,
      },
    [appPreferences]
  );

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const updatePreferences = useCallback(
    async (nextPreferences: AppPreferences) => {
      try {
        await updateAppPreferences(nextPreferences);
      } catch (error) {
        console.error('Failed to update transcription preferences:', error);
        toast.error('Failed to save transcription preferences', {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [updateAppPreferences]
  );

  useEffect(() => {
    if (!appPreferences || hasNormalizedTimeoutRef.current) {
      return;
    }

    hasNormalizedTimeoutRef.current = true;

    if (
      appPreferences.transcription_timeout_seconds ===
      DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS
    ) {
      return;
    }

    void updatePreferences({
      ...appPreferences,
      transcription_timeout_seconds: DEFAULT_TRANSCRIPTION_TIMEOUT_SECONDS,
    });
  }, [appPreferences, updatePreferences]);

  const handleTranscriptModelChange = useCallback(
    (nextConfig: TranscriptModelProps) => {
      void setTranscriptModelConfigPersisted(nextConfig).catch((error) => {
        console.error('Failed to save transcription model settings:', error);
        toast.error('Failed to save transcription model settings', {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [setTranscriptModelConfigPersisted]
  );

  return (
    <div className="space-y-6">
      {showModelSettings ? (
        <SettingsSection
          title="Transcription"
        >
          <SettingsCard
            className={
              mode === 'models'
                ? 'pt-1'
                : 'pt-1'
            }
          >
            <div className="space-y-4">
              <ModelSelectionSettings
                transcriptModelConfig={transcriptModelConfig}
                setTranscriptModelConfig={handleTranscriptModelChange}
                compact
              />
              {showLanguageWithModels ? (
                <div className="pt-1">
                  <LanguageSelection
                    selectedLanguage={selectedLanguage}
                    onLanguageChange={() => {
                      // LanguageSelection already persists through ConfigContext.
                    }}
                    provider={transcriptModelConfig.provider}
                    variant="minimal"
                  />
                </div>
              ) : null}
            </div>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      {showLanguageSection ? (
        <SettingsSection
          title="Language"
        >
          <SettingsCard className="pt-1">
            <LanguageSelection
              selectedLanguage={selectedLanguage}
              onLanguageChange={() => {
                // LanguageSelection already persists through ConfigContext.
              }}
              provider={transcriptModelConfig.provider}
              variant="minimal"
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}

      {showProcessingSettings ? (
        <SettingsSection>
          <SettingsCard>
            <SettingsRow title="Enable cleanup">
              <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
                <Switch
                  checked={effectivePreferences.transcript_cleanup.enabled}
                  onCheckedChange={(checked) => {
                    void updatePreferences({
                      ...effectivePreferences,
                      transcript_cleanup: {
                        ...effectivePreferences.transcript_cleanup,
                        enabled: checked,
                      },
                    });
                  }}
                  className={SETTINGS_TOGGLE_SWITCH_CLASS}
                />
              </div>
            </SettingsRow>

            <SettingsRow title="Remove filler words">
              <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
                <Switch
                  checked={effectivePreferences.transcript_cleanup.remove_fillers}
                  disabled={!effectivePreferences.transcript_cleanup.enabled}
                  onCheckedChange={(checked) => {
                    void updatePreferences({
                      ...effectivePreferences,
                      transcript_cleanup: {
                        ...effectivePreferences.transcript_cleanup,
                        remove_fillers: checked,
                      },
                    });
                  }}
                  className={SETTINGS_TOGGLE_SWITCH_CLASS}
                />
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      ) : null}
    </div>
  );
}

export function ModelsSettings() {
  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)] xl:gap-0">
      <div className="min-w-0 xl:border-r xl:border-slate-200/80 xl:pr-10">
        <TranscriptionSettings mode="models" />
      </div>

      <div className="min-w-0 xl:pl-10">
        <SummaryModelSettings mode="models" />
      </div>
    </div>
  );
}

export function ProcessingSettings() {
  return (
    <SettingsSection>
      <TranscriptionSettings mode="processing" />

      <div className="py-2" />

      <SummaryModelSettings mode="processing" />
    </SettingsSection>
  );
}

type RecordingPreferences = {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
};

type StorageLocations = {
  database: string;
  whisperModels: string;
  parakeetModels: string;
};

const DEFAULT_APP_TRANSCRIPTION_TIMEOUT_SECONDS = 600;

export function FilesAndStorageSettings() {
  const { appPreferences, loadPreferences, updateAppPreferences } = useConfig();

  const [recordingPreferences, setRecordingPreferences] =
    useState<RecordingPreferences | null>(null);
  const [storageLocations, setStorageLocations] = useState<StorageLocations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingRecording, setIsSavingRecording] = useState(false);

  const effectivePreferences: AppPreferences = useMemo(
    () =>
      appPreferences ?? {
        auto_export_markdown_on_finalize: false,
        transcript_cleanup: {
          enabled: true,
          remove_fillers: true,
        },
        transcription_timeout_seconds: DEFAULT_APP_TRANSCRIPTION_TIMEOUT_SECONDS,
      },
    [appPreferences]
  );

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const [recordingPrefs, database, whisperModels, parakeetModels] =
          await Promise.all([
            invoke<RecordingPreferences>('get_recording_preferences'),
            invoke<string>('get_database_directory'),
            invoke<string>('whisper_get_models_directory'),
            invoke<string>('parakeet_get_models_directory'),
          ]);

        if (!isMounted) {
          return;
        }

        setRecordingPreferences(recordingPrefs);
        setStorageLocations({
          database,
          whisperModels,
          parakeetModels,
        });
      } catch (error) {
        console.error('Failed to load file and storage settings:', error);
        toast.error('Failed to load file and storage settings');
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveRecordingPreferences = async (
    nextPreferences: RecordingPreferences,
    successMessage?: string
  ) => {
    if (!recordingPreferences) {
      return;
    }

    const previousPreferences = recordingPreferences;
    setRecordingPreferences(nextPreferences);
    setIsSavingRecording(true);

    try {
      await invoke('set_recording_preferences', { preferences: nextPreferences });

      if (successMessage) {
        toast.success(successMessage);
      }
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      setRecordingPreferences(previousPreferences);
      toast.error('Failed to update file preferences', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSavingRecording(false);
    }
  };

  const handleChangeSaveLocation = async () => {
    if (!recordingPreferences) {
      return;
    }

    try {
      const selectedFolder = await invoke<string | null>('select_recording_folder');

      if (!selectedFolder) {
        return;
      }

      await saveRecordingPreferences(
        {
          ...recordingPreferences,
          save_folder: selectedFolder,
        },
        'Recording folder updated'
      );
    } catch (error) {
      console.error('Failed to change recordings folder:', error);
      toast.error('Failed to change recordings folder');
    }
  };

  const handleOpenFolder = async (
    command:
      | 'open_database_folder'
      | 'open_models_folder'
      | 'open_parakeet_models_folder'
      | 'open_recordings_folder'
  ) => {
    try {
      await invoke(command);
    } catch (error) {
      console.error(`Failed to run ${command}:`, error);
      toast.error('Failed to open folder');
    }
  };

  const handleToggleAutoExport = async (checked: boolean) => {
    try {
      await updateAppPreferences({
        ...effectivePreferences,
        auto_export_markdown_on_finalize: checked,
      });
    } catch (error) {
      console.error('Failed to update auto-export setting:', error);
      toast.error('Failed to update export preference');
    }
  };

  if (isLoading || !recordingPreferences || !storageLocations) {
    return (
      <SettingsSection
        title="Files Location"
      >
        <SettingsCard>
          <div className="space-y-4">
            <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
            <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
            <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }

  const locationRows = [
    {
      label: 'Transcript library',
      description: 'Meeting metadata, summaries, and search index',
      path: storageLocations.database,
      command: 'open_database_folder' as const,
    },
    {
      label: 'Whisper models',
      description: 'Downloaded Whisper speech-to-text models',
      path: storageLocations.whisperModels,
      command: 'open_models_folder' as const,
    },
    {
      label: 'Parakeet models',
      description: 'Downloaded Parakeet speech-to-text models',
      path: storageLocations.parakeetModels,
      command: 'open_parakeet_models_folder' as const,
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Files Location"
      >
        <SettingsCard>
          <SettingsRow
            label="Keep original audio"
            description="Save recordings for retranscription later."
          >
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={recordingPreferences.auto_save}
                onCheckedChange={(checked) => {
                  void saveRecordingPreferences(
                    {
                      ...recordingPreferences,
                      auto_save: checked,
                    },
                    checked ? 'Original audio will be kept' : 'Original audio will be removed'
                  );
                }}
                disabled={isSavingRecording}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>

          <SettingsRow
            label="Auto-export Markdown"
            description="Save a transcript file after each recording."
          >
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={effectivePreferences.auto_export_markdown_on_finalize}
                onCheckedChange={(checked) => {
                  void handleToggleAutoExport(checked);
                }}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>

          <SettingsGroup label="Recording folder" description="Where saved audio files live.">
            <div className="break-all border-l-2 border-slate-200 pl-3 font-mono text-[11px] leading-5 text-slate-500">
              {recordingPreferences.save_folder}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleOpenFolder('open_recordings_folder')}
                className={SETTINGS_OUTLINE_BUTTON_CLASS}
              >
                <FolderOpen className="h-4 w-4" />
                Open
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleChangeSaveLocation()}
                disabled={isSavingRecording}
                className={SETTINGS_OUTLINE_BUTTON_CLASS}
              >
                {isSavingRecording ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Change'
                )}
              </Button>
            </div>
          </SettingsGroup>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection>
        <SettingsCard>
          {locationRows.map((row) => (
            <div key={row.label}>
              <div className="py-3">
                <div className="mb-2 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-950">{row.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{row.description}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleOpenFolder(row.command)}
                    className={`${SETTINGS_OUTLINE_BUTTON_CLASS} shrink-0`}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Open
                  </Button>
                </div>
                <div className="break-all border-l-2 border-slate-200 pl-3 font-mono text-[11px] leading-5 text-slate-400">
                  {row.path}
                </div>
              </div>
            </div>
          ))}
        </SettingsCard>
      </SettingsSection>

      <DatabaseBackupSection />
    </div>
  );
}

function DatabaseBackupSection() {
  const [isCreating, setIsCreating] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const list = await invoke<string[]>('list_database_backups');
      setBackups(list);
    } catch {
      console.error('Failed to list backups');
    } finally {
      setIsLoadingBackups(false);
    }
  };

  useEffect(() => {
    void loadBackups();
  }, []);

  const handleCreateBackup = async () => {
    setIsCreating(true);
    try {
      const path = await invoke<string>('create_database_backup');
      toast.success('Database backup created', {
        description: path.split(/[/\\]/).pop(),
        duration: 4000,
      });
      await loadBackups();
    } catch (error) {
      console.error('Failed to create backup:', error);
      toast.error('Failed to create backup');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCleanup = async () => {
    try {
      const removed = await invoke<number>('cleanup_old_backups', { keepCount: 3 });
      if (removed > 0) {
        toast.success(`Cleaned up ${removed} old backup${removed > 1 ? 's' : ''}`);
        await loadBackups();
      } else {
        toast.info('No old backups to clean up');
      }
    } catch (error) {
      console.error('Failed to cleanup backups:', error);
      toast.error('Failed to cleanup old backups');
    }
  };

  return (
    <SettingsSection title="Database Backup">
      <SettingsCard>
        <div className="space-y-3">
          <div className="text-[13px] text-slate-600">
            Create a snapshot of your meeting database. Backups are stored alongside your database file.
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCreateBackup()}
              disabled={isCreating}
              className={`${SETTINGS_OUTLINE_BUTTON_CLASS}`}
            >
              {isCreating ? 'Creating...' : 'Create Backup'}
            </Button>
            {backups.length > 3 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCleanup()}
                className={`${SETTINGS_OUTLINE_BUTTON_CLASS}`}
              >
                Cleanup Old
              </Button>
            )}
          </div>
          {!isLoadingBackups && backups.length > 0 && (
            <div className="text-[11px] text-slate-400">
              {backups.length} backup{backups.length !== 1 ? 's' : ''} saved
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function cloneSettings(settings: NotificationSettings): NotificationSettings {
  return {
    ...settings,
    notification_preferences: { ...settings.notification_preferences },
  };
}

export function NotificationsSettings() {
  const { notificationSettings, loadPreferences, updateNotificationSettings } = useConfig();

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const saveSettings = async (nextSettings: NotificationSettings) => {
    try {
      await updateNotificationSettings(nextSettings);
    } catch (error) {
      console.error('Failed to update notification settings:', error);
      toast.error('Failed to update notification settings');
    }
  };

  const handleToggle = async (
    updater: (settings: NotificationSettings) => NotificationSettings
  ) => {
    if (!notificationSettings) {
      return;
    }

    await saveSettings(updater(cloneSettings(notificationSettings)));
  };

  if (!notificationSettings) {
    return (
      <SettingsSection
        title="Notifications"
      >
        <SettingsCard>
          <div className="space-y-4">
            <div className="h-5 w-36 animate-pulse rounded bg-slate-100" />
            <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
            <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
          </div>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Notifications">
        <SettingsCard>
          <SettingsRow title="Recording started">
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={notificationSettings.notification_preferences.show_recording_started}
                onCheckedChange={(checked) => {
                  void handleToggle((settings) => {
                    settings.notification_preferences.show_recording_started = checked;
                    return settings;
                  });
                }}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>

          <SettingsRow title="Recording stopped">
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={notificationSettings.notification_preferences.show_recording_stopped}
                onCheckedChange={(checked) => {
                  void handleToggle((settings) => {
                    settings.notification_preferences.show_recording_stopped = checked;
                    return settings;
                  });
                }}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>

          <SettingsRow title="Transcription finished">
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={notificationSettings.notification_preferences.show_transcription_complete}
                onCheckedChange={(checked) => {
                  void handleToggle((settings) => {
                    settings.notification_preferences.show_transcription_complete = checked;
                    return settings;
                  });
                }}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>

          <SettingsRow title="System errors">
            <div className={SETTINGS_TOGGLE_CONTROL_CLASS}>
              <Switch
                checked={notificationSettings.notification_preferences.show_system_errors}
                onCheckedChange={(checked) => {
                  void handleToggle((settings) => {
                    settings.notification_preferences.show_system_errors = checked;
                    return settings;
                  });
                }}
                className={SETTINGS_TOGGLE_SWITCH_CLASS}
              />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

    </div>
  );
}

export function TagsSettings() {
  const { tags, createTag, deleteTag, isLoading } = useTags();
  const [newTagName, setNewTagName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null);

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      return;
    }

    setIsCreating(true);
    try {
      await createTag(name);
      setNewTagName('');
      toast.success('Tag created');
    } catch (error) {
      console.error('Failed to create tag:', error);
      toast.error('Failed to create tag');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    setDeletingTagId(tagId);
    try {
      await deleteTag(tagId);
      toast.success('Tag deleted');
    } catch (error) {
      console.error('Failed to delete tag:', error);
      toast.error('Failed to delete tag');
    } finally {
      setDeletingTagId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Tags">
        <SettingsCard>
          <SettingsGroup
            label="Create tag"
            description="Global tags can be attached to any meeting from the Context tab or meetings filters."
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="New tag name"
                className={cn(SETTINGS_TEXT_INPUT_CLASS, 'w-full')}
              />
              <Button
                type="button"
                onClick={() => void handleCreateTag()}
                disabled={isCreating || !newTagName.trim()}
                className={SETTINGS_SOLID_BUTTON_CLASS}
              >
                {isCreating ? 'Creating...' : 'Create tag'}
              </Button>
            </div>
          </SettingsGroup>

          <SettingsDivider />

          <SettingsGroup
            label="Existing tags"
            description="Deleting a tag removes it from all meetings and triggers context reindexing."
          >
            {isLoading ? (
              <div className="text-sm text-slate-500">Loading tags...</div>
            ) : tags.length === 0 ? (
              <div className="text-sm text-slate-500">No tags created yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => void handleDeleteTag(tag.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    <span>{tag.name}</span>
                    <span className="text-slate-400">
                      {deletingTagId === tag.id ? '...' : 'Delete'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SettingsGroup>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

export const AudioRecordingSettings = RecordingSettings;
export const DataStorageSettings = FilesAndStorageSettings;


