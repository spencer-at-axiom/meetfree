// Integration tests for diarization module

#[cfg(test)]
mod integration_tests {
    use super::super::*;

    #[tokio::test]
    async fn test_model_manager_creation() {
        let temp_dir = std::env::temp_dir().join("test_diarization_models");
        let manager = model_manager::DiarizationModelManager::new(temp_dir.clone());

        // Should be able to get models list
        let models = manager.get_models().await;
        assert!(models.is_ok());

        let models = models.unwrap();
        assert_eq!(models.len(), 2); // Segmentation + Embedding

        // Clean up
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[tokio::test]
    async fn test_sherpa_handler_creation() {
        let temp_dir = std::env::temp_dir().join("test_sherpa_handler");
        let handler = sherpa_handler::SherpaDiarizationHandler::new(Some(temp_dir.clone()));

        assert!(handler.is_ok());

        let handler = handler.unwrap();
        assert!(!handler.models_available().await); // Models not downloaded yet

        // Clean up
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
    }

    #[test]
    fn test_speaker_segment_creation() {
        let segment = SpeakerSegment {
            start_ms: 0,
            end_ms: 1000,
            speaker_id: 0,
        };

        assert_eq!(segment.start_ms, 0);
        assert_eq!(segment.end_ms, 1000);
        assert_eq!(segment.speaker_id, 0);
    }

    #[test]
    fn test_speaker_turn_creation() {
        let turn = SpeakerTurn {
            speaker_number: 1,
            start_ms: 0,
            end_ms: 5000,
            text: "Hello world".to_string(),
            confidence: 0.95,
        };

        assert_eq!(turn.speaker_number, 1);
        assert_eq!(turn.start_ms, 0);
        assert_eq!(turn.end_ms, 5000);
        assert_eq!(turn.text, "Hello world");
        assert_eq!(turn.confidence, 0.95);
    }
}
