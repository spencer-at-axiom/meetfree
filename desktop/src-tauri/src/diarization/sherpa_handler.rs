// Native Rust speaker diarization using sherpa-onnx
// Replaces Python subprocess approach with bundled ONNX models

use super::SpeakerSegment;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// Sherpa-ONNX diarization handler
pub struct SherpaDiarizationHandler {
    models_dir: PathBuf,
}

impl SherpaDiarizationHandler {
    /// Create a new Sherpa diarization handler
    pub fn new(models_dir: Option<PathBuf>) -> Result<Self> {
        let models_dir = if let Some(dir) = models_dir {
            dir.join("diarization")
        } else {
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            if cfg!(debug_assertions) {
                current_dir.join("models").join("diarization")
            } else {
                crate::brand::data_root()?.join("models").join("diarization")
            }
        };

        log::info!(
            "SherpaDiarizationHandler using models directory: {}",
            models_dir.display()
        );

        // Create directory if it doesn't exist
        if !models_dir.exists() {
            std::fs::create_dir_all(&models_dir)?;
        }

        Ok(Self { models_dir })
    }

    /// Run speaker diarization on an audio file
    pub async fn diarize_audio(&self, audio_path: &str) -> Result<Vec<SpeakerSegment>> {
        log::info!("Running sherpa-onnx diarization on: {}", audio_path);

        // Check if models exist
        let seg_model_path = self.models_dir.join("segmentation").join("model.onnx");
        let emb_model_path = self.models_dir.join("embedding").join("model.onnx");

        if !seg_model_path.exists() || !emb_model_path.exists() {
            return Err(anyhow!(
                "Diarization models not found. Please download models first."
            ));
        }

        // Load audio file
        let audio_samples = self.load_audio_file(audio_path).await?;
        let sample_rate = 16000; // Sherpa-ONNX expects 16kHz

        // Use sherpa-rs for diarization
        let seg_model_str = seg_model_path.to_string_lossy().to_string();
        let emb_model_str = emb_model_path.to_string_lossy().to_string();

        // Run diarization in blocking task to avoid blocking async runtime
        let segments = tokio::task::spawn_blocking(move || {
            Self::run_diarization_blocking(&seg_model_str, &emb_model_str, audio_samples, sample_rate)
        })
        .await
        .map_err(|e| anyhow!("Diarization task failed: {}", e))??;

        log::info!("Diarization complete: {} segments", segments.len());

        Ok(segments)
    }

    /// Run diarization in blocking context (called from spawn_blocking)
    fn run_diarization_blocking(
        seg_model_path: &str,
        emb_model_path: &str,
        audio_samples: Vec<f32>,
        _sample_rate: i32,
    ) -> Result<Vec<SpeakerSegment>> {
        use sherpa_rs::diarize::{Diarize, DiarizeConfig};

        // Create diarization config
        // Note: Only num_clusters is configurable in sherpa-rs DiarizeConfig
        // Other parameters (threshold, min_duration) are handled internally
        let config = DiarizeConfig {
            num_clusters: None, // Auto-detect number of speakers
            ..Default::default()
        };

        // Create diarization instance
        let mut diarization = Diarize::new(seg_model_path, emb_model_path, config)
            .map_err(|e| anyhow!("Failed to create diarization instance: {}", e))?;

        // Process audio with progress callback
        let progress_callback = |n_computed: i32, n_total: i32| -> i32 {
            if n_total > 0 {
                let progress = (n_computed * 100) / n_total;
                log::debug!("Diarization progress: {}%", progress);
            }
            0 // Return 0 to continue processing
        };

        let segments = diarization
            .compute(audio_samples, Some(Box::new(progress_callback)))
            .map_err(|e| anyhow!("Diarization processing failed: {}", e))?;

        // Convert to our format
        let result: Vec<SpeakerSegment> = segments
            .iter()
            .map(|seg| SpeakerSegment {
                start_ms: (seg.start * 1000.0) as i64,
                end_ms: (seg.end * 1000.0) as i64,
                speaker_id: seg.speaker as u32,
            })
            .collect();

        Ok(result)
    }

    /// Load audio file and convert to mono 16kHz samples
    async fn load_audio_file(&self, audio_path: &str) -> Result<Vec<f32>> {
        use symphonia::core::audio::SampleBuffer;
        use symphonia::core::codecs::DecoderOptions;
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        let path = Path::new(audio_path);
        let file = std::fs::File::open(path)
            .map_err(|e| anyhow!("Failed to open audio file: {}", e))?;

        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = path.extension() {
            hint.with_extension(&ext.to_string_lossy());
        }

        let format_opts = FormatOptions::default();
        let metadata_opts = MetadataOptions::default();
        let decoder_opts = DecoderOptions::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| anyhow!("Failed to probe audio format: {}", e))?;

        let mut format = probed.format;
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
            .ok_or_else(|| anyhow!("No audio track found"))?;

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &decoder_opts)
            .map_err(|e| anyhow!("Failed to create decoder: {}", e))?;

        let track_id = track.id;
        let mut samples = Vec::new();

        // Decode all packets
        loop {
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(symphonia::core::errors::Error::IoError(e))
                    if e.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    break;
                }
                Err(e) => return Err(anyhow!("Failed to read packet: {}", e)),
            };

            if packet.track_id() != track_id {
                continue;
            }

            match decoder.decode(&packet) {
                Ok(decoded) => {
                    let spec = *decoded.spec();
                    let duration = decoded.capacity() as u64;

                    let mut sample_buf = SampleBuffer::<f32>::new(duration, spec);
                    sample_buf.copy_interleaved_ref(decoded);

                    // Convert to mono if needed
                    let channels = spec.channels.count();
                    let channel_samples = sample_buf.samples();

                    if channels == 1 {
                        samples.extend_from_slice(channel_samples);
                    } else {
                        // Average channels to mono
                        for chunk in channel_samples.chunks(channels) {
                            let mono_sample: f32 = chunk.iter().sum::<f32>() / channels as f32;
                            samples.push(mono_sample);
                        }
                    }
                }
                Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
                Err(e) => return Err(anyhow!("Decode error: {}", e)),
            }
        }

        // Resample to 16kHz if needed
        let source_rate = decoder
            .codec_params()
            .sample_rate
            .ok_or_else(|| anyhow!("Unknown sample rate"))?;

        if source_rate != 16000 {
            log::info!("Resampling from {}Hz to 16000Hz", source_rate);
            samples = self.resample_audio(samples, source_rate, 16000)?;
        }

        Ok(samples)
    }

    /// Resample audio to target sample rate
    fn resample_audio(
        &self,
        samples: Vec<f32>,
        source_rate: u32,
        target_rate: u32,
    ) -> Result<Vec<f32>> {
        use rubato::{
            Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType,
            WindowFunction,
        };

        let params = SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.95,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        };

        let mut resampler = SincFixedIn::<f32>::new(
            target_rate as f64 / source_rate as f64,
            2.0,
            params,
            samples.len(),
            1,
        )
        .map_err(|e| anyhow!("Failed to create resampler: {}", e))?;

        let waves_in = vec![samples];
        let waves_out = resampler
            .process(&waves_in, None)
            .map_err(|e| anyhow!("Resampling failed: {}", e))?;

        Ok(waves_out[0].clone())
    }

    /// Check if models are available
    pub async fn models_available(&self) -> bool {
        let seg_path = self.models_dir.join("segmentation").join("model.onnx");
        let emb_path = self.models_dir.join("embedding").join("model.onnx");
        seg_path.exists() && emb_path.exists()
    }

    /// Get models directory
    pub fn get_models_dir(&self) -> &Path {
        &self.models_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_handler_creation() {
        let handler = SherpaDiarizationHandler::new(None);
        assert!(handler.is_ok());
    }
}
