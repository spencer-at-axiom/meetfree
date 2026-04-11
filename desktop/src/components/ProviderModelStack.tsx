'use client';

import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { SETTINGS_LABEL_CLASS } from '@/components/settingsShared';
import { cn } from '@/lib/utils';

type ProviderModelStackProps = {
  providerControl: ReactNode;
  modelControl: ReactNode;
  providerDescription?: ReactNode;
  modelDescription?: ReactNode;
  providerLabel?: ReactNode;
  modelLabel?: ReactNode;
  labelClassName?: string;
  className?: string;
};

export function ProviderModelStack({
  providerControl,
  modelControl,
  providerDescription,
  modelDescription,
  providerLabel = 'Provider',
  modelLabel = 'Model',
  labelClassName,
  className,
}: ProviderModelStackProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <Label className={labelClassName ?? SETTINGS_LABEL_CLASS}>
            {providerLabel}
          </Label>
          {providerDescription ? providerDescription : null}
        </div>
        <div className="w-full shrink-0 sm:w-[240px]">
          {providerControl}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <Label className={labelClassName ?? SETTINGS_LABEL_CLASS}>
            {modelLabel}
          </Label>
          {modelDescription ? modelDescription : null}
        </div>
        <div className="w-full shrink-0 sm:w-[240px]">
          {modelControl}
        </div>
      </div>
    </div>
  );
}
