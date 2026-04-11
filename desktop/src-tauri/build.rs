#[path = "build/ffmpeg.rs"]
mod ffmpeg;

fn main() {
    if let Err(error) = try_main() {
        println!("cargo:warning={error}");
        std::process::exit(1);
    }
}

fn try_main() -> Result<(), String> {
    emit_build_feature_note();

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    ffmpeg::ensure_ffmpeg_binary()?;

    tauri_build::build();
    Ok(())
}

fn emit_build_feature_note() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    match target_os.as_str() {
        "macos" => {
            #[cfg(feature = "coreml")]
            println!("cargo:warning=macOS build: CoreML feature enabled");
        }
        "windows" => {
            if cfg!(feature = "cuda") {
                println!("cargo:warning=Windows build: CUDA feature enabled");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=Windows build: Vulkan feature enabled");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=Windows build: OpenBLAS feature enabled");
            }
        }
        "linux" => {
            if cfg!(feature = "cuda") {
                println!("cargo:warning=Linux build: CUDA feature enabled");
            } else if cfg!(feature = "vulkan") {
                println!("cargo:warning=Linux build: Vulkan feature enabled");
            } else if cfg!(feature = "hipblas") {
                println!("cargo:warning=Linux build: HIPBLAS feature enabled");
            } else if cfg!(feature = "openblas") {
                println!("cargo:warning=Linux build: OpenBLAS feature enabled");
            }
        }
        _ => {}
    }
}
