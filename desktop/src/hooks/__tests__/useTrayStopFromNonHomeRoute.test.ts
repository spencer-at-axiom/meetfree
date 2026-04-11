import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEvt } from '../rec/useEvt';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const mockOnRecordingStopped = vi.fn();
vi.mock('@/services/recordingService', () => ({
  recordingService: {
    onRecordingStopped: (cb: (p: any) => void) => {
      mockOnRecordingStopped.mockImplementation(cb);
      return Promise.resolve(vi.fn());
    },
  },
}));

describe('Tray stop from non-home route', () => {
  const fin = vi.fn().mockResolvedValue(undefined);
  const beg = vi.fn().mockResolvedValue(true);
  const fail = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fin() when a recording-stopped event arrives (simulating tray stop)', async () => {
    renderHook(() =>
      useEvt({
        isRec: true,
        isAuto: false,
        setAuto: vi.fn(),
        beg,
        fail,
        fin,
      })
    );

    await vi.waitFor(() => {
      expect(mockOnRecordingStopped).toBeDefined();
    });

    const payload = {
      meeting_id: 'test-meeting-1',
      meeting_title: 'Test Meeting',
      transcript_count: 5,
      finalized_at: new Date().toISOString(),
    };

    await act(async () => {
      mockOnRecordingStopped(payload);
    });

    expect(fin).toHaveBeenCalledWith(payload);
  });

  it('handles backend stop event even when not on the home route', async () => {
    renderHook(() =>
      useEvt({
        isRec: true,
        isAuto: false,
        setAuto: vi.fn(),
        beg,
        fail,
        fin,
      })
    );

    await vi.waitFor(() => {
      expect(mockOnRecordingStopped).toBeDefined();
    });

    const payload = {
      meeting_id: 'meeting-from-settings-page',
      meeting_title: 'Meeting While On Settings',
      transcript_count: 3,
      finalized_at: new Date().toISOString(),
      save_error: null,
    };

    await act(async () => {
      mockOnRecordingStopped(payload);
    });

    expect(fin).toHaveBeenCalledTimes(1);
    expect(fin).toHaveBeenCalledWith(
      expect.objectContaining({ meeting_id: 'meeting-from-settings-page' })
    );
  });
});
