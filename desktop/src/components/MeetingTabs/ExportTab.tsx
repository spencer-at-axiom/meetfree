'use client';

import { useState } from 'react';
import { Download, FileText, FileType, File, Folder, CheckCircle, AlertCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ExportFormat } from '@/types/export';
import { exportMeeting } from '@/services/exportService';
import { getModifierKey } from '@/hooks/useKeyboardShortcuts';

interface ExportTabProps {
  meetingId: string;
  meetingTitle: string;
}

export function ExportTab({ meetingId, meetingTitle }: ExportTabProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
  const [isExporting, setIsExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string>('');
  const [lastExportResult, setLastExportResult] = useState<{
    success: boolean;
    path?: string;
    error?: string;
  } | null>(null);
  const mod = getModifierKey();

  const formats: { value: ExportFormat; label: string; icon: any; description: string }[] = [
    {
      value: 'markdown',
      label: 'Markdown',
      icon: FileText,
      description: 'Plain text with formatting (.md)',
    },
    {
      value: 'pdf',
      label: 'PDF',
      icon: FileType,
      description: 'Portable document format (.pdf)',
    },
    {
      value: 'docx',
      label: 'Word Document',
      icon: File,
      description: 'Microsoft Word format (.docx)',
    },
  ];

  const handleSelectFolder = async () => {
    try {
      const selected = await invoke<string | null>('select_recording_folder');
      if (selected) {
        setExportPath(selected);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
      toast.error('Failed to select export destination');
    }
  };

  const handleExport = async () => {
    if (!exportPath) {
      toast.error('Please select an export destination');
      return;
    }

    setIsExporting(true);
    setLastExportResult(null);

    try {
      const result = await exportMeeting(meetingId, selectedFormat, exportPath);

      if (!result.error) {
        setLastExportResult({
          success: true,
          path: result.output_path,
        });
        toast.success(
          result.wrote_file
            ? `Exported as ${selectedFormat.toUpperCase()}`
            : `${selectedFormat.toUpperCase()} preview generated`
        );
      } else {
        setLastExportResult({
          success: false,
          error: result.error || 'Export failed',
        });
        toast.error(result.error || 'Export failed');
      }
    } catch (error) {
      const errorMsg = String(error);
      setLastExportResult({
        success: false,
        error: errorMsg,
      });
      toast.error(`Export failed: ${errorMsg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenExportFolder = async () => {
    if (lastExportResult?.path) {
      try {
        await invoke('open_path', { path: lastExportResult.path });
      } catch (_error) {
        toast.error('Failed to open export location');
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-8 space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Export Meeting</h2>
          <p className="text-sm text-gray-600">
            Export "{meetingTitle}" to your preferred format
          </p>
        </div>

        {/* Format Selection */}
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Export Format
          </label>
          <div className="grid grid-cols-3 gap-3">
            {formats.map((format) => {
              const Icon = format.icon;
              return (
                <button
                  key={format.value}
                  onClick={() => setSelectedFormat(format.value)}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    selectedFormat === format.value
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <Icon
                    className={`w-6 h-6 mb-2 ${
                      selectedFormat === format.value ? 'text-blue-600' : 'text-gray-400'
                    }`}
                  />
                  <div className="font-medium text-sm text-gray-900 mb-1">
                    {format.label}
                  </div>
                  <div className="text-xs text-gray-500">{format.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Destination Folder */}
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Export Destination
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Folder className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={exportPath}
                onChange={(e) => setExportPath(e.target.value)}
                placeholder="Select destination folder..."
                className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={handleSelectFolder}
              className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Export Button */}
        <div>
          <button
            onClick={handleExport}
            disabled={isExporting || !exportPath}
            className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export as {selectedFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>

        {/* Export Result */}
        {lastExportResult && (
          <div
            className={`p-4 rounded-lg border-2 ${
              lastExportResult.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {lastExportResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={`font-medium text-sm mb-1 ${
                    lastExportResult.success ? 'text-green-900' : 'text-red-900'
                  }`}
                >
                  {lastExportResult.success ? 'Export Successful' : 'Export Failed'}
                </div>
                {lastExportResult.success && lastExportResult.path && (
                  <>
                    <div className="text-xs text-green-700 mb-2 break-all">
                      {lastExportResult.path}
                    </div>
                    <button
                      onClick={handleOpenExportFolder}
                      className="text-xs text-green-700 hover:text-green-800 font-medium underline"
                    >
                      Open export location
                    </button>
                  </>
                )}
                {!lastExportResult.success && lastExportResult.error && (
                  <div className="text-xs text-red-700">{lastExportResult.error}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Export Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-900">
              <div className="font-medium mb-1">What's included in the export?</div>
              <ul className="space-y-1 text-blue-800">
                <li>• Meeting title and metadata</li>
                <li>• Full transcript with timestamps</li>
                <li>• Speaker labels (if available)</li>
                <li>• AI-generated summary (if available)</li>
              </ul>
            </div>
          </div>
        </div>
        
        {/* Keyboard Shortcut Hint */}
        <div className="text-center">
          <p className="text-xs text-gray-500">
            Tip: Press <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded">{mod}</kbd> + <kbd className="px-1.5 py-0.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-300 rounded">3</kbd> to quickly access this tab
          </p>
        </div>
      </div>
    </div>
  );
}
