'use client';

import { useRef, useReducer, startTransition, useEffect, memo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { motion } from "framer-motion";
import { TranscriptSegmentData } from "@/types";

export interface VirtualizedTranscriptViewProps {
    /** Transcript segments to display */
    segments: TranscriptSegmentData[];
    /** Whether recording is in progress */
    isRecording?: boolean;
    /** Whether recording is paused */
    isPaused?: boolean;
    /** Whether processing/finalizing transcription */
    isProcessing?: boolean;
    /** Whether stopping */
    isStopping?: boolean;
    /** Enable streaming effect for latest segment */
    enableStreaming?: boolean;
    /** Show confidence indicators */
    showConfidence?: boolean;
    /** Override empty-state presentation for recording surfaces */
    emptyStateMode?: 'default' | 'ready';
    /** Completely disable auto-scroll behavior (for meeting details page) */
    disableAutoScroll?: boolean;

    // Pagination props (infinite scroll)
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    onLoadMore?: () => void;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
    if (seconds === undefined) return '[--:--]';

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
    id,
    timestamp,
    text,
    confidence,
    isStreaming,
    showConfidence,
}: {
    id: string;
    timestamp: number;
    text: string;
    confidence?: number;
    isStreaming: boolean;
    showConfidence: boolean;
}) {
    const displayText = text.trim() === '' ? '[Silence]' : text;

    return (
        <div id={`segment-${id}`} className="mb-3">
            <div className="flex items-start gap-2">
                <Tooltip>
                    <TooltipTrigger>
                        <span className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px]">
                            {formatRecordingTime(timestamp)}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {confidence !== undefined && showConfidence && (
                            <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
                        )}
                    </TooltipContent>
                </Tooltip>
                <div className="flex-1">
                    {isStreaming ? (
                        <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
                            <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
                        </div>
                    ) : (
                        <p className="text-base text-gray-800 leading-relaxed">{displayText}</p>
                    )}
                </div>
            </div>
        </div>
    );
});

function TranscriptEmptyState({
    isRecording,
    isPaused,
    isReadyPreview,
    showRecordingStyleEmptyState,
}: {
    isRecording: boolean;
    isPaused: boolean;
    isReadyPreview: boolean;
    showRecordingStyleEmptyState: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-gray-500 mt-8"
        >
            {showRecordingStyleEmptyState ? (
                <>
                    {!isReadyPreview ? (
                        <>
                            <div className="flex items-center justify-center mb-3">
                                <div className={`w-3 h-3 rounded-full ${
                                    isPaused
                                      ? 'bg-amber-500'
                                      : 'bg-blue-500 animate-pulse'
                                }`}></div>
                            </div>
                            <p className="text-sm text-gray-600 font-medium">
                                {isPaused ? 'Paused' : 'Listening for speech'}
                            </p>
                        </>
                    ) : null}
                    {(isPaused || isRecording) && (
                        <p className="text-xs mt-1 text-gray-500">
                            {isPaused
                              ? 'Resume to continue capturing audio'
                              : 'Transcription will appear as speech is detected'
                            }
                        </p>
                    )}
                </>
            ) : (
                <>
                    <p className="text-lg font-semibold">Welcome to MeetFree!</p>
                    <p className="text-xs mt-1">Start recording to see live transcription</p>
                </>
            )}
        </motion.div>
    );
}

function TranscriptPaginationStatus({
    hasMore,
    isLoadingMore,
    isRecording,
    segmentsLength,
    totalCount,
    loadedCount,
    loadMoreTriggerRef,
}: {
    hasMore: boolean;
    isLoadingMore: boolean;
    isRecording: boolean;
    segmentsLength: number;
    totalCount: number;
    loadedCount: number;
    loadMoreTriggerRef: RefObject<HTMLDivElement>;
}) {
    if ((!hasMore && !isLoadingMore) || isRecording || segmentsLength === 0) {
        return null;
    }

    return (
        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
            {isLoadingMore ? (
                <div className="flex items-center gap-2 text-gray-500">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                    <span className="text-sm">Loading more...</span>
                </div>
            ) : hasMore && totalCount > 0 ? (
                <span className="text-sm text-gray-400">
                    Showing {loadedCount} of {totalCount} segments
                </span>
            ) : null}
        </div>
    );
}

function TranscriptActivityStatus({
    isRecording,
    isPaused,
    isProcessing,
    isStopping,
    segmentsLength,
}: {
    isRecording: boolean;
    isPaused: boolean;
    isProcessing: boolean;
    isStopping: boolean;
    segmentsLength: number;
}) {
    if (segmentsLength === 0) {
        return null;
    }

    if (!isStopping && isRecording && !isPaused && !isProcessing) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 mt-4 text-gray-500"
            >
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-sm">Transcribing latest segment</span>
            </motion.div>
        );
    }

    if (isRecording && isPaused) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 mt-4 text-amber-600"
            >
                <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                <span className="text-sm">Paused</span>
            </motion.div>
        );
    }

    if (isStopping || isProcessing) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 mt-4 text-gray-500"
            >
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div>
                <span className="text-sm">Finalizing transcript</span>
            </motion.div>
        );
    }

    return null;
}

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
    segments,
    isRecording = false,
    isPaused = false,
    isProcessing = false,
    isStopping = false,
    enableStreaming = false,
    showConfidence = true,
    emptyStateMode = 'default',
    disableAutoScroll = false,
    hasMore = false,
    isLoadingMore = false,
    totalCount = 0,
    loadedCount = 0,
    onLoadMore,
}) => {
    // Create scroll ref first - shared between virtualizer and auto-scroll hook
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ref for infinite scroll trigger element
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    // Force re-render without flushSync (avoids React warning)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Setup virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: segments.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60, // Estimated height per segment
        overscan: 10, // Render extra items above/below viewport
        onChange: () => {
            startTransition(() => {
                rerender();
            });
        },
    });

    // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
    useAutoScroll({
        scrollRef,
        segments,
        isRecording,
        isPaused,
        virtualizer,
        virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
        disableAutoScroll,
    });

    // Streaming text effect hook (typewriter animation for new transcripts)
    const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
        segments,
        isRecording,
        enableStreaming
    );

    // Infinite scroll: IntersectionObserver to trigger loading more
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
            return;
        }

        const triggerElement = loadMoreTriggerRef.current;
        if (!triggerElement) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
            },
            {
                root: null,
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(triggerElement);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

    // Scroll-based fallback for fast scrolling
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking || isLoadingMore || !hasMore) return;

            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = scrollElement;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;

                // Trigger load when within 200px of bottom
                if (scrollBottom < 200 && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
                ticking = false;
            });
        };

        scrollElement.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollElement.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

    // Use simple rendering for small lists, virtualization for large lists
    const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;
    const isReadyPreview = emptyStateMode === 'ready';
    const showRecordingStyleEmptyState = isRecording || isReadyPreview;
    const transcriptList = useVirtualization ? (
        <div
            style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
            }}
        >
            {virtualizer.getVirtualItems().map((virtualRow) => {
                const segment = segments[virtualRow.index];
                const isStreaming = streamingSegmentId === segment.id;

                return (
                    <div
                        key={segment.id}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualRow.start}px)`,
                        }}
                    >
                        <TranscriptSegment
                            id={segment.id}
                            timestamp={segment.timestamp}
                            text={getDisplayText(segment)}
                            confidence={segment.confidence}
                            isStreaming={isStreaming}
                            showConfidence={showConfidence}
                        />
                    </div>
                );
            })}
        </div>
    ) : (
        <div className="space-y-1">
            {segments.map((segment) => {
                const isStreaming = streamingSegmentId === segment.id;

                return (
                    <motion.div
                        key={segment.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        <TranscriptSegment
                            id={segment.id}
                            timestamp={segment.timestamp}
                            text={getDisplayText(segment)}
                            confidence={segment.confidence}
                            isStreaming={isStreaming}
                            showConfidence={showConfidence}
                        />
                    </motion.div>
                );
            })}
        </div>
    );

    return (
        <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2">
            <div>
            {segments.length === 0 ? (
                <TranscriptEmptyState
                    isRecording={isRecording}
                    isPaused={isPaused}
                    isReadyPreview={isReadyPreview}
                    showRecordingStyleEmptyState={showRecordingStyleEmptyState}
                />
            ) : (
                <>
                    {transcriptList}
                    <TranscriptPaginationStatus
                        hasMore={hasMore}
                        isLoadingMore={isLoadingMore}
                        isRecording={isRecording}
                        segmentsLength={segments.length}
                        totalCount={totalCount}
                        loadedCount={loadedCount}
                        loadMoreTriggerRef={loadMoreTriggerRef}
                    />
                    <TranscriptActivityStatus
                        isRecording={isRecording}
                        isPaused={isPaused}
                        isProcessing={isProcessing}
                        isStopping={isStopping}
                        segmentsLength={segments.length}
                    />
                </>
            )}
            </div>
        </div>
    );
};
