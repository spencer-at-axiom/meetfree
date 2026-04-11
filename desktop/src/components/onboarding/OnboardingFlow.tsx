import React from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { usePlatform } from '@/hooks/usePlatform';
import {
  WelcomeStep,
  PermissionsStep,
  DownloadProgressStep,
} from './steps';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete: _onComplete }: OnboardingFlowProps) {
  const { currentStep, goToStep } = useOnboarding();
  const platform = usePlatform();
  const isMac = platform === 'macos';

  React.useEffect(() => {
    if (!isMac && currentStep > 2) {
      goToStep(2);
    }
  }, [currentStep, goToStep, isMac]);

  // 3-Step Onboarding Flow:
  // Step 1: Welcome
  // Step 2: Download Progress
  // Step 3: Permissions (macOS only)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <DownloadProgressStep />}
      {currentStep === 3 && isMac && <PermissionsStep />}
    </div>
  );
}
