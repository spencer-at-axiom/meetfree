use anyhow::Result;
use tiktoken_rs::cl100k_base;

/// Accurate token counter using tiktoken for OpenAI models
///
/// This replaces the rough estimation (~0.35 tokens/char) with precise
/// token counting that matches OpenAI's actual tokenization.
pub struct TokenCounter {
    bpe: tiktoken_rs::CoreBPE,
}

impl TokenCounter {
    /// Create a new token counter with cl100k_base encoding
    /// (used by GPT-4, GPT-3.5-turbo, text-embedding-ada-002)
    pub fn new() -> Result<Self> {
        let bpe = cl100k_base()?;
        Ok(Self { bpe })
    }

    /// Count tokens in a text string
    pub fn count_tokens(&self, text: &str) -> usize {
        self.bpe.encode_with_special_tokens(text).len()
    }

    /// Count tokens for a chat completion message
    /// Includes overhead for message formatting (role, content, etc.)
    pub fn count_message_tokens(&self, role: &str, content: &str) -> usize {
        // OpenAI adds ~4 tokens per message for formatting:
        // <|start|>{role/name}\n{content}<|end|>\n
        let base_tokens = self.count_tokens(content);
        let role_tokens = self.count_tokens(role);
        base_tokens + role_tokens + 4
    }

    /// Check if text exceeds token limit
    pub fn exceeds_limit(&self, text: &str, limit: usize) -> bool {
        self.count_tokens(text) > limit
    }

    /// Split text into chunks that fit within token limit
    /// Returns chunks with overlap for context preservation
    pub fn chunk_text(&self, text: &str, max_tokens: usize, overlap_tokens: usize) -> Vec<String> {
        let mut chunks = Vec::new();
        let words: Vec<&str> = text.split_whitespace().collect();

        if words.is_empty() {
            return chunks;
        }

        let mut current_chunk = String::new();
        let mut current_tokens = 0;
        let mut overlap_buffer = Vec::new();

        for word in words {
            let word_with_space = format!("{} ", word);
            let word_tokens = self.count_tokens(&word_with_space);

            // If adding this word would exceed limit, start new chunk
            if current_tokens + word_tokens > max_tokens && !current_chunk.is_empty() {
                chunks.push(current_chunk.trim().to_string());

                // Start new chunk with overlap from previous chunk
                current_chunk = overlap_buffer.join(" ");
                current_tokens = self.count_tokens(&current_chunk);
                overlap_buffer.clear();

                // Add space if chunk has content
                if !current_chunk.is_empty() {
                    current_chunk.push(' ');
                }
            }

            current_chunk.push_str(&word_with_space);
            current_tokens += word_tokens;

            // Maintain overlap buffer
            overlap_buffer.push(word);
            let overlap_text = overlap_buffer.join(" ");
            if self.count_tokens(&overlap_text) > overlap_tokens {
                overlap_buffer.remove(0);
            }
        }

        // Add final chunk if not empty
        if !current_chunk.is_empty() {
            chunks.push(current_chunk.trim().to_string());
        }

        chunks
    }

    /// Get recommended chunk size for a given model
    pub fn get_recommended_chunk_size(model: &str) -> usize {
        match model {
            "gpt-4" | "gpt-4-turbo" => 6000, // Leave room for system prompt + response
            "gpt-3.5-turbo" => 3000,
            "gpt-4o" | "gpt-4o-mini" => 100000, // Large context window
            _ => 3000,                          // Conservative default
        }
    }
}

impl Default for TokenCounter {
    fn default() -> Self {
        Self::new().expect("Failed to initialize token counter")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_counting() {
        let counter = TokenCounter::new().unwrap();

        // Simple text
        let text = "Hello, world!";
        let tokens = counter.count_tokens(text);
        assert!(tokens > 0);
        assert!(tokens < 10); // Should be around 3-4 tokens
    }

    #[test]
    fn test_message_tokens() {
        let counter = TokenCounter::new().unwrap();

        let role = "user";
        let content = "What is the weather today?";
        let tokens = counter.count_message_tokens(role, content);

        // Should include content + role + formatting overhead
        let content_tokens = counter.count_tokens(content);
        assert!(tokens > content_tokens);
    }

    #[test]
    fn test_chunking() {
        let counter = TokenCounter::new().unwrap();

        let text = "This is a test. ".repeat(100); // Long text
        let chunks = counter.chunk_text(&text, 50, 10);

        assert!(chunks.len() > 1);

        // Verify each chunk is within limit
        for chunk in &chunks {
            let tokens = counter.count_tokens(chunk);
            assert!(
                tokens <= 50,
                "Chunk has {} tokens, exceeds limit of 50",
                tokens
            );
        }
    }

    #[test]
    fn test_exceeds_limit() {
        let counter = TokenCounter::new().unwrap();

        let short_text = "Hello";
        let long_text = "word ".repeat(1000);

        assert!(!counter.exceeds_limit(short_text, 100));
        assert!(counter.exceeds_limit(&long_text, 100));
    }
}
