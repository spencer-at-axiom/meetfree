import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SETTINGS_SELECT_TRIGGER_CLASS } from '@/components/settingsShared';

import {
  createDownloadingStatus,
  formatFileSize,
  getDownloadProgress,
  getModelDisplayInfo,
  getModelDisplayName,
  isCorruptedStatus,
  isDownloadingStatus,
  isErrorStatus,
  isMissingStatus,
  ParakeetAPI,
  ParakeetModelInfo,
} from '../lib/parakeet';
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog';

const HIDDEN_PARAKEET_MODELS = new Set(['parakeet-tdt-0.6b-v2-int8']);

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
  compact?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = '',
  autoSave = false,
  compact = false,
}: ParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);

  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [autoSave, onModelSelect]);

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const availableModels = (await ParakeetAPI.getAvailableModels()).filter(
          (model) => !HIDDEN_PARAKEET_MODELS.has(model.name)
        );
        if (isMounted) {
          setModels(availableModels);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to initialize Parakeet:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load models');
          toast.error('Failed to load transcript models', {
            description: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;

    const register = async () => {
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        'parakeet-model-download-progress',
        (event) => {
          const { modelName, progress } = event.payload;
          setModels((previous) =>
            previous.map((model) =>
              model.name === modelName
                ? { ...model, status: createDownloadingStatus(progress) }
                : model
            )
          );
        }
      );

      unlistenComplete = await listen<{ modelName: string }>(
        'parakeet-model-download-complete',
        (event) => {
          const { modelName } = event.payload;

          setModels((previous) =>
            previous.map((model) =>
              model.name === modelName
                ? { ...model, status: 'Available' }
                : model
            )
          );

          toast.success(`${getModelDisplayName(modelName)} ready`, {
            description: 'Model downloaded and ready to use',
          });

          onModelSelectRef.current?.(modelName);
          if (autoSaveRef.current) {
            void saveModelSelection(modelName);
          }
        }
      );

      unlistenError = await listen<{ modelName: string; error: string }>(
        'parakeet-model-download-error',
        (event) => {
          const { modelName, error: downloadError } = event.payload;

          setModels((previous) =>
            previous.map((model) =>
              model.name === modelName
                ? {
                    ...model,
                    status: { Error: downloadError },
                  }
                : model
            )
          );

          toast.error(`Failed to download ${getModelDisplayName(modelName)}`, {
            description: downloadError,
            action: {
              label: 'Retry',
              onClick: () => {
                void downloadModel(modelName);
              },
            },
          });
        }
      );
    };

    void register();

    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
      unlistenError?.();
    };
  }, []);

  const saveModelSelection = async (modelName: string) => {
    try {
      await invoke('transcript_cfg_set', {
        provider: 'parakeet',
        model: modelName,
        apiKey: null,
      });
    } catch (saveError) {
      console.error('Failed to save model selection:', saveError);
    }
  };

  const downloadModel = async (modelName: string) => {
    try {
      setModels((previous) =>
        previous.map((model) =>
          model.name === modelName
            ? { ...model, status: createDownloadingStatus(0) }
            : model
        )
      );

      toast.info(`Downloading ${getModelDisplayName(modelName)}`, {
        description: 'This may take a few minutes.',
      });

      await ParakeetAPI.downloadModel(modelName);
    } catch (downloadError) {
      console.error('Download failed:', downloadError);
      const message =
        downloadError instanceof Error ? downloadError.message : 'Download failed';

      setModels((previous) =>
        previous.map((model) =>
          model.name === modelName
            ? { ...model, status: { Error: message } }
            : model
        )
      );
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await ParakeetAPI.cancelDownload(modelName);
      setModels((previous) =>
        previous.map((model) =>
          model.name === modelName
            ? { ...model, status: 'Missing' }
            : model
        )
      );

      toast.info(`${getModelDisplayName(modelName)} download cancelled`);
    } catch (cancelError) {
      console.error('Failed to cancel download:', cancelError);
      toast.error('Failed to cancel download');
    }
  };

  const deleteModel = async (modelName: string) => {
    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);
      const refreshedModels = (await ParakeetAPI.getAvailableModels()).filter(
        (model) => !HIDDEN_PARAKEET_MODELS.has(model.name)
      );
      setModels(refreshedModels);

      toast.success(`${getModelDisplayName(modelName)} removed`);

      if (selectedModel === modelName) {
        onModelSelect?.('');
      }
    } catch (deleteError) {
      console.error('Failed to delete model:', deleteError);
      toast.error(`Failed to remove ${getModelDisplayName(modelName)}`, {
        description:
          deleteError instanceof Error ? deleteError.message : 'Delete failed',
      });
    }
  };

  const selectModel = async (modelName: string) => {
    onModelSelect?.(modelName);

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    toast.success(`Using ${getModelDisplayName(modelName)}`);
  };

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-xl bg-slate-100" />
          <div className="h-16 rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-xl border border-red-200 bg-red-50/70 p-4 ${className}`}>
        <p className="text-[13px] font-medium text-red-800">Failed to load models</p>
        <p className="mt-1 text-[12px] text-red-600">{error}</p>
      </div>
    );
  }

  const recommendedModel = models.find(
    (model) => model.name === 'parakeet-tdt-0.6b-v3-int8'
  );
  const otherModels = models.filter(
    (model) => model.name !== 'parakeet-tdt-0.6b-v3-int8'
  );
  const selectedModelInfo =
    models.find((model) => model.name === selectedModel) ??
    recommendedModel ??
    otherModels[0];

  if (compact) {
    const renderStatusIcon = (model: ParakeetModelInfo) => {
      if (model.status === 'Available') {
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
      }

      if (isMissingStatus(model.status)) {
        return <Download className="h-3.5 w-3.5 text-slate-500" />;
      }

      if (isDownloadingStatus(model.status)) {
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />;
      }

      return <AlertCircle className="h-3.5 w-3.5 text-amber-600" />;
    };

    const handleCompactSelect = async (modelName: string) => {
      const targetModel = models.find((model) => model.name === modelName);
      if (!targetModel) {
        return;
      }

      if (targetModel.status === 'Available') {
        await selectModel(modelName);
        return;
      }

      if (isMissingStatus(targetModel.status)) {
        const confirmed = await confirm({
          title: `Download ${getModelDisplayName(modelName)}?`,
          description: `${getModelDisplayName(modelName)} is not downloaded yet (${formatFileSize(targetModel.size_mb)}). Download now?`,
          confirmLabel: 'Yes, Download',
          cancelLabel: 'No',
        });

        if (!confirmed) {
          return;
        }

        await downloadModel(modelName);
        return;
      }

      if (isDownloadingStatus(targetModel.status)) {
        return;
      }

      if (isCorruptedStatus(targetModel.status)) {
        await deleteModel(modelName);
      }

      await downloadModel(modelName);
    };

    return (
      <div className={`space-y-1 ${className}`}>
        {confirmationDialog}
        <Select
          value={selectedModelInfo?.name}
          onValueChange={(modelName) => {
            void handleCompactSelect(modelName);
          }}
        >
          <SelectTrigger className={SETTINGS_SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {models.map((model) => {
              const downloadingProgressValue = getDownloadProgress(model.status);
              const isDownloading = downloadingProgressValue !== null;
              const downloadingProgress =
                downloadingProgressValue !== null
                  ? Math.round(downloadingProgressValue)
                  : null;

              return (
                <SelectItem key={model.name} value={model.name} disabled={isDownloading}>
                  <span className="flex w-full items-center justify-between gap-2">
                    <span>{getModelDisplayName(model.name)}</span>
                    <span className="flex items-center gap-1">
                      {downloadingProgress !== null ? (
                        <span className="text-[11px] text-slate-500">{`${downloadingProgress}%`}</span>
                      ) : null}
                      {renderStatusIcon(model)}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedModelInfo?.status && isMissingStatus(selectedModelInfo.status) ? (
          <button
            type="button"
            onClick={() => {
              void handleCompactSelect(selectedModelInfo.name);
            }}
            className="ml-[0.5ch] w-fit px-0 text-[11px] font-medium text-slate-600 underline underline-offset-2 transition-colors hover:text-slate-900"
          >
            Download {getModelDisplayName(selectedModelInfo.name)}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {recommendedModel ? (
        <ModelCard
          model={recommendedModel}
          isSelected={selectedModel === recommendedModel.name}
          isRecommended={true}
          onSelect={() => {
            if (recommendedModel.status === 'Available') {
              void selectModel(recommendedModel.name);
            }
          }}
          onDownload={() => {
            void downloadModel(recommendedModel.name);
          }}
          onCancel={() => {
            void cancelDownload(recommendedModel.name);
          }}
          onDelete={() => {
            void deleteModel(recommendedModel.name);
          }}
        />
      ) : null}

      {otherModels.length > 0 ? (
        <div className="space-y-3">
          {otherModels.map((model) => (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={false}
              onSelect={() => {
                if (model.status === 'Available') {
                  void selectModel(model.name);
                }
              }}
              onDownload={() => {
                void downloadModel(model.name);
              }}
              onCancel={() => {
                void cancelDownload(model.name);
              }}
              onDelete={() => {
                void deleteModel(model.name);
              }}
            />
          ))}
        </div>
      ) : null}

      {selectedModel ? (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="pt-2 text-center text-[11px] text-slate-500"
        >
          Using {getModelDisplayName(selectedModel)} for transcription
        </motion.div>
      ) : null}
    </div>
  );
}

interface ModelCardProps {
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
}: ModelCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const displayInfo = getModelDisplayInfo(model.name);
  const displayName = getModelDisplayName(model.name);
  const tagline = displayInfo?.tagline || model.description || '';

  const isAvailable = model.status === 'Available';
  const isMissing = isMissingStatus(model.status);
  const isError = isErrorStatus(model.status);
  const isCorrupted = isCorruptedStatus(model.status);
  const downloadProgress = getDownloadProgress(model.status);

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative rounded-xl border transition-colors ${
        isSelected && isAvailable
          ? 'border-slate-900 bg-slate-50'
          : isAvailable
            ? 'border-slate-200 bg-white hover:border-slate-300'
            : 'border-slate-200 bg-slate-50/70'
      } ${isAvailable ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={() => {
        if (isAvailable) {
          onSelect();
        }
      }}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {displayInfo?.icon || 'MODEL'}
              </span>
              <h3 className="text-[13px] font-semibold text-slate-950">{displayName}</h3>
              {isSelected && isAvailable ? (
                <span className="rounded-full border border-slate-900 px-2 py-0.5 text-[10px] font-medium text-slate-900">
                  Selected
                </span>
              ) : null}
              {isRecommended ? (
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  Recommended
                </span>
              ) : null}
            </div>

            <p className="text-[12px] text-slate-500">{tagline}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
              <span className="flex items-center gap-1">
                <span className="text-slate-400">Size</span>
                <span>{formatFileSize(model.size_mb)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-slate-400">Speed</span>
                <span>{model.speed}</span>
              </span>
            </div>
          </div>

          <div className="ml-3 flex items-center gap-2 self-start">
            {isAvailable ? (
              <>
                <div className="flex items-center gap-1.5 text-emerald-600">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-[11px] font-medium">Ready</span>
                </div>
                {isHovered ? (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete();
                    }}
                    className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Delete model to free up space"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                ) : null}
              </>
            ) : null}

            {isMissing ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload();
                }}
                className="h-8 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-slate-800"
              >
                Download
              </button>
            ) : null}

            {downloadProgress === null && isError ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload();
                }}
                className="h-8 rounded-md bg-red-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-red-700"
              >
                Retry
              </button>
            ) : null}

            {isCorrupted ? (
              <div className="flex gap-2">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                  }}
                  className="h-8 rounded-md bg-orange-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-orange-700"
                >
                  Delete
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownload();
                  }}
                  className="h-8 rounded-md bg-slate-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-slate-800"
                >
                  Re-download
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {downloadProgress !== null ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 border-t border-slate-200 pt-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-blue-600">Downloading</span>
                <span className="text-[12px] font-semibold text-blue-600">
                  {Math.round(downloadProgress)}%
                </span>
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onCancel();
                }}
                className="rounded px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
                title="Cancel download"
              >
                Cancel
              </button>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600"
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {model.size_mb
                ? `${formatFileSize((model.size_mb * downloadProgress) / 100)} / ${formatFileSize(model.size_mb)}`
                : 'Downloading...'}
            </p>
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}

