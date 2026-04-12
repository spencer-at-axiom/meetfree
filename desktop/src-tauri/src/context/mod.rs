use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::database::models::{
    ActionItemModel, DecisionModel, MeetingContextAssetModel, MeetingModel, MeetingSpeakerModel,
    TagModel, Transcript,
};
use crate::database::repositories::action_item::ActionItemsRepository;
use crate::database::repositories::context_asset::ContextAssetsRepository;
use crate::database::repositories::decision::DecisionsRepository;
use crate::database::repositories::speaker_identity::SpeakerIdentitiesRepository;
use crate::database::repositories::tag::TagsRepository;
use crate::database::repositories::vocabulary::VocabularyRule;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerTurnContextRow {
    pub speaker_number: i32,
    pub speaker_name: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingContextPackage {
    pub meeting_metadata: MeetingModel,
    pub transcript_segments: Vec<Transcript>,
    pub speaker_turns: Vec<SpeakerTurnContextRow>,
    pub identified_speakers: Vec<MeetingSpeakerModel>,
    pub action_items: Vec<ActionItemModel>,
    pub decisions: Vec<DecisionModel>,
    pub scratchpad: Option<String>,
    pub attachments: Vec<MeetingContextAssetModel>,
    pub tags: Vec<TagModel>,
    pub vocabulary_rules: Vec<VocabularyRule>,
}

pub async fn assemble_meeting_context(
    pool: &SqlitePool,
    meeting_id: &str,
) -> Result<MeetingContextPackage, String> {
    let meeting_metadata = sqlx::query_as::<_, MeetingModel>(
        "SELECT id, title, created_at, updated_at, folder_path, source_type, language, duration_seconds, recording_started_at, recording_ended_at, markdown_export_path
         FROM meetings WHERE id = ?",
    )
    .bind(meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to load meeting metadata: {}", e))?
    .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let transcript_segments = sqlx::query_as::<_, Transcript>(
        "SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY COALESCE(audio_start_time, 0) ASC, timestamp ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load transcripts: {}", e))?;

    let speaker_rows = sqlx::query_as::<_, (i32, Option<String>, i64, i64, String, f64)>(
        "SELECT
            st.speaker_number,
            COALESCE(ms.display_name_override, si.display_name, st.speaker_name) AS speaker_name,
            st.start_ms,
            st.end_ms,
            st.text,
            st.confidence
         FROM speaker_turns st
         LEFT JOIN meeting_speakers ms ON ms.id = st.meeting_speaker_id
         LEFT JOIN speaker_identities si ON si.id = ms.speaker_identity_id
         WHERE st.meeting_id = ?
         ORDER BY st.start_ms ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load speaker turns: {}", e))?;

    let speaker_turns = speaker_rows
        .into_iter()
        .map(
            |(speaker_number, speaker_name, start_ms, end_ms, text, confidence)| {
                SpeakerTurnContextRow {
                    speaker_number,
                    speaker_name,
                    start_ms,
                    end_ms,
                    text,
                    confidence,
                }
            },
        )
        .collect();

    let identified_speakers = SpeakerIdentitiesRepository::list_meeting_speakers(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load meeting speakers: {}", e))?;

    let action_items = ActionItemsRepository::list_meeting_action_items(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load action items: {}", e))?;

    let decisions = DecisionsRepository::list_meeting_decisions(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load decisions: {}", e))?;

    let scratchpad = ContextAssetsRepository::get_scratchpad(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load scratchpad: {}", e))?
        .and_then(|a| a.content);

    let all_assets = ContextAssetsRepository::list_assets(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load context assets: {}", e))?;
    let attachments = all_assets
        .into_iter()
        .filter(|a| a.asset_type != "scratchpad")
        .collect();

    let tags = TagsRepository::list_meeting_tags(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load tags: {}", e))?;

    let vocabulary_rules =
        crate::vocabulary::get_effective_rules_for_meeting(pool, Some(meeting_id)).await?;

    Ok(MeetingContextPackage {
        meeting_metadata,
        transcript_segments,
        speaker_turns,
        identified_speakers,
        action_items,
        decisions,
        scratchpad,
        attachments,
        tags,
        vocabulary_rules,
    })
}

pub fn format_context_for_prompt(package: &MeetingContextPackage) -> String {
    let mut sections: Vec<String> = Vec::new();

    if let Some(ref pad) = package.scratchpad {
        let trimmed = pad.trim();
        if !trimmed.is_empty() {
            sections.push(format!("## User Notes\n\n{}", trimmed));
        }
    }

    if !package.tags.is_empty() {
        let names: Vec<&str> = package.tags.iter().map(|t| t.name.as_str()).collect();
        sections.push(format!("## Meeting Tags\n\n{}", names.join(", ")));
    }

    for asset in &package.attachments {
        if let Some(ref content) = asset.content {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                let title = asset.title.as_deref().unwrap_or("Attached Context");
                sections.push(format!("## {}\n\n{}", title, trimmed));
            }
        }
    }

    sections.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_package() -> MeetingContextPackage {
        MeetingContextPackage {
            meeting_metadata: MeetingModel {
                id: "m1".into(),
                title: "Test".into(),
                created_at: crate::database::models::DateTimeUtc(chrono::Utc::now()),
                updated_at: crate::database::models::DateTimeUtc(chrono::Utc::now()),
                folder_path: None,
                source_type: "recorded".into(),
                language: None,
                duration_seconds: None,
                recording_started_at: None,
                recording_ended_at: None,
                markdown_export_path: None,
            },
            transcript_segments: vec![],
            speaker_turns: vec![],
            identified_speakers: vec![],
            action_items: vec![],
            decisions: vec![],
            scratchpad: None,
            attachments: vec![],
            tags: vec![],
            vocabulary_rules: vec![],
        }
    }

    #[test]
    fn test_format_context_empty() {
        let pkg = empty_package();
        assert_eq!(format_context_for_prompt(&pkg), "");
    }

    #[test]
    fn test_format_context_with_scratchpad() {
        let mut pkg = empty_package();
        pkg.scratchpad = Some("Remember to ask about the budget".into());
        let result = format_context_for_prompt(&pkg);
        assert!(result.contains("## User Notes"));
        assert!(result.contains("budget"));
    }

    #[test]
    fn test_format_context_with_tags() {
        let mut pkg = empty_package();
        pkg.tags = vec![
            TagModel {
                id: "t1".into(),
                name: "sprint-planning".into(),
                normalized_name: "sprint-planning".into(),
                color: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            },
            TagModel {
                id: "t2".into(),
                name: "engineering".into(),
                normalized_name: "engineering".into(),
                color: None,
                created_at: chrono::Utc::now().to_rfc3339(),
            },
        ];
        let result = format_context_for_prompt(&pkg);
        assert!(result.contains("## Meeting Tags"));
        assert!(result.contains("sprint-planning, engineering"));
    }

    #[test]
    fn test_format_context_with_attachment() {
        let mut pkg = empty_package();
        pkg.attachments = vec![MeetingContextAssetModel {
            id: "a1".into(),
            meeting_id: "m1".into(),
            asset_type: "attachment".into(),
            title: Some("Agenda".into()),
            content: Some("1. Review OKRs\n2. Sprint retro".into()),
            file_path: None,
            file_mime_type: None,
            file_size_bytes: None,
            metadata: None,
            sort_order: 0,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        }];
        let result = format_context_for_prompt(&pkg);
        assert!(result.contains("## Agenda"));
        assert!(result.contains("Review OKRs"));
    }

    #[test]
    fn test_format_context_combined() {
        let mut pkg = empty_package();
        pkg.scratchpad = Some("Key question: timeline".into());
        pkg.tags = vec![TagModel {
            id: "t1".into(),
            name: "weekly".into(),
            normalized_name: "weekly".into(),
            color: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        }];
        let result = format_context_for_prompt(&pkg);
        assert!(result.contains("## User Notes"));
        assert!(result.contains("## Meeting Tags"));
    }
}
