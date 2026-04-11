"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { ModelConfig, ModelSaveOptions } from '@/components/ModelSettingsModal';
import { SumGen } from './SummaryGeneratorButtonGroup';
import { SumUpd } from './SummaryUpdaterButtonGroup';
import { type SummaryPayload } from '@/contracts/summaryContract';
import { type ExportFormat } from '@/types/export';
import type { SumSt } from '@/hooks/meeting-details/sumMsg';
import { StructuredReviewPanel } from './StructuredReviewPanel';

interface PanPrp {
  meetingId: string;
  isTitleDirty: boolean;
  sumRef: RefObject<BlockNoteSummaryViewRef>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onMd: () => Promise<void>;
  onExp?: (format: ExportFormat) => Promise<void>;
  aiSum: SummaryPayload | null;
  sumSt: SumSt;
  rows: Transcript[];
  cfg: ModelConfig;
  setCfg: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSaveCfg: (config?: ModelConfig, options?: ModelSaveOptions) => Promise<void>;
  onGen: (customPrompt: string) => Promise<void>;
  onHalt: () => void;
  prompt: string;
  onSaveSum: (summary: SummaryPayload) => Promise<void>;
  onDirtyChange: (isDirty: boolean) => void;
  sumErr: string | null;
  getMsg: (status: SumSt) => string;
  tpls: Array<{ id: string; name: string; description: string }>;
  selTpl: string;
  onTpl: (templateId: string, templateName: string) => void;
  isCfg?: boolean;
  onOpen?: (openFn: () => void) => void;
}

export function SumPan({
  meetingId,
  isTitleDirty,
  sumRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onMd,
  onExp,
  aiSum,
  sumSt,
  rows,
  cfg,
  setCfg,
  onSaveCfg,
  onGen,
  onHalt,
  prompt,
  onSaveSum,
  onDirtyChange,
  sumErr,
  getMsg,
  tpls,
  selTpl,
  onTpl,
  isCfg = false,
  onOpen,
}: PanPrp) {
  const isLoad = sumSt === 'processing' || sumSt === 'summarizing' || sumSt === 'regenerating';
  const [isFind, setFind] = useState(false);
  const [query, setQuery] = useState('');
  const inpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isFind) {
      inpRef.current?.focus();
      inpRef.current?.select();
    }
  }, [isFind]);

  const doFind = useCallback(() => {
    const text = query.trim();
    if (!text) {
      return;
    }

    const win = window as Window & {
      find?: (
        text: string,
        caseSensitive?: boolean,
        backwards?: boolean,
        wrapAround?: boolean,
        wholeWord?: boolean,
        searchInFrames?: boolean,
        showDialog?: boolean,
      ) => boolean;
    };

    const found = win.find?.(text, false, false, true, false, true, false) ?? false;
    if (!found) {
      toast.info('No matching text found in the summary.');
    }
  }, [query]);

  const togFind = useCallback(() => {
    setFind((prev) => !prev);
    setQuery('');
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200 p-4">
        {aiSum && !isLoad && (
          <div className="flex w-full items-center justify-center gap-2 pt-0">
            <div className="flex-shrink-0">
              <SumGen
                cfg={cfg}
                setCfg={setCfg}
                onSave={onSaveCfg}
                onGen={onGen}
                onHalt={onHalt}
                prompt={prompt}
                sumSt={sumSt}
                tpls={tpls}
                selTpl={selTpl}
                onTpl={onTpl}
                hasTxt={rows.length > 0}
                isCfg={isCfg}
                onOpen={onOpen}
              />
            </div>

            <div className="flex-shrink-0">
              <SumUpd
                isSaving={isSaving}
                isDirty={isTitleDirty || (sumRef.current?.isDirty || false)}
                onSave={onSaveAll}
                onCopy={onCopySummary}
                onMd={onMd}
                onExp={onExp}
                onFind={togFind}
                hasSummary={!!aiSum}
              />
            </div>
          </div>
        )}

        {isFind && aiSum && (
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={inpRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  doFind();
                }
              }}
              placeholder="Find text in summary"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={doFind}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Find Next
            </button>
          </div>
        )}
      </div>

      {isLoad ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-center pb-4 pt-8">
            <SumGen
              cfg={cfg}
              setCfg={setCfg}
              onSave={onSaveCfg}
              onGen={onGen}
              onHalt={onHalt}
              prompt={prompt}
              sumSt={sumSt}
              tpls={tpls}
              selTpl={selTpl}
              onTpl={onTpl}
              hasTxt={rows.length > 0}
              isCfg={isCfg}
              onOpen={onOpen}
            />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-blue-500"></div>
              <p className="text-gray-600">Generating AI Summary...</p>
            </div>
          </div>
        </div>
      ) : !aiSum ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-center pb-4 pt-8">
            <SumGen
              cfg={cfg}
              setCfg={setCfg}
              onSave={onSaveCfg}
              onGen={onGen}
              onHalt={onHalt}
              prompt={prompt}
              sumSt={sumSt}
              tpls={tpls}
              selTpl={selTpl}
              onTpl={onTpl}
              hasTxt={rows.length > 0}
              isCfg={isCfg}
              onOpen={onOpen}
            />
          </div>
          <EmptyStateSummary
            onGenerate={() => onGen(prompt)}
            hasModel={cfg.provider !== null && cfg.model !== null}
            isGenerating={isLoad}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full p-6">
            <StructuredReviewPanel
              meetingId={meetingId}
              refreshSignal={`${sumSt}:${aiSum.markdown.length}`}
            />
            <BlockNoteSummaryView
              ref={sumRef}
              summaryData={aiSum}
              onSave={onSaveSum}
              onDirtyChange={onDirtyChange}
              status={sumSt}
              error={sumErr}
            />
          </div>
          {sumSt !== 'idle' && (
            <div className={`mt-4 rounded-lg p-4 ${sumSt === 'error' ? 'bg-red-100 text-red-700' :
              sumSt === 'completed' ? 'bg-green-100 text-green-700' :
                'bg-blue-100 text-blue-700'
              }`}>
              <p className="text-sm font-medium">{getMsg(sumSt)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
