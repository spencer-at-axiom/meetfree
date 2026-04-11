import { describe, expect, it } from 'vitest';
import {
  createDownloadingStatus,
  getDownloadProgress,
  isCorruptedStatus,
  isDownloadingStatus,
  isErrorStatus,
  isMissingStatus,
} from '@/lib/transcriptionModelStatus';

describe('transcriptionModelStatus', () => {
  it('parses download progress from numeric payload', () => {
    const status = createDownloadingStatus(42);
    expect(isDownloadingStatus(status)).toBe(true);
    expect(getDownloadProgress(status)).toBe(42);
  });

  it('parses download progress from object payload', () => {
    const status = { Downloading: { progress: 88 } } as const;
    expect(isDownloadingStatus(status)).toBe(true);
    expect(getDownloadProgress(status)).toBe(88);
  });

  it('returns null for non-downloading statuses', () => {
    expect(getDownloadProgress('Available')).toBeNull();
    expect(getDownloadProgress('Missing')).toBeNull();
  });

  it('detects status variants safely', () => {
    expect(isMissingStatus('Missing')).toBe(true);
    expect(isErrorStatus({ Error: 'network' })).toBe(true);
    expect(
      isCorruptedStatus({
        Corrupted: { file_size: 128, expected_min_size: 256 },
      })
    ).toBe(true);
  });
});
