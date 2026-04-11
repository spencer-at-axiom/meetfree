import { toast } from 'sonner';
import type { ModelConfig } from '@/components/ModelSettingsModal';

export type SumSt = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';

export function msg(st: SumSt): string {
  switch (st) {
    case 'processing':
      return 'Processing transcript...';
    case 'summarizing':
      return 'Generating summary...';
    case 'regenerating':
      return 'Regenerating summary...';
    case 'completed':
      return 'Summary completed';
    case 'error':
      return 'Error generating summary';
    default:
      return '';
  }
}

export function showRun(isRe: boolean, cfg: ModelConfig): void {
  toast.info(`${isRe ? 'Regenerating' : 'Generating'} summary...`, {
    description: `Using ${cfg.provider}/${cfg.model}`,
    duration: 3000,
  });
}

export function showOk(): void {
  toast.success('Summary generated successfully!', {
    description: 'Your meeting summary is ready',
    duration: 4000,
  });
}

export function showErr(isRe: boolean, err: string): void {
  toast.error(`Failed to ${isRe ? 'regenerate' : 'generate'} summary`, {
    description: err.includes('Connection refused')
      ? 'Could not connect to LLM service. Please ensure Ollama or your configured LLM provider is running.'
      : err,
  });
}

export function showReErr(err: string): void {
  toast.error('Failed to regenerate summary', {
    description: `${err}. Your previous summary has been restored.`,
  });
}

export function showNoTxt(): void {
  toast.error('No transcripts available for summary');
}

export function showTxtErr(): void {
  toast.error('Failed to fetch transcripts for summary generation');
}

export function showLoad(): void {
  toast.info('Loading model configuration, please wait...');
}

export function showNeedMdl(): void {
  toast.error('Select a summary model before generating a summary');
}

export function showOll0(): void {
  toast.error(
    'No Ollama models found. Please download gemma3:1b from Model Settings.',
    { duration: 5000 }
  );
}

export function showOllMiss(open: () => void): void {
  toast.error('Ollama is not installed', {
    description: 'Please download and install Ollama to use local models.',
    duration: 7000,
    action: {
      label: 'Download',
      onClick: open,
    },
  });
}

export function showOllErr(): void {
  toast.error(
    'Failed to check Ollama models. Please ensure Ollama is running and download a model from Settings.',
    { duration: 5000 }
  );
}

export function showStop(): void {
  toast.info('Summary generation stopped', {
    description: 'You can generate a new summary anytime',
    duration: 3000,
  });
}
