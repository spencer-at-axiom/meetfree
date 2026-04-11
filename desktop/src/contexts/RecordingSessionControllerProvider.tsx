'use client';

import React, { createContext, useCallback, useContext, ReactNode, useMemo, useRef } from 'react';
import { useRecordingSessionController, UseRecordingSessionControllerReturn } from '@/hooks/useRecordingSessionController';

type ModelSelectorModalHandler = (name: 'modelSelector', message?: string) => void;

interface RecordingSessionControllerProviderProps {
  children: ReactNode;
}

interface RecordingSessionControllerContextValue extends UseRecordingSessionControllerReturn {
  registerShowModal: (handler: ModelSelectorModalHandler) => () => void;
}

const RecordingSessionControllerContext = createContext<RecordingSessionControllerContextValue | undefined>(undefined);

/**
 * Global provider for recording session controller.
 * Ensures recording lifecycle events (start, stop, pause, resume) are handled
 * consistently across the entire app, including tray/global shortcut stops from any route.
 */
export function RecordingSessionControllerProvider({ children }: RecordingSessionControllerProviderProps) {
  const showModalRef = useRef<ModelSelectorModalHandler | undefined>(undefined);

  const controller = useRecordingSessionController((name, message) => {
    showModalRef.current?.(name, message);
  });

  const registerShowModal = useCallback((handler: ModelSelectorModalHandler) => {
    showModalRef.current = handler;

    return () => {
      if (showModalRef.current === handler) {
        showModalRef.current = undefined;
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      ...controller,
      registerShowModal,
    }),
    [controller, registerShowModal]
  );

  return (
    <RecordingSessionControllerContext.Provider value={value}>
      {children}
    </RecordingSessionControllerContext.Provider>
  );
}

/**
 * Hook to access the global recording session controller.
 * Use this instead of calling useRecordingSessionController directly
 * to ensure you're using the globally mounted instance.
 */
export function useGlobalRecordingController(): RecordingSessionControllerContextValue {
  const context = useContext(RecordingSessionControllerContext);
  if (!context) {
    throw new Error('useGlobalRecordingController must be used within RecordingSessionControllerProvider');
  }
  return context;
}
