#[cfg(test)]
mod export_tests {
    use crate::export::common::MeetingExportData;

    #[test]
    fn test_meeting_export_data_creation() {
        let data = MeetingExportData {
            id: "test-id".to_string(),
            title: "Test Meeting".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            folder_path: None,
            source_type: "recorded".to_string(),
            language: Some("en".to_string()),
            duration_seconds: Some(3600.0),
            diarization_status: None,
        };

        assert_eq!(data.id, "test-id");
        assert_eq!(data.title, "Test Meeting");
        assert_eq!(data.source_type, "recorded");
    }

    #[test]
    fn test_meeting_export_data_with_folder() {
        let data = MeetingExportData {
            id: "test-id".to_string(),
            title: "Test Meeting".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            folder_path: Some("/path/to/meeting".to_string()),
            source_type: "imported".to_string(),
            language: None,
            duration_seconds: None,
            diarization_status: None,
        };

        assert_eq!(data.source_type, "imported");
        assert!(data.folder_path.is_some());
    }

    #[test]
    fn test_meeting_export_data_no_language() {
        let data = MeetingExportData {
            id: "test-id".to_string(),
            title: "Test Meeting".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            folder_path: None,
            source_type: "recorded".to_string(),
            language: None,
            duration_seconds: None,
            diarization_status: None,
        };

        assert!(data.language.is_none());
    }
}
