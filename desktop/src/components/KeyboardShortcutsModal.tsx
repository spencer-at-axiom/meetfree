'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getModifierKey } from '@/hooks/useKeyboardShortcuts';
import { Mic, Search, Save, Settings, FileText, Sparkles, Download, Keyboard } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
  icon?: any;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  const mod = getModifierKey();
  
  const categories: ShortcutCategory[] = [
    {
      title: 'Navigation',
      shortcuts: [
        {
          keys: [mod, 'R'],
          description: 'Go to recording page',
          icon: Mic,
        },
        {
          keys: [mod, 'F'],
          description: 'Go to meetings and focus search',
          icon: Search,
        },
        {
          keys: [mod, ','],
          description: 'Open settings',
          icon: Settings,
        },
      ],
    },
    {
      title: 'Actions',
      shortcuts: [
        {
          keys: [mod, 'S'],
          description: 'Save current changes',
          icon: Save,
        },
        {
          keys: [mod, '/'],
          description: 'Show keyboard shortcuts',
          icon: Keyboard,
        },
      ],
    },
    {
      title: 'Meeting Details',
      shortcuts: [
        {
          keys: [mod, '1'],
          description: 'Switch to Transcript tab',
          icon: FileText,
        },
        {
          keys: [mod, '2'],
          description: 'Switch to Summary tab',
          icon: Sparkles,
        },
        {
          keys: [mod, '3'],
          description: 'Switch to Export tab',
          icon: Download,
        },
      ],
    },
    {
      title: 'Meetings List',
      shortcuts: [
        {
          keys: ['↑', '↓'],
          description: 'Navigate meetings',
        },
        {
          keys: ['Enter'],
          description: 'Open selected meeting',
        },
        {
          keys: ['Delete'],
          description: 'Delete selected meeting',
        },
        {
          keys: [mod, 'A'],
          description: 'Select all meetings',
        },
        {
          keys: ['Esc'],
          description: 'Clear selection',
        },
      ],
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-xl font-bold">
          <Keyboard className="w-6 h-6" />
          Keyboard Shortcuts
        </DialogTitle>
        
        <div className="space-y-6 py-4">
          {categories.map((category) => (
            <div key={category.title}>
              <h3 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">
                {category.title}
              </h3>
              
              <div className="space-y-2">
                {category.shortcuts.map((shortcut, index) => {
                  const Icon = shortcut.icon;
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {Icon && <Icon className="w-4 h-4 text-gray-400" />}
                        <span className="text-sm text-gray-700">
                          {shortcut.description}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIndex) => (
                          <kbd
                            key={keyIndex}
                            className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded shadow-sm"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        
        <div className="border-t pt-4">
          <p className="text-xs text-gray-500 text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded">{mod}</kbd> + <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded">/</kbd> anytime to show this dialog
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
