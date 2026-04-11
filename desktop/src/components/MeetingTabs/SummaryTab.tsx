'use client';

import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { Button } from '@/components/ui/button';
import type { ModelConfig, ModelSaveOptions } from '@/components/ModelSettingsModal';
import type { SummaryPayload } from '@/contracts/summaryContract';
import type { ExportFormat } from '@/types/export';

interface SummaryTabProps {
  isTitleDirty: boolean;
  summaryRef: any;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onExportMarkdown: () => Promise<void>;
  onExport: (format: ExportFormat) => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: SummaryPayload | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: any[];
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveModelConfig: (config?: ModelConfig, options?: ModelSaveOptions) => Promise<void>;
  onGenerateSummary: (prompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  onSaveSummary: (content: any) => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;
  availableTemplates: any[];
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading: boolean;
  onOpenModelSettings: (openFn: () => void) => void;
}

export function SummaryTab(props: SummaryTabProps) {
  const { summaryStatus, aiSummary, transcripts, summaryError } = props;
  
  // Determine loading/error states
  const isGenerating = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const hasSummary = !!aiSummary;
  const hasTranscripts = transcripts && transcripts.length > 0;
  const hasError = summaryStatus === 'error' || !!summaryError;
  
  // Show loading state during generation
  if (isGenerating) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/60 px-6">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
          <div className="mx-auto inline-block h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700"></div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-slate-950">Generating Summary</p>
            <p className="text-sm text-slate-600">{props.getSummaryStatusMessage(summaryStatus)}</p>
          </div>
        </div>
      </div>
    );
  }
  
  // Show error state with retry option
  if (hasError && !hasSummary) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50/60 px-6">
        <div className="max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white/90 px-8 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium text-slate-950">Summary Generation Failed</p>
            <p className="text-sm text-slate-600">{summaryError || 'An error occurred while generating the summary.'}</p>
          </div>
          {hasTranscripts && (
            <Button
              onClick={() => props.onGenerateSummary(props.customPrompt)}
              className="rounded-full px-4"
            >
              Retry Generation
            </Button>
          )}
        </div>
      </div>
    );
  }
  
  // Show empty state when no summary exists
  if (!hasSummary && !isGenerating) {
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
              {hasTranscripts 
                ? 'Generate an AI summary to capture the key takeaways from this meeting.'
                : 'This meeting does not have any transcript content to summarize yet.'
              }
            </p>
          </div>
          {hasTranscripts && (
            <Button
              onClick={() => props.onGenerateSummary(props.customPrompt)}
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
      <SummaryPanel {...props} />
    </div>
  );
}
