import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SETTINGS_LABEL_CLASS,
  SETTINGS_SELECT_TRIGGER_CLASS,
} from '@/components/settingsShared';

export interface BackendInfo {
  id: string;
  name: string;
  description: string;
}

interface AudioBackendSelectorProps {
  currentBackend?: string;
  onBackendChange?: (backend: string) => void;
  disabled?: boolean;
}

export function AudioBackendSelector({
  currentBackend: propBackend,
  onBackendChange,
  disabled = false,
}: AudioBackendSelectorProps) {
  const [backends, setBackends] = useState<BackendInfo[]>([]);
  const [currentBackend, setCurrentBackend] = useState<string>('coreaudio');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadBackends = async () => {
      try {
        setLoading(true);
        setError(null);

        const backendInfo = await invoke<BackendInfo[]>('get_audio_backend_info');
        const current = propBackend ?? (await invoke<string>('get_current_audio_backend'));

        if (!isMounted) {
          return;
        }

        setBackends(backendInfo);
        setCurrentBackend(current);
      } catch (err) {
        console.error('Failed to load audio backends:', err);
        if (isMounted) {
          setError('Failed to load capture methods');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadBackends();

    return () => {
      isMounted = false;
    };
  }, [propBackend]);

  const activeBackend = useMemo(
    () => backends.find((backend) => backend.id === currentBackend) ?? null,
    [backends, currentBackend]
  );

  const handleBackendChange = async (backendId: string) => {
    try {
      setError(null);
      await invoke('set_audio_backend', { backend: backendId });
      setCurrentBackend(backendId);
      onBackendChange?.(backendId);
      toast.success('System audio method updated');
    } catch (err) {
      console.error('Failed to set audio backend:', err);
      setError('Failed to change capture method. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-5 w-40 rounded bg-slate-100" />
        <div className="h-10 rounded-xl bg-slate-100" />
        <div className="h-16 rounded-2xl bg-slate-50" />
      </div>
    );
  }

  if (backends.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <div className={SETTINGS_LABEL_CLASS}>
            System audio capture method
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            This only affects computer audio. Your microphone uses the normal input path either
            way.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Select
            value={currentBackend}
            onValueChange={(value) => {
              void handleBackendChange(value);
            }}
            disabled={disabled}
          >
            <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Choose a capture method" />
            </SelectTrigger>
            <SelectContent>
              {backends.map((backend) => (
                <SelectItem key={backend.id} value={backend.id}>
                  {backend.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="border-l-2 border-slate-200 pl-3">
          <div className="text-[12px] font-medium text-slate-700">
            {activeBackend?.name ?? 'Capture method'}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-slate-500">
            {activeBackend?.description ??
              'Choose the system audio capture method that works best on this Mac.'}
          </p>
          <p className="mt-3 text-[11px] leading-5 text-slate-400">
            Changes apply to new recordings. If system audio stops working, switch methods here
            before recording again.
          </p>
        </div>
      </div>
    </div>
  );
}


