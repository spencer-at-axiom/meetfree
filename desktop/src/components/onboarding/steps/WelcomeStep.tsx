import React from 'react';
import { Lock, Sparkles, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    {
      icon: Lock,
      title: 'Your data never leaves your device',
    },
    {
      icon: Sparkles,
      title: 'Intelligent summaries & insights',
    },
    {
      icon: Cpu,
      title: 'Works offline, no cloud required',
    },
  ];

  return (
    <OnboardingContainer
      title="Welcome to MeetFree"
      description="Private meeting capture with local transcription and recaps."
      step={1}
      hideProgress={true}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="w-full rounded-3xl border border-gray-200/90 bg-gray-50/70 p-5 sm:p-6">
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-400">
              What you get
            </p>
          </div>
          <div className="mt-4 space-y-3.5">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
                <div key={index} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-gray-200">
                    <Icon className="h-3.5 w-3.5 text-gray-700" />
                  </div>
                  <p className="pt-1 text-[13px] font-medium text-gray-700 sm:text-[14px]">
                    {feature.title}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="w-full max-w-sm space-y-2.5">
          <Button
            onClick={goNext}
            className="h-10.5 w-full rounded-xl bg-gray-950 text-[13px] font-medium text-white hover:bg-gray-800"
          >
            Start setup
          </Button>
          <p className="text-center text-[11px] text-gray-500">
            Downloads begin on the next screen.
          </p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
