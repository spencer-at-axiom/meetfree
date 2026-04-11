import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mic, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { PermissionRow } from '../shared';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePlatform } from '@/hooks/usePlatform';
import { toast } from 'sonner';
import { getPermissionSettingsPane, OnboardingPermission } from '@/lib/tauriContracts';

export function PermissionsStep() {
  const { setPermissionStatus, setPermissionsSkipped, permissions, completeOnboarding } =
    useOnboarding();
  const [isPending, setIsPending] = useState(false);
  const platform = usePlatform();
  const isMacOS = platform === 'macos';

  const checkPermissions = useCallback(async () => {
    console.log('[PermissionsStep] Current permission states:');
    console.log(`  - Microphone: ${permissions.microphone}`);
    console.log(`  - System Audio: ${permissions.systemAudio}`);
  }, [permissions.microphone, permissions.systemAudio]);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const showManualPermissionGuidance = (permission: OnboardingPermission) => {
    if (platform === 'windows') {
      toast.error(
        permission === 'microphone'
          ? 'Open Windows Settings > Privacy & security > Microphone and allow MeetFree.'
          : 'Open Windows privacy/audio capture settings manually, then retry.'
      );
      return;
    }

    if (platform === 'linux') {
      toast.error(
        permission === 'microphone'
          ? 'Open Linux sound/privacy settings and allow microphone access for MeetFree.'
          : 'Configure Linux audio capture permissions/devices manually, then retry.'
      );
      return;
    }

    toast.error(
      permission === 'microphone'
        ? 'Open your system privacy settings and allow microphone access for MeetFree.'
        : 'Open your system privacy/audio settings and allow audio capture for MeetFree.'
    );
  };

  const openMacSettingsPane = async (permission: OnboardingPermission) => {
    if (!isMacOS) {
      showManualPermissionGuidance(permission);
      return;
    }

    try {
      const preferencePane = getPermissionSettingsPane(permission);
      await invoke('open_system_settings', { preferencePane });
    } catch (error) {
      console.error(`[PermissionsStep] Failed to open ${permission} settings:`, error);
      showManualPermissionGuidance(permission);
    }
  };

  const handleMicrophoneAction = async () => {
    if (permissions.microphone === 'denied') {
      await openMacSettingsPane('microphone');
      return;
    }

    setIsPending(true);
    try {
      const granted = await invoke<boolean>('trigger_microphone_permission');
      setPermissionStatus('microphone', granted ? 'authorized' : 'denied');
    } catch (error) {
      console.error('[PermissionsStep] Failed to request microphone permission:', error);
      setPermissionStatus('microphone', 'denied');
      toast.error('Failed to request microphone permission');
    } finally {
      setIsPending(false);
    }
  };

  const handleSystemAudioAction = async () => {
    if (permissions.systemAudio === 'denied') {
      await openMacSettingsPane('systemAudio');
      return;
    }

    setIsPending(true);
    try {
      const granted = await invoke<boolean>('trigger_system_audio_permission_command');
      setPermissionStatus('systemAudio', granted ? 'authorized' : 'denied');
    } catch (error) {
      console.error('[PermissionsStep] Failed to request system audio permission:', error);
      setPermissionStatus('systemAudio', 'denied');
      toast.error('Failed to request system audio permission');
    } finally {
      setIsPending(false);
    }
  };

  const handleFinish = async () => {
    try {
      await completeOnboarding();
      window.location.reload();
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
      toast.error('Failed to complete onboarding. Please try again.');
    }
  };

  const handleSkip = async () => {
    setPermissionsSkipped(true);
    await handleFinish();
  };

  const allPermissionsGranted =
    permissions.microphone === 'authorized' && permissions.systemAudio === 'authorized';

  return (
    <OnboardingContainer
      title="Finish setup"
      description="Allow microphone and system audio access so MeetFree can capture calls cleanly on this Mac."
      step={3}
      totalSteps={3}
      showNavigation={allPermissionsGranted}
      canGoNext={allPermissionsGranted}
    >
      <div className="mx-auto max-w-lg space-y-5">
        <div className="space-y-4">
          <PermissionRow
            icon={<Mic className="w-5 h-5" />}
            title="Microphone"
            description="Required to capture your voice during meetings."
            status={permissions.microphone}
            isPending={isPending}
            onAction={handleMicrophoneAction}
          />

          <PermissionRow
            icon={<Volume2 className="w-5 h-5" />}
            title="System Audio"
            description="Enable this if you want MeetFree to capture app and call audio."
            status={permissions.systemAudio}
            isPending={isPending}
            onAction={handleSystemAudioAction}
          />
        </div>

        <div className="flex flex-col gap-2.5 pt-2">
          <Button
            onClick={handleFinish}
            disabled={!allPermissionsGranted}
            className="h-10.5 w-full rounded-xl text-[13px]"
          >
            Finish Setup
          </Button>

          <button
            onClick={handleSkip}
            className="text-[12px] text-neutral-500 transition-colors hover:text-neutral-700"
          >
            I'll do this later
          </button>

          {!allPermissionsGranted && (
            <p className="text-center text-[11px] text-muted-foreground">
              Recording will not work without permissions. You can grant them later in settings.
            </p>
          )}
        </div>
      </div>
    </OnboardingContainer>
  );
}
