// Export module - shared infrastructure for all export formats
//
// Architecture:
// - common.rs: Shared data collection, file I/O, and utility functions
// - markdown.rs: Markdown export (refactored from markdown_export.rs)
// - pdf.rs: PDF export using genpdf crate
// - docx.rs: DOCX export using docx-rs crate

pub mod common;
pub mod docx;
pub mod markdown;
pub mod pdf;

#[cfg(test)]
mod tests;

// Re-export main commands for convenience
pub use docx::{meeting_export_docx, meetings_export_docx_batch};
pub use markdown::{meeting_export_markdown, meetings_export_markdown_batch};
pub use pdf::{meeting_export_pdf, meetings_export_pdf_batch};
