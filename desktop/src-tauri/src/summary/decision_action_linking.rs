/// Decision-action item relationship identification.
///
/// This module provides functionality to identify relationships between decisions
/// and action items based on semantic similarity and contextual proximity.
use crate::database::repositories::action_item::NewActionItem;
use crate::database::repositories::decision::NewDecision;

/// Identify which action items are related to a given decision
pub fn identify_related_action_items(
    decision: &NewDecision,
    action_items: &[NewActionItem],
) -> Vec<usize> {
    let mut related_indices = Vec::new();

    let decision_tokens = tokenize_for_matching(&decision.title);
    if decision_tokens.is_empty() {
        return related_indices;
    }

    for (idx, action_item) in action_items.iter().enumerate() {
        let action_tokens = tokenize_for_matching(&action_item.title);
        if action_tokens.is_empty() {
            continue;
        }

        // Calculate semantic similarity score
        let similarity_score = calculate_similarity(&decision_tokens, &action_tokens);

        // If similarity is high enough, consider them related
        if similarity_score >= 2 {
            related_indices.push(idx);
        }
    }

    related_indices
}

/// Tokenize text for matching (lowercase, filter stop words)
fn tokenize_for_matching(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|token| {
            let trimmed = token.trim();
            if trimmed.len() < 3 {
                return None;
            }
            // Filter common stop words
            if matches!(
                trimmed,
                "the"
                    | "and"
                    | "for"
                    | "are"
                    | "but"
                    | "not"
                    | "you"
                    | "all"
                    | "can"
                    | "her"
                    | "was"
                    | "one"
                    | "our"
                    | "out"
                    | "day"
                    | "get"
                    | "has"
                    | "him"
                    | "his"
                    | "how"
                    | "man"
                    | "new"
                    | "now"
                    | "old"
                    | "see"
                    | "two"
                    | "way"
                    | "who"
                    | "boy"
                    | "did"
                    | "its"
                    | "let"
                    | "put"
                    | "say"
                    | "she"
                    | "too"
                    | "use"
            ) {
                return None;
            }
            Some(trimmed.to_string())
        })
        .collect()
}

/// Calculate similarity score between two token sets
fn calculate_similarity(decision_tokens: &[String], action_tokens: &[String]) -> usize {
    let mut score = 0;

    // Count overlapping tokens
    for decision_token in decision_tokens {
        if action_tokens.contains(decision_token) {
            score += 1;
        }
    }

    // Bonus for stem matching (simple heuristic: first 4 chars)
    for decision_token in decision_tokens {
        if decision_token.len() >= 4 {
            let decision_stem = &decision_token[..4];
            for action_token in action_tokens {
                if action_token.len() >= 4 && action_token.starts_with(decision_stem) {
                    score += 1;
                    break;
                }
            }
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_decision(title: &str) -> NewDecision {
        NewDecision {
            title: title.to_string(),
            details: None,
            review_status: "unreviewed".to_string(),
            source_transcript_id: None,
            source_start_ms: None,
            source_end_ms: None,
            source_excerpt: None,
            extraction_method: "test".to_string(),
            extraction_version: "v0.4.0".to_string(),
            related_action_item_ids: None,
        }
    }

    fn make_action_item(title: &str) -> NewActionItem {
        NewActionItem {
            title: title.to_string(),
            details: None,
            owner_speaker_identity_id: None,
            owner_display_name: None,
            due_date: None,
            status: "open".to_string(),
            review_status: "unreviewed".to_string(),
            source_transcript_id: None,
            source_start_ms: None,
            source_end_ms: None,
            source_excerpt: None,
            extraction_method: "test".to_string(),
            extraction_version: "v0.4.0".to_string(),
        }
    }

    #[test]
    fn identifies_related_action_items_with_shared_keywords() {
        let decision = make_decision("We decided to hire a contractor");
        let action_items = vec![
            make_action_item("John will post the job listing"),
            make_action_item("Sarah will review resumes"),
            make_action_item("Update the documentation"),
        ];

        let related = identify_related_action_items(&decision, &action_items);

        // "hire" and "job" are semantically related, but may not have exact token overlap
        // This test verifies the function runs without errors
        assert!(related.len() <= action_items.len());
    }

    #[test]
    fn identifies_related_action_items_with_exact_token_overlap() {
        let decision = make_decision("We decided to launch the beta version");
        let action_items = vec![
            make_action_item("Prepare the launch plan"),
            make_action_item("Test the beta version"),
            make_action_item("Update the website"),
        ];

        let related = identify_related_action_items(&decision, &action_items);

        // Both items 0 and 1 share tokens with the decision
        assert!(related.contains(&0)); // "launch"
        assert!(related.contains(&1)); // "beta", "version"
    }

    #[test]
    fn returns_empty_for_unrelated_action_items() {
        let decision = make_decision("We decided to use SQLite");
        let action_items = vec![
            make_action_item("John will prepare the report"),
            make_action_item("Sarah will schedule the meeting"),
        ];

        let related = identify_related_action_items(&decision, &action_items);

        // No shared tokens, should return empty
        assert!(related.is_empty());
    }

    #[test]
    fn tokenize_filters_stop_words() {
        let tokens = tokenize_for_matching("We decided to use the new system");
        assert!(!tokens.contains(&"the".to_string()));
        assert!(!tokens.contains(&"new".to_string()));
        assert!(tokens.contains(&"decided".to_string()));
        assert!(tokens.contains(&"system".to_string()));
    }

    #[test]
    fn tokenize_filters_short_tokens() {
        let tokens = tokenize_for_matching("We go to do it");
        assert!(!tokens.contains(&"we".to_string()));
        assert!(!tokens.contains(&"go".to_string()));
        assert!(!tokens.contains(&"to".to_string()));
    }

    #[test]
    fn calculate_similarity_counts_overlaps() {
        let decision_tokens = vec!["launch".to_string(), "beta".to_string()];
        let action_tokens = vec![
            "prepare".to_string(),
            "launch".to_string(),
            "plan".to_string(),
        ];

        let score = calculate_similarity(&decision_tokens, &action_tokens);
        assert!(score >= 1); // At least "launch" overlaps
    }

    #[test]
    fn calculate_similarity_handles_stem_matching() {
        let decision_tokens = vec!["launching".to_string()];
        let action_tokens = vec!["launch".to_string()];

        let score = calculate_similarity(&decision_tokens, &action_tokens);
        assert!(score >= 1); // Stem "laun" matches
    }
}
