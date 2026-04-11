import { invoke } from '@tauri-apps/api/core';
import {
  createDownloadingStatus,
  DownloadableModelStatus,
  getDownloadProgress,
  isAvailableStatus,
  isCorruptedStatus,
  isDownloadingStatus,
  isErrorStatus,
  isMissingStatus,
} from './transcriptionModelStatus';
export {
  createDownloadingStatus,
  getDownloadProgress,
  isCorruptedStatus,
  isDownloadingStatus,
  isErrorStatus,
  isMissingStatus,
};

export interface ParakeetModelInfo {
  name: string;
  path: string;
  size_mb: number;
  accuracy: ModelAccuracy;
  speed: ProcessingSpeed;
  status: ModelStatus;
  description?: string;
  quantization: QuantizationType;
}

export type QuantizationType = 'FP32' | 'Int8';
export type ModelAccuracy = 'High' | 'Good' | 'Decent';
export type ProcessingSpeed =
  | 'Slow'
  | 'Medium'
  | 'Fast'
  | 'Very Fast'
  | 'Ultra Fast';

export type ModelStatus =
  DownloadableModelStatus;

export interface ParakeetEngineState {
  currentModel: string | null;
  availableModels: ParakeetModelInfo[];
  isLoading: boolean;
  error: string | null;
}

export interface ModelDisplayInfo {
  friendlyName: string;
  icon: string;
  tagline: string;
  recommended?: boolean;
  tier: 'fastest' | 'balanced' | 'precise';
}

export const MODEL_DISPLAY_CONFIG: Record<string, ModelDisplayInfo> = {
  'parakeet-tdt-0.6b-v3-int8': {
    friendlyName: 'Parakeet v3 Int8',
    icon: 'FAST',
    tagline: 'Best overall speed and accuracy',
    recommended: true,
    tier: 'fastest',
  },
  'parakeet-tdt-0.6b-v2-int8': {
    friendlyName: 'Parakeet v2 Int8',
    icon: 'BAL',
    tagline: 'Smaller download size',
    tier: 'balanced',
  },
  'parakeet-tdt-0.6b-v3-fp32': {
    friendlyName: 'Parakeet v3 FP32',
    icon: 'PREC',
    tagline: 'Higher precision',
    tier: 'precise',
  },
};

export const PARAKEET_MODEL_CONFIGS: Record<
  string,
  Partial<ParakeetModelInfo>
> = {
  'parakeet-tdt-0.6b-v3-int8': {
    description: 'Real time on M4 Max, optimized for speed',
    size_mb: 670,
    accuracy: 'High',
    speed: 'Ultra Fast',
    quantization: 'Int8',
  },
  'parakeet-tdt-0.6b-v2-int8': {
    description: '25x real-time, smaller size with good accuracy',
    size_mb: 661,
    accuracy: 'High',
    speed: 'Very Fast',
    quantization: 'Int8',
  },
  'parakeet-tdt-0.6b-v3-fp32': {
    description: '20x real-time on M4 Max, higher precision',
    size_mb: 2554,
    accuracy: 'High',
    speed: 'Fast',
    quantization: 'FP32',
  },
};

export function getModelIcon(accuracy: ModelAccuracy): string {
  switch (accuracy) {
    case 'High':
      return 'High';
    case 'Good':
      return 'Good';
    case 'Decent':
      return 'Standard';
    default:
      return 'Standard';
  }
}

export function getModelDisplayName(modelName: string): string {
  const displayInfo = MODEL_DISPLAY_CONFIG[modelName];
  return displayInfo?.friendlyName || modelName;
}

export function getModelDisplayInfo(modelName: string): ModelDisplayInfo | null {
  return MODEL_DISPLAY_CONFIG[modelName] || null;
}

export function getStatusColor(status: ModelStatus): string {
  if (isAvailableStatus(status)) return 'green';
  if (isMissingStatus(status)) return 'gray';
  if (isDownloadingStatus(status)) return 'blue';
  if (isErrorStatus(status)) return 'red';
  return 'gray';
}

export function formatFileSize(sizeMb: number): string {
  if (sizeMb >= 1000) {
    return `${(sizeMb / 1000).toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

export function isQuantizedModel(modelName: string): boolean {
  return modelName.includes('int8');
}

export function getModelPerformanceBadge(
  quantization: QuantizationType
): { label: string; color: string } {
  switch (quantization) {
    case 'FP32':
      return { label: 'Full Precision', color: 'blue' };
    case 'Int8':
      return { label: 'Int8 Quantized', color: 'green' };
    default:
      return { label: 'Standard', color: 'gray' };
  }
}

export function getRecommendedModel(systemSpecs?: {
  ram: number;
  cores: number;
}): string {
  if (!systemSpecs) return 'parakeet-tdt-0.6b-v3-int8';
  return 'parakeet-tdt-0.6b-v3-int8';
}

export class ParakeetAPI {
  static async init(): Promise<void> {
    await invoke('parakeet_init');
  }

  static async getAvailableModels(): Promise<ParakeetModelInfo[]> {
    return await invoke('parakeet_get_available_models');
  }

  static async loadModel(modelName: string): Promise<void> {
    await invoke('parakeet_load_model', { modelName });
  }

  static async getCurrentModel(): Promise<string | null> {
    return await invoke('parakeet_get_current_model');
  }

  static async isModelLoaded(): Promise<boolean> {
    return await invoke('parakeet_is_model_loaded');
  }

  static async transcribeAudio(audioData: number[]): Promise<string> {
    return await invoke('parakeet_transcribe_audio', { audioData });
  }

  static async getModelsDirectory(): Promise<string> {
    return await invoke('parakeet_get_models_directory');
  }

  static async downloadModel(modelName: string): Promise<void> {
    await invoke('parakeet_download_model', { modelName });
  }

  static async cancelDownload(modelName: string): Promise<void> {
    await invoke('parakeet_cancel_download', { modelName });
  }

  static async deleteCorruptedModel(modelName: string): Promise<string> {
    return await invoke('parakeet_delete_corrupted_model', { modelName });
  }

  static async hasAvailableModels(): Promise<boolean> {
    return await invoke('parakeet_has_available_models');
  }

  static async validateModelReady(): Promise<string> {
    return await invoke('parakeet_validate_model_ready');
  }

  static async openModelsFolder(): Promise<void> {
    await invoke('open_parakeet_models_folder');
  }
}
