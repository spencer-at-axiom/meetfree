'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Filter,
  Check,
  Calendar,
  Clock,
  Users,
  CheckCircle2,
  Mic,
  Upload,
  Trash2,
  Download,
  MoreHorizontal,
  Pencil,
  CheckSquare,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

import { useMeetings, type Meeting } from '@/contexts/MeetingsContext';
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog';
import { batchExportMeetings } from '@/services/exportService';
import type { ExportFormat } from '@/types/export';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';

type MeetingListItem = Meeting & {
  duration?: number | null;
  speaker_count?: number | null;
  has_summary?: boolean;
  source_type?: 'recorded' | 'imported' | 'retranscribed' | string;
};

type MeetingGroup = [string, MeetingListItem[]];
type MeetingFilter = 'all' | 'recorded' | 'imported';
type MeetingDateFilter = 'any-time' | 'today' | 'last-7-days' | 'last-30-days' | 'older';

function formatRelativeTime(dateString?: string) {
  if (!dateString) {
    return 'Unknown date';
  }

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${Math.max(diffMins, 1)}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';

  return date.toLocaleDateString();
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return 'N/A';

  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;

  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hrs}h ${remainingMins}m`;
}

export default function MeetingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { meetings, isLoading, refetchMeetings } = useMeetings();
  const { confirm, confirmationDialog } = useConfirmationDialog();

  const [searchQuery, setSearchQuery] = useState('');
  const [meetingFilter, setMeetingFilter] = useState<MeetingFilter>('all');
  const [meetingDateFilter, setMeetingDateFilter] = useState<MeetingDateFilter>('any-time');
  const [selectedMeetings, setSelectedMeetings] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [ftsMatchIds, setFtsMatchIds] = useState<Set<string> | null>(null);

  const [isBatchExportOpen, setIsBatchExportOpen] = useState(false);
  const [batchDestinationRoot, setBatchDestinationRoot] = useState('');
  const [batchExportFormat, setBatchExportFormat] = useState<ExportFormat>('markdown');
  const [selectedForBatchExport, setSelectedForBatchExport] = useState<Set<string>>(new Set());
  const [isBatchExporting, setIsBatchExporting] = useState(false);
  const [batchExportResults, setBatchExportResults] = useState<any[] | null>(null);

  const validMeetings = useMemo(
    () => meetings.filter((meeting): meeting is MeetingListItem => meeting.id !== 'intro-call'),
    [meetings]
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setFtsMatchIds(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await invoke<{ results: Array<{ id: string }> }>(
          'transcript_search_with_filters',
          { query, limit: 200, offset: 0 }
        );
        if (!cancelled) {
          setFtsMatchIds(new Set(res.results.map((r) => r.id)));
        }
      } catch {
        if (!cancelled) setFtsMatchIds(null);
      }
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  useEffect(() => {
    if (searchParams.get('action') !== 'batch-export') {
      return;
    }

    setIsBatchExportOpen(true);
    setSelectedForBatchExport(new Set(validMeetings.map((meeting) => meeting.id)));
  }, [searchParams, validMeetings]);

  const groupedMeetings = useMemo<MeetingGroup[]>(() => {
    const groups: Record<string, MeetingListItem[]> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      Older: [],
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    validMeetings.forEach((meeting) => {
      const meetingDate = new Date(meeting.created_at || '');

      if (meetingDate >= today) {
        groups.Today.push(meeting);
      } else if (meetingDate >= yesterday) {
        groups.Yesterday.push(meeting);
      } else if (meetingDate >= weekAgo) {
        groups['This Week'].push(meeting);
      } else {
        groups.Older.push(meeting);
      }
    });

    return Object.entries(groups).filter((entry): entry is MeetingGroup => entry[1].length > 0);
  }, [validMeetings]);

  const filteredMeetings = useMemo<MeetingGroup[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    return groupedMeetings
      .map(([group, groupMeetings]) => [
        group,
        groupMeetings.filter((meeting) => {
          const titleMatch = !query || meeting.title.toLowerCase().includes(query);
          const ftsMatch = ftsMatchIds !== null ? ftsMatchIds.has(meeting.id) : false;
          const matchesQuery = !query || titleMatch || ftsMatch;
          const matchesFilter =
            meetingFilter === 'all'
              ? true
              : meetingFilter === 'recorded'
                ? (meeting.source_type ?? 'recorded') === 'recorded'
                : (meeting.source_type ?? 'recorded') === 'imported';
          const meetingDate = meeting.created_at ? new Date(meeting.created_at) : null;
          const matchesDate =
            meetingDateFilter === 'any-time' || !meetingDate
              ? true
              : meetingDateFilter === 'today'
                ? meetingDate >= today
                : meetingDateFilter === 'last-7-days'
                  ? meetingDate >= sevenDaysAgo
                  : meetingDateFilter === 'last-30-days'
                    ? meetingDate >= thirtyDaysAgo
                    : meetingDate < thirtyDaysAgo;

          return matchesQuery && matchesFilter && matchesDate;
        }),
      ] as MeetingGroup)
      .filter((entry) => entry[1].length > 0);
  }, [groupedMeetings, searchQuery, meetingFilter, meetingDateFilter, ftsMatchIds]);

  const flatMeetings = useMemo(
    () => filteredMeetings.flatMap(([_, groupMeetings]) => groupMeetings),
    [filteredMeetings]
  );

  const hasActiveFilters = meetingFilter !== 'all' || meetingDateFilter !== 'any-time';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, flatMeetings.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          event.preventDefault();
          if (focusedIndex >= 0 && flatMeetings[focusedIndex]) {
            router.push(`/meeting-details?id=${flatMeetings[focusedIndex].id}`);
          }
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          if (focusedIndex >= 0 && flatMeetings[focusedIndex]) {
            void handleDeleteMeeting(flatMeetings[focusedIndex]);
          }
          break;
        case 'a':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            handleSelectAll();
          }
          break;
        case 'Escape':
          if (isSelectionMode) {
            event.preventDefault();
            handleClearSelection();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flatMeetings, focusedIndex, isSelectionMode, router]);

  const handleToggleSelection = (meetingId: string) => {
    setSelectedMeetings((prev) => {
      const next = new Set(prev);
      if (next.has(meetingId)) {
        next.delete(meetingId);
      } else {
        next.add(meetingId);
      }
      return next;
    });
    setIsSelectionMode(true);
  };

  const handleSelectAll = () => {
    setSelectedMeetings(new Set(flatMeetings.map((meeting) => meeting.id)));
    setIsSelectionMode(true);
  };

  const handleClearSelection = () => {
    setSelectedMeetings(new Set());
    setIsSelectionMode(false);
  };

  const handleBulkDelete = async () => {
    if (selectedMeetings.size === 0) {
      return;
    }

    const count = selectedMeetings.size;
    const confirmed = await confirm({
      title: `Delete ${count} meeting${count > 1 ? 's' : ''}?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });

    if (!confirmed) {
      return;
    }

    try {
      for (const meetingId of selectedMeetings) {
        await invoke('meeting_delete', { meetingId });
      }

      toast.success(`Deleted ${count} meeting${count > 1 ? 's' : ''}`);
      handleClearSelection();
      await refetchMeetings();
    } catch (_error) {
      toast.error('Failed to delete meetings');
    }
  };

  const handleDeleteMeeting = async (meeting: MeetingListItem) => {
    const confirmed = await confirm({
      title: `Delete "${meeting.title}"?`,
      description: 'This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });

    if (!confirmed) {
      return;
    }

    try {
      await invoke('meeting_delete', { meetingId: meeting.id });
      toast.success('Meeting deleted');
      await refetchMeetings();
    } catch (_error) {
      toast.error('Failed to delete meeting');
    }
  };

  const handleRenameMeeting = async (meeting: MeetingListItem, newTitle: string) => {
    if (!newTitle || newTitle === meeting.title) {
      return;
    }

    try {
      await invoke('meeting_title_set', {
        meetingId: meeting.id,
        title: newTitle,
      });
      toast.success('Meeting renamed');
      await refetchMeetings();
    } catch (_error) {
      toast.error('Failed to rename meeting');
    }
  };

  const batchExportCandidates = validMeetings;

  const handleToggleBatchMeeting = (meetingId: string, checked: boolean) => {
    setSelectedForBatchExport((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(meetingId);
      } else {
        next.delete(meetingId);
      }
      return next;
    });
  };

  const handlePickBatchFolder = async () => {
    try {
      const selected = await invoke<string | null>('select_recording_folder');
      if (selected) {
        setBatchDestinationRoot(selected);
      }
    } catch (error) {
      console.error('Failed to select batch export folder:', error);
      toast.error('Failed to select export destination');
    }
  };

  const handleBatchExport = async () => {
    if (selectedForBatchExport.size === 0) {
      toast.error('Select at least one meeting');
      return;
    }

    if (!batchDestinationRoot.trim()) {
      toast.error('Select a destination folder');
      return;
    }

    try {
      setIsBatchExporting(true);
      setBatchExportResults(null);

      const response = await batchExportMeetings(
        Array.from(selectedForBatchExport),
        batchExportFormat,
        batchDestinationRoot
      );

      setBatchExportResults(response.results);

      const successCount = response.results.filter((result) => result.success).length;
      const failureCount = response.results.length - successCount;

      if (failureCount > 0) {
        toast.warning(`Exported ${successCount} meetings, ${failureCount} failed`);
      } else {
        toast.success(`Exported ${successCount} meetings as ${batchExportFormat.toUpperCase()}`);
      }
    } catch (error) {
      console.error('Batch export failed:', error);
      toast.error(`Batch export failed: ${String(error)}`);
    } finally {
      setIsBatchExporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col bg-slate-50/60"
    >
      <div className="border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search meetings"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 shadow-sm transition-shadow placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'relative inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
                    hasActiveFilters
                      ? 'text-slate-900 hover:bg-slate-100'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                  )}
                  aria-label="Filter meetings"
                  title="Filter meetings"
                >
                  <Filter className="h-4 w-4" />
                  {hasActiveFilters ? (
                    <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-slate-900" />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 text-xs">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Source</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setMeetingFilter('all')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingFilter === 'all' ? 'opacity-100' : 'opacity-0')} />
                  All meetings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingFilter('recorded')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingFilter === 'recorded' ? 'opacity-100' : 'opacity-0')} />
                  Recorded
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingFilter('imported')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingFilter === 'imported' ? 'opacity-100' : 'opacity-0')} />
                  Imported
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Date</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setMeetingDateFilter('any-time')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingDateFilter === 'any-time' ? 'opacity-100' : 'opacity-0')} />
                  Any time
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingDateFilter('today')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingDateFilter === 'today' ? 'opacity-100' : 'opacity-0')} />
                  Today
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingDateFilter('last-7-days')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingDateFilter === 'last-7-days' ? 'opacity-100' : 'opacity-0')} />
                  Last 7 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingDateFilter('last-30-days')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingDateFilter === 'last-30-days' ? 'opacity-100' : 'opacity-0')} />
                  Last 30 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMeetingDateFilter('older')} className="text-[13px]">
                  <Check className={cn('h-4 w-4', meetingDateFilter === 'older' ? 'opacity-100' : 'opacity-0')} />
                  Older
                </DropdownMenuItem>
                {hasActiveFilters ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setMeetingFilter('all');
                        setMeetingDateFilter('any-time');
                      }}
                      className="text-[13px]"
                    >
                      Clear filters
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>

            {isSelectionMode ? (
              <>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedMeetings.size} selected
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedForBatchExport(new Set(selectedMeetings));
                    setIsBatchExportOpen(true);
                  }}
                  disabled={selectedMeetings.size === 0}
                >
                  <Download className="h-4 w-4" />
                  Export
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleBulkDelete()}
                  disabled={selectedMeetings.size === 0}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
                <Button type="button" variant="outline" onClick={handleClearSelection}>
                  Done
                </Button>
              </>
            ) : validMeetings.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSelectionMode(true)}
              >
                <CheckSquare className="h-4 w-4" />
                Select
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-6">
          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map((group) => (
                <div key={group} className="space-y-3">
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-200/70" />
                  <div className="space-y-2">
                    {[1, 2].map((row) => (
                      <div
                        key={row}
                        className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center">
              <div className="max-w-md text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <Calendar className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-slate-950">
                  {searchQuery || hasActiveFilters ? 'No meetings found' : 'No meetings yet'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {searchQuery || hasActiveFilters
                    ? 'Try a different search term or clear the active filters.'
                    : 'Start a recording and your saved meetings will appear here.'}
                </p>
                {!searchQuery && !hasActiveFilters && (
                  <Button
                    type="button"
                    className="mt-5"
                    onClick={() => router.push('/')}
                  >
                    Start Recording
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {filteredMeetings.map(([dateGroup, groupMeetings]) => (
                <section key={dateGroup} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {dateGroup}
                    </h2>
                    <span className="text-xs text-slate-400">
                      {groupMeetings.length} {groupMeetings.length === 1 ? 'meeting' : 'meetings'}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {groupMeetings.map((meeting) => {
                      const globalIndex = flatMeetings.findIndex((item) => item.id === meeting.id);

                      return (
                        <MeetingCard
                          key={meeting.id}
                          meeting={meeting}
                          isSelected={selectedMeetings.has(meeting.id)}
                          isSelectionMode={isSelectionMode}
                          isFocused={focusedIndex === globalIndex}
                          onToggleSelection={handleToggleSelection}
                          onDelete={handleDeleteMeeting}
                          onRename={handleRenameMeeting}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmationDialog}

      <Dialog open={isBatchExportOpen} onOpenChange={setIsBatchExportOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogTitle>Batch Export Meetings</DialogTitle>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Export Format
              </label>
              <div className="flex gap-3">
                {(['markdown', 'pdf', 'docx'] as const).map((format) => (
                  <label key={format} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="export-format"
                      value={format}
                      checked={batchExportFormat === format}
                      onChange={() => setBatchExportFormat(format)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm capitalize font-medium">{format}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Destination Root Folder
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={batchDestinationRoot}
                  onChange={(event) => setBatchDestinationRoot(event.target.value)}
                  placeholder="Select destination folder"
                  className="h-9 flex-1 rounded border border-gray-300 px-3 text-sm"
                />
                <Button type="button" variant="outline" onClick={() => void handlePickBatchFolder()}>
                  Browse
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Meetings</label>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedForBatchExport(new Set(batchExportCandidates.map((meeting) => meeting.id)))
                  }
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Select all
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                {batchExportCandidates.length === 0 ? (
                  <div className="p-3 text-sm text-gray-500">No meetings available.</div>
                ) : (
                  batchExportCandidates.map((meeting) => (
                    <label
                      key={meeting.id}
                      className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-gray-50"
                    >
                      <span className="truncate">{meeting.title}</span>
                      <input
                        type="checkbox"
                        checked={selectedForBatchExport.has(meeting.id)}
                        onChange={(event) =>
                          handleToggleBatchMeeting(meeting.id, event.target.checked)
                        }
                      />
                    </label>
                  ))
                )}
              </div>
            </div>

            {batchExportResults && (
              <div className="divide-y rounded-md border">
                {batchExportResults.map((result) => {
                  const meeting = batchExportCandidates.find(
                    (candidate) => candidate.id === result.meeting_id
                  );

                  return (
                    <div key={result.meeting_id} className="p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">
                          {meeting?.title ?? result.meeting_id}
                        </span>
                        <span className={result.success ? 'text-green-600' : 'text-red-600'}>
                          {result.success ? 'Success' : 'Failed'}
                        </span>
                      </div>
                      {result.output_path && (
                        <p className="mt-1 truncate text-xs text-gray-500">{result.output_path}</p>
                      )}
                      {result.error && (
                        <p className="mt-1 text-xs text-red-600">{result.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsBatchExportOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => void handleBatchExport()}
              disabled={isBatchExporting}
            >
              {isBatchExporting ? 'Exporting...' : `Export ${batchExportFormat.toUpperCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

interface MeetingCardProps {
  meeting: MeetingListItem;
  isSelected: boolean;
  isSelectionMode: boolean;
  isFocused: boolean;
  onToggleSelection: (meetingId: string) => void;
  onDelete: (meeting: MeetingListItem) => Promise<void>;
  onRename: (meeting: MeetingListItem, newTitle: string) => Promise<void>;
}

function MeetingCard({
  meeting,
  isSelected,
  isSelectionMode,
  isFocused,
  onToggleSelection,
  onDelete,
  onRename,
}: MeetingCardProps) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [editedTitle, setEditedTitle] = useState(meeting.title);

  const sourceLabel =
    meeting.source_type === 'imported'
      ? 'Imported'
      : meeting.source_type === 'retranscribed'
        ? 'Retranscribed'
        : 'Recorded';

  const handleCardClick = () => {
    if (isSelectionMode) {
      onToggleSelection(meeting.id);
      return;
    }

    router.push(`/meeting-details?id=${meeting.id}`);
  };

  const handleRenameCommit = async () => {
    const nextTitle = editedTitle.trim();
    setIsRenaming(false);

    if (!nextTitle || nextTitle === meeting.title) {
      setEditedTitle(meeting.title);
      return;
    }

    await onRename(meeting, nextTitle);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleCardClick}
      className={cn(
        'group rounded-2xl border bg-white p-4 shadow-sm transition-all',
        isSelectionMode ? 'cursor-pointer' : 'cursor-pointer hover:border-slate-300 hover:shadow-md',
        isSelected ? 'border-slate-950 ring-1 ring-slate-950/10' : 'border-slate-200',
        isFocused && !isSelected ? 'border-slate-300 ring-1 ring-slate-300/60' : ''
      )}
    >
      <div className="flex items-start gap-3">
        {isSelectionMode ? (
          <div className="pt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelection(meeting.id)}
              onClick={(event) => event.stopPropagation()}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(event) => setEditedTitle(event.target.value)}
                  onBlur={() => void handleRenameCommit()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleRenameCommit();
                    }
                    if (event.key === 'Escape') {
                      setIsRenaming(false);
                      setEditedTitle(meeting.title);
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  autoFocus
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-950 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              ) : (
                <h3 className="truncate text-sm font-medium text-slate-950">{meeting.title}</h3>
              )}

              <p className="mt-1 text-xs text-slate-500">
                {formatRelativeTime(meeting.created_at)}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {meeting.has_summary ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Summary
                </span>
              ) : null}

              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {meeting.source_type === 'imported' ? (
                  <Upload className="h-3 w-3" />
                ) : (
                  <Mic className="h-3 w-3" />
                )}
                {sourceLabel}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Meeting actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsRenaming(true);
                      setEditedTitle(meeting.title);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSelection(meeting.id);
                    }}
                  >
                    <CheckSquare className="h-4 w-4" />
                    {isSelected ? 'Deselect' : 'Select'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDelete(meeting);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(meeting.duration)}
            </span>

            {meeting.speaker_count ? (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {meeting.speaker_count} {meeting.speaker_count === 1 ? 'speaker' : 'speakers'}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
