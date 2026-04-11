"use client";

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, FileText, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { TranscriptTab } from '@/components/MeetingTabs/TranscriptTab';
import { SumTab } from '@/components/MeetingTabs/SummaryTab';
import { ExportDialog } from '@/components/MeetingDetails/ExportDialog';
import {
  ModelConfig,
  ModelSaveOptions,
  sanitizeModelConfig,
} from '@/components/ModelSettingsModal';
import { useConfig } from '@/contexts/ConfigContext';
import type { SummaryPayload } from '@/contracts/summaryContract';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useSum } from '@/hooks/meeting-details/useSum';
import { useTemplates } from '@/hooks/meeting-details/useTemplates';
import Analytics from '@/lib/analytics';
import type { MeetingDetails } from '@/types/meeting';
import { TranscriptSegmentData } from '@/types';

interface MeetingPageContentProps {
  meeting: MeetingDetails;
  summaryData: SummaryPayload | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: MeetingPageContentProps) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const router = useRouter();
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const source = searchParams.get('source');
  const openModelSettingsRef = useRef<(() => void) | null>(null);
  const { modelConfig, setModelConfig } = useConfig();

  const meetingData = useMeetingData({ meeting, summaryData });
  const templates = useTemplates();

  useEffect(() => {
    if (source === 'recording') {
      setActiveTab('summary');
    }
  }, [source]);

  useKeyboardShortcuts({
    onTabSwitch: (tabIndex: number) => {
      const tabs = ['transcript', 'summary'];
      setActiveTab(tabs[tabIndex]);
    },
    onSave: async () => {
      if (meetingData.isTitleDirty || meetingData.isSummaryDirty) {
        await meetingData.saveAllChanges();
      }
    },
  });

  const regDlg = (openFn: () => void) => {
    openModelSettingsRef.current = openFn;
  };

  const openDlg = () => {
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn('Model settings open function not yet registered');
    }
  };

  const saveCfg = async (
    config?: ModelConfig,
    options?: ModelSaveOptions
  ) => {
    if (!config) return;

    try {
      await invoke('model_cfg_set', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      const sanitizedConfig = sanitizeModelConfig(config);
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', sanitizedConfig);
      if (!options?.silent) {
        toast.success('Model settings saved successfully');
      }
    } catch (error) {
      console.error('Failed to save model config:', error);
      if (!options?.silent) {
        toast.error('Failed to save model settings');
      }
      throw error;
    }
  };

  const {
    gen,
    halt,
    sumSt,
    sumErr,
    msg,
  } = useSum({
    meeting,
    modelConfig,
    isModelConfigLoading: false,
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: openDlg,
  });

  const copyOperations = useCopyOperations({
    meeting,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled) {
        await gen('');

        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    return () => {
      cancelled = true;
    };
  }, [
    shouldAutoGenerate,
    meeting.id,
    meetingData.transcripts.length,
    modelConfig.provider,
    modelConfig.model,
    onAutoGenerateComplete,
    gen,
  ]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col bg-slate-50/60"
    >
      <div className="shrink-0 border-b border-slate-200 bg-white/90 px-6 py-5 backdrop-blur">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Button
              variant="outline"
              onClick={() => router.push('/meetings')}
              aria-label="Back to meetings"
              className="h-10 rounded-full border-slate-200 bg-white px-4 text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Meetings
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                {meetingData.meetingTitle}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {meeting.created_at && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    {new Date(meeting.created_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
                {meeting.transcripts && meeting.transcripts.length > 0 && (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    {meeting.transcripts.length} segments
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={meetingOperations.handleOpenMeetingFolder}
              title="Open meeting folder"
              className="h-10 rounded-full border-slate-200 bg-white px-4 text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Open Folder
            </Button>

            <Button onClick={() => setIsExportDialogOpen(true)} className="h-10 rounded-full px-4">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto rounded-full border border-slate-200 bg-slate-100/80 p-1">
            <TabsTrigger
              value="transcript"
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
            >
              <FileText className="h-4 w-4" />
              Transcript
            </TabsTrigger>
            <TabsTrigger
              value="summary"
              className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
            >
              <Sparkles className="h-4 w-4" />
              Summary
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ExportDialog
        open={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        onExport={meetingOperations.handleExport}
      />

      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab}>
          <TabsContent value="transcript" className="m-0 h-full">
            <TranscriptTab
              transcripts={meetingData.transcripts}
              customPrompt={customPrompt}
              onPromptChange={setCustomPrompt}
              onCopyTranscript={copyOperations.handleCopyTranscript}
              onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
              isRecording={false}
              segments={segments}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              totalCount={totalCount}
              loadedCount={loadedCount}
              onLoadMore={onLoadMore}
              meetingId={meeting.id}
              meetingFolderPath={meeting.folder_path}
              onRefetchTranscripts={onRefetchTranscripts}
            />
          </TabsContent>

          <TabsContent value="summary" className="m-0 h-full">
            <SumTab
              meetingId={meeting.id}
              isTitleDirty={meetingData.isTitleDirty}
              sumRef={meetingData.blockNoteSummaryRef}
              isSaving={meetingData.isSaving}
              onSaveAll={meetingData.saveAllChanges}
              onCopySummary={copyOperations.handleCopySummary}
              onMd={meetingOperations.handleExportMarkdown}
              onExp={meetingOperations.handleExport}
              aiSum={meetingData.aiSummary}
              sumSt={sumSt}
              rows={meetingData.transcripts}
              cfg={modelConfig}
              setCfg={setModelConfig}
              onSaveCfg={saveCfg}
              onGen={gen}
              onHalt={halt}
              prompt={customPrompt}
              onSaveSum={meetingData.handleSaveSummary}
              onDirtyChange={meetingData.setIsSummaryDirty}
              sumErr={sumErr}
              getMsg={msg}
              tpls={templates.availableTemplates}
              selTpl={templates.selectedTemplate}
              onTpl={templates.handleTemplateSelection}
              isCfg={false}
              onOpen={regDlg}
            />
          </TabsContent>
        </Tabs>
      </div>
    </motion.div>
  );
}
