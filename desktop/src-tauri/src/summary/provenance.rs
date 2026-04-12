/// Provenance capture for action items and decisions.
///
/// This module provides functionality to search transcripts and find evidence
/// for extracted action items and decisions, capturing timing and source information.
use crate::database::models::Transcript;
use once_cell::sync::Lazy;
use sqlx::SqlitePool;
use std::collections::HashSet;

#[derive(Debug, Clone, Default)]
pub struct ProvenanceData {
    pub source_transcript_id: Option<String>,
    pub source_start_ms: Option<i64>,
    pub source_end_ms: Option<i64>,
    pub source_excerpt: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ProvenanceMatch {
    pub data: ProvenanceData,
    pub score: usize,
    pub coverage_ratio: f32,
    pub exact_phrase_match: bool,
    pub matched_terms: Vec<String>,
}

/// Find provenance data for a given text by searching transcripts
pub async fn find_provenance_in_transcripts(
    pool: &SqlitePool,
    meeting_id: &str,
    search_text: &str,
) -> Result<ProvenanceData, String> {
    Ok(find_best_provenance_match(pool, meeting_id, search_text)
        .await?
        .map(|matched| matched.data)
        .unwrap_or_default())
}

pub async fn find_best_provenance_match(
    pool: &SqlitePool,
    meeting_id: &str,
    search_text: &str,
) -> Result<Option<ProvenanceMatch>, String> {
    // Fetch all transcripts for the meeting
    let transcripts = sqlx::query_as::<_, Transcript>(
        "SELECT id, meeting_id, transcript, raw_transcript, processing_version, timestamp,
                audio_start_time, audio_end_time, duration, speaker
         FROM transcripts
         WHERE meeting_id = ?
         ORDER BY audio_start_time ASC",
    )
    .bind(meeting_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to fetch transcripts: {}", e))?;

    // Search for the text in transcripts
    let normalized_search = normalize_for_search(search_text);
    let search_tokens = tokenize_for_search(&normalized_search);

    if search_tokens.is_empty() {
        return Ok(None);
    }

    let mut best_match: Option<TranscriptMatch<'_>> = None;

    for transcript in &transcripts {
        let normalized_transcript = normalize_for_search(&transcript.transcript);
        let transcript_tokens = tokenize_for_search(&normalized_transcript);

        let overlap_tokens = matching_tokens(&search_tokens, &transcript_tokens);
        if overlap_tokens.is_empty() {
            continue;
        }

        let exact_phrase_match =
            normalized_search.len() >= 8 && normalized_transcript.contains(&normalized_search);
        let ordered_match = is_subsequence(&search_tokens, &transcript_tokens);
        let coverage_ratio = overlap_tokens.len() as f32 / search_tokens.len() as f32;
        let match_score = calculate_match_score(
            &search_tokens,
            &transcript_tokens,
            coverage_ratio,
            exact_phrase_match,
            ordered_match,
        );

        if !exact_phrase_match && coverage_ratio < minimum_coverage_ratio(search_tokens.len()) {
            continue;
        }

        let excerpt = build_excerpt_window(&transcript.transcript, &search_tokens, 24);
        let candidate = TranscriptMatch {
            transcript,
            score: match_score,
            coverage_ratio,
            exact_phrase_match,
            matched_terms: overlap_tokens,
            excerpt,
        };

        if should_replace_match(best_match.as_ref(), &candidate) {
            best_match = Some(candidate);
        }
    }

    Ok(best_match.map(|matched| ProvenanceMatch {
        data: ProvenanceData {
            source_transcript_id: Some(matched.transcript.id.clone()),
            source_start_ms: matched
                .transcript
                .audio_start_time
                .map(|t| (t * 1000.0) as i64),
            source_end_ms: matched
                .transcript
                .audio_end_time
                .map(|t| (t * 1000.0) as i64),
            source_excerpt: Some(matched.excerpt),
        },
        score: matched.score,
        coverage_ratio: matched.coverage_ratio,
        exact_phrase_match: matched.exact_phrase_match,
        matched_terms: matched.matched_terms,
    }))
}

/// Normalize text for search (lowercase, remove punctuation)
fn normalize_for_search(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect()
}

/// Tokenize text for search
fn tokenize_for_search(text: &str) -> Vec<String> {
    static ALLOWED_SHORT_TOKENS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
        HashSet::from([
            "ai", "api", "db", "do", "go", "hr", "ml", "pm", "qa", "ui", "ux",
        ])
    });

    static STOP_WORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
        HashSet::from([
            "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "he", "her", "his",
            "if", "in", "into", "is", "it", "its", "of", "on", "or", "our", "she", "so", "the",
            "their", "them", "they", "this", "to", "us", "was", "we", "with",
        ])
    });

    text.to_lowercase()
        .split_whitespace()
        .filter_map(|token| {
            let normalized = token.trim();
            if normalized.is_empty() || STOP_WORDS.contains(normalized) {
                return None;
            }

            if normalized.len() >= 3 || ALLOWED_SHORT_TOKENS.contains(normalized) {
                return Some(normalized.to_string());
            }

            None
        })
        .collect()
}

/// Calculate match score based on token overlap
fn calculate_match_score(
    search_tokens: &[String],
    transcript_tokens: &[String],
    coverage_ratio: f32,
    exact_phrase_match: bool,
    ordered_match: bool,
) -> usize {
    let overlap_count = matching_tokens(search_tokens, transcript_tokens).len();
    let mut score = overlap_count * 10;

    if ordered_match {
        score += search_tokens.len() * 4;
    }

    if exact_phrase_match {
        score += 30;
    }

    score + (coverage_ratio * 10.0).round() as usize
}

/// Check if search tokens appear as a subsequence in transcript tokens
fn is_subsequence(needle: &[String], haystack: &[String]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if needle.len() > haystack.len() {
        return false;
    }

    let mut needle_idx = 0;
    for token in haystack {
        if needle_idx < needle.len() && token == &needle[needle_idx] {
            needle_idx += 1;
        }
    }

    needle_idx == needle.len()
}

/// Truncate excerpt to a maximum length
fn truncate_excerpt(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}

fn minimum_coverage_ratio(search_token_count: usize) -> f32 {
    match search_token_count {
        0..=2 => 0.5,
        3 => 0.66,
        _ => 0.6,
    }
}

fn matching_tokens(search_tokens: &[String], transcript_tokens: &[String]) -> Vec<String> {
    let transcript_set: HashSet<&str> = transcript_tokens.iter().map(String::as_str).collect();
    search_tokens
        .iter()
        .filter(|token| transcript_set.contains(token.as_str()))
        .cloned()
        .collect()
}

fn tokenize_original_text(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|token| token.to_string())
        .collect()
}

fn build_excerpt_window(text: &str, search_tokens: &[String], window_size: usize) -> String {
    let words = tokenize_original_text(text);
    if words.is_empty() {
        return String::new();
    }

    let mut best_start = 0usize;
    let mut best_end = words.len().min(window_size);
    let mut best_score = 0usize;

    for start in 0..words.len() {
        let end = (start + window_size).min(words.len());
        let slice = words[start..end].join(" ");
        let normalized_slice = normalize_for_search(&slice);
        let slice_tokens = tokenize_for_search(&normalized_slice);
        let score = matching_tokens(search_tokens, &slice_tokens).len();

        if score > best_score {
            best_score = score;
            best_start = start;
            best_end = end;
        }
    }

    let excerpt = words[best_start..best_end].join(" ");
    let prefix = if best_start > 0 { "... " } else { "" };
    let suffix = if best_end < words.len() { " ..." } else { "" };
    format!("{}{}{}", prefix, truncate_excerpt(&excerpt, 220), suffix)
}

fn should_replace_match(
    current_best: Option<&TranscriptMatch<'_>>,
    candidate: &TranscriptMatch<'_>,
) -> bool {
    match current_best {
        None => true,
        Some(best) => {
            candidate.score > best.score
                || (candidate.score == best.score && candidate.coverage_ratio > best.coverage_ratio)
                || (candidate.score == best.score
                    && (candidate.coverage_ratio - best.coverage_ratio).abs() < f32::EPSILON
                    && candidate.exact_phrase_match
                    && !best.exact_phrase_match)
        }
    }
}

struct TranscriptMatch<'a> {
    transcript: &'a Transcript,
    score: usize,
    coverage_ratio: f32,
    exact_phrase_match: bool,
    matched_terms: Vec<String>,
    excerpt: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_for_search_removes_punctuation() {
        assert_eq!(
            normalize_for_search("Hello, world!"),
            "hello world".to_string()
        );
        assert_eq!(
            normalize_for_search("John's plan."),
            "johns plan".to_string()
        );
    }

    #[test]
    fn tokenize_for_search_filters_short_tokens() {
        let tokens = tokenize_for_search("we need to do it");
        assert_eq!(tokens, vec!["need".to_string(), "do".to_string()]);
    }

    #[test]
    fn tokenize_for_search_keeps_meaningful_domain_short_tokens() {
        let tokens = tokenize_for_search("AI UI QA DB API");
        assert_eq!(
            tokens,
            vec![
                "ai".to_string(),
                "ui".to_string(),
                "qa".to_string(),
                "db".to_string(),
                "api".to_string(),
            ]
        );
    }

    #[test]
    fn calculate_match_score_counts_overlaps() {
        let search = vec!["prepare".to_string(), "launch".to_string()];
        let transcript = vec![
            "we".to_string(),
            "need".to_string(),
            "prepare".to_string(),
            "the".to_string(),
            "launch".to_string(),
        ];
        let score = calculate_match_score(&search, &transcript, 1.0, false, true);
        assert!(score > 0);
    }

    #[test]
    fn is_subsequence_detects_consecutive_matches() {
        let needle = vec!["prepare".to_string(), "launch".to_string()];
        let haystack = vec![
            "we".to_string(),
            "prepare".to_string(),
            "the".to_string(),
            "launch".to_string(),
        ];
        assert!(is_subsequence(&needle, &haystack));
    }

    #[test]
    fn is_subsequence_returns_false_for_non_matches() {
        let needle = vec!["prepare".to_string(), "launch".to_string()];
        let haystack = vec!["we".to_string(), "launch".to_string()];
        assert!(!is_subsequence(&needle, &haystack));
    }

    #[test]
    fn truncate_excerpt_limits_length() {
        let text = "This is a very long text that should be truncated to a reasonable length for display purposes.";
        let truncated = truncate_excerpt(text, 50);
        assert!(truncated.len() <= 53); // 50 + "..."
        assert!(truncated.ends_with("..."));
    }

    #[tokio::test]
    async fn find_provenance_returns_default_for_no_transcripts() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        let result = find_provenance_in_transcripts(&pool, "meeting-1", "prepare launch plan")
            .await
            .expect("query should succeed");

        assert_eq!(result.source_transcript_id, None);
    }

    #[tokio::test]
    async fn find_provenance_finds_matching_transcript() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, processing_version,
                                      audio_start_time, audio_end_time)
             VALUES ('transcript-1', 'meeting-1', 'We need to prepare the launch plan by Friday.',
                     '2026-04-11T10:00:00Z', 'v0.2.0', 0.0, 5.0)",
        )
        .execute(&pool)
        .await
        .expect("insert transcript");

        let result = find_provenance_in_transcripts(&pool, "meeting-1", "prepare launch plan")
            .await
            .expect("query should succeed");

        assert_eq!(
            result.source_transcript_id,
            Some("transcript-1".to_string())
        );
        assert_eq!(result.source_start_ms, Some(0));
        assert_eq!(result.source_end_ms, Some(5000));
        assert!(result.source_excerpt.is_some());
    }

    #[test]
    fn matching_tokens_returns_unique_overlap_terms_in_search_order() {
        let overlap = matching_tokens(
            &["launch".into(), "beta".into(), "plan".into()],
            &["plan".into(), "launch".into(), "notes".into()],
        );

        assert_eq!(overlap, vec!["launch".to_string(), "plan".to_string()]);
    }

    #[test]
    fn build_excerpt_window_focuses_on_relevant_terms() {
        let excerpt = build_excerpt_window(
            "Intro words here. We decided to ship the beta behind a feature flag after the review. Closing words.",
            &["ship".into(), "beta".into(), "feature".into(), "flag".into()],
            10,
        );

        assert!(excerpt.contains("ship the beta"));
        assert!(excerpt.contains("feature flag"));
    }

    #[tokio::test]
    async fn find_best_provenance_match_prefers_stronger_evidence() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("failed to create pool");

        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrations should run");

        sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at)
             VALUES ('meeting-1', 'Test', '2026-04-11T00:00:00Z', '2026-04-11T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert meeting");

        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, processing_version,
                                      audio_start_time, audio_end_time)
             VALUES
             ('transcript-weak', 'meeting-1', 'We talked about beta timelines and launch work.',
              '2026-04-11T10:00:00Z', 'v0.2.0', 0.0, 4.0),
             ('transcript-strong', 'meeting-1', 'We decided to ship the beta behind a feature flag after QA review.',
              '2026-04-11T10:01:00Z', 'v0.2.0', 5.0, 10.0)",
        )
        .execute(&pool)
        .await
        .expect("insert transcripts");

        let result =
            find_best_provenance_match(&pool, "meeting-1", "ship the beta behind a feature flag")
                .await
                .expect("query should succeed")
                .expect("expected provenance match");

        assert_eq!(
            result.data.source_transcript_id,
            Some("transcript-strong".to_string())
        );
        assert!(result.score > 0);
        assert!(result.coverage_ratio >= 0.6);
        assert!(result.exact_phrase_match);
    }
}
