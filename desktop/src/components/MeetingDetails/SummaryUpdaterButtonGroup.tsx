"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, FileDown, Loader2, Save, Search } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { ExportDialog } from './ExportDialog';
import type { ExportFormat } from '@/types/export';

interface UpdBtn {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => Promise<void>;
  onCopy: () => Promise<void>;
  onMd?: () => Promise<void>;
  onExp?: (format: ExportFormat) => Promise<void>;
  onFind?: () => void;
  hasSummary: boolean;
}

export function SumUpd({
  isSaving,
  isDirty,
  onSave,
  onCopy,
  onMd,
  onExp,
  onFind,
  hasSummary,
}: UpdBtn) {
  const [dlgOpen, setDlg] = useState(false);
  const [isExp, setExp] = useState(false);

  const doExp = async (format: ExportFormat) => {
    if (!onExp) {
      if (onMd) {
        await onMd();
      }
      return;
    }

    setExp(true);
    try {
      await onExp(format);
    } finally {
      setExp(false);
    }
  };

  return (
    <>
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          className={`${isDirty ? 'bg-green-200' : ''}`}
          title={isSaving ? 'Saving' : 'Save Changes'}
          onClick={() => {
            Analytics.trackButtonClick('save_changes', 'meeting_details');
            void onSave();
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

        <Button
          variant="outline"
          size="sm"
          title="Copy Summary"
          onClick={() => {
            Analytics.trackButtonClick('copy_summary', 'meeting_details');
            void onCopy();
          }}
          disabled={!hasSummary}
          className="cursor-pointer"
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        {(onMd || onExp) && (
          <Button
            variant="outline"
            size="sm"
            title="Export Meeting"
            onClick={() => {
              Analytics.trackButtonClick('export_meeting', 'meeting_details');
              setDlg(true);
            }}
            className="cursor-pointer"
            disabled={isExp}
          >
            {isExp ? (
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

      {(onMd || onExp) && (
        <ExportDialog
          open={dlgOpen}
          onOpenChange={setDlg}
          onExport={doExp}
          isLoading={isExp}
        />
      )}
    </>
  );
}
