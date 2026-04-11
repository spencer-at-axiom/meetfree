-- Add relationship metadata for decisions to action items
-- This allows tracking which action items are related to which decisions

ALTER TABLE decisions ADD COLUMN related_action_item_ids TEXT;

-- The related_action_item_ids field stores a JSON array of action item IDs
-- Example: ["action-123", "action-456"]
-- This enables future UI to display related action items when viewing a decision
