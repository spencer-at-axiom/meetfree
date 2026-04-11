'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const SETTINGS_LABEL_CLASS =
  'text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500';

export const SETTINGS_TEXT_INPUT_CLASS =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-none focus:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300';

export const SETTINGS_SELECT_TRIGGER_CLASS =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 shadow-none focus:border-slate-300 focus:ring-1 focus:ring-slate-300';

export const SETTINGS_OUTLINE_BUTTON_CLASS =
  'h-8 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 shadow-none hover:bg-slate-50';

export const SETTINGS_SOLID_BUTTON_CLASS =
  'h-8 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white shadow-none hover:bg-slate-800';

type SettingsRowProps = {
  label?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center';
};

type SettingsSectionProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function SettingsRow({
  label,
  title,
  description,
  children,
  className,
  align = 'start',
}: SettingsRowProps) {
  const resolvedLabel = label ?? title ?? '';

  return (
    <div className={cn('py-4', className)}>
      <div
        className={cn(
          'flex flex-col gap-2.5 sm:flex-row sm:justify-between sm:gap-8',
          align === 'center' ? 'sm:items-center' : 'sm:items-start'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-5 text-slate-950">
            {resolvedLabel}
          </div>
          {description && (
            <div className="mt-1 max-w-[56ch] text-[11px] leading-5 text-slate-500">
              {description}
            </div>
          )}
        </div>
        <div className="shrink-0 sm:min-w-[200px] sm:max-w-[320px] sm:justify-self-end">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SettingsDivider() {
  return <div className="h-px bg-slate-200/80" />;
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('space-y-0', className)}>{children}</div>;
}

export function SettingsSection({
  title,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      {title ? (
        <div className="space-y-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-700">
            {title}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingsGroup({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-4', className)}>
      <div className="space-y-2">
        <div>
          <div className="text-[13px] font-medium leading-5 text-slate-950">
            {label}
          </div>
          {description && (
            <div className="mt-1 max-w-[58ch] text-[11px] leading-5 text-slate-500">
              {description}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

