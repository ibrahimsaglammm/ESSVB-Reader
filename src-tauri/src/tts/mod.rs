pub mod cache;
pub mod chunker;
pub mod gemini;
#[cfg(target_os = "linux")]
pub mod local_linux;
#[cfg(windows)]
pub mod local_windows;
pub mod ollama;
pub mod provider;

use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;

use crate::error::AppError;
use crate::settings::AppSettings;
use crate::tts::cache::{TtsCacheStats, TtsDiskCache};
use crate::tts::gemini::GeminiTtsProvider;
use crate::tts::ollama::OllamaTtsProvider;
use crate::tts::provider::{TtsProvider, TtsProviderStatus, TtsRequest, TtsSynthesisResponse};

#[cfg(target_os = "linux")]
use crate::tts::local_linux::{synthesize_linux_offline, LocalLinuxTtsProvider};
#[cfg(windows)]
use crate::tts::local_windows::{synthesize_windows_offline, LocalWindowsTtsProvider};

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct LocalMobileTtsProvider;

#[cfg(any(target_os = "android", target_os = "ios"))]
#[async_trait::async_trait]
impl TtsProvider for LocalMobileTtsProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    async fn status(&self, _settings: &AppSettings) -> TtsProviderStatus {
        let voice_name = if cfg!(target_os = "android") {
            "Android TTS (Türkçe)"
        } else {
            "iOS AVSpeechSynthesizer (Türkçe)"
        };
        TtsProviderStatus {
            provider_id: "local".to_string(),
            available: true,
            voice_name: voice_name.to_string(),
            details: "Cihaz içi yerleşik çevrimdışı konuşma motoru hazır".to_string(),
            setup_hint_tr: "Cihaz ayarlarından çevrimdışı Türkçe ses paketini yönetebilirsiniz."
                .to_string(),
            setup_hint_en: "Manage offline Turkish voices in device accessibility/speech settings."
                .to_string(),
        }
    }

    async fn synthesize(&self, _req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError> {
        Err(AppError::Tts(
            "Mobil platformlarda sesli okuma doğrudan yerel sistem eklentisi üzerinden yürütülür."
                .into(),
        ))
    }
}

pub async fn synthesize_local_offline(
    text: &str,
    rate: f32,
    settings: &AppSettings,
) -> Result<(Vec<u8>, String), AppError> {
    #[cfg(windows)]
    {
        let _ = settings;
        return synthesize_windows_offline(text, rate).await;
    }
    #[cfg(target_os = "linux")]
    {
        return synthesize_linux_offline(text, rate, settings).await;
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (text, rate, settings);
        Err(AppError::Tts(
            "Bu platform için yerleşik çevrimdışı TTS sağlayıcısı uygulanmadı".into(),
        ))
    }
}

pub struct TtsManager {
    cache: TtsDiskCache,
}

impl TtsManager {
    pub fn new(cache_dir: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            cache: TtsDiskCache::new(cache_dir)?,
        })
    }

    fn select_provider(provider_id: &str) -> Result<Box<dyn TtsProvider>, AppError> {
        match provider_id {
            "local" => {
                #[cfg(windows)]
                {
                    Ok(Box::new(LocalWindowsTtsProvider))
                }
                #[cfg(target_os = "linux")]
                {
                    Ok(Box::new(LocalLinuxTtsProvider))
                }
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    Ok(Box::new(LocalMobileTtsProvider))
                }
                #[cfg(not(any(
                    windows,
                    target_os = "linux",
                    target_os = "android",
                    target_os = "ios"
                )))]
                {
                    Err(AppError::Tts(
                        "Yerel TTS bu platformda desteklenmiyor".into(),
                    ))
                }
            }
            "ollama" => Ok(Box::new(OllamaTtsProvider)),
            "gemini" => Ok(Box::new(GeminiTtsProvider)),
            other => Err(AppError::Validation(format!(
                "Bilinmeyen TTS sağlayıcısı: {other}"
            ))),
        }
    }

    pub async fn all_statuses(&self, settings: &AppSettings) -> Vec<TtsProviderStatus> {
        let mut out = Vec::new();
        for id in ["local", "ollama", "gemini"] {
            if let Ok(p) = Self::select_provider(id) {
                out.push(p.status(settings).await);
            }
        }
        out
    }

    /// Synthesizes text strictly via the selected provider. NEVER silently falls back
    /// to another provider (especially cloud providers) if the selected provider fails.
    pub async fn synthesize(
        &self,
        text: &str,
        settings: &AppSettings,
        rate_override: Option<f32>,
    ) -> Result<TtsSynthesisResponse, AppError> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation("Seslendirilecek metin boş".into()));
        }
        if trimmed.chars().count() > 2_000 {
            return Err(AppError::Validation(
                "Tek TTS parçasında maksimum 2000 karakter işlenebilir".into(),
            ));
        }

        let provider = Self::select_provider(&settings.tts_provider)?;
        let rate = rate_override.unwrap_or(settings.tts_rate).clamp(0.5, 2.0);
        let voice_discriminator = match provider.id() {
            "ollama" => format!("ollama:{}", settings.ollama_model),
            "gemini" => format!("gemini:{}:{}", settings.gemini_model, settings.gemini_voice),
            _ => "local".to_string(),
        };

        let cache_key = TtsDiskCache::cache_key(provider.id(), &voice_discriminator, rate, trimmed);
        let max_bytes = u64::from(settings.tts_cache_max_mb) * 1024 * 1024;

        // Only serve from cache when Gemini gate is still satisfied if Gemini is active
        if provider.id() == "gemini" && !settings.gemini_tts_enabled {
            return Err(AppError::NetworkDisabled(
                "Gemini TTS kapalı. Ayarlardan açıkça etkinleştirin.".into(),
            ));
        }

        if let Some(cached_wav) = self.cache.get(&cache_key)? {
            return Ok(TtsSynthesisResponse {
                audio_base64: BASE64_STANDARD.encode(cached_wav),
                mime_type: "audio/wav".to_string(),
                provider_id: provider.id().to_string(),
                voice_name: format!("{} (Önbellek)", voice_discriminator),
                from_cache: true,
                prepared_text: trimmed.to_string(),
            });
        }

        let req = TtsRequest {
            text: trimmed.to_string(),
            rate,
            settings: settings.clone(),
        };

        // Strict dispatch: on failure, propagate error immediately with ZERO automatic fallback.
        let (wav_bytes, voice_name, prepared_text) = provider.synthesize(&req).await?;
        self.cache.put(&cache_key, &wav_bytes, max_bytes)?;

        Ok(TtsSynthesisResponse {
            audio_base64: BASE64_STANDARD.encode(wav_bytes),
            mime_type: "audio/wav".to_string(),
            provider_id: provider.id().to_string(),
            voice_name,
            from_cache: false,
            prepared_text,
        })
    }

    pub fn cache_stats(&self, settings: &AppSettings) -> Result<TtsCacheStats, AppError> {
        let max_bytes = u64::from(settings.tts_cache_max_mb) * 1024 * 1024;
        self.cache.stats(max_bytes)
    }

    pub fn clear_cache(&self) -> Result<usize, AppError> {
        self.cache.clear()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn does_not_fallback_when_selected_provider_fails() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let dir = TempDir::new().unwrap();
            let mgr = TtsManager::new(dir.path().to_path_buf()).unwrap();
            // Force Ollama on unreachable port with no model -> must return error, NOT fallback to local/gemini
            let settings = AppSettings {
                tts_provider: "ollama".to_string(),
                ollama_url: "http://127.0.0.1:59999".to_string(),
                ollama_model: String::new(),
                ..AppSettings::default()
            };

            let err = mgr
                .synthesize("Test cümlesi.", &settings, None)
                .await
                .unwrap_err();
            assert_eq!(err.code(), "TTS_ERROR");
        });
    }
}
