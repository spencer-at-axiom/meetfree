/**
 * ExportDialog Component
 * Dialog for selecting export format (Markdown, PDF, DOCX)
 */

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, FileText } from 'lucide-react';
import type { ExportFormat } from '@/types/export';
import { EXPORT_FORMATS, FORMAT_DESCRIPTIONS } from '@/services/exportService';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (format: ExportFormat) => Promise<void>;
  isLoading?: boolean;
}

export function ExportDialog({
  open,
  onOpenChange,
  onExport,
  isLoading = false,
}: ExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');

  const handleExport = async () => {
    try {
      await onExport(selectedFormat);
      onOpenChange(false);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Export Meeting
          </DialogTitle>
          <DialogDescription>
            Choose a format to export this meeting&apos;s transcript and summary.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div role="radiogroup" className="space-y-3">
            {EXPORT_FORMATS.map((format) => (
              <div
                key={format}
                className={`flex items-start gap-3 rounded-lg border p-4 transition-colors cursor-pointer ${
                  selectedFormat === format
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  id={`format-${format}`}
                  type="radio"
                  name="meeting-export-format"
                  value={format}
                  checked={selectedFormat === format}
                  onChange={() => setSelectedFormat(format)}
                  className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1">
                  <Label
                    htmlFor={`format-${format}`}
                    className="cursor-pointer font-medium capitalize text-gray-900"
                  >
                    {format}
                  </Label>
                  <p className="text-sm text-gray-600">
                    {FORMAT_DESCRIPTIONS[format]}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {selectedFormat === 'pdf' && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              PDF files are great for sharing and printing. Best for professional distribution.
            </div>
          )}

          {selectedFormat === 'docx' && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              DOCX files are editable in Microsoft Word, Google Docs, and LibreOffice. Perfect for collaboration.
            </div>
          )}

          {selectedFormat === 'markdown' && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              Markdown is portable, version-control friendly, and works with any text editor.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={isLoading}
            className="gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoading ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
