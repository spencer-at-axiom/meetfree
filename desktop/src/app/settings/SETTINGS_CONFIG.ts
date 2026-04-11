import {
  AudioRecordingSettings,
  DataStorageSettings,
  ModelsSettings,
  ProcessingSettings,
} from '@/components/settings';

export type SettingsTabConfig = {
  value: string;
  label: string;
  component: () => JSX.Element;
};

export const SETTINGS_TABS: SettingsTabConfig[] = [
  {
    value: 'audio',
    label: 'Recording',
    component: AudioRecordingSettings,
  },
  {
    value: 'models',
    label: 'Models',
    component: ModelsSettings,
  },
  {
    value: 'process',
    label: 'Processing',
    component: ProcessingSettings,
  },
  {
    value: 'storage',
    label: 'Files Location',
    component: DataStorageSettings,
  },
];

