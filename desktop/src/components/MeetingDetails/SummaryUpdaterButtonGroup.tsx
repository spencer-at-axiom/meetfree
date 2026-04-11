"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Save, Loader2, FileDown, Search } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { ExportDialog } from './ExportDialog';
import type { ExportFormat } from '@/types/export';

interface SummaryUpdaterButtonGroupProps {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onExportMarkdown?: () => Promise<void>;
  onExport?: (format: ExportFormat) => Promise<void>;
  onFind?: () => void;
  onOpenFolder: () => Promise<void>;
  hasSummary: boolean;
}

export function SummaryUpdaterButtonGroup({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onExportMarkdown,
  onExport,
  onFind,
  onOpenFolder: _onOpenFolder,
  hasSummary
}: SummaryUpdaterButtonGroupProps) {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    if (!onExport) {
      // Fallback to markdown export if onExport not provided
      if (onExportMarkdown) {
        await onExportMarkdown();
      }
      return;
    }

    setIsExporting(true);
    try {
      await onExport(format);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <ButtonGroup>
        {/* Save button */}
        <Button
          variant="outline"
          size="sm"
          className={`${isDirty ? 'bg-green-200' : ""}`}
          title={isSaving ? "Saving" : "Save Changes"}
          onClick={() => {
            Analytics.trackButtonClick('save_changes', 'meeting_details');
            onSave();
          }}
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <Loader2 className="animate-spin" />
              <span className="hidden lg:inline">Saving...</span>
            </>
          ) : (
            <>
              <Save />
              <span className="hidden lg:inline">Save</span>
            </>
          )}
        </Button>

        {/* Copy button */}
        <Button
          variant="outline"
          size="sm"
          title="Copy Summary"
          onClick={() => {
            Analytics.trackButtonClick('copy_summary', 'meeting_details');
            onCopy();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        {(onExportMarkdown || onExport) && (
          <Button
            variant="outline"
            size="sm"
            title="Export Meeting"
            onClick={() => {
              Analytics.trackButtonClick('export_meeting', 'meeting_details');
              setExportDialogOpen(true);
            }}
            className="cursor-pointer"
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FileDown />
            )}
            <span className="hidden lg:inline">Export</span>
          </Button>
        )}

        {onFind && (
          <Button
            variant="outline"
            size="sm"
            title="Find in Summary"
            onClick={() => {
              Analytics.trackButtonClick('find_in_summary', 'meeting_details');
              onFind();
            }}
            disabled={!hasSummary}
            className="cursor-pointer"
          >
            <Search />
            <span className="hidden lg:inline">Find</span>
          </Button>
        )}
      </ButtonGroup>

      {/* Export format selection dialog */}
      {(onExportMarkdown || onExport) && (
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          onExport={handleExport}
          isLoading={isExporting}
        />
      )}
    </>
  );
}
