'use client';

import { useEffect } from 'react';

interface UseRecordingKeyboardShortcutProps {
  isRecording: boolean;
  isRecordingDisabled: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}

export function useRecordingKeyboardShortcut({
  isRecording,
  isRecordingDisabled,
  onStart,
  onStop,
}: UseRecordingKeyboardShortcutProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;

      if (!modifierPressed || event.key.toLowerCase() !== 'r') {
        return;
      }

      event.preventDefault();

      if (isRecording) {
        void onStop();
        return;
      }

      if (!isRecordingDisabled) {
        void onStart();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, isRecordingDisabled, onStart, onStop]);
}
