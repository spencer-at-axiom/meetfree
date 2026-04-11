"use client";

import {
  ModelConfig,
  ModelSaveOptions,
  ModelSettingsModal,
} from '@/components/ModelSettingsModal';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, FileText, Loader2, Settings, Sparkles, Square } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import { isOllamaNotInstalledError } from '@/lib/utils';
import type { SumSt } from '@/hooks/meeting-details/sumMsg';

interface GenBtn {
  cfg: ModelConfig;
  setCfg: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config?: ModelConfig, options?: ModelSaveOptions) => Promise<void>;
  onGen: (prompt: string) => Promise<void>;
  onHalt: () => void;
  prompt: string;
  sumSt: SumSt;
  tpls: Array<{ id: string; name: string; description: string }>;
  selTpl: string;
  onTpl: (templateId: string, templateName: string) => void;
  hasTxt?: boolean;
  isCfg?: boolean;
  onOpen?: (openFn: () => void) => void;
}

export function SumGen({
  cfg,
  setCfg,
  onSave,
  onGen,
  onHalt,
  prompt,
  sumSt,
  tpls,
  selTpl,
  onTpl,
  hasTxt = true,
  isCfg = false,
  onOpen,
}: GenBtn) {
  const [isChk, setChk] = useState(false);
  const [dlgOpen, setDlg] = useState(false);

  useEffect(() => {
    if (!onOpen) {
      return;
    }

    const openDlg = () => {
      console.log('Opening model settings dialog via callback');
      setDlg(true);
    };

    onOpen(openDlg);
  }, [onOpen]);

  if (!hasTxt) {
    return null;
  }

  const runGen = async () => {
    if (cfg.provider !== 'ollama') {
      await onGen(prompt);
      return;
    }

    setChk(true);
    try {
      const endpoint = cfg.ollamaEndpoint || null;
      const rows = await invoke('get_ollama_models', { endpoint }) as any[];

      if (!rows || rows.length === 0) {
        toast.error(
          'No Ollama models found. Please download gemma2:2b from Model Settings.',
          { duration: 5000 }
        );
        setDlg(true);
        return;
      }

      await onGen(prompt);
    } catch (error) {
      console.error('Error checking Ollama models:', error);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (isOllamaNotInstalledError(errMsg)) {
        toast.error('Ollama is not installed', {
          description: 'Please download and install Ollama to use local models.',
          duration: 7000,
          action: {
            label: 'Download',
            onClick: () => invoke('external_url_open', { url: 'https://ollama.com/download' }),
          },
        });
      } else {
        toast.error(
          'Failed to check Ollama models. Please check if Ollama is running and download a model.',
          { duration: 5000 }
        );
      }

      setDlg(true);
    } finally {
      setChk(false);
    }
  };

  const isGen = sumSt === 'processing' || sumSt === 'summarizing' || sumSt === 'regenerating';

  return (
    <ButtonGroup>
      {isGen ? (
        <Button
          variant="outline"
          size="sm"
          className="border-red-200 bg-gradient-to-r from-red-50 to-orange-50 xl:px-4 hover:from-red-100 hover:to-orange-100"
          onClick={() => {
            Analytics.trackButtonClick('stop_summary_generation', 'meeting_details');
            onHalt();
          }}
          title="Stop summary generation"
        >
          <Square className="xl:mr-2" size={18} fill="currentColor" />
          <span className="hidden lg:inline xl:inline">Stop</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50 xl:px-4 hover:from-blue-100 hover:to-purple-100"
          onClick={() => {
            Analytics.trackButtonClick('generate_summary', 'meeting_details');
            void runGen();
          }}
          disabled={isChk || isCfg}
          title={
            isCfg
              ? 'Loading model configuration...'
              : isChk
                ? 'Checking models...'
                : 'Generate AI Summary'
          }
        >
          {isChk || isCfg ? (
            <>
              <Loader2 className="animate-spin xl:mr-2" size={18} />
              <span className="hidden xl:inline">Processing...</span>
            </>
          ) : (
            <>
              <Sparkles className="xl:mr-2" size={18} />
              <span className="hidden lg:inline xl:inline">Generate Summary</span>
            </>
          )}
        </Button>
      )}

      <Dialog open={dlgOpen} onOpenChange={setDlg}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" title="Summary Settings">
            <Settings />
            <span className="hidden lg:inline">AI Model</span>
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <VisuallyHidden>
            <DialogTitle>Model Settings</DialogTitle>
          </VisuallyHidden>
          <ModelSettingsModal
            onSave={async (nextCfg, options) => {
              await onSave(nextCfg, options);
              if (!options?.silent) {
                setDlg(false);
              }
            }}
            modelConfig={cfg}
            setModelConfig={setCfg}
            skipInitialFetch={true}
          />
        </DialogContent>
      </Dialog>

      {tpls.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" title="Select summary template">
              <FileText />
              <span className="hidden lg:inline">Template</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tpls.map((tpl) => (
              <DropdownMenuItem
                key={tpl.id}
                onClick={() => onTpl(tpl.id, tpl.name)}
                title={tpl.description}
                className="flex items-center justify-between gap-2"
              >
                <span>{tpl.name}</span>
                {selTpl === tpl.id && (
                  <Check className="h-4 w-4 text-green-600" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </ButtonGroup>
  );
}
