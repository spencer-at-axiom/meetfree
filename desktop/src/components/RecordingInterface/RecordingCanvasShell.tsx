'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type RecordingCanvasTone = 'ready' | 'recording' | 'paused' | 'finalizing';

interface RecordingCanvasShellProps {
  statusLabel: string;
  durationLabel: string;
  tone: RecordingCanvasTone;
  children: React.ReactNode;
  helperMessage?: string | null;
  primaryAction: {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  secondaryAction: {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

const toneClasses: Record<RecordingCanvasTone, string> = {
  ready: 'border-emerald-200 bg-emerald-50/92 text-emerald-700',
  recording: 'border-red-200 bg-red-50/92 text-red-700',
  paused: 'border-amber-200 bg-amber-50/92 text-amber-700',
  finalizing: 'border-slate-200 bg-slate-100/92 text-slate-700',
};

function ControlButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  emphasis = 'secondary',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  emphasis?: 'primary' | 'secondary' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-12 w-12 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-45',
        emphasis === 'primary'
          ? 'bg-white text-slate-950 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.5)] hover:scale-[1.03] hover:bg-slate-100 focus-visible:ring-white'
          : emphasis === 'danger'
            ? 'bg-white text-red-600 shadow-[0_8px_24px_-12px_rgba(15,23,42,0.5)] hover:scale-[1.03] hover:bg-red-50 focus-visible:ring-white'
            : 'border border-white/12 bg-white/8 text-white hover:bg-white/14 focus-visible:ring-white/70'
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

export function RecordingCanvasShell({
  statusLabel,
  durationLabel,
  tone,
  children,
  helperMessage,
  primaryAction,
  secondaryAction,
}: RecordingCanvasShellProps) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f2f5f9_100%)]">
      <div className="absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-5 pointer-events-none">
        <div className="pointer-events-auto inline-flex items-center gap-3 px-3 py-2">
          <span className={cn('inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium', toneClasses[tone])}>
            {statusLabel}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-medium text-slate-700">
            {durationLabel}
          </span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {children}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-4 pb-6 pointer-events-none">
        {helperMessage ? (
          <div className="pointer-events-auto max-w-xl rounded-full border border-white/70 bg-white/88 px-4 py-2 text-center text-xs font-medium text-slate-600 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
            {helperMessage}
          </div>
        ) : null}

        <div className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/12 bg-slate-950/92 px-3 py-3 text-white shadow-[0_28px_80px_-32px_rgba(15,23,42,0.75)] backdrop-blur">
          <ControlButton
            icon={primaryAction.icon}
            label={primaryAction.label}
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            emphasis="primary"
          />
          <ControlButton
            icon={secondaryAction.icon}
            label={secondaryAction.label}
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
            emphasis="danger"
          />
        </div>
      </div>
    </div>
  );
}
