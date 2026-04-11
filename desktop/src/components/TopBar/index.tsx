'use client';

import { useRouter, usePathname } from 'next/navigation';
import { Settings, Mic, Calendar, Upload, FileOutput, MoreVertical, Keyboard } from 'lucide-react';
import Logo from '../Logo';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useState, useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getModifierKey } from '@/hooks/useKeyboardShortcuts';
import { WindowControls } from '@/components/WindowControls';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useRecordingStatusSnapshot } from '@/contexts/RecordingStateContext';

interface TopBarProps {
  isOnboarding?: boolean;
}

export function TopBar({ isOnboarding = false }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { openImportDialog } = useImportDialog();
  const { status, isRecording, isPaused } = useRecordingStatusSnapshot();
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux'>('windows');
  const mod = getModifierKey();

  const isRecordRoute = pathname === '/';
  const isMeetings = pathname === '/meetings';
  const isSettings = pathname === '/settings';
  const isRecordingActive = isRecording || isPaused;

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) {
      setPlatform('macos');
    } else if (userAgent.includes('linux')) {
      setPlatform('linux');
    } else {
      setPlatform('windows');
    }
  }, []);

  const handleBatchExport = () => {
    // Navigate to meetings page and trigger batch export
    router.push('/meetings?action=batch-export');
  };

  const handleShowShortcuts = () => {
    // Trigger keyboard shortcuts modal via custom event
    window.dispatchEvent(new CustomEvent('show-keyboard-shortcuts'));
  };

  const handleDragStart = async (e: React.MouseEvent) => {
    // Only start dragging if clicking on the drag region (not on buttons)
    if ((e.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    }
  };

  return (
    <div
      className="relative h-10 bg-white/98 backdrop-blur-md border-b border-gray-200/60 flex items-center justify-between select-none flex-shrink-0"
      onMouseDown={handleDragStart}
      data-tauri-drag-region
    >
      {/* Left: Window Controls (macOS) or Logo (Windows/Linux) */}
      {platform === 'macos' ? (
        <div className="flex items-center gap-4 min-w-[140px] h-full" data-tauri-drag-region>
          <WindowControls />
          <button
            onClick={() => router.push('/')}
            className="hover:opacity-70 transition-opacity duration-150 h-full flex items-center mt-2.5"
            data-no-drag
          >
            <Logo isCollapsed={true} />
          </button>
        </div>
      ) : (
        <div className="flex items-center min-w-[140px] pl-3 h-full" data-tauri-drag-region>
          <button
            onClick={() => router.push('/')}
            className="hover:opacity-70 transition-opacity duration-150 h-full flex items-center mt-2.5"
            data-no-drag
          >
            <Logo isCollapsed={true} />
          </button>
        </div>
      )}

      {/* Center: Main Navigation - Drag Region */}
      <div className="absolute inset-0 flex items-center justify-center px-4 pointer-events-none" data-tauri-drag-region>
        {isOnboarding ? (
          <div
            className="rounded-md px-3 py-1 text-[13px] font-medium text-gray-500 pointer-events-auto"
            data-tauri-drag-region
          >
            Setup
          </div>
        ) : (
          <>
            <button
              onClick={() => router.push('/')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] font-medium transition-all duration-150 ${
                isRecordingActive
                  ? 'bg-red-50 text-red-700 shadow-sm'
                  : isRecordRoute
                    ? 'bg-red-50 text-red-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
              } pointer-events-auto`}
              data-no-drag
            >
              <Mic className="w-3.5 h-3.5" />
              {isRecordingActive ? (status === 'recording' ? 'Recording' : 'Paused') : 'Record'}
            </button>

            <button
              onClick={() => router.push('/meetings')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[13px] font-medium transition-all duration-150 ${
                isMeetings
                  ? 'bg-gray-100 text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
              } pointer-events-auto`}
              data-no-drag
            >
              <Calendar className="w-3.5 h-3.5" />
              Meetings
            </button>
          </>
        )}
      </div>

      {/* Right: Actions & Settings & Window Controls */}
      <div className="flex items-center justify-end h-full flex-shrink-0" data-tauri-drag-region>
        {!isOnboarding && (
          <div className="flex items-center gap-0.5 pr-1.5" data-tauri-drag-region>
            <DropdownMenu open={showMoreMenu} onOpenChange={setShowMoreMenu}>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100/70 transition-all duration-150"
                  aria-label="More actions"
                  data-no-drag
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100] w-44 text-xs">
                <DropdownMenuItem onClick={() => openImportDialog()} className="text-xs">
                  <Upload className="w-3 h-3 mr-2" />
                  Import Audio
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBatchExport} className="text-xs">
                  <FileOutput className="w-3 h-3 mr-2" />
                  Batch Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleShowShortcuts} className="text-xs">
                  <Keyboard className="w-3 h-3 mr-2" />
                  <span className="flex-1">Keyboard Shortcuts</span>
                  <span className="text-gray-400 ml-2">{mod}/</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={() => router.push('/settings')}
              className={`p-1.5 rounded-md transition-all duration-150 ${
                isSettings
                  ? 'bg-gray-100 text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/70'
              }`}
              aria-label="Settings"
              data-no-drag
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Window Controls (Windows/Linux) */}
        {platform !== 'macos' && <WindowControls />}
      </div>
    </div>
  );
}
