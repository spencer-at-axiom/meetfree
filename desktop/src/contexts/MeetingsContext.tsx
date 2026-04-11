'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';

export interface Meeting {
  id: string;
  title: string;
  created_at?: string;
}

export interface CurrentMeeting {
  id: string;
  title: string;
}

// Search result type for transcript search
interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
  score: number;
  sourceType: string;
  hasSummary: boolean;
}

export interface TranscriptSearchFilters {
  dateFrom: string;
  dateTo: string;
  sourceType: 'all' | 'recorded' | 'imported' | 'retranscribed';
  hasSummary: 'all' | 'yes' | 'no';
}

interface MeetingsContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  meetings: Meeting[];
  setMeetings: (meetings: Meeting[]) => void;
  isLoading: boolean;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  searchTranscripts: (query: string, filters?: TranscriptSearchFilters) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  searchFilters: TranscriptSearchFilters;
  setSearchFilters: (filters: TranscriptSearchFilters) => void;
  // Summary polling management
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: any) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
  // Refetch meetings from the native Tauri data layer
  refetchMeetings: () => Promise<void>;
}

const MeetingsContext = createContext<MeetingsContextType | null>(null);

export const useMeetings = () => {
  const context = useContext(MeetingsContext);
  if (!context) {
    throw new Error('useMeetings must be used within a MeetingsProvider');
  }
  return context;
};

export function MeetingsProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFilters, setSearchFilters] = useState<TranscriptSearchFilters>({
    dateFrom: '',
    dateTo: '',
    sourceType: 'all',
    hasSummary: 'all',
  });
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<Map<string, NodeJS.Timeout>>(new Map());

  // Fetch meetings from backend
  const fetchMeetings = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const meetings = await invoke('meetings_list') as Array<{ id: string; title: string; created_at?: string }>;
      setMeetings(meetings);
      Analytics.trackBackendConnection(true);
    } catch (error) {
      console.error('Error fetching meetings:', error);
      setMeetings([]);
      Analytics.trackBackendConnection(false, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  // Function to search through meeting transcripts
  const searchTranscripts = async (query: string, filters: TranscriptSearchFilters = searchFilters) => {
    const hasActiveFilters =
      !!filters.dateFrom ||
      !!filters.dateTo ||
      filters.sourceType !== 'all' ||
      filters.hasSummary !== 'all';

    if (!query.trim() && !hasActiveFilters) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);

      const hasSummary =
        filters.hasSummary === 'yes'
          ? true
          : filters.hasSummary === 'no'
            ? false
            : null;

      const request = {
        query: query.trim() || null,
        dateFrom: filters.dateFrom || null,
        dateTo: filters.dateTo || null,
        sourceType: filters.sourceType !== 'all' ? filters.sourceType : null,
        hasSummary,
        limit: 200,
        offset: 0,
      };

      const response = await invoke<{ results: TranscriptSearchResult[] }>('transcript_search_with_filters', { request });
      setSearchResults(response.results || []);
    } catch (error) {
      console.error('Error searching transcripts:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Summary polling management
  const startSummaryPolling = React.useCallback((
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void
  ) => {
    // Stop existing poll for this meeting if any
    if (activeSummaryPolls.has(meetingId)) {
      clearInterval(activeSummaryPolls.get(meetingId)!);
    }

    console.log(`📊 Starting polling for meeting ${meetingId}, process ${processId}`);

    let pollCount = 0;
    const MAX_POLLS = 200; // ~16.5 minutes at 5-second intervals

    const pollInterval = setInterval(async () => {
      pollCount++;

      if (pollCount >= MAX_POLLS) {
        console.warn(`⏱️ Polling timeout for ${meetingId} after ${MAX_POLLS} iterations`);
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
        onUpdate({
          status: 'error',
          error: 'Summary generation timed out after 15 minutes. Please try again or check your model configuration.'
        });
        return;
      }

      try {
        const result = await invoke('api_get_summary', {
          meetingId: meetingId,
        }) as any;

        console.log(`📊 Polling update for ${meetingId}:`, result.status);

        onUpdate(result);

        if (result.status === 'completed' || result.status === 'error' || result.status === 'failed' || result.status === 'cancelled') {
          console.log(`Polling completed for ${meetingId}, status: ${result.status}`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        } else if (result.status === 'idle' && pollCount > 1) {
          console.log(`Process completed or not found for ${meetingId}, stopping poll`);
          clearInterval(pollInterval);
          setActiveSummaryPolls(prev => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        }
      } catch (error) {
        console.error(`Polling error for ${meetingId}:`, error);
        onUpdate({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        clearInterval(pollInterval);
        setActiveSummaryPolls(prev => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
      }
    }, 5000);

    setActiveSummaryPolls(prev => new Map(prev).set(meetingId, pollInterval));
  }, [activeSummaryPolls]);

  const stopSummaryPolling = React.useCallback((meetingId: string) => {
    const pollInterval = activeSummaryPolls.get(meetingId);
    if (pollInterval) {
      console.log(`⏹️ Stopping polling for meeting ${meetingId}`);
      clearInterval(pollInterval);
      setActiveSummaryPolls(prev => {
        const next = new Map(prev);
        next.delete(meetingId);
        return next;
      });
    }
  }, [activeSummaryPolls]);

  // Cleanup all polling intervals on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up all summary polling intervals');
      activeSummaryPolls.forEach(interval => clearInterval(interval));
    };
  }, [activeSummaryPolls]);

  return (
    <MeetingsContext.Provider value={{
      currentMeeting,
      setCurrentMeeting,
      meetings,
      setMeetings,
      isLoading,
      isMeetingActive,
      setIsMeetingActive,
      searchTranscripts,
      searchResults,
      isSearching,
      searchFilters,
      setSearchFilters,
      activeSummaryPolls,
      startSummaryPolling,
      stopSummaryPolling,
      refetchMeetings: fetchMeetings,
    }}>
      {children}
    </MeetingsContext.Provider>
  );
}
