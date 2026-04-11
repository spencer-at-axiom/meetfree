'use client';

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

interface SpeakerIdentity {
  id: string;
  display_name: string;
  normalized_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface SpeakerIdentityWithCounts {
  identity: SpeakerIdentity;
  meeting_count: number;
  action_item_count: number;
}

interface MergeResult {
  meeting_speakers_updated: number;
  action_items_updated: number;
  voice_profiles_updated: number;
}

interface MergeConfirmationDialogProps {
  source: SpeakerIdentityWithCounts;
  target: SpeakerIdentityWithCounts;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MergeConfirmationDialog({
  source,
  target,
  onConfirm,
  onCancel,
}: MergeConfirmationDialogProps) {
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<MergeResult | null>(null);

  async function handleConfirm() {
    try {
      setMerging(true);
      setError(null);

      const result = await invoke<MergeResult>('speaker_identities_merge', {
        sourceIdentityId: source.identity.id,
        targetIdentityId: target.identity.id,
      });

      setSuccess(result);

      setTimeout(() => {
        onConfirm();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMerging(false);
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && !merging && !success) {
      onCancel();
    } else if (event.key === 'Enter' && !merging && !success && !error) {
      event.preventDefault();
      void handleConfirm();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !merging && onCancel()}>
      <DialogContent
        className="sm:max-w-[500px]"
        onKeyDown={handleKeyDown}
        aria-describedby="merge-dialog-description"
      >
        <DialogHeader>
          <DialogTitle>Merge Speaker Identities</DialogTitle>
          <DialogDescription id="merge-dialog-description">
            This action will combine two speaker identities into one. All references will be updated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!success && (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">Source (will be archived):</p>
                <div
                  className="rounded-lg border p-3 bg-muted/50"
                  role="region"
                  aria-label={`Source identity: ${source.identity.display_name}, ${source.meeting_count} meetings, ${source.action_item_count} action items`}
                >
                  <p className="font-medium">{source.identity.display_name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {source.meeting_count} meetings, {source.action_item_count} action items
                  </p>
                </div>
              </div>

              <div className="flex justify-center" aria-hidden="true">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Target (will be kept):</p>
                <div
                  className="rounded-lg border p-3 bg-primary/5"
                  role="region"
                  aria-label={`Target identity: ${target.identity.display_name}, ${target.meeting_count} meetings, ${target.action_item_count} action items`}
                >
                  <p className="font-medium">{target.identity.display_name}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {target.meeting_count} meetings, {target.action_item_count} action items
                  </p>
                </div>
              </div>

              <Alert role="alert">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>
                  All meeting speakers and action items linked to "{source.identity.display_name}" will be
                  updated to link to "{target.identity.display_name}". The source identity will be archived.
                </AlertDescription>
              </Alert>
            </>
          )}

          {success && (
            <Alert
              className="border-green-500 bg-green-50 dark:bg-green-950"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2
                className="h-4 w-4 text-green-600 dark:text-green-400"
                aria-hidden="true"
              />
              <AlertDescription className="text-green-900 dark:text-green-100">
                <p className="font-medium mb-2">Merge completed successfully!</p>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>{success.meeting_speakers_updated} meeting speakers updated</li>
                  <li>{success.action_items_updated} action items updated</li>
                  {success.voice_profiles_updated > 0 && (
                    <li>{success.voice_profiles_updated} voice profiles updated</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                <p className="font-medium">Merge failed</p>
                <p className="text-sm mt-1">{error}</p>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {!success && (
            <>
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={merging}
                aria-label="Cancel merge operation"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={merging}
                aria-label="Confirm merge operation"
              >
                {merging && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {merging ? 'Merging...' : 'Confirm Merge'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
