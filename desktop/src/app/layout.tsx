'use client'

import './globals.css'
import { Inter } from 'next/font/google'
import { TopBar } from '@/components/TopBar'
import { MeetingsProvider } from '@/contexts/MeetingsContext'
import { Toaster, toast } from 'sonner'
import "sonner/dist/styles.css"
import { useState, useEffect, useCallback } from 'react'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RecordingStateProvider } from '@/contexts/RecordingStateContext'
import { OllamaDownloadProvider } from '@/contexts/OllamaDownloadContext'
import { TranscriptProvider } from '@/contexts/TranscriptContext'
import { ConfigProvider } from '@/contexts/ConfigContext'
import { OnboardingProvider } from '@/contexts/OnboardingContext'
import { OnboardingFlow } from '@/components/onboarding'
import { DownloadProgressToastProvider } from '@/components/shared/DownloadProgressToast'
import { UpdateCheckProvider } from '@/components/UpdateCheckProvider'
import { RecCtx } from '@/contexts/RecCtx'
import { ImportAudioDialog, ImportDropOverlay } from '@/components/ImportAudio'
import { ImportDialogProvider } from '@/contexts/ImportDialogContext'
import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcutsModal'


const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFilePath, setImportFilePath] = useState<string | null>(null)
  
  // Keyboard shortcuts state
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  
  // Setup global keyboard shortcuts
  useKeyboardShortcuts({
    onShowHelp: () => setShowShortcutsModal(true),
    onStopRecording: () => {
      window.dispatchEvent(new CustomEvent('request-stop-recording-shortcut'));
    },
  })
  
  // Listen for custom event to show shortcuts modal (from TopBar)
  useEffect(() => {
    const handleShowShortcuts = () => setShowShortcutsModal(true);
    window.addEventListener('show-keyboard-shortcuts', handleShowShortcuts);
    return () => window.removeEventListener('show-keyboard-shortcuts', handleShowShortcuts);
  }, []);

  useEffect(() => {
    // Check onboarding status first
    invoke<{ completed: boolean } | null>('get_onboarding_status')
      .then((status) => {
        const isComplete = status?.completed ?? false

        if (!isComplete) {
          console.log('[Layout] Onboarding not completed, showing onboarding flow')
          setShowOnboarding(true)
        } else {
          console.log('[Layout] Onboarding completed, showing main app')
        }
      })
      .catch((error) => {
        console.error('[Layout] Failed to check onboarding status:', error)
        // Default to showing onboarding if we can't check
        setShowOnboarding(true)
      })
  }, [])

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener('contextmenu', handleContextMenu);
      return () => document.removeEventListener('contextmenu', handleContextMenu);
    }
  }, []);
  useEffect(() => {
    // Listen for tray recording toggle request
    let isActive = true;
    let cleanup: UnlistenFn | undefined;

    const register = async () => {
      cleanup = await listen('request-recording-toggle', () => {
        if (showOnboarding) {
          toast.error("Please complete setup first", {
            description: "You need to finish onboarding before you can start recording."
          });
          return;
        }

        window.dispatchEvent(new CustomEvent('start-recording-from-sidebar'));
      });

      if (!isActive) {
        cleanup();
      }
    };

    void register();

    return () => {
      isActive = false;
      cleanup?.();
    };
  }, [showOnboarding]);

  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Find the first audio file
    const audioFile = paths.find(p => {
      const ext = p.split('.').pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log('[Layout] Audio file dropped:', audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error('Please drop an audio file', {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`
      });
    }
  }, []);

  // Listen for drag-drop events
  useEffect(() => {
    if (showOnboarding) return; // Don't handle drops during onboarding

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Drag enter/over - show overlay for supported audio drop flow.
      const unlistenDragEnter = await listen('tauri://drag-enter', () => {
        setShowDropOverlay(true);
      });
      if (cleanedUpRef.current) {
        unlistenDragEnter();
        return;
      }
      unlisteners.push(unlistenDragEnter);

      // Drag leave - hide overlay
      const unlistenDragLeave = await listen('tauri://drag-leave', () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        unlistenDragLeave();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDragLeave);

      // Drop - process files
      const unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setShowDropOverlay(false);
        handleFileDrop(event.payload.paths);
      });
      if (cleanedUpRef.current) {
        unlistenDrop();
        unlisteners.forEach(u => u());
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [showOnboarding, handleFileDrop]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
  }, []);

  const handleOnboardingComplete = () => {
    console.log('[Layout] Onboarding completed, reloading app')
    setShowOnboarding(false)
    // Optionally reload the window to ensure all state is fresh
    window.location.reload()
  }

  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <RecordingStateProvider>
          <ConfigProvider>
            <OllamaDownloadProvider>
              <OnboardingProvider>
                <UpdateCheckProvider>
                  <MeetingsProvider>
                    <TooltipProvider>
                      <TranscriptProvider>
                        <RecCtx>
                          <ImportDialogProvider onOpen={handleOpenImportDialog}>
                            <DownloadProgressToastProvider />

                            <div className="flex flex-col h-screen">
                              <TopBar isOnboarding={showOnboarding} />
                              <main className="relative flex-1 overflow-hidden">
                                {showOnboarding ? (
                                  <OnboardingFlow onComplete={handleOnboardingComplete} />
                                ) : (
                                  children
                                )}
                              </main>
                            </div>

                            <ImportDropOverlay visible={showDropOverlay} />
                            <ConditionalImportDialog
                              showImportDialog={showImportDialog}
                              handleImportDialogClose={handleImportDialogClose}
                              importFilePath={importFilePath}
                            />
                            <KeyboardShortcutsModal
                              isOpen={showShortcutsModal}
                              onClose={() => setShowShortcutsModal(false)}
                            />
                          </ImportDialogProvider>
                        </RecCtx>
                      </TranscriptProvider>
                    </TooltipProvider>
                  </MeetingsProvider>
                </UpdateCheckProvider>
              </OnboardingProvider>
            </OllamaDownloadProvider>
          </ConfigProvider>
        </RecordingStateProvider>

        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  )
}
