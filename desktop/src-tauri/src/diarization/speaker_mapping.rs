// Speaker mapping - aligns speaker segments to transcript segments
// Maps diarization results to specific words/phrases in the transcript

use super::{SpeakerSegment, SpeakerTurn, TranscriptSegment};

/// Map speaker segments to transcript segments
pub fn map_speakers_to_transcripts(
    speaker_segments: &[SpeakerSegment],
    transcript_rows: &[TranscriptSegment],
) -> Vec<SpeakerTurn> {
    if speaker_segments.is_empty() || transcript_rows.is_empty() {
        return Vec::new();
    }

    let mut speaker_turns = Vec::new();

    for speaker_seg in speaker_segments {
        // Find all transcript rows that overlap with this speaker segment
        let overlapping_transcripts: Vec<_> = transcript_rows
            .iter()
            .filter(|t| segments_overlap(speaker_seg, t))
            .collect();

        if overlapping_transcripts.is_empty() {
            continue;
        }

        // Group overlapping transcripts into continuous chunks
        let chunks = group_consecutive_transcripts(overlapping_transcripts);

        for chunk in chunks {
            // Find min start and max end of chunk
            let start_ms = chunk
                .iter()
                .map(|t| t.start_ms)
                .min()
                .unwrap_or(speaker_seg.start_ms);
            let end_ms = chunk
                .iter()
                .map(|t| t.end_ms)
                .max()
                .unwrap_or(speaker_seg.end_ms);

            // Combine text from all segments in chunk
            let combined_text = chunk.iter().map(|t| t.text.as_str()).collect::<Vec<_>>().join(" ");

            // Calculate confidence based on overlap percentage
            let confidence = calculate_overlap_confidence(speaker_seg, start_ms, end_ms);

            speaker_turns.push(SpeakerTurn {
                speaker_number: speaker_seg.speaker_id,
                start_ms,
                end_ms,
                text: combined_text,
                confidence,
            });
        }
    }

    // Sort by start time
    speaker_turns.sort_by_key(|t| t.start_ms);

    speaker_turns
}

/// Check if two time segments overlap
fn segments_overlap(speaker_seg: &SpeakerSegment, transcript: &TranscriptSegment) -> bool {
    speaker_seg.start_ms < transcript.end_ms && speaker_seg.end_ms > transcript.start_ms
}

/// Group consecutive transcripts without large gaps
fn group_consecutive_transcripts(transcripts: Vec<&TranscriptSegment>) -> Vec<Vec<&TranscriptSegment>> {
    if transcripts.is_empty() {
        return Vec::new();
    }

    let mut groups: Vec<Vec<&TranscriptSegment>> = Vec::new();
    let mut current_group = vec![transcripts[0]];

    for i in 1..transcripts.len() {
        let prev = transcripts[i - 1];
        let curr = transcripts[i];

        // If gap between transcripts is less than 500ms, keep them together
        if curr.start_ms - prev.end_ms < 500 {
            current_group.push(curr);
        } else {
            groups.push(current_group);
            current_group = vec![curr];
        }
    }

    if !current_group.is_empty() {
        groups.push(current_group);
    }

    groups
}

/// Calculate confidence based on overlap percentage
fn calculate_overlap_confidence(
    speaker_seg: &SpeakerSegment,
    start_ms: i64,
    end_ms: i64,
) -> f64 {
    let speaker_duration = (speaker_seg.end_ms - speaker_seg.start_ms).max(1);
    let overlap_start = start_ms.max(speaker_seg.start_ms);
    let overlap_end = end_ms.min(speaker_seg.end_ms);
    let overlap_duration = (overlap_end - overlap_start).max(0);

    let confidence = overlap_duration as f64 / speaker_duration as f64;
    confidence.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_overlap_basic() {
        let speaker = SpeakerSegment {
            start_ms: 0,
            end_ms: 5000,
            speaker_id: 0,
        };

        let overlap = TranscriptSegment {
            id: "1".to_string(),
            text: "test".to_string(),
            start_ms: 2000,
            end_ms: 3000,
        };

        let no_overlap = TranscriptSegment {
            id: "2".to_string(),
            text: "test".to_string(),
            start_ms: 6000,
            end_ms: 7000,
        };

        assert!(segments_overlap(&speaker, &overlap));
        assert!(!segments_overlap(&speaker, &no_overlap));
    }

    #[test]
    fn calculate_overlap_confidence_full() {
        let speaker = SpeakerSegment {
            start_ms: 0,
            end_ms: 1000,
            speaker_id: 0,
        };

        let conf = calculate_overlap_confidence(&speaker, 0, 1000);
        assert_eq!(conf, 1.0);
    }

    #[test]
    fn calculate_overlap_confidence_partial() {
        let speaker = SpeakerSegment {
            start_ms: 0,
            end_ms: 1000,
            speaker_id: 0,
        };

        let conf = calculate_overlap_confidence(&speaker, 500, 1000);
        assert_eq!(conf, 0.5);
    }

    #[test]
    fn group_consecutive_transcripts_single_group() {
        let transcripts = [
            TranscriptSegment {
                id: "1".to_string(),
                text: "hello".to_string(),
                start_ms: 0,
                end_ms: 100,
            },
            TranscriptSegment {
                id: "2".to_string(),
                text: "world".to_string(),
                start_ms: 200,
                end_ms: 300,
            },
        ];

        let t_refs: Vec<_> = transcripts.iter().collect();
        let groups = group_consecutive_transcripts(t_refs);

        // Both should be in same group due to small gap
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
    }

    #[test]
    fn group_consecutive_transcripts_multiple_groups() {
        let transcripts = [
            TranscriptSegment {
                id: "1".to_string(),
                text: "hello".to_string(),
                start_ms: 0,
                end_ms: 100,
            },
            TranscriptSegment {
                id: "2".to_string(),
                text: "silence".to_string(),
                start_ms: 2000, // Large gap
                end_ms: 2100,
            },
        ];

        let t_refs: Vec<_> = transcripts.iter().collect();
        let groups = group_consecutive_transcripts(t_refs);

        // Should be in separate groups due to large gap
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].len(), 1);
        assert_eq!(groups[1].len(), 1);
    }

    #[test]
    fn map_speakers_to_transcripts_basic() {
        let speaker_segments = vec![
            SpeakerSegment {
                start_ms: 0,
                end_ms: 5000,
                speaker_id: 0,
            },
            SpeakerSegment {
                start_ms: 5000,
                end_ms: 10000,
                speaker_id: 1,
            },
        ];

        let transcript_rows = vec![
            TranscriptSegment {
                id: "1".to_string(),
                text: "hello".to_string(),
                start_ms: 1000,
                end_ms: 2000,
            },
            TranscriptSegment {
                id: "2".to_string(),
                text: "world".to_string(),
                start_ms: 6000,
                end_ms: 7000,
            },
        ];

        let result = map_speakers_to_transcripts(&speaker_segments, &transcript_rows);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].speaker_number, 0);
        assert_eq!(result[1].speaker_number, 1);
    }
}
