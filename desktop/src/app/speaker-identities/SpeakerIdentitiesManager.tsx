'use client';

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { MergeConfirmationDialog } from './MergeConfirmationDialog';
import { Loader2, Users, FileText, Archive } from 'lucide-react';

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

export function SpeakerIdentitiesManager() {
  const router = useRouter();
  const [identities, setIdentities] = useState<SpeakerIdentityWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'meetings' | 'action_items'>('updated');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeSource, setMergeSource] = useState<SpeakerIdentityWithCounts | null>(null);
  const [mergeTarget, setMergeTarget] = useState<SpeakerIdentityWithCounts | null>(null);

  useEffect(() => {
    loadIdentities();
  }, []);

  async function loadIdentities() {
    try {
      setLoading(true);
      setError(null);
      const data = await invoke<SpeakerIdentityWithCounts[]>('speaker_identities_list_with_counts');
      // Filter out archived identities
      setIdentities(data.filter(item => !item.identity.archived_at));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleCheckboxChange(id: string, checked: boolean) {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  }

  function handleMergeClick() {
    if (selectedIds.size !== 2) {
      return;
    }

    const [firstId, secondId] = Array.from(selectedIds);
    const first = identities.find(item => item.identity.id === firstId);
    const second = identities.find(item => item.identity.id === secondId);

    if (!first || !second) {
      return;
    }

    // Default: the one with more meetings is the target
    if (first.meeting_count >= second.meeting_count) {
      setMergeTarget(first);
      setMergeSource(second);
    } else {
      setMergeTarget(second);
      setMergeSource(first);
    }

    setShowMergeDialog(true);
  }

  function handleMergeSuccess() {
    setShowMergeDialog(false);
    setSelectedIds(new Set());
    setMergeSource(null);
    setMergeTarget(null);
    loadIdentities();
  }

  function handleMergeCancel() {
    setShowMergeDialog(false);
    setMergeSource(null);
    setMergeTarget(null);
  }

  function handleCardClick(identityId: string, event: React.MouseEvent) {
    // Don't navigate if clicking on checkbox or merge button
    const target = event.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('[role="checkbox"]') ||
      target.tagName === 'INPUT'
    ) {
      return;
    }
    router.push(`/speaker-identities/detail?id=${identityId}`);
  }

  // Handle keyboard navigation on cards
  const handleCardKeyDown = (identityId: string, event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      const target = event.target as HTMLElement;
      // Only navigate if not on an interactive element
      if (target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'checkbox') {
        event.preventDefault();
        router.push(`/speaker-identities/detail?id=${identityId}`);
      }
    }
  };

  const filteredIdentities = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const visible = normalizedQuery.length === 0
      ? identities
      : identities.filter((item) => {
          const haystacks = [
            item.identity.display_name,
            item.identity.normalized_name,
            item.identity.notes ?? '',
          ];
          return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
        });

    const sorted = [...visible];
    sorted.sort((a, b) => {
      if (sortBy === 'name') {
        return a.identity.display_name.localeCompare(b.identity.display_name);
      }
      if (sortBy === 'meetings') {
        return b.meeting_count - a.meeting_count || a.identity.display_name.localeCompare(b.identity.display_name);
      }
      if (sortBy === 'action_items') {
        return b.action_item_count - a.action_item_count || a.identity.display_name.localeCompare(b.identity.display_name);
      }
      return (
        new Date(b.identity.updated_at).getTime() - new Date(a.identity.updated_at).getTime() ||
        a.identity.display_name.localeCompare(b.identity.display_name)
      );
    });

    return sorted;
  }, [identities, searchQuery, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Identities</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button onClick={loadIdentities} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Speaker Identities</h1>
        <p className="text-muted-foreground">
          Manage speaker identities across meetings. Select two identities to merge duplicates.
        </p>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
        <label className="sr-only" htmlFor="speaker-identity-search">
          Search speaker identities
        </label>
        <input
          id="speaker-identity-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search names or notes"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Search speaker identities"
        />
        <label className="sr-only" htmlFor="speaker-identity-sort">
          Sort speaker identities
        </label>
        <select
          id="speaker-identity-sort"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as 'updated' | 'name' | 'meetings' | 'action_items')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Sort speaker identities"
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
          <option value="meetings">Most meetings</option>
          <option value="action_items">Most action items</option>
        </select>
        <div className="flex items-center text-sm text-muted-foreground" aria-label="Visible identity count">
          Showing {filteredIdentities.length} of {identities.length}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-4" role="toolbar" aria-label="Identity management actions">
        <Button
          onClick={handleMergeClick}
          disabled={selectedIds.size !== 2}
          variant={selectedIds.size === 2 ? 'default' : 'secondary'}
          aria-label={`Merge selected identities. ${selectedIds.size} of 2 selected`}
        >
          Merge Selected ({selectedIds.size}/2)
        </Button>
        {selectedIds.size > 0 && (
          <Button
            onClick={() => setSelectedIds(new Set())}
            variant="outline"
            aria-label="Clear selection"
          >
            Clear Selection
          </Button>
        )}
      </div>

      {identities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No speaker identities found</p>
          </CardContent>
        </Card>
      ) : filteredIdentities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">No identities match the current search.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4" role="list" aria-label="Speaker identities">
          {filteredIdentities.map((item) => (
            <Card
              key={item.identity.id}
              className={`${
                selectedIds.has(item.identity.id) ? 'border-primary' : ''
              } cursor-pointer hover:bg-accent transition-colors`}
              onClick={(e) => handleCardClick(item.identity.id, e)}
              onKeyDown={(e) => handleCardKeyDown(item.identity.id, e)}
              tabIndex={0}
              role="listitem"
              aria-label={`${item.identity.display_name}, ${item.meeting_count} meetings, ${item.action_item_count} action items`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <Checkbox
                      checked={selectedIds.has(item.identity.id)}
                      onCheckedChange={(checked) =>
                        handleCheckboxChange(item.identity.id, checked === true)
                      }
                      aria-label={`Select ${item.identity.display_name}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <CardTitle className="text-xl">
                        {item.identity.display_name}
                      </CardTitle>
                      {item.identity.notes && (
                        <CardDescription className="mt-1">
                          {item.identity.notes}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  {item.identity.archived_at && (
                    <Badge variant="secondary" className="ml-2">
                      <Archive className="h-3 w-3 mr-1" aria-hidden="true" />
                      Archived
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium">{item.meeting_count}</span>
                      <span className="text-muted-foreground">
                        {item.meeting_count === 1 ? 'meeting' : 'meetings'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="font-medium">{item.action_item_count}</span>
                      <span className="text-muted-foreground">
                        {item.action_item_count === 1 ? 'action item' : 'action items'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Open details for meetings, action items, and voice profiles</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/speaker-identities/detail?id=${item.identity.id}`);
                      }}
                      aria-label={`Open details for ${item.identity.display_name}`}
                    >
                      Open Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showMergeDialog && mergeSource && mergeTarget && (
        <MergeConfirmationDialog
          source={mergeSource}
          target={mergeTarget}
          onConfirm={handleMergeSuccess}
          onCancel={handleMergeCancel}
        />
      )}
    </div>
  );
}
