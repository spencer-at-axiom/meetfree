import { invoke } from '@tauri-apps/api/core';

export interface MeetingContextAsset {
  id: string;
  meeting_id: string;
  asset_type: 'scratchpad' | 'attachment' | 'calendar_event' | 'note';
  title: string | null;
  content: string | null;
  file_path: string | null;
  file_mime_type: string | null;
  file_size_bytes: number | null;
  metadata: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  normalized_name: string;
  color: string | null;
  created_at: string;
}

export interface MeetingContextPackage {
  meeting_metadata: Record<string, unknown>;
  transcript_segments: Record<string, unknown>[];
  speaker_turns: Record<string, unknown>[];
  identified_speakers: Record<string, unknown>[];
  action_items: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  scratchpad: string | null;
  attachments: MeetingContextAsset[];
  tags: Tag[];
  vocabulary_rules: Record<string, unknown>[];
}

export async function contextAssetCreate(args: {
  meetingId: string;
  assetType: string;
  title?: string;
  content?: string;
  filePath?: string;
  fileMimeType?: string;
  fileSizeBytes?: number;
}): Promise<MeetingContextAsset> {
  return invoke<MeetingContextAsset>('context_asset_create', {
    meeting_id: args.meetingId,
    asset_type: args.assetType,
    title: args.title,
    content: args.content,
    file_path: args.filePath,
    file_mime_type: args.fileMimeType,
    file_size_bytes: args.fileSizeBytes,
  });
}

export async function contextAssetList(args: { meetingId: string }): Promise<MeetingContextAsset[]> {
  return invoke<MeetingContextAsset[]>('context_asset_list', {
    meeting_id: args.meetingId,
  });
}

export async function contextAssetUpdate(args: {
  assetId: string;
  title?: string;
  content?: string;
}): Promise<boolean> {
  return invoke<boolean>('context_asset_update', {
    asset_id: args.assetId,
    title: args.title,
    content: args.content,
  });
}

export async function contextAssetDelete(args: { assetId: string }): Promise<boolean> {
  return invoke<boolean>('context_asset_delete', {
    asset_id: args.assetId,
  });
}

export async function scratchpadGet(args: { meetingId: string }): Promise<MeetingContextAsset | null> {
  return invoke<MeetingContextAsset | null>('scratchpad_get', {
    meeting_id: args.meetingId,
  });
}

export async function scratchpadUpsert(args: {
  meetingId: string;
  content: string;
}): Promise<MeetingContextAsset> {
  return invoke<MeetingContextAsset>('scratchpad_upsert', {
    meeting_id: args.meetingId,
    content: args.content,
  });
}

export async function tagCreate(args: { name: string; color?: string }): Promise<Tag> {
  return invoke<Tag>('tag_create', {
    name: args.name,
    color: args.color,
  });
}

export async function tagList(): Promise<Tag[]> {
  return invoke<Tag[]>('tag_list');
}

export async function tagDelete(args: { tagId: string }): Promise<boolean> {
  return invoke<boolean>('tag_delete', {
    tag_id: args.tagId,
  });
}

export async function meetingTagAdd(args: { meetingId: string; tagId: string }): Promise<void> {
  return invoke<void>('meeting_tag_add', {
    meeting_id: args.meetingId,
    tag_id: args.tagId,
  });
}

export async function meetingTagRemove(args: { meetingId: string; tagId: string }): Promise<void> {
  return invoke<void>('meeting_tag_remove', {
    meeting_id: args.meetingId,
    tag_id: args.tagId,
  });
}

export async function meetingTagsList(args: { meetingId: string }): Promise<Tag[]> {
  return invoke<Tag[]>('meeting_tags_list', {
    meeting_id: args.meetingId,
  });
}

export async function meetingContextGet(args: { meetingId: string }): Promise<MeetingContextPackage> {
  return invoke<MeetingContextPackage>('meeting_context_get', {
    meeting_id: args.meetingId,
  });
}

export async function getScratchpadContent(meetingId: string): Promise<string | null> {
  const asset = await scratchpadGet({ meetingId });
  return asset?.content ?? null;
}

export async function getTagNames(meetingId: string): Promise<string[]> {
  const tags = await meetingTagsList({ meetingId });
  return tags.map((t) => t.name);
}
