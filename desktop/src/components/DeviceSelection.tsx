import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Mic, RefreshCw, Speaker } from 'lucide-react';

import { AudioBackendSelector } from './AudioBackendSelector';
import { AudioLevelMeter, CompactAudioLevelMeter } from './AudioLevelMeter';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SETTINGS_SELECT_TRIGGER_CLASS } from '@/components/settingsShared';
import Analytics from '@/lib/analytics';
import { usePlatform } from '@/hooks/usePlatform';

export interface AudioDevice {
  name: string;
  device_type: 'Input' | 'Output';
}

export interface SelectedDevices {
  micDevice: string | null;
  systemDevice: string | null;
}

export interface AudioLevelData {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

export interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevelData[];
}

interface DeviceSelectionProps {
  selectedDevices: SelectedDevices;
  onDeviceChange: (devices: SelectedDevices) => void;
  disabled?: boolean;
  compact?: boolean;
  variant?: 'default' | 'minimal';
  showSystemAudioBackendSelector?: boolean;
}

export function DeviceSelection({
  selectedDevices,
  onDeviceChange,
  disabled = false,
  compact = false,
  variant = 'default',
  showSystemAudioBackendSelector = false,
}: DeviceSelectionProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [audioLevels, setAudioLevels] = useState<Map<string, AudioLevelData>>(new Map());
  const [isMonitoring, setIsMonitoring] = useState(false);
  const platform = usePlatform();
  const isSystemAudioSupported =
    platform === 'macos' || platform === 'windows' || platform === 'linux';
  const systemDeviceValue = isSystemAudioSupported
    ? (selectedDevices.systemDevice || 'default')
    : 'default';

  const inputDevices = devices.filter((device) => device.device_type === 'Input');
  const outputDevices = devices.filter((device) => device.device_type === 'Output');
  const isMinimal = variant === 'minimal';

  const fetchDevices = async () => {
    try {
      setError(null);
      const result = await invoke<AudioDevice[]>('get_audio_devices');
      setDevices(result);
      console.log('Fetched audio devices:', result);
    } catch (err) {
      console.error('Failed to fetch audio devices:', err);
      setError('Failed to load audio devices. Please check your system audio settings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchDevices();
  }, []);

  useEffect(() => {
    if (!isSystemAudioSupported && selectedDevices.systemDevice) {
      onDeviceChange({
        ...selectedDevices,
        systemDevice: null,
      });
    }
  }, [isSystemAudioSupported, onDeviceChange, selectedDevices]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupAudioLevelListener = async () => {
      try {
        unlisten = await listen<AudioLevelUpdate>('audio-levels', (event) => {
          const nextLevels = new Map<string, AudioLevelData>();

          event.payload.levels.forEach((level) => {
            nextLevels.set(level.device_name, level);
          });

          setAudioLevels(nextLevels);
        });
      } catch (err) {
        console.error('Failed to setup audio level listener:', err);
      }
    };

    void setupAudioLevelListener();

    return () => {
      unlisten?.();

      if (isMonitoring) {
        void stopAudioLevelMonitoring();
      }
    };
  }, [isMonitoring]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDevices();
  };

  const getDeviceMetadata = (deviceName: string) => {
    const nameLower = deviceName.toLowerCase();

    const isBluetooth =
      nameLower.includes('airpods') ||
      nameLower.includes('bluetooth') ||
      nameLower.includes('wireless') ||
      nameLower.includes('wh-') ||
      nameLower.includes('bt ');

    let category = 'wired';
    if (deviceName === 'default') {
      category = 'default';
    } else if (nameLower.includes('airpods')) {
      category = 'airpods';
    } else if (isBluetooth) {
      category = 'bluetooth';
    }

    return { isBluetooth, category };
  };

  const handleMicDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      micDevice: deviceName === 'default' ? null : deviceName,
    };

    onDeviceChange(newDevices);

    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('microphone_selected', {
      device_name: deviceName,
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_system_audio: (!!selectedDevices.systemDevice).toString(),
    }).catch((err) => console.error('Failed to track microphone selection:', err));
  };

  const handleSystemDeviceChange = (deviceName: string) => {
    const newDevices = {
      ...selectedDevices,
      systemDevice: deviceName === 'default' ? null : deviceName,
    };

    onDeviceChange(newDevices);

    const metadata = getDeviceMetadata(deviceName);
    Analytics.track('system_audio_selected', {
      device_name: deviceName,
      device_category: metadata.category,
      is_bluetooth: metadata.isBluetooth.toString(),
      has_microphone: (!!selectedDevices.micDevice).toString(),
    }).catch((err) => console.error('Failed to track system audio selection:', err));
  };

  const stopAudioLevelMonitoring = async () => {
    try {
      await invoke('stop_audio_level_monitoring');
      setIsMonitoring(false);
      setAudioLevels(new Map());
      console.log('Stopped audio level monitoring');
    } catch (err) {
      console.error('Failed to stop audio level monitoring:', err);
    }
  };

  const startAudioLevelMonitoring = async () => {
    try {
      const deviceNames = inputDevices.map((device) => device.name);
      if (deviceNames.length === 0) {
        return;
      }

      await invoke('start_audio_level_monitoring', { deviceNames });
      setIsMonitoring(true);
    } catch (err) {
      console.error('Failed to start audio level monitoring:', err);
      setError('Failed to start microphone monitoring. Please try again.');
    }
  };

  const toggleAudioLevelMonitoring = async () => {
    if (isMonitoring) {
      await stopAudioLevelMonitoring();
      return;
    }

    await startAudioLevelMonitoring();
  };

  if (loading) {
    if (isMinimal) {
      return (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="flex-1 space-y-2">
              <div className="h-5 w-32 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-48 bg-slate-50 rounded animate-pulse" />
            </div>
            <div className="h-9 w-full max-w-[240px] bg-slate-100 rounded animate-pulse" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="flex-1 space-y-2">
              <div className="h-5 w-32 bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-48 bg-slate-50 rounded animate-pulse" />
            </div>
            <div className="h-9 w-full max-w-[240px] bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
      );
    }

    return (
      <div className={compact ? 'space-y-3' : 'p-4 space-y-4'}>
        <div className="animate-pulse">
          <div className="mb-4 h-4 w-1/3 rounded bg-slate-200" />
          <div className="mb-3 h-10 rounded bg-slate-200" />
          <div className="h-10 rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  if (isMinimal) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="text-[12px] text-red-600 leading-5">
            {error}
          </div>
        )}

        {/* Microphone */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-slate-950 leading-5">
              Microphone
            </div>
            <div className="mt-1 text-[12px] text-slate-500 leading-5">
              Default audio input for new recordings
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-[240px]">
            <Select
              value={selectedDevices.micDevice || 'default'}
              onValueChange={handleMicDeviceChange}
              disabled={disabled}
            >
              <SelectTrigger
                id="mic-selection"
                className={SETTINGS_SELECT_TRIGGER_CLASS}
              >
                <SelectValue placeholder="Select microphone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default microphone</SelectItem>
                {inputDevices.map((device) => (
                  <SelectItem key={device.name} value={device.name}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {inputDevices.length === 0 && (
              <p className="mt-1 text-[12px] text-slate-400">No microphone devices found</p>
            )}
          </div>
        </div>

        {/* System Audio */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-slate-950 leading-5">
              System Audio
            </div>
            <div className="mt-1 text-[12px] text-slate-500 leading-5">
              Capture system audio (loopback/monitor source depending on platform)
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-[240px]">
            <Select
              value={systemDeviceValue}
              onValueChange={handleSystemDeviceChange}
              disabled={disabled || !isSystemAudioSupported}
            >
              <SelectTrigger
                id="system-selection"
                className={SETTINGS_SELECT_TRIGGER_CLASS}
              >
                <SelectValue placeholder="Choose audio source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Off</SelectItem>
                {outputDevices.map((device) => (
                  <SelectItem key={device.name} value={device.name}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {outputDevices.length === 0 && isSystemAudioSupported && (
              <p className="mt-1 text-[12px] text-slate-400">No system audio devices found</p>
            )}
          </div>
        </div>

        {showSystemAudioBackendSelector && isSystemAudioSupported ? (
          <div className="border-t border-slate-200 pt-3">
            <AudioBackendSelector disabled={disabled} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {!compact && (
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-slate-900">Audio Devices</h4>
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleAudioLevelMonitoring}
              disabled={disabled || inputDevices.length === 0}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                isMonitoring
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-green-100 text-green-700 hover:bg-green-200'
              } disabled:pointer-events-none disabled:opacity-50`}
              title={inputDevices.length === 0 ? 'No microphones available to test' : ''}
            >
              {isMonitoring ? 'Stop Test' : 'Test Mic'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing || disabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-sm font-medium transition-colors hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-slate-600" />
            <Label
              htmlFor="mic-selection"
              className={compact ? 'text-xs font-medium text-slate-700' : 'text-sm font-medium text-slate-700'}
            >
              Microphone
            </Label>
          </div>
          <Select
            value={selectedDevices.micDevice || 'default'}
            onValueChange={handleMicDeviceChange}
            disabled={disabled}
          >
            <SelectTrigger id="mic-selection" className="w-full">
              <SelectValue placeholder="Select microphone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default microphone</SelectItem>
              {inputDevices.map((device) => (
                <SelectItem key={device.name} value={device.name}>
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {inputDevices.length === 0 && (
            <p className="text-xs text-slate-500">No microphone devices found</p>
          )}

          {!compact && isMonitoring && inputDevices.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-2">
              <p className="text-xs font-medium text-slate-600">Microphone Levels:</p>
              {inputDevices.map((device) => {
                const levelData = audioLevels.get(device.name);

                return (
                  <div key={`level-${device.name}`} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="max-w-[200px] truncate text-xs text-slate-600">
                        {device.name}
                      </span>
                      {levelData && (
                        <CompactAudioLevelMeter
                          rmsLevel={levelData.rms_level}
                          peakLevel={levelData.peak_level}
                          isActive={levelData.is_active}
                        />
                      )}
                    </div>
                    {levelData && (
                      <AudioLevelMeter
                        rmsLevel={levelData.rms_level}
                        peakLevel={levelData.peak_level}
                        isActive={levelData.is_active}
                        deviceName={device.name}
                        size="small"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Speaker className="h-4 w-4 text-slate-600" />
            <Label
              htmlFor="system-selection"
              className={compact ? 'text-xs font-medium text-slate-700' : 'text-sm font-medium text-slate-700'}
            >
              System Audio
            </Label>
          </div>

          <Select
            value={systemDeviceValue}
            onValueChange={handleSystemDeviceChange}
            disabled={disabled || !isSystemAudioSupported}
          >
            <SelectTrigger id="system-selection" className="w-full">
              <SelectValue placeholder="Select system audio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Off</SelectItem>
              {outputDevices.map((device) => (
                <SelectItem key={device.name} value={device.name}>
                  {device.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {outputDevices.length === 0 && isSystemAudioSupported && (
            <p className="text-xs text-slate-500">No system audio devices found</p>
          )}

          {!compact && !disabled && isSystemAudioSupported && (
            <div className="border-t border-slate-100 pt-3">
              <AudioBackendSelector disabled={disabled} />
            </div>
          )}
        </div>
      </div>

      {!compact && (
        <div className="space-y-1 text-xs text-slate-500">
          <p>- <strong>Microphone:</strong> Records your voice and ambient sound</p>
          <p>- <strong>System Audio:</strong> Records computer audio (music, calls, etc.)</p>
          {isMonitoring && (
            <p>- <strong>Mic Levels:</strong> Green = good, Yellow = loud, Red = too loud</p>
          )}
          {!isMonitoring && inputDevices.length > 0 && (
            <p>- <strong>Tip:</strong> Click "Test Mic" to check if your microphone is working</p>
          )}
        </div>
      )}
    </div>
  );
}



