// Model download and management for sherpa-onnx diarization models
// Handles downloading segmentation and embedding models from Hugging Face

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::{AsyncWriteExt, BufWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiarizationModelInfo {
    pub name: String,
    pub model_type: String, // "segmentation" or "embedding"
    pub size_mb: u32,
    pub status: ModelStatus,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
    pub percent: u8,
}

pub struct DiarizationModelManager {
    models_dir: PathBuf,
}

impl DiarizationModelManager {
    pub fn new(models_dir: PathBuf) -> Self {
        Self { models_dir }
    }

    /// Get available diarization models
    pub async fn get_models(&self) -> Result<Vec<DiarizationModelInfo>> {
        let mut models = Vec::new();

        // Segmentation model (pyannote-based)
        let seg_path = self.models_dir.join("segmentation").join("model.onnx");
        let seg_status = if seg_path.exists() {
            ModelStatus::Available
        } else {
            ModelStatus::Missing
        };

        models.push(DiarizationModelInfo {
            name: "pyannote-segmentation-3.0".to_string(),
            model_type: "segmentation".to_string(),
            size_mb: 6, // ~5.7 MB for model.onnx (archive is ~17 MB total)
            status: seg_status,
            description: "Speaker segmentation model (pyannote 3.0)".to_string(),
        });

        // Embedding model (3D-Speaker)
        let emb_path = self.models_dir.join("embedding").join("model.onnx");
        let emb_status = if emb_path.exists() {
            ModelStatus::Available
        } else {
            ModelStatus::Missing
        };

        models.push(DiarizationModelInfo {
            name: "3dspeaker-eres2net-base".to_string(),
            model_type: "embedding".to_string(),
            size_mb: 42, // ~42 MB direct download
            status: emb_status,
            description: "Speaker embedding model (3D-Speaker eres2net)".to_string(),
        });

        Ok(models)
    }

    /// Download segmentation model
    pub async fn download_segmentation_model(
        &self,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        // Download tar.bz2 archive
        let url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2";
        let dest_dir = self.models_dir.join("segmentation");
        let archive_path = dest_dir.join("model.tar.bz2");
        let model_path = dest_dir.join("model.onnx");

        // Download archive
        self.download_file(url, &archive_path, progress_callback).await?;

        // Extract model.onnx from archive
        log::info!("Extracting segmentation model from archive...");
        self.extract_model_from_archive(&archive_path, &model_path, "sherpa-onnx-pyannote-segmentation-3-0/model.onnx").await?;

        // Clean up archive
        if archive_path.exists() {
            fs::remove_file(&archive_path).await?;
            log::info!("Cleaned up archive file");
        }

        Ok(())
    }

    /// Download embedding model
    pub async fn download_embedding_model(
        &self,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        // This is a direct .onnx file download
        let url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx";
        let dest_dir = self.models_dir.join("embedding");
        let dest_path = dest_dir.join("model.onnx");

        self.download_file(url, &dest_path, progress_callback).await
    }

    /// Download both models
    pub async fn download_all_models(
        &self,
        progress_callback: Option<Arc<dyn Fn(String, DownloadProgress) + Send + Sync>>,
    ) -> Result<()> {
        log::info!("Downloading diarization models...");

        // Download segmentation model
        if let Some(cb) = progress_callback.as_ref() {
            let cb_clone = Arc::clone(cb);
            let seg_cb: Box<dyn Fn(DownloadProgress) + Send> = Box::new(move |p: DownloadProgress| {
                cb_clone("segmentation".to_string(), p);
            });
            self.download_segmentation_model(Some(seg_cb)).await?;
        } else {
            self.download_segmentation_model(None).await?;
        }

        // Download embedding model
        if let Some(cb) = progress_callback.as_ref() {
            let cb_clone = Arc::clone(cb);
            let emb_cb: Box<dyn Fn(DownloadProgress) + Send> = Box::new(move |p: DownloadProgress| {
                cb_clone("embedding".to_string(), p);
            });
            self.download_embedding_model(Some(emb_cb)).await?;
        } else {
            self.download_embedding_model(None).await?;
        }

        log::info!("All diarization models downloaded successfully");
        Ok(())
    }

    /// Download a file with progress tracking
    async fn download_file(
        &self,
        url: &str,
        dest_path: &Path,
        progress_callback: Option<Box<dyn Fn(DownloadProgress) + Send>>,
    ) -> Result<()> {
        log::info!("Downloading from {} to {}", url, dest_path.display());

        // Create parent directory
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Create HTTP client
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(600))
            .build()?;

        // Start download
        let response = client.get(url).send().await?;

        if !response.status().is_success() {
            return Err(anyhow!("HTTP error: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        let total_mb = total_size as f64 / (1024.0 * 1024.0);

        log::info!("Download size: {:.2} MB", total_mb);

        // Create file
        let file = fs::File::create(dest_path).await?;
        let mut writer = BufWriter::new(file);

        // Download with progress
        let mut downloaded: u64 = 0;
        let start_time = Instant::now();
        let mut last_report = Instant::now();

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            writer.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            // Report progress every 500ms
            if last_report.elapsed() > Duration::from_millis(500) {
                let elapsed = start_time.elapsed().as_secs_f64();
                let speed_mbps = if elapsed > 0.0 {
                    (downloaded as f64 / (1024.0 * 1024.0)) / elapsed
                } else {
                    0.0
                };

                let progress = DownloadProgress {
                    downloaded_mb: downloaded as f64 / (1024.0 * 1024.0),
                    total_mb,
                    speed_mbps,
                    percent: if total_size > 0 {
                        ((downloaded as f64 / total_size as f64) * 100.0) as u8
                    } else {
                        0
                    },
                };

                if let Some(ref cb) = progress_callback {
                    cb(progress);
                }

                last_report = Instant::now();
            }
        }

        writer.flush().await?;

        // Final progress report
        if let Some(ref cb) = progress_callback {
            cb(DownloadProgress {
                downloaded_mb: total_mb,
                total_mb,
                speed_mbps: 0.0,
                percent: 100,
            });
        }

        log::info!("Download complete: {}", dest_path.display());
        Ok(())
    }

    /// Delete a model
    pub async fn delete_model(&self, model_type: &str) -> Result<()> {
        let model_dir = self.models_dir.join(model_type);
        if model_dir.exists() {
            fs::remove_dir_all(&model_dir).await?;
            log::info!("Deleted {} model", model_type);
        }
        Ok(())
    }

    /// Extract model.onnx from tar.bz2 archive
    async fn extract_model_from_archive(
        &self,
        archive_path: &Path,
        output_path: &Path,
        model_path_in_archive: &str,
    ) -> Result<()> {
        use bzip2::read::BzDecoder;
        use tar::Archive;

        log::info!("Extracting {} from archive...", model_path_in_archive);

        // Read archive file
        let archive_file = std::fs::File::open(archive_path)
            .map_err(|e| anyhow!("Failed to open archive: {}", e))?;

        // Decompress bzip2
        let decompressor = BzDecoder::new(archive_file);

        // Create tar archive reader
        let mut archive = Archive::new(decompressor);

        // Find and extract the specific file
        let mut found = false;
        for entry_result in archive.entries()? {
            let mut entry = entry_result?;
            let path = entry.path()?;
            
            if path.to_string_lossy() == model_path_in_archive {
                log::info!("Found model file in archive: {}", path.display());
                
                // Create output directory if needed
                if let Some(parent) = output_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }

                // Extract to output path
                let mut output_file = std::fs::File::create(output_path)?;
                std::io::copy(&mut entry, &mut output_file)?;
                
                found = true;
                log::info!("Extracted model to: {}", output_path.display());
                break;
            }
        }

        if !found {
            return Err(anyhow!(
                "Model file '{}' not found in archive",
                model_path_in_archive
            ));
        }

        Ok(())
    }
}
