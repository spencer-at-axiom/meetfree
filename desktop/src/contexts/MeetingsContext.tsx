'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { useSummaryPolling } from '@/hooks/useSummaryPolling';

export interface Meeting {
  id: string;
  title: string;
  created_at?: string;
}

export interface CurrentMeeting {
  id: string;
  title: string;
}

export interface TranscriptSearchResult {
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
  tagId?: string;
}

interface SummaryPollResult {
  status: string;
  meeting_id: string;
  data?: unknown;
  error?: string;
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
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: SummaryPollResult) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
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

  const {
    activePolls: activeSummaryPolls,
    startPolling: startSummaryPolling,
    stopPolling: stopSummaryPolling,
  } = useSummaryPolling();

  const fetchMeetings = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const meetingList = await invoke('meetings_list') as Array<{ id: string; title: string; created_at?: string }>;
      setMeetings(meetingList);
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

  const searchTranscripts = async (query: string, filters: TranscriptSearchFilters = searchFilters) => {
    const hasActiveFilters =
      !!filters.dateFrom ||
      !!filters.dateTo ||
      filters.sourceType !== 'all' ||
      filters.hasSummary !== 'all' ||
      !!filters.tagId;

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
        tagId: filters.tagId || null,
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
