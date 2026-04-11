import React from 'react';
import { AlertTriangle, Mic, Speaker, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { usePlatform } from '@/hooks/usePlatform';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PermissionWarningProps {
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
  onRecheck: () => void;
  isRechecking?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PermissionWarning({
  hasMicrophone,
  hasSystemAudio,
  onRecheck,
  isRechecking = false,
  open,
  onOpenChange,
}: PermissionWarningProps) {
  const platform = usePlatform();
  const isLinux = platform === 'linux';
  const isMacOS = platform === 'macos';

  if (isLinux) {
    return null;
  }

  if (hasMicrophone && hasSystemAudio) {
    return null;
  }

  const openMicrophoneSettings = async () => {
    if (!isMacOS) {
      return;
    }

    try {
      await invoke('open_system_settings', { preferencePane: 'Privacy_Microphone' });
    } catch (error) {
      console.error('Failed to open microphone settings:', error);
    }
  };

  const openScreenRecordingSettings = async () => {
    if (!isMacOS) {
      return;
    }

    try {
      await invoke('open_system_settings', { preferencePane: 'Privacy_ScreenCapture' });
    } catch (error) {
      console.error('Failed to open screen recording settings:', error);
    }
  };

  const title = !hasMicrophone && !hasSystemAudio
    ? 'Permissions Required'
    : !hasMicrophone
      ? 'Microphone Permission Required'
      : 'System Audio Permission Required';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <DialogTitle className="text-base font-semibold text-gray-900">
              {title}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isMacOS && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-800 leading-relaxed">
                Automatic settings deep-linking is only available on macOS. Open your OS privacy
                settings manually, allow MeetFree permissions, then click Recheck.
              </p>
            </div>
          )}

          {!hasMicrophone && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 leading-relaxed">
                MeetFree needs microphone access to record meetings. No microphone devices were
                detected.
              </p>
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-900">Please check:</p>
                <ul className="space-y-1.5 text-xs text-gray-600 ml-1">
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-0.5">•</span>
                    <span>Your microphone is connected and powered on</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-0.5">•</span>
                    <span>Microphone permission is granted in system settings</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-gray-400 mt-0.5">•</span>
                    <span>No other app is exclusively using the microphone</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {!hasSystemAudio && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 leading-relaxed">
                {hasMicrophone
                  ? "System audio capture is not available. You can still record with microphone input only."
                  : 'System audio capture is also not available.'}
              </p>
              {isMacOS && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-900">To enable system audio on macOS:</p>
                  <ul className="space-y-1.5 text-xs text-gray-600 ml-1">
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>Install a virtual audio device (for example, BlackHole 2ch)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>Grant Screen Recording permission to MeetFree</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>Configure audio routing in Audio MIDI Setup</span>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            onClick={onRecheck}
            disabled={isRechecking}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${isRechecking ? 'animate-spin' : ''}`} />
            Recheck
          </button>
          
          {isMacOS && !hasMicrophone && (
            <button
              onClick={openMicrophoneSettings}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors shadow-sm"
            >
              <Mic className="h-4 w-4" />
              Open Microphone Settings
            </button>
          )}
          
          {isMacOS && !hasSystemAudio && hasMicrophone && (
            <button
              onClick={openScreenRecordingSettings}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm"
            >
              <Speaker className="h-4 w-4" />
              Open Screen Recording
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
