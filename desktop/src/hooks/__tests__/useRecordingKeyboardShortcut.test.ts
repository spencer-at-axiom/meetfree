import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRecordingKeyboardShortcut } from '../useRecordingKeyboardShortcut';

describe('useRecordingKeyboardShortcut', () => {
  it('starts recording on Ctrl+R when idle and enabled', () => {
    const onStart = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecordingKeyboardShortcut({
        isRecording: false,
        isRecordingDisabled: false,
        onStart,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('does not start recording on Ctrl+R when currently recording', () => {
    const onStart = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecordingKeyboardShortcut({
        isRecording: true,
        isRecordingDisabled: false,
        onStart,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));

    expect(onStart).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+R when recording start is disabled', () => {
    const onStart = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecordingKeyboardShortcut({
        isRecording: false,
        isRecordingDisabled: true,
        onStart,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));

    expect(onStart).not.toHaveBeenCalled();
  });

  it('ignores Ctrl+Shift+R so the global stop shortcut can own it', () => {
    const onStart = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useRecordingKeyboardShortcut({
        isRecording: false,
        isRecordingDisabled: false,
        onStart,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', ctrlKey: true, shiftKey: true }));

    expect(onStart).not.toHaveBeenCalled();
  });
});
