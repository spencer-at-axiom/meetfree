'use client';

import { SumPan } from '@/components/MeetingDetails/SummaryPanel';
import { Button } from '@/components/ui/button';
import type { ModelConfig, ModelSaveOptions } from '@/components/ModelSettingsModal';
import type { SummaryPayload } from '@/contracts/summaryContract';
import type { ExportFormat } from '@/types/export';
import type { Transcript } from '@/types';
import type { SumSt } from '@/hooks/meeting-details/sumMsg';
import type { BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import type { RefObject } from 'react';

interface TemplateOption {
  id: string;
  name: string;
  description: string;
}

interface TabPrp {
  meetingId: string;
  isTitleDirty: boolean;
  sumRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onMd: () => Promise<void>;
  onExp: (format: ExportFormat) => Promise<void>;
  aiSum: SummaryPayload | null;
  sumSt: SumSt;
  streamProgress?: number;
  rows: Transcript[];
  cfg: ModelConfig;
  setCfg: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveCfg: (config?: ModelConfig, options?: ModelSaveOptions) => Promise<void>;
  onGen: (prompt: string) => Promise<void>;
  onHalt: () => void;
  prompt: string;
  onSaveSum: (content: SummaryPayload) => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
  sumErr: string | null;
  getMsg: (status: SumSt) => string;
  tpls: TemplateOption[];
  selTpl: string;
  onTpl: (templateId: string, templateName: string) => void;
  isCfg: boolean;
  onOpen: (openFn: () => void) => void;
}

export function SumTab(props: TabPrp) {
  const { sumSt, aiSum, rows, sumErr } = props;

  const isGen = sumSt === 'processing' || sumSt === 'summarizing' || sumSt === 'regenerating' || sumSt === 'streaming';
  const hasSum = !!aiSum;
  const hasTxt = rows && rows.length > 0;
  const hasErr = sumSt === 'error' || !!sumErr;

  if (isGen) {
    const progress = props.streamProgress;
    const showBar = sumSt === 'streaming' && progress != null;
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/60 px-6">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
          {!showBar && (
            <div className="mx-auto inline-block h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700"></div>
          )}
          {showBar && (
            <div className="mx-auto w-full">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-700 transition-all duration-300 ease-out"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs tabular-nums text-slate-500">
                {Math.round((progress ?? 0) * 100)}%
              </p>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-lg font-medium text-slate-950">Generating Summary</p>
            <p className="text-sm text-slate-600">{props.getMsg(sumSt)}</p>
          </div>
        </div>
      </div>
    );
  }

  if (hasErr && !hasSum) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/60 px-6">
        <div className="max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-slate-950">Summary Generation Failed</p>
            <p className="text-sm text-slate-600">{sumErr || 'An error occurred while generating the summary.'}</p>
          </div>
          {hasTxt && (
            <Button
              onClick={() => props.onGen(props.prompt)}
              className="rounded-full px-4"
            >
              Retry Generation
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!hasSum && !isGen) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/60 px-6">
        <div className="max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <svg className="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-slate-950">No Summary Yet</p>
            <p className="text-sm text-slate-600">
              {hasTxt
                ? 'Generate an AI summary to capture the key takeaways from this meeting.'
                : 'This meeting does not have any transcript content to summarize yet.'
              }
            </p>
          </div>
          {hasTxt && (
            <Button
              onClick={() => props.onGen(props.prompt)}
              className="rounded-full px-4"
            >
              Generate Summary
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-50/60">
      <SumPan {...props} />
    </div>
  );
}
