import React from 'react';
import { Check } from 'lucide-react';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  onStepClick?: (step: number) => void;
}

export function ProgressIndicator({ current, total, onStepClick }: ProgressIndicatorProps) {
  const visibleSteps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div className="mb-5">
      <div className="mb-2.5 flex items-center justify-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-gray-400">
          Step {current} of {total}
        </p>
      </div>
      <div className="flex items-center justify-center gap-2">
        {visibleSteps.map((step, index) => {
          const isActive = step === current;
          const isCompleted = step < current;
          const isClickable = isCompleted && onStepClick;

          return (
            <React.Fragment key={step}>
              <button
                onClick={() => isClickable && onStepClick(step)}
                disabled={!isClickable}
                aria-label={`Go to step ${step}`}
                className={`relative flex h-2.5 rounded-full transition-all duration-300 ${
                  isCompleted
                    ? 'w-12 bg-emerald-500'
                    : isActive
                      ? 'w-14 bg-gray-900'
                      : 'w-8 bg-gray-200'
                } ${isClickable ? 'cursor-pointer hover:bg-gray-700' : 'cursor-default'}`}
              >
                {isCompleted ? (
                  <Check className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white" />
                ) : null}
                {isActive ? (
                  <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white" />
                ) : null}
                <span className="sr-only">
                  {isCompleted ? 'Completed' : isActive ? 'Current' : 'Upcoming'} step {step}
                </span>
              </button>

              {index < visibleSteps.length - 1 && (
                <div
                  className={`h-px w-3 transition-all duration-300 ${
                    isCompleted ? 'bg-emerald-300' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
