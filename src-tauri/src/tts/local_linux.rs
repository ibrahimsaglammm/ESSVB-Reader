use std::path::{Path, PathBuf};
use std::process::Stdio;

use async_trait::async_trait;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::settings::AppSettings;
use crate::tts::provider::{TtsProvider, TtsProviderStatus, TtsRequest};

pub struct LocalLinuxTtsProvider;

fn find_in_path(bin: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn find_piper_binary() -> Option<PathBuf> {
    find_in_path("piper").or_else(|| find_in_path("piper-tts"))
}

fn find_turkish_piper_model(configured_path: &str) -> Option<PathBuf> {
    if !configured_path.trim().is_empty() {
        let p = PathBuf::from(configured_path.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    let voices_dir = data_home.join("essvb-reader/voices");
    if let Ok(entries) = std::fs::read_dir(voices_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("onnx") {
                return Some(p);
            }
        }
    }
    None
}

pub async fn synthesize_linux_offline(
    text: &str,
    rate: f32,
    settings: &AppSettings,
) -> Result<(Vec<u8>, String), AppError> {
    // 1. Prefer Piper ONNX neural Turkish model if binary & model exist
    if let (Some(piper_bin), Some(model_path)) = (
        find_piper_binary(),
        find_turkish_piper_model(&settings.linux_piper_model_path),
    ) {
        let wav = run_piper(&piper_bin, &model_path, text, rate).await?;
        let model_name = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("piper-tr")
            .to_string();
        return Ok((wav, format!("Piper ({model_name})")));
    }

    // 2. Fallback to espeak-ng Turkish voice (strictly direct exec without shell)
    if let Some(espeak_bin) = find_in_path("espeak-ng") {
        let wav = run_espeak(&espeak_bin, text, rate).await?;
        return Ok((wav, "eSpeak-NG (tr)".to_string()));
    }

    Err(AppError::Tts(
        "Yerel Türkçe ses motoru (piper veya espeak-ng) bulunamadı. CachyOS/Arch Linux'ta 'sudo pacman -S espeak-ng' komutunu veya AUR üzerinden piper-tts-bin + tr_TR ONNX modelini kurun.".into(),
    ))
}

async fn run_piper(
    bin: &Path,
    model_path: &Path,
    text: &str,
    rate: f32,
) -> Result<Vec<u8>, AppError> {
    let tmp = std::env::temp_dir().join(format!("essvb-tts-{}.wav", uuid::Uuid::new_v4()));
    let length_scale = (1.0 / rate.clamp(0.5, 2.0)).to_string();

    let mut child = Command::new(bin)
        .arg("--model")
        .arg(model_path)
        .arg("--length_scale")
        .arg(&length_scale)
        .arg("--output_file")
        .arg(&tmp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Tts(format!("Piper çalıştırılamadı: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| AppError::Tts(format!("Piper girişine yazılamadı: {e}")))?;
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Tts(format!("Piper işlemi beklenemedi: {e}")))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Tts(format!(
            "Piper hatası: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    let bytes = std::fs::read(&tmp)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(bytes)
}

async fn run_espeak(bin: &Path, text: &str, rate: f32) -> Result<Vec<u8>, AppError> {
    let wpm = ((165.0 * rate.clamp(0.5, 2.0)).round() as u32).to_string();
    let mut child = Command::new(bin)
        .arg("-v")
        .arg("tr")
        .arg("-s")
        .arg(&wpm)
        .arg("--stdin")
        .arg("--stdout")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Tts(format!("espeak-ng çalıştırılamadı: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| AppError::Tts(format!("espeak-ng girişine yazılamadı: {e}")))?;
        drop(stdin);
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Tts(format!("espeak-ng işlemi beklenemedi: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Tts(format!(
            "espeak-ng hatası: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(output.stdout)
}

#[async_trait]
impl TtsProvider for LocalLinuxTtsProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    async fn status(&self, settings: &AppSettings) -> TtsProviderStatus {
        let has_piper = find_piper_binary().is_some()
            && find_turkish_piper_model(&settings.linux_piper_model_path).is_some();
        let has_espeak = find_in_path("espeak-ng").is_some();

        if has_piper {
            TtsProviderStatus {
                provider_id: "local".to_string(),
                available: true,
                voice_name: "Piper Türkçe (ONNX)".to_string(),
                details: "Yerel Piper nöral Türkçe TTS hazır".to_string(),
                setup_hint_tr: String::new(),
                setup_hint_en: String::new(),
            }
        } else if has_espeak {
            TtsProviderStatus {
                provider_id: "local".to_string(),
                available: true,
                voice_name: "eSpeak-NG (tr)".to_string(),
                details: "Yerel eSpeak-NG Türkçe TTS hazır (daha doğal ses için Piper Türkçe ONNX modeli önerilir)".to_string(),
                setup_hint_tr: "Daha doğal ses için AUR'dan piper-tts-bin ve Türkçe .onnx modeli kurup ayardan yolunu seçebilirsiniz.".to_string(),
                setup_hint_en: "For more natural speech, install piper-tts-bin from AUR with a Turkish .onnx model.".to_string(),
            }
        } else {
            TtsProviderStatus {
                provider_id: "local".to_string(),
                available: false,
                voice_name: String::new(),
                details: "Linux yerel Türkçe TTS motoru bulunamadı".to_string(),
                setup_hint_tr: "CachyOS / Arch Linux'ta kurulum: sudo pacman -S espeak-ng  (veya AUR: paru -S piper-tts-bin + Türkçe .onnx modelini ~/.local/share/essvb-reader/voices/ altına koyun).".to_string(),
                setup_hint_en: "Install on CachyOS / Arch Linux: sudo pacman -S espeak-ng (or AUR piper-tts-bin with a Turkish .onnx model in ~/.local/share/essvb-reader/voices/).".to_string(),
            }
        }
    }

    async fn synthesize(&self, req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError> {
        let (wav, voice_name) =
            synthesize_linux_offline(&req.text, req.rate, &req.settings).await?;
        Ok((wav, voice_name, req.text.clone()))
    }
}
