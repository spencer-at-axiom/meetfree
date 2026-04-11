pub mod handlers;
// Removed: pub mod commands; - empty placeholder file deleted
pub mod config;
pub mod custom_openai;
pub mod meetings;

pub use handlers::*;
// Don't re-export commands to avoid conflicts - lib.rs will import directly
