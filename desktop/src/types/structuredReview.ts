export interface MeetingSpeakerReviewItem {
  id: string;
  meeting_id: string;
  diarization_speaker_number: number | null;
  display_name_override: string | null;
  speaker_identity_id: string | null;
  review_status: string;
  match_confidence: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_reviewed_at: string | null;
  last_generated_at: string | null;
}

export interface SpeakerIdentityReviewItem {
  id: string;
  display_name: string;
  normalized_name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ActionItemReviewItem {
  id: string;
  meeting_id: string;
  title: string;
  details: string | null;
  owner_speaker_identity_id: string | null;
  owner_display_name: string | null;
  due_date: string | null;
  status: string;
  review_status: string;
  source_transcript_id: string | null;
  source_start_ms: number | null;
  source_end_ms: number | null;
  source_excerpt: string | null;
  extraction_method: string;
  extraction_version: string;
  created_at: string;
  updated_at: string;
}

export interface DecisionReviewItem {
  id: string;
  meeting_id: string;
  title: string;
  details: string | null;
  review_status: string;
  source_transcript_id: string | null;
  source_start_ms: number | null;
  source_end_ms: number | null;
  source_excerpt: string | null;
  extraction_method: string;
  extraction_version: string;
  created_at: string;
  updated_at: string;
}

export interface StructuredReviewSnapshot {
  meeting_speakers: MeetingSpeakerReviewItem[];
  action_items: ActionItemReviewItem[];
  decisions: DecisionReviewItem[];
  speaker_identities: SpeakerIdentityReviewItem[];
}
