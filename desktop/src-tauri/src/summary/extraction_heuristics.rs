/// Enhanced heuristics for extracting action items and decisions from meeting text.
///
/// This module implements pattern matching beyond simple keyword detection to identify
/// action items and decisions with improved accuracy.
use once_cell::sync::Lazy;
use regex::Regex;

/// Pattern matchers for action item detection
static ACTION_WILL_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:^|[\r\n]+|[.!?]\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+will\s+(.+?)(?:[.!?]|$)",
    )
    .expect("action will pattern should compile")
});

static ACTION_NEED_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)(?:we|they|team)\s+need\s+to\s+(.+?)(?:[.!?]|$)")
        .expect("action need pattern should compile")
});

static ACTION_TODO_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)(?:TODO|To-do|To do):\s*(.+?)(?:[.!?]|$)")
        .expect("action todo pattern should compile")
});

static ACTION_ITEM_LABEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)Action\s+item:\s*(.+?)(?:[.!?]|$)")
        .expect("action item label should compile")
});

static ACTION_ASSIGNED_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:^|[\r\n]+|[.!?]\s+)Assigned\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*):\s*(.+?)(?:[.!?]|$)",
    )
    .expect("action assigned pattern should compile")
});

/// Pattern matchers for decision detection
static DECISION_DECIDED_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)(?:we|they|team)\s+decided\s+to\s+(.+?)(?:[.!?]|$)")
        .expect("decision decided pattern should compile")
});

static DECISION_AGREED_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)(?:the\s+)?team\s+agreed\s+(?:to\s+)?(.+?)(?:[.!?]|$)")
        .expect("decision agreed pattern should compile")
});

static DECISION_LABEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)Decision:\s*(.+?)(?:[.!?]|$)")
        .expect("decision label should compile")
});

static DECISION_AGREED_LABEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)Agreed:\s*(.+?)(?:[.!?]|$)")
        .expect("decision agreed label should compile")
});

static DECISION_CONSENSUS_LABEL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:^|[\r\n]+|[.!?]\s+)Consensus:\s*(.+?)(?:[.!?]|$)")
        .expect("decision consensus label should compile")
});

#[derive(Debug, Clone)]
pub struct ExtractedActionItem {
    pub title: String,
    pub owner_name: Option<String>,
    pub source_text: String,
}

#[derive(Debug, Clone)]
pub struct ExtractedDecision {
    pub title: String,
    pub source_text: String,
}

/// Extract action items from text using enhanced heuristics
pub fn extract_action_items_from_text(text: &str) -> Vec<ExtractedActionItem> {
    let mut items = Vec::new();

    // Pattern: "John will do something"
    for capture in ACTION_WILL_PATTERN.captures_iter(text) {
        if let (Some(owner), Some(action)) = (capture.get(1), capture.get(2)) {
            items.push(ExtractedActionItem {
                title: action.as_str().trim().to_string(),
                owner_name: Some(owner.as_str().trim().to_string()),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "We need to do something"
    for capture in ACTION_NEED_PATTERN.captures_iter(text) {
        if let Some(action) = capture.get(1) {
            items.push(ExtractedActionItem {
                title: action.as_str().trim().to_string(),
                owner_name: None,
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "TODO: do something"
    for capture in ACTION_TODO_PATTERN.captures_iter(text) {
        if let Some(action) = capture.get(1) {
            items.push(ExtractedActionItem {
                title: action.as_str().trim().to_string(),
                owner_name: None,
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "Action item: do something"
    for capture in ACTION_ITEM_LABEL.captures_iter(text) {
        if let Some(action) = capture.get(1) {
            items.push(ExtractedActionItem {
                title: action.as_str().trim().to_string(),
                owner_name: None,
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "Assigned to John: do something"
    for capture in ACTION_ASSIGNED_PATTERN.captures_iter(text) {
        if let (Some(owner), Some(action)) = (capture.get(1), capture.get(2)) {
            items.push(ExtractedActionItem {
                title: action.as_str().trim().to_string(),
                owner_name: Some(owner.as_str().trim().to_string()),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    items
}

/// Extract decisions from text using enhanced heuristics
pub fn extract_decisions_from_text(text: &str) -> Vec<ExtractedDecision> {
    let mut decisions = Vec::new();

    // Pattern: "We decided to do something"
    for capture in DECISION_DECIDED_PATTERN.captures_iter(text) {
        if let Some(decision) = capture.get(1) {
            decisions.push(ExtractedDecision {
                title: decision.as_str().trim().to_string(),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "The team agreed to do something"
    for capture in DECISION_AGREED_PATTERN.captures_iter(text) {
        if let Some(decision) = capture.get(1) {
            decisions.push(ExtractedDecision {
                title: decision.as_str().trim().to_string(),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "Decision: do something"
    for capture in DECISION_LABEL.captures_iter(text) {
        if let Some(decision) = capture.get(1) {
            decisions.push(ExtractedDecision {
                title: decision.as_str().trim().to_string(),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "Agreed: do something"
    for capture in DECISION_AGREED_LABEL.captures_iter(text) {
        if let Some(decision) = capture.get(1) {
            decisions.push(ExtractedDecision {
                title: decision.as_str().trim().to_string(),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    // Pattern: "Consensus: do something"
    for capture in DECISION_CONSENSUS_LABEL.captures_iter(text) {
        if let Some(decision) = capture.get(1) {
            decisions.push(ExtractedDecision {
                title: decision.as_str().trim().to_string(),
                source_text: capture.get(0).unwrap().as_str().trim().to_string(),
            });
        }
    }

    decisions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_action_item_with_owner_from_will_pattern() {
        let text = "John will prepare the launch plan by Friday.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "prepare the launch plan by Friday");
        assert_eq!(items[0].owner_name.as_deref(), Some("John"));
    }

    #[test]
    fn extracts_action_item_from_need_pattern() {
        let text = "We need to update the documentation.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "update the documentation");
        assert_eq!(items[0].owner_name, None);
    }

    #[test]
    fn extracts_action_item_from_todo_pattern() {
        let text = "TODO: Review the pull request.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Review the pull request");
    }

    #[test]
    fn extracts_action_item_from_action_item_label() {
        let text = "Action item: Schedule follow-up meeting.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Schedule follow-up meeting");
    }

    #[test]
    fn extracts_action_item_from_assigned_pattern() {
        let text = "Assigned to Sarah: Create the design mockups.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Create the design mockups");
        assert_eq!(items[0].owner_name.as_deref(), Some("Sarah"));
    }

    #[test]
    fn extracts_decision_from_decided_pattern() {
        let text = "We decided to ship the beta behind a feature flag.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].title, "ship the beta behind a feature flag");
    }

    #[test]
    fn extracts_decision_from_agreed_pattern() {
        let text = "The team agreed to keep the desktop-first scope.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].title, "keep the desktop-first scope");
    }

    #[test]
    fn extracts_decision_from_decision_label() {
        let text = "Decision: Move forward with the new architecture.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].title, "Move forward with the new architecture");
    }

    #[test]
    fn extracts_decision_from_agreed_label() {
        let text = "Agreed: Use SQLite for local storage.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].title, "Use SQLite for local storage");
    }

    #[test]
    fn extracts_decision_from_consensus_label() {
        let text = "Consensus: Prioritize performance over features.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 1);
        assert_eq!(decisions[0].title, "Prioritize performance over features");
    }

    #[test]
    fn extracts_multiple_action_items_from_mixed_text() {
        let text =
            "John will prepare the report. We need to schedule a follow-up. TODO: Review the code.";
        let items = extract_action_items_from_text(text);
        assert_eq!(items.len(), 3);
    }

    #[test]
    fn extracts_multiple_decisions_from_mixed_text() {
        let text =
            "We decided to ship on Friday. The team agreed to use Rust. Decision: Keep it simple.";
        let decisions = extract_decisions_from_text(text);
        assert_eq!(decisions.len(), 3);
    }

    #[test]
    fn extracts_items_and_decisions_after_markdown_headings() {
        let text = "## Summary\nWe need to update the docs.\nWe decided to ship the beta.";
        let items = extract_action_items_from_text(text);
        let decisions = extract_decisions_from_text(text);

        assert_eq!(items.len(), 1);
        assert_eq!(decisions.len(), 1);
    }
}
