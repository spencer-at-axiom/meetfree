import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressIndicator } from './shared/ProgressIndicator';
import { useOnboarding } from '@/contexts/OnboardingContext';
import type { OnboardingContainerProps } from '@/types/onboarding';

export function OnboardingContainer({
  title,
  description,
  children,
  step,
  totalSteps = 3,
  stepOffset = 0,
  hideProgress = false,
  className,
  showNavigation = false,
  onNext,
  onPrevious,
  canGoNext = true,
  canGoPrevious = true,
}: OnboardingContainerProps) {
  const { goToStep, goPrevious, goNext } = useOnboarding();

  const handlePrevious = () => {
    if (onPrevious) {
      onPrevious();
    } else {
      goPrevious();
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goNext();
    }
  };

  const handleStepClick = (s: number) => {
    goToStep(s + stepOffset);
  };

  return (
    <div className="absolute inset-0 z-10 overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(226,232,240,0.6),_rgba(249,250,251,0.94)_38%,_rgba(243,244,246,1)_100%)]">
      <div
        className={cn(
          'mx-auto flex h-full w-full max-w-3xl flex-col px-4 py-4 sm:px-6 sm:py-5',
          className
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-gray-200/80 bg-white/96 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.28)] backdrop-blur">
          {step && !hideProgress && (
            <div className="relative flex-shrink-0 border-b border-gray-100 px-5 pb-4 pt-5 sm:px-7">
              {showNavigation && (
                <div className="pointer-events-none absolute inset-x-5 top-1/2 flex -translate-y-1/2 justify-between sm:inset-x-7">
                  <button
                    onClick={handlePrevious}
                    disabled={!canGoPrevious || step === 1}
                    className={cn(
                      'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition-all duration-200',
                      canGoPrevious && step !== 1
                        ? 'hover:-translate-x-0.5 hover:border-gray-300 hover:bg-gray-50'
                        : 'opacity-0 cursor-not-allowed'
                    )}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <button
                    onClick={handleNext}
                    disabled={!canGoNext || step === totalSteps}
                    className={cn(
                      'pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition-all duration-200',
                      canGoNext && step !== totalSteps
                        ? 'hover:translate-x-0.5 hover:border-gray-300 hover:bg-gray-50'
                        : 'opacity-0 cursor-not-allowed'
                    )}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}

              <ProgressIndicator current={step} total={totalSteps} onStepClick={handleStepClick} />
            </div>
          )}

          <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5 pt-6 sm:px-8 sm:pb-7 sm:pt-7">
            <div className="mb-5 flex-shrink-0 text-center">
              <h1 className="text-[1.75rem] font-semibold tracking-tight text-gray-950 sm:text-[2.05rem]">
                {title}
              </h1>
              {description && (
                <p className="mx-auto mt-2.5 max-w-lg text-[13px] leading-6 text-gray-600 sm:text-[14px]">
                  {description}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-xl space-y-5">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
