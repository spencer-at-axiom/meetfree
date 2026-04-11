/**
 * SpeakerLabel Component
 * Displays speaker identification with color coding in the transcript
 */

"use client";

import { useMemo } from 'react';

interface SpeakerLabelProps {
  speakerId?: number;
  speakerName?: string;
  confidence?: number;
  showConfidence?: boolean;
}

const SPEAKER_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-300',
  'bg-purple-100 text-purple-800 border-purple-300',
  'bg-green-100 text-green-800 border-green-300',
  'bg-amber-100 text-amber-800 border-amber-300',
  'bg-red-100 text-red-800 border-red-300',
  'bg-pink-100 text-pink-800 border-pink-300',
  'bg-indigo-100 text-indigo-800 border-indigo-300',
  'bg-teal-100 text-teal-800 border-teal-300',
];

export function SpeakerLabel({
  speakerId = 0,
  speakerName,
  confidence,
  showConfidence = false,
}: SpeakerLabelProps) {
  const colorClass = useMemo(() => {
    return SPEAKER_COLORS[speakerId % SPEAKER_COLORS.length];
  }, [speakerId]);

  const displayName = speakerName || `Speaker ${speakerId + 1}`;
  const confidencePercent = confidence ? Math.round(confidence * 100) : null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border ${colorClass}`}
      title={
        confidence !== undefined
          ? `${displayName} (confidence: ${confidencePercent}%)`
          : displayName
      }
    >
      {displayName}
      {showConfidence && confidencePercent && (
        <span className="text-xs opacity-75">({confidencePercent}%)</span>
      )}
    </span>
  );
}

interface TranscriptSegmentWithSpeakerProps {
  timestamp: string;
  text: string;
  speakerId?: number;
  speakerName?: string;
  confidence?: number;
  className?: string;
}

/**
 * Renders a transcript segment with speaker label
 */
export function TranscriptSegmentWithSpeaker({
  timestamp,
  text,
  speakerId,
  speakerName,
  confidence,
  className = '',
}: TranscriptSegmentWithSpeakerProps) {
  const hasSpeaker = speakerId !== undefined && speakerId >= 0;

  return (
    <div className={`flex gap-3 py-2 ${className}`}>
      <div className="flex-shrink-0 w-20 text-xs text-gray-500 font-mono">
        {timestamp}
      </div>
      <div className="flex-1 min-w-0">
        {hasSpeaker && (
          <>
            <SpeakerLabel
              speakerId={speakerId}
              speakerName={speakerName}
              confidence={confidence}
              showConfidence={false}
            />
            <div className="mt-1 text-sm text-gray-800 break-words">{text}</div>
          </>
        )}
        {!hasSpeaker && (
          <div className="text-sm text-gray-800 break-words">{text}</div>
        )}
      </div>
    </div>
  );
}

interface SpeakerStatsProps {
  speakers: Array<{
    speakerId: number;
    speakerName?: string;
    segmentCount: number;
    wordCount?: number;
  }>;
}

/**
 * Shows statistics about speakers in the meeting
 */
export function SpeakerStats({ speakers }: SpeakerStatsProps) {
  if (speakers.length === 0) {
    return null;
  }

  const totalSegments = speakers.reduce((sum, s) => sum + s.segmentCount, 0);

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-900">Speakers ({speakers.length})</h3>
      <div className="space-y-2">
        {speakers.map((speaker) => {
          const percentage = ((speaker.segmentCount / totalSegments) * 100).toFixed(1);
          return (
            <div key={speaker.speakerId} className="flex items-center justify-between gap-3">
              <SpeakerLabel
                speakerId={speaker.speakerId}
                speakerName={speaker.speakerName}
              />
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 font-medium w-10 text-right">
                  {percentage}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
