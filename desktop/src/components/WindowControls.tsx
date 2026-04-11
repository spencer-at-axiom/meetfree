'use client';

import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Minus, Maximize2 } from 'lucide-react';

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState<'macos' | 'windows' | 'linux'>('windows');

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

    // Check if window is maximized
    const checkMaximized = async () => {
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };

    checkMaximized();

    // Listen for resize events
    const unlisten = getCurrentWindow().onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const handleMinimize = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  };

  if (platform === 'macos') {
    return (
      <div className="flex items-center h-full gap-[8px] pl-4 pr-3 group" data-no-drag>
        <button
          onClick={handleClose}
          className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/20 hover:bg-[#FF5F56] flex items-center justify-center relative overflow-hidden"
          aria-label="Close"
          title="Close"
        >
          <X className="w-2 h-2 text-[#4D0000] opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2.5} />
        </button>
        <button
          onClick={handleMinimize}
          className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/20 hover:bg-[#FFBD2E] flex items-center justify-center relative overflow-hidden"
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus className="w-2 h-2 text-[#4D2800] opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={2.5} />
        </button>
        <button
          onClick={handleMaximize}
          className="w-3 h-3 rounded-full bg-[#28C940] border border-[#1FA934]/20 hover:bg-[#28C940] flex items-center justify-center relative overflow-hidden"
          aria-label="Maximize"
          title="Maximize"
        >
          <Maximize2 className="w-2 h-2 text-[#004D0C] opacity-0 group-hover:opacity-100 transition-opacity p-[0.5px]" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  // Windows/Linux controls - Windows 11 style
  return (
    <div className="flex items-center h-full" data-no-drag>
      <button
        onClick={handleMinimize}
        className="h-full w-[46px] hover:bg-black/5 active:bg-black/10 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
        aria-label="Minimize"
        title="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square"/>
        </svg>
      </button>
      <button
        onClick={handleMaximize}
        className="h-full w-[46px] hover:bg-black/5 active:bg-black/10 transition-colors flex items-center justify-center text-gray-700 hover:text-gray-900"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M0.5 2.5v7h7" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
             <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        )}
      </button>
      <button
        onClick={handleClose}
        className="h-full w-[46px] hover:bg-[#e81123] active:bg-[#f1707a] transition-colors flex items-center justify-center text-gray-700 hover:text-white"
        aria-label="Close"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" strokeLinejoin="miter"/>
        </svg>
      </button>
    </div>
  );
}
