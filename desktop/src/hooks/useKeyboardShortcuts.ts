import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface UseKeyboardShortcutsOptions {
  onShowHelp?: () => void;
  onSave?: () => void;
  onTabSwitch?: (tabIndex: number) => void;
  onStopRecording?: () => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).contentEditable === 'true'
      ) {
        // Exception: Allow Cmd+S to save even in input fields
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          options.onSave?.();
        }
        return;
      }
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        options.onStopRecording?.();
        return;
      }
      
      // Global shortcuts (require Cmd/Ctrl)
      if (modifier) {
        switch (e.key.toLowerCase()) {
          case 'r':
            e.preventDefault();
            router.push('/');
            break;
            
          case 'f':
            e.preventDefault();
            router.push('/meetings');
            // Focus search after navigation
            setTimeout(() => {
              const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
              searchInput?.focus();
            }, 100);
            break;
            
          case 's':
            e.preventDefault();
            options.onSave?.();
            break;
            
          case ',':
            e.preventDefault();
            router.push('/settings');
            break;
            
          case '/':
            e.preventDefault();
            options.onShowHelp?.();
            break;
            
          // Tab navigation shortcuts (only on meeting details page)
          case '1':
            if (pathname?.includes('/meeting-details')) {
              e.preventDefault();
              options.onTabSwitch?.(0); // Transcript
            }
            break;
            
          case '2':
            if (pathname?.includes('/meeting-details')) {
              e.preventDefault();
              options.onTabSwitch?.(1); // Summary
            }
            break;
            
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, pathname, options]);
}

// Helper to get the modifier key name based on platform
export function getModifierKey(): string {
  const isMac = typeof navigator !== 'undefined' && 
    navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return isMac ? '⌘' : 'Ctrl';
}
