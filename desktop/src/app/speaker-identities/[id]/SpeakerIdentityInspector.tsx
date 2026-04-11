'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft, Users, FileText, Calendar, Edit2, Save, X, Mic } from 'lucide-react';

interface SpeakerIdentity {
  id: string;
  display_name: string;
  normalized_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface IdentityMeetingAppearance {
  meeting_id: string;
  meeting_title: string;
  meeting_date: string;
  speaker_display_name: string | null;
  meeting_speaker_id: string;
}

interface IdentityActionItem {
  id: string;
  meeting_id: string;
  title: string;
  details: string | null;
  owner_display_name: string | null;
  due_date: string | null;
  status: string;
  review_status: string;
  created_at: string;
  meeting_title: string;
  meeting_date: string;
}

interface VoiceProfile {
  id: string;
  speaker_identity_id: string;
  profile_kind: string;
  provider: string | null;
  model_version: string | null;
  sample_count: number;
  profile_payload: string | null;
  created_at: string;
  updated_at: string;
  last_trained_at: string | null;
}

interface IdentityInspectionDetail {
  identity: SpeakerIdentity;
  meetings: IdentityMeetingAppearance[];
  action_items: IdentityActionItem[];
  voice_profiles: VoiceProfile[];
  meeting_count: number;
  action_item_count: number;
}

interface VoiceProfileDraft {
  profile_kind: string;
  provider: string;
  model_version: string;
  sample_count: string;
  profile_payload: string;
}

function createVoiceProfileDraft(profile?: VoiceProfile): VoiceProfileDraft {
  return {
    profile_kind: profile?.profile_kind ?? 'manual',
    provider: profile?.provider ?? '',
    model_version: profile?.model_version ?? '',
    sample_count: String(profile?.sample_count ?? 0),
    profile_payload: profile?.profile_payload ?? '',
  };
}

export function SpeakerIdentityInspector() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const identityId = searchParams.get('id') ?? '';

  const [detail, setDetail] = useState<IdentityInspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAllActionItems, setShowAllActionItems] = useState(false);
  const [voiceProfileDrafts, setVoiceProfileDrafts] = useState<Record<string, VoiceProfileDraft>>({});
  const [newVoiceProfileDraft, setNewVoiceProfileDraft] = useState<VoiceProfileDraft | null>(null);
  const [voiceProfileBusyId, setVoiceProfileBusyId] = useState<string | 'new' | null>(null);

  useEffect(() => {
    if (!identityId) {
      setLoading(false);
      setError('Identity id is missing');
      return;
    }
    loadIdentityDetail();
  }, [identityId]);

  async function loadIdentityDetail() {
    try {
      setLoading(true);
      setError(null);
      const data = await invoke<IdentityInspectionDetail>('speaker_identity_inspect', {
        identityId,
      });
      setDetail(data);
      setEditedName(data.identity.display_name);
      setEditedNotes(data.identity.notes || '');
      setVoiceProfileDrafts(
        data.voice_profiles.reduce<Record<string, VoiceProfileDraft>>((acc, profile) => {
          acc[profile.id] = createVoiceProfileDraft(profile);
          return acc;
        }, {}),
      );
      setNewVoiceProfileDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!detail) return;

    try {
      setSaving(true);
      const trimmedName = editedName.trim();
      const normalizedCurrentNotes = detail.identity.notes || '';
      const trimmedNotes = editedNotes.trim();

      const updatePayload: {
        identityId: string;
        displayName?: string;
        notes?: string | null;
      } = {
        identityId,
      };

      if (trimmedName !== detail.identity.display_name) {
        updatePayload.displayName = trimmedName;
      }

      if (trimmedNotes !== normalizedCurrentNotes) {
        updatePayload.notes = trimmedNotes.length > 0 ? trimmedNotes : null;
      }

      await invoke('speaker_identity_update', {
        ...updatePayload,
      });
      setIsEditing(false);
      await loadIdentityDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (detail) {
      setEditedName(detail.identity.display_name);
      setEditedNotes(detail.identity.notes || '');
    }
    setIsEditing(false);
  }

  function updateVoiceProfileDraft(id: string, patch: Partial<VoiceProfileDraft>) {
    setVoiceProfileDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }

  function updateNewVoiceProfileDraft(patch: Partial<VoiceProfileDraft>) {
    setNewVoiceProfileDraft((prev) => ({ ...(prev ?? createVoiceProfileDraft()), ...patch }));
  }

  function parseVoiceProfileDraft(draft: VoiceProfileDraft) {
    const sampleCount = Number.parseInt(draft.sample_count, 10);
    if (!Number.isFinite(sampleCount) || sampleCount < 0) {
      throw new Error('Sample count must be 0 or greater');
    }

    return {
      profile_kind: draft.profile_kind,
      provider: draft.provider.trim() || null,
      model_version: draft.model_version.trim() || null,
      sample_count: sampleCount,
      profile_payload: draft.profile_payload.trim() || null,
    };
  }

  async function handleAddVoiceProfile() {
    if (!newVoiceProfileDraft) return;

    try {
      setVoiceProfileBusyId('new');
      await invoke('speaker_identity_add_voice_profile', {
        identityId,
        profile: parseVoiceProfileDraft(newVoiceProfileDraft),
      });
      await loadIdentityDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceProfileBusyId(null);
    }
  }

  async function handleSaveVoiceProfile(profileId: string) {
    const draft = voiceProfileDrafts[profileId];
    if (!draft) return;

    try {
      setVoiceProfileBusyId(profileId);
      await invoke('speaker_identity_update_voice_profile', {
        voiceProfileId: profileId,
        profile: parseVoiceProfileDraft(draft),
      });
      await loadIdentityDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceProfileBusyId(null);
    }
  }

  async function handleDeleteVoiceProfile(profileId: string) {
    try {
      setVoiceProfileBusyId(profileId);
      await invoke('speaker_identity_delete_voice_profile', {
        voiceProfileId: profileId,
      });
      await loadIdentityDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceProfileBusyId(null);
    }
  }

  function handleMeetingClick(meetingId: string, meetingSpeakerId: string) {
    router.push(`/meeting-details?id=${meetingId}&highlightSpeaker=${meetingSpeakerId}`);
  }

  function handleMeetingKeyDown(meetingId: string, meetingSpeakerId: string, event: React.KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      router.push(`/meeting-details?id=${meetingId}&highlightSpeaker=${meetingSpeakerId}`);
    }
  }

  function formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  }

  function groupActionItemsByMeeting(items: IdentityActionItem[]): Map<string, IdentityActionItem[]> {
    const grouped = new Map<string, IdentityActionItem[]>();
    for (const item of items) {
      const existing = grouped.get(item.meeting_id) || [];
      existing.push(item);
      grouped.set(item.meeting_id, existing);
    }
    return grouped;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error Loading Identity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error || 'Identity not found'}</p>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => router.push('/speaker-identities')} variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Identities
              </Button>
              <Button onClick={loadIdentityDetail}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groupedActionItems = groupActionItemsByMeeting(detail.action_items);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <Button 
          onClick={() => router.push('/speaker-identities')} 
          variant="ghost" 
          className="mb-4"
          aria-label="Back to speaker identities list"
        >
          <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
          Back to Identities
        </Button>
      </div>

      {/* Identity Details Card */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="display-name">Display Name</Label>
                    <Input
                      id="display-name"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="mt-1"
                      aria-required="true"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={editedNotes}
                      onChange={(e) => setEditedNotes(e.target.value)}
                      className="mt-1"
                      rows={3}
                      aria-describedby="notes-description"
                    />
                    <p id="notes-description" className="sr-only">Optional notes about this speaker identity</p>
                  </div>
                </div>
              ) : (
                <>
                  <CardTitle className="text-2xl">{detail.identity.display_name}</CardTitle>
                  {detail.identity.notes && (
                    <CardDescription className="mt-2">{detail.identity.notes}</CardDescription>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button onClick={handleSave} disabled={saving} size="sm" aria-label="Save changes">
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button onClick={handleCancel} variant="outline" size="sm" disabled={saving} aria-label="Cancel editing">
                    <X className="h-4 w-4 mr-2" aria-hidden="true" />
                    Cancel
                  </Button>
                </>
              ) : (
                <Button onClick={() => setIsEditing(true)} variant="outline" size="sm" aria-label="Edit identity details">
                  <Edit2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Created:</span>{' '}
              <span>{formatDate(detail.identity.created_at)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Updated:</span>{' '}
              <span>{formatDate(detail.identity.updated_at)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6" role="region" aria-label="Identity statistics">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold" aria-label={`${detail.meeting_count} meetings`}>{detail.meeting_count}</div>
                <div className="text-sm text-muted-foreground">
                  {detail.meeting_count === 1 ? 'Meeting' : 'Meetings'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold" aria-label={`${detail.action_item_count} action items`}>{detail.action_item_count}</div>
                <div className="text-sm text-muted-foreground">
                  {detail.action_item_count === 1 ? 'Action Item' : 'Action Items'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Mic className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <div className="text-2xl font-bold" aria-label={`${detail.voice_profiles.length} voice profiles`}>{detail.voice_profiles.length}</div>
                <div className="text-sm text-muted-foreground">
                  {detail.voice_profiles.length === 1 ? 'Voice Profile' : 'Voice Profiles'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Meetings List */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Meetings</CardTitle>
          <CardDescription>
            All meetings where this identity appears ({detail.meetings.length})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No meetings found for this identity
            </p>
          ) : (
            <div className="space-y-2" role="list" aria-label="Meetings list">
              {detail.meetings.map((meeting) => (
                <div
                  key={meeting.meeting_speaker_id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => handleMeetingClick(meeting.meeting_id, meeting.meeting_speaker_id)}
                  onKeyDown={(e) => handleMeetingKeyDown(meeting.meeting_id, meeting.meeting_speaker_id, e)}
                  tabIndex={0}
                  role="listitem"
                  aria-label={`${meeting.meeting_title}, ${formatDate(meeting.meeting_date)}${meeting.speaker_display_name ? `, speaker name: ${meeting.speaker_display_name}` : ''}`}
                >
                  <div className="flex-1">
                    <div className="font-medium">{meeting.meeting_title}</div>
                    {meeting.speaker_display_name && (
                      <div className="text-sm text-muted-foreground">
                        Speaker name: {meeting.speaker_display_name}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" aria-hidden="true" />
                    {formatDate(meeting.meeting_date)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Items */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Action Items</CardTitle>
              <CardDescription>
                Action items owned by this identity ({detail.action_item_count})
              </CardDescription>
            </div>
            {detail.action_item_count > 0 && (
              <Button
                onClick={() => setShowAllActionItems(!showAllActionItems)}
                variant="outline"
                size="sm"
                aria-label={showAllActionItems ? 'Hide action items' : 'Show all action items'}
                aria-expanded={showAllActionItems}
              >
                {showAllActionItems ? 'Hide' : 'Show All'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {detail.action_item_count === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No action items owned by this identity
            </p>
          ) : showAllActionItems ? (
            <div className="space-y-6" role="region" aria-label="Action items grouped by meeting">
              {Array.from(groupedActionItems.entries()).map(([meetingId, items]) => {
                const firstItem = items[0];
                return (
                  <div key={meetingId} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {firstItem.meeting_title} - {formatDate(firstItem.meeting_date)}
                    </div>
                    <div className="space-y-2 pl-6" role="list" aria-label={`Action items from ${firstItem.meeting_title}`}>
                      {items.map((item) => (
                        <div key={item.id} className="p-3 rounded-lg border" role="listitem">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <div className="font-medium">{item.title}</div>
                              {item.details && (
                                <div className="text-sm text-muted-foreground mt-1">
                                  {item.details}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Badge
                                variant={
                                  item.status === 'completed'
                                    ? 'default'
                                    : item.status === 'dismissed'
                                    ? 'secondary'
                                    : 'outline'
                                }
                                aria-label={`Status: ${item.status}`}
                              >
                                {item.status}
                              </Badge>
                              <Badge
                                variant={
                                  item.review_status === 'accepted'
                                    ? 'default'
                                    : item.review_status === 'edited'
                                    ? 'secondary'
                                    : 'outline'
                                }
                                aria-label={`Review status: ${item.review_status}`}
                              >
                                {item.review_status}
                              </Badge>
                            </div>
                          </div>
                          {item.due_date && (
                            <div className="text-sm text-muted-foreground mt-2">
                              Due: {formatDate(item.due_date)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              Click "Show All" to view action items grouped by meeting
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Voice Profiles</CardTitle>
              <CardDescription>
                Manual and reusable profile records for future speaker matching ({detail.voice_profiles.length})
              </CardDescription>
            </div>
            {!newVoiceProfileDraft && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNewVoiceProfileDraft(createVoiceProfileDraft())}
                aria-label="Add voice profile"
              >
                Add Voice Profile
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {newVoiceProfileDraft && (
            <div className="rounded-lg border border-dashed p-4" role="form" aria-label="New voice profile">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="new-voice-profile-kind">Profile Type</Label>
                  <select
                    id="new-voice-profile-kind"
                    value={newVoiceProfileDraft.profile_kind}
                    onChange={(event) => updateNewVoiceProfileDraft({ profile_kind: event.target.value })}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="manual">Manual</option>
                    <option value="embedding_v1">Embedding v1</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="new-voice-profile-sample-count">Sample Count</Label>
                  <Input
                    id="new-voice-profile-sample-count"
                    type="number"
                    min="0"
                    value={newVoiceProfileDraft.sample_count}
                    onChange={(event) => updateNewVoiceProfileDraft({ sample_count: event.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="new-voice-profile-provider">Provider</Label>
                  <Input
                    id="new-voice-profile-provider"
                    value={newVoiceProfileDraft.provider}
                    onChange={(event) => updateNewVoiceProfileDraft({ provider: event.target.value })}
                    className="mt-1"
                    placeholder="Optional provider"
                  />
                </div>
                <div>
                  <Label htmlFor="new-voice-profile-model-version">Model Version</Label>
                  <Input
                    id="new-voice-profile-model-version"
                    value={newVoiceProfileDraft.model_version}
                    onChange={(event) => updateNewVoiceProfileDraft({ model_version: event.target.value })}
                    className="mt-1"
                    placeholder="Optional model version"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="new-voice-profile-payload">Payload or Notes</Label>
                  <Textarea
                    id="new-voice-profile-payload"
                    value={newVoiceProfileDraft.profile_payload}
                    onChange={(event) => updateNewVoiceProfileDraft({ profile_payload: event.target.value })}
                    className="mt-1"
                    rows={4}
                    placeholder="Manual notes or serialized profile payload"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setNewVoiceProfileDraft(null)}
                  disabled={voiceProfileBusyId === 'new'}
                  aria-label="Cancel new voice profile"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddVoiceProfile}
                  disabled={voiceProfileBusyId === 'new'}
                  aria-label="Save new voice profile"
                >
                  {voiceProfileBusyId === 'new' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    'Save Voice Profile'
                  )}
                </Button>
              </div>
            </div>
          )}

          {detail.voice_profiles.length === 0 && !newVoiceProfileDraft ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No voice profiles yet. Add one to start building reusable speaker-matching data.
            </p>
          ) : (
            <div className="space-y-3" role="list" aria-label="Voice profiles">
              {detail.voice_profiles.map((profile) => {
                const draft = voiceProfileDrafts[profile.id];
                const isBusy = voiceProfileBusyId === profile.id;

                return (
                  <div
                    key={profile.id}
                    className="rounded-lg border p-4"
                    role="listitem"
                    aria-label={`Voice profile ${profile.profile_kind} ${profile.id}`}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label htmlFor={`voice-profile-kind-${profile.id}`}>Profile Type</Label>
                        <select
                          id={`voice-profile-kind-${profile.id}`}
                          value={draft?.profile_kind ?? 'manual'}
                          onChange={(event) =>
                            updateVoiceProfileDraft(profile.id, { profile_kind: event.target.value })
                          }
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="manual">Manual</option>
                          <option value="embedding_v1">Embedding v1</option>
                        </select>
                      </div>
                      <div>
                        <Label htmlFor={`voice-profile-sample-count-${profile.id}`}>Sample Count</Label>
                        <Input
                          id={`voice-profile-sample-count-${profile.id}`}
                          type="number"
                          min="0"
                          value={draft?.sample_count ?? '0'}
                          onChange={(event) =>
                            updateVoiceProfileDraft(profile.id, { sample_count: event.target.value })
                          }
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`voice-profile-provider-${profile.id}`}>Provider</Label>
                        <Input
                          id={`voice-profile-provider-${profile.id}`}
                          value={draft?.provider ?? ''}
                          onChange={(event) =>
                            updateVoiceProfileDraft(profile.id, { provider: event.target.value })
                          }
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`voice-profile-model-version-${profile.id}`}>Model Version</Label>
                        <Input
                          id={`voice-profile-model-version-${profile.id}`}
                          value={draft?.model_version ?? ''}
                          onChange={(event) =>
                            updateVoiceProfileDraft(profile.id, { model_version: event.target.value })
                          }
                          className="mt-1"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <Label htmlFor={`voice-profile-payload-${profile.id}`}>Payload or Notes</Label>
                        <Textarea
                          id={`voice-profile-payload-${profile.id}`}
                          value={draft?.profile_payload ?? ''}
                          onChange={(event) =>
                            updateVoiceProfileDraft(profile.id, { profile_payload: event.target.value })
                          }
                          className="mt-1"
                          rows={3}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        Created {formatDate(profile.created_at)}. Last trained{' '}
                        {profile.last_trained_at ? formatDate(profile.last_trained_at) : 'never'}.
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleDeleteVoiceProfile(profile.id)}
                          disabled={isBusy}
                          aria-label={`Delete voice profile ${profile.id}`}
                        >
                          Delete
                        </Button>
                        <Button
                          onClick={() => handleSaveVoiceProfile(profile.id)}
                          disabled={isBusy}
                          aria-label={`Save voice profile ${profile.id}`}
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            'Save'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
