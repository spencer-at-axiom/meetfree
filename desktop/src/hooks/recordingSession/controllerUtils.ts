const FINALIZATION_CACHE_STALE_MS = 5 * 60 * 1000;
const FINALIZATION_CACHE_MAX_ENTRIES = 10;

export function generateMeetingTitle(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
}

export function buildFinalizationDedupeKey(
  meetingId: string,
  finalizedAt: string
): string {
  return `${meetingId}|${finalizedAt}`;
}

export function cleanupStaleFinalizationEntries(
  cache: Set<string>,
  nowMs = Date.now()
): void {
  const staleThreshold = nowMs - FINALIZATION_CACHE_STALE_MS;
  for (const key of cache) {
    const delimiterIndex = key.indexOf('|');
    if (delimiterIndex === -1) {
      continue;
    }

    const timestamp = key.slice(delimiterIndex + 1);
    if (new Date(timestamp).getTime() < staleThreshold) {
      cache.delete(key);
    }
  }
}

export function trimFinalizationCache(cache: Set<string>): void {
  if (cache.size <= FINALIZATION_CACHE_MAX_ENTRIES) {
    return;
  }

  const entries = Array.from(cache);
  const toDelete = entries.slice(0, entries.length - FINALIZATION_CACHE_MAX_ENTRIES);
  toDelete.forEach((key) => cache.delete(key));
}

export function calculateTranscriptWordCount(
  transcripts: Array<{ text: string }>
): number {
  return transcripts
    .map((transcript) => transcript.text.split(/\s+/).length)
    .reduce((sum, count) => sum + count, 0);
}

export function calculateWordsPerMinute(
  wordCount: number,
  durationSeconds: number
): number {
  if (durationSeconds <= 0) {
    return 0;
  }

  return wordCount / (durationSeconds / 60);
}
