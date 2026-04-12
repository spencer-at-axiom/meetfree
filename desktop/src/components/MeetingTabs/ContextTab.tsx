'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, NotebookPen, Paperclip, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useContextAssets } from '@/hooks/useContextAssets';
import { useScratchpad } from '@/hooks/useScratchpad';
import { useMeetingTags, useTags } from '@/hooks/useTags';
import { selectContextAttachment } from '@/services/contextService';

type DraftAssetType = 'note' | 'attachment';

export function ContextTab({ meetingId }: { meetingId: string }) {
  const { content, setContent, isLoading: isScratchpadLoading, isSaving, error: scratchpadError } =
    useScratchpad(meetingId);
  const {
    assets,
    createAsset,
    updateAsset,
    deleteAsset,
    isLoading: isAssetsLoading,
  } = useContextAssets(meetingId);
  const { tags: allTags, createTag, isLoading: isTagsLoading } = useTags();
  const {
    tags: meetingTags,
    addTag,
    removeTag,
    isLoading: isMeetingTagsLoading,
  } = useMeetingTags(meetingId);

  const [newAssetType, setNewAssetType] = useState<DraftAssetType>('note');
  const [newAssetTitle, setNewAssetTitle] = useState('');
  const [newAssetContent, setNewAssetContent] = useState('');
  const [newAssetPath, setNewAssetPath] = useState('');
  const [newAssetMimeType, setNewAssetMimeType] = useState<string | undefined>();
  const [newAssetSizeBytes, setNewAssetSizeBytes] = useState<number | undefined>();
  const [attachmentPreviewWasTruncated, setAttachmentPreviewWasTruncated] = useState(false);
  const [isCreatingAsset, setIsCreatingAsset] = useState(false);
  const [isSelectingAttachment, setIsSelectingAttachment] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { title: string; content: string }>>({});
  const [savingAssetId, setSavingAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [isCreatingTag, setIsCreatingTag] = useState(false);

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, { title: string; content: string }> = {};
      for (const asset of assets) {
        next[asset.id] = current[asset.id] ?? {
          title: asset.title ?? '',
          content: asset.content ?? '',
        };
      }
      return next;
    });
  }, [assets]);

  const availableTags = useMemo(() => {
    const currentIds = new Set(meetingTags.map((tag) => tag.id));
    return allTags.filter((tag) => !currentIds.has(tag.id));
  }, [allTags, meetingTags]);

  useEffect(() => {
    if (!availableTags.some((tag) => tag.id === selectedTagId)) {
      setSelectedTagId(availableTags[0]?.id ?? '');
    }
  }, [availableTags, selectedTagId]);

  const isBusy =
    isScratchpadLoading || isAssetsLoading || isTagsLoading || isMeetingTagsLoading;

  const handleCreateAsset = async () => {
    if (!newAssetTitle.trim() && !newAssetContent.trim() && !newAssetPath.trim()) {
      toast.error('Add a title, content, or file path before creating a context item.');
      return;
    }

    setIsCreatingAsset(true);
    try {
      await createAsset(newAssetType, {
        title: newAssetTitle.trim() || undefined,
        content: newAssetContent.trim() || undefined,
        filePath: newAssetPath.trim() || undefined,
        fileMimeType: newAssetMimeType,
        fileSizeBytes: newAssetSizeBytes,
      });
      setNewAssetTitle('');
      setNewAssetContent('');
      setNewAssetPath('');
      setNewAssetMimeType(undefined);
      setNewAssetSizeBytes(undefined);
      setAttachmentPreviewWasTruncated(false);
      toast.success('Context item added');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add context item');
    } finally {
      setIsCreatingAsset(false);
    }
  };

  const handleSaveAsset = async (assetId: string) => {
    const draft = drafts[assetId];
    const asset = assets.find((item) => item.id === assetId);
    if (!draft || !asset) {
      return;
    }

    setSavingAssetId(assetId);
    try {
      await updateAsset(assetId, {
        title: draft.title.trim(),
        content: draft.content.trim(),
      });
      toast.success('Context item updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update context item');
    } finally {
      setSavingAssetId(null);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    setDeletingAssetId(assetId);
    try {
      await deleteAsset(assetId);
      toast.success('Context item removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove context item');
    } finally {
      setDeletingAssetId(null);
    }
  };

  const handleAddExistingTag = async () => {
    if (!selectedTagId) {
      return;
    }

    try {
      await addTag(selectedTagId);
      toast.success('Tag added to meeting');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add tag');
    }
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      return;
    }

    setIsCreatingTag(true);
    try {
      const created = await createTag(name);
      await addTag(created.id);
      setNewTagName('');
      toast.success('Tag created and added to meeting');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    } finally {
      setIsCreatingTag(false);
    }
  };

  const handleSelectAttachment = async () => {
    setIsSelectingAttachment(true);
    try {
      const selection = await selectContextAttachment();
      if (!selection) {
        return;
      }

      setNewAssetType('attachment');
      setNewAssetTitle(selection.title);
      setNewAssetPath(selection.path);
      setNewAssetMimeType(selection.file_mime_type ?? undefined);
      setNewAssetSizeBytes(selection.file_size_bytes);
      setAttachmentPreviewWasTruncated(selection.content_was_truncated);

      if (selection.content) {
        setNewAssetContent(selection.content);
        toast.success('Attachment loaded into context draft');
      } else {
        toast.success('Attachment selected');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to select attachment');
    } finally {
      setIsSelectingAttachment(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50/60 p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <NotebookPen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Scratchpad</h2>
              <p className="text-sm text-slate-500">
                Notes here flow into the meeting context package used by summaries and retrieval.
              </p>
            </div>
          </div>

          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Capture reminders, agenda items, follow-ups, or context you want the recap to use."
            className="min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-300 focus:bg-white"
          />

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              {isScratchpadLoading
                ? 'Loading scratchpad...'
                : isSaving
                  ? 'Saving changes...'
                  : 'Changes save automatically.'}
            </span>
            {scratchpadError ? <span className="text-red-600">{scratchpadError}</span> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Tags className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Tags</h2>
              <p className="text-sm text-slate-500">
                Use tags to organize meetings and narrow transcript search.
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {meetingTags.length === 0 ? (
              <span className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-500">
                No tags assigned yet
              </span>
            ) : (
              meetingTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    void removeTag(tag.id).then(() => toast.success('Tag removed from meeting')).catch((error) => {
                      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  <span>{tag.name}</span>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ))
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <select
              value={selectedTagId}
              onChange={(event) => setSelectedTagId(event.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
              disabled={availableTags.length === 0}
            >
              {availableTags.length === 0 ? (
                <option value="">No unassigned tags available</option>
              ) : (
                availableTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))
              )}
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleAddExistingTag()}
              disabled={!selectedTagId}
              className="h-10 rounded-xl"
            >
              Add Existing Tag
            </Button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              type="text"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              placeholder="Create a new tag"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
            />
            <Button
              type="button"
              onClick={() => void handleCreateTag()}
              disabled={isCreatingTag || !newTagName.trim()}
              className="h-10 rounded-xl"
            >
              {isCreatingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Tag
            </Button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
              <Paperclip className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Context Items</h2>
              <p className="text-sm text-slate-500">
                Add notes or attachment metadata that should travel with this meeting.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
              <select
                value={newAssetType}
                onChange={(event) => setNewAssetType(event.target.value as DraftAssetType)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
              >
                <option value="note">Note</option>
                <option value="attachment">Attachment</option>
              </select>
              <input
                type="text"
                value={newAssetTitle}
                onChange={(event) => setNewAssetTitle(event.target.value)}
                placeholder="Title"
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
              />
            </div>

            <textarea
              value={newAssetContent}
              onChange={(event) => setNewAssetContent(event.target.value)}
              placeholder="Content or pasted reference text"
              className="min-h-[120px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-300"
            />

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
              <input
                type="text"
                value={newAssetPath}
                onChange={(event) => {
                  setNewAssetPath(event.target.value);
                  if (!event.target.value.trim()) {
                    setNewAssetMimeType(undefined);
                    setNewAssetSizeBytes(undefined);
                    setAttachmentPreviewWasTruncated(false);
                  }
                }}
                placeholder="Optional file path"
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSelectAttachment()}
                disabled={isSelectingAttachment}
                className="h-10 rounded-xl"
              >
                {isSelectingAttachment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
                Choose File
              </Button>
              <Button
                type="button"
                onClick={() => void handleCreateAsset()}
                disabled={isCreatingAsset}
                className="h-10 rounded-xl"
              >
                {isCreatingAsset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Context Item
              </Button>
            </div>
            {newAssetType === 'attachment' ? (
              <div className="space-y-1 text-xs text-slate-500">
                <p>
                  Text-based files load a preview into this draft automatically. PDFs and other binary files are attached as metadata only in v0.5.0.
                </p>
                {newAssetSizeBytes ? (
                  <p>
                    Selected file size: {Math.round(newAssetSizeBytes / 1024)} KB
                    {newAssetMimeType ? ` • ${newAssetMimeType}` : ''}
                  </p>
                ) : null}
                {attachmentPreviewWasTruncated ? (
                  <p className="text-amber-700">
                    The attachment preview was truncated before saving.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {assets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No context items yet.
              </div>
            ) : (
              assets.map((asset) => {
                const draft = drafts[asset.id] ?? {
                  title: asset.title ?? '',
                  content: asset.content ?? '',
                };
                const isAssetSaving = savingAssetId === asset.id;
                const isAssetDeleting = deletingAssetId === asset.id;
                const hasChanges =
                  draft.title !== (asset.title ?? '') || draft.content !== (asset.content ?? '');

                return (
                  <div
                    key={asset.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                        {asset.asset_type.replace('_', ' ')}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteAsset(asset.id)}
                        disabled={isAssetDeleting}
                        className="h-8 rounded-full px-3 text-slate-500 hover:text-red-600"
                      >
                        {isAssetDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>

                    <div className="grid gap-3">
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [asset.id]: {
                              ...draft,
                              title: event.target.value,
                            },
                          }))
                        }
                        placeholder="Title"
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-300"
                      />
                      <textarea
                        value={draft.content}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [asset.id]: {
                              ...draft,
                              content: event.target.value,
                            },
                          }))
                        }
                        placeholder="Content"
                        className="min-h-[110px] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-300"
                      />
                      {asset.file_path ? (
                        <p className="text-xs text-slate-500">Path: {asset.file_path}</p>
                      ) : null}
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleSaveAsset(asset.id)}
                          disabled={!hasChanges || isAssetSaving}
                          className="h-9 rounded-xl"
                        >
                          {isAssetSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Save Changes
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {isBusy ? (
          <div className="text-center text-xs text-slate-500">Refreshing meeting context...</div>
        ) : null}
      </div>
    </div>
  );
}
