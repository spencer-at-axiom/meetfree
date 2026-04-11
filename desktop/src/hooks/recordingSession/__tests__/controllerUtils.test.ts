import { describe, expect, it } from 'vitest';
import {
  clrSet,
  getWc,
  getWpm,
  mkKey,
  mkTtl,
} from '@/hooks/rec/recUts';

describe('recUts', () => {
  it('builds deterministic meeting titles', () => {
    const date = new Date(2026, 3, 10, 15, 30, 5);
    expect(mkTtl(date)).toBe('Meeting 10_04_26_15_30_05');
  });

  it('removes stale finalization cache entries', () => {
    const nowMs = new Date('2026-04-10T16:00:00Z').getTime();
    const stale = mkKey('meeting-1', '2026-04-10T15:40:00Z');
    const fresh = mkKey('meeting-2', '2026-04-10T15:58:30Z');
    const cache = new Set<string>([stale, fresh]);

    clrSet(cache, nowMs);

    expect(cache.has(stale)).toBe(false);
    expect(cache.has(fresh)).toBe(true);
  });

  it('calculates transcript analytics', () => {
    const wordCount = getWc([
      { text: 'hello world' },
      { text: 'this is a test' },
    ]);
    expect(wordCount).toBe(6);
    expect(getWpm(wordCount, 120)).toBe(3);
    expect(getWpm(wordCount, 0)).toBe(0);
  });
});
