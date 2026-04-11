import { describe, expect, it } from 'vitest';
import {
  buildFinalizationDedupeKey,
  calculateTranscriptWordCount,
  calculateWordsPerMinute,
  cleanupStaleFinalizationEntries,
  generateMeetingTitle,
} from '@/hooks/recordingSession/controllerUtils';

describe('controllerUtils', () => {
  it('builds deterministic meeting titles', () => {
    const date = new Date(2026, 3, 10, 15, 30, 5);
    expect(generateMeetingTitle(date)).toBe('Meeting 10_04_26_15_30_05');
  });

  it('removes stale finalization cache entries', () => {
    const nowMs = new Date('2026-04-10T16:00:00Z').getTime();
    const stale = buildFinalizationDedupeKey('meeting-1', '2026-04-10T15:40:00Z');
    const fresh = buildFinalizationDedupeKey('meeting-2', '2026-04-10T15:58:30Z');
    const cache = new Set<string>([stale, fresh]);

    cleanupStaleFinalizationEntries(cache, nowMs);

    expect(cache.has(stale)).toBe(false);
    expect(cache.has(fresh)).toBe(true);
  });

  it('calculates transcript analytics', () => {
    const wordCount = calculateTranscriptWordCount([
      { text: 'hello world' },
      { text: 'this is a test' },
    ]);
    expect(wordCount).toBe(6);
    expect(calculateWordsPerMinute(wordCount, 120)).toBe(3);
    expect(calculateWordsPerMinute(wordCount, 0)).toBe(0);
  });
});
