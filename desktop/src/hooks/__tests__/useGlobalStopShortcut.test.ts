import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/meetings',
}));

describe('Global stop shortcut from non-home route', () => {
  const stopFn = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fires onStopRecording on Ctrl+Shift+R from /meetings', () => {
    renderHook(() => useKeyboardShortcuts({ onStopRecording: stopFn }));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'R', ctrlKey: true, shiftKey: true })
    );

    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  it('fires onStopRecording on Meta+Shift+R (macOS) from /meetings', () => {
    const prev = navigator.platform;
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    try {
      renderHook(() => useKeyboardShortcuts({ onStopRecording: stopFn }));

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'R', metaKey: true, shiftKey: true })
      );

      expect(stopFn).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'platform', {
        configurable: true,
        value: prev,
      });
    }
  });

  it('does not fire when typing in an input field', () => {
    renderHook(() => useKeyboardShortcuts({ onStopRecording: stopFn }));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 'R',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: input, writable: false });

    window.dispatchEvent(event);

    expect(stopFn).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
