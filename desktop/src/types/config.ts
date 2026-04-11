export type TranscriptModelProvider =
  | 'localWhisper'
  | 'parakeet';

export interface TranscriptModelProps {
  provider: TranscriptModelProvider;
  model: string;
  apiKey?: string | null;
  hasStoredKey?: boolean;
}
