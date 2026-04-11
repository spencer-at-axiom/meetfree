/**
 * DiarizationSettings Component
 * UI controls for enabling/managing speaker diarization
 */

"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader2, CheckCircle2, Mic2 } from 'lucide-react';
import { toast } from 'sonner';

interface DiarizationSettingsProps {
  meetingId: string;
  onDiarizationStart?:  (meetingId: string) => Promise<void>;
  diarizationStatus?: 'not_started' | 'in_progress' | 'completed' | 'failed';
  enabledByDefault?: boolean;
}

export function DiarizationSettings({
  meetingId,
  onDiarizationStart,
  diarizationStatus = 'not_started',
  enabledByDefault = false,
}: DiarizationSettingsProps) {
  const [isEnabled, setIsEnabled] = useState(enabledByDefault);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    setIsEnabled(enabled);
    
    if (enabled && onDiarizationStart && diarizationStatus === 'not_started') {
      try {
        setIsProcessing(true);
        await onDiarizationStart(meetingId);
        toast.success('Speaker identification started');
      } catch (error) {
        setIsEnabled(false);
        console.error('Failed to start diarization:', error);
        toast.error('Failed to start speaker identification', {
          description: 'Please ensure diarization models are downloaded',
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const getStatusBadge = () => {
    switch (diarizationStatus) {
      case 'completed':
        return (
          <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-medium">Speakers Identified</span>
          </div>
        );
      case 'in_progress':
        return (
          <div className="flex items-center gap-2 text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Identifying speakers...</span>
          </div>
        );
      case 'failed':
        return (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-medium">Identification Failed</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-2 text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
            <Mic2 className="h-4 w-4" />
            <span className="text-sm font-medium">Not Run Yet</span>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4 p-4 border border-slate-200 rounded-lg bg-slate-50">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Label className="text-base font-semibold text-slate-900">
            Speaker Identification
          </Label>
          <p className="text-sm text-slate-600">
            Automatically identify and label different speakers in the meeting
          </p>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={handleToggle}
          disabled={isProcessing || diarizationStatus === 'in_progress'}
        />
      </div>

      {isEnabled && (
        <div className="space-y-3">
          {getStatusBadge()}

          <div className="rounded-lg bg-white border border-slate-200 p-3 text-sm text-slate-700 space-y-2">
            <p className="font-medium text-slate-900">Requirements:</p>
            <ul className="list-disc list-inside space-y-1 text-xs text-slate-600">
              <li>Diarization models (~48MB) will be downloaded on first use</li>
              <li>Processing time typically ~0.5x to 1x the meeting length</li>
            </ul>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800 space-y-2">
            <p className="font-medium text-blue-900">ℹ️ How it works:</p>
            <p>Speaker identification analyzes the audio to detect speaker boundaries and assigns speaker labels (Speaker 1, Speaker 2, etc.). These labels will appear in transcripts, exports, and can be used for searching.</p>
          </div>

          {diarizationStatus === 'not_started' && (
            <Button
              onClick={() => handleToggle(true)}
              disabled={isProcessing}
              className="w-full"
              variant="default"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                'Start Speaker Identification'
              )}
            </Button>
          )}

          {diarizationStatus === 'completed' && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-sm text-green-800">
                ✓ Speaker identification is complete. Speaker labels are now available in your transcript, and you can search by speaker.
              </p>
            </div>
          )}
        </div>
      )}

      {!isEnabled && diarizationStatus === 'completed' && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3">
          <p className="text-sm text-green-800 font-medium">
            ✓ This meeting has been analyzed for speakers. Enable to view or search by speaker.
          </p>
        </div>
      )}
    </div>
  );
}

