'use client';

import { Mic } from 'lucide-react';
import { motion } from 'framer-motion';

interface HeroRecordButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function HeroRecordButton({ onClick, disabled = false }: HeroRecordButtonProps) {
  return (
    <div className="flex flex-col items-center gap-6">
      {/* Main Button */}
      <motion.button
        onClick={onClick}
        disabled={disabled}
        className="relative group"
        whileHover={{ scale: disabled ? 1 : 1.05 }}
        whileTap={{ scale: disabled ? 1 : 0.98 }}
        transition={{ duration: 0.2 }}
      >
        {/* Outer ring (animated on hover) */}
        <div className="absolute inset-0 bg-red-500 rounded-full opacity-0 group-hover:opacity-20 group-hover:scale-110 transition-all duration-300" />
        
        {/* Main circular button */}
        <div className={`
          relative w-40 h-40 rounded-full flex items-center justify-center
          shadow-lg transition-all duration-300
          ${disabled 
            ? 'bg-gray-300 cursor-not-allowed' 
            : 'bg-red-500 hover:bg-red-600 hover:shadow-xl hover:shadow-red-500/30 cursor-pointer'
          }
        `}>
          <Mic className={`w-16 h-16 ${disabled ? 'text-gray-500' : 'text-white'}`} />
        </div>
      </motion.button>
      
      {/* Keyboard hint */}
      <div className="text-xs text-gray-500">
        Press{' '}
        <kbd className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs font-mono">
          {navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘R' : 'Ctrl+R'}
        </kbd>
        {' '}or click to start
      </div>
    </div>
  );
}
