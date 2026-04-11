'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { useRec, type RecApi } from '@/hooks/rec/useRec';

type ModFn = (name: 'modelSelector', message?: string) => void;

interface CtxVal extends RecApi {
  regMod: (fn: ModFn) => () => void;
}

const Ctx = createContext<CtxVal | undefined>(undefined);

export function RecCtx({ children }: { children: ReactNode }) {
  const modRef = useRef<ModFn | undefined>(undefined);

  const rec = useRec((name, message) => {
    modRef.current?.(name, message);
  });

  const regMod = useCallback((fn: ModFn) => {
    modRef.current = fn;

    return () => {
      if (modRef.current === fn) {
        modRef.current = undefined;
      }
    };
  }, []);

  const val = useMemo(
    () => ({
      ...rec,
      regMod,
    }),
    [rec, regMod]
  );

  return (
    <Ctx.Provider value={val}>
      {children}
    </Ctx.Provider>
  );
}

export function useRcx(): CtxVal {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useRcx must be used within RecCtx');
  }
  return ctx;
}
