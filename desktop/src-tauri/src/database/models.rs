use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingModel {
    pub id: String,
    pub title: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub folder_path: Option<String>,
    pub source_type: String,
    pub language: Option<String>,
    pub duration_seconds: Option<f64>,
    pub recording_started_at: Option<String>,
    pub recording_ended_at: Option<String>,
    pub markdown_export_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(transparent)]
pub struct DateTimeUtc(pub DateTime<Utc>);

impl From<NaiveDateTime> for DateTimeUtc {
    fn from(naive: NaiveDateTime) -> Self {
        DateTimeUtc(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
    }
}

// Renamed from TranscriptSegment to Transcript to match the table name
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Transcript {
    pub id: String,
    pub meeting_id: String,
    pub transcript: String,
    pub raw_transcript: Option<String>,
    pub processing_version: String,
    pub timestamp: String,
    // Recording-relative timestamps for audio-transcript synchronization
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
    // Speaker identification: 'mic' for microphone, 'system' for system audio
    pub speaker: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SummaryProcess {
    pub meeting_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub error: Option<String>,
    pub result: Option<String>, // JSON
    pub start_time: Option<chrono::DateTime<chrono::Utc>>,
    pub end_time: Option<chrono::DateTime<chrono::Utc>>,
    pub chunk_count: i64,
    pub processing_time: f64,
    pub metadata: Option<String>,      // JSON
    pub result_backup: Option<String>, // Backup of result before regeneration
    pub result_backup_timestamp: Option<chrono::DateTime<chrono::Utc>>, // When backup was created
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptChunk {
    pub meeting_id: String,
    pub meeting_name: Option<String>,
    pub transcript_text: String,
    pub model: String,
    pub model_name: String,
    pub chunk_size: Option<i64>,
    pub overlap: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Setting {
    pub id: String,
    pub provider: String,
    pub model: String,
    #[sqlx(rename = "whisperModel")]
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[sqlx(rename = "ollamaEndpoint")]
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
    /// Custom OpenAI-compatible endpoint configuration stored as JSON without the API key.
    #[sqlx(rename = "customOpenAIConfig")]
    #[serde(rename = "customOpenAIConfig")]
    pub custom_openai_config: Option<String>,
}

impl Setting {
    /// Parse the custom OpenAI config from JSON string
    pub fn get_custom_openai_config(&self) -> Option<crate::summary::CustomOpenAIConfig> {
        self.custom_openai_config
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
    }
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TranscriptSetting {
    pub id: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct SpeakerIdentityModel {
    pub id: String,
    pub display_name: String,
    pub normalized_name: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct VoiceProfileModel {
    pub id: String,
    pub speaker_identity_id: String,
    pub profile_kind: String,
    pub provider: Option<String>,
    pub model_version: Option<String>,
    pub sample_count: i64,
    pub profile_payload: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_trained_at: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingSpeakerModel {
    pub id: String,
    pub meeting_id: String,
    pub diarization_speaker_number: Option<i64>,
    pub display_name_override: Option<String>,
    pub speaker_identity_id: Option<String>,
    pub review_status: String,
    pub match_confidence: Option<f64>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_reviewed_at: Option<String>,
    pub last_generated_at: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ActionItemModel {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub details: Option<String>,
    pub owner_speaker_identity_id: Option<String>,
    pub owner_display_name: Option<String>,
    pub due_date: Option<String>,
    pub status: String,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct DecisionModel {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub details: Option<String>,
    pub review_status: String,
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
    pub extraction_method: String,
    pub extraction_version: String,
    pub related_action_item_ids: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// v0.5.0: Context layer models

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingContextAssetModel {
    pub id: String,
    pub meeting_id: String,
    pub asset_type: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub file_mime_type: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub metadata: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TagModel {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub color: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MeetingTagModel {
    pub meeting_id: String,
    pub tag_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct EmbeddingModel {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub meeting_id: String,
    pub embedding: Vec<u8>,
    pub model_name: String,
    pub dimensions: i64,
    pub created_at: String,
}
