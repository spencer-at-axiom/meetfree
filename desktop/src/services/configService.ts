/**
 * Configuration Service
 *
 * Handles all configuration-related Tauri backend calls.
 * Pure 1-to-1 wrapper - no error handling changes, exact same behavior as direct invoke calls.
 */

import { invoke } from '@tauri-apps/api/core';
import type { TranscriptModelProps } from '@/types/config';

export interface ModelConfig {
  provider: 'ollama' | 'groq' | 'claude' | 'openrouter' | 'openai' | 'custom-openai';
  model: string;
  whisperModel: string;
  ollamaEndpoint?: string | null;
  hasStoredKey?: boolean;
  // Custom OpenAI fields (only populated when provider is 'custom-openai')
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  hasStoredApiKey?: boolean;
}

export interface CustomOpenAIConfig {
  endpoint: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
  hasStoredApiKey: boolean;
}

export interface CustomOpenAIConfigInput {
  endpoint: string;
  apiKey: string | null;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
}

export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  system_audio_backend?: string | null;
}

/**
 * Configuration Service
 * Singleton service for managing app configuration
 */
export class ConfigService {
  /**
   * Get saved transcript model configuration
   * @returns Promise with provider/model metadata and stored-key presence
   */
  async getTranscriptConfig(): Promise<TranscriptModelProps> {
    return invoke<TranscriptModelProps>('transcript_cfg_get');
  }

  /**
   * Get saved summary model configuration
   * @returns Promise with provider/model metadata and stored-key presence
   */
  async getModelConfig(): Promise<ModelConfig> {
    return invoke<ModelConfig>('model_cfg_get');
  }

  /**
   * Get saved audio device preferences
   * @returns Promise with { preferred_mic_device, preferred_system_device }
   */
  async getRecordingPreferences(): Promise<RecordingPreferences> {
    return invoke<RecordingPreferences>('get_recording_preferences');
  }

  /**
   * Get custom OpenAI configuration
   * @returns Promise with CustomOpenAIConfig or null if not configured
   */
  async getCustomOpenAIConfig(): Promise<CustomOpenAIConfig | null> {
    return invoke<CustomOpenAIConfig | null>('custom_openai_cfg_get');
  }

  /**
   * Save custom OpenAI configuration
   * @param config - CustomOpenAIConfig to save
   * @returns Promise with result status
   */
  async saveCustomOpenAIConfig(config: CustomOpenAIConfigInput): Promise<{ status: string; message: string }> {
    return invoke<{ status: string; message: string }>('custom_openai_cfg_set', {
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      topP: config.topP,
    });
  }

  /**
   * Test custom OpenAI connection
   * @param endpoint - API endpoint URL
   * @param apiKey - Optional API key
   * @param model - Model name
   * @returns Promise with test result
   */
  async testCustomOpenAIConnection(
    endpoint: string,
    apiKey: string | null,
    model: string
  ): Promise<{ status: string; message: string; http_status?: number }> {
    return invoke<{ status: string; message: string; http_status?: number }>('custom_openai_conn_test', {
      endpoint,
      apiKey,
      model,
    });
  }
}

// Export singleton instance
export const configService = new ConfigService();
