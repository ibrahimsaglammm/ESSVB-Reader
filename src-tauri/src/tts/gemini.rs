use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::settings::secrets::{has_gemini_api_key, load_gemini_api_key_internal};
use crate::settings::AppSettings;
use crate::tts::provider::{TtsProvider, TtsProviderStatus, TtsRequest};

pub struct GeminiTtsProvider;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRequest<'a> {
    contents: Vec<GeminiContent<'a>>,
    generation_config: GeminiGenerationConfig<'a>,
}

#[derive(Debug, Serialize)]
struct GeminiContent<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiGenerationConfig<'a> {
    response_modalities: [&'static str; 1],
    speech_config: GeminiSpeechConfig<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiSpeechConfig<'a> {
    voice_config: GeminiVoiceConfig<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiVoiceConfig<'a> {
    prebuilt_voice_config: GeminiPrebuiltVoice<'a>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiPrebuiltVoice<'a> {
    voice_name: &'a str,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiRespContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiRespContent {
    #[serde(default)]
    parts: Vec<GeminiRespPart>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiRespPart {
    inline_data: Option<GeminiInlineData>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiInlineData {
    mime_type: String,
    data: String,
}

fn validate_model_id(model: &str) -> Result<&str, AppError> {
    let trimmed = model.trim();
    if trimmed.is_empty()
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
    {
        return Err(AppError::Validation("Geçersiz Gemini model adı".into()));
    }
    Ok(trimmed)
}

/// Converts raw signed 16-bit little-endian mono PCM bytes to a standard RIFF WAV container.
pub fn pcm_l16_to_wav(pcm_bytes: &[u8], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * u32::from(num_channels) * u32::from(bits_per_sample) / 8;
    let block_align = num_channels * bits_per_sample / 8;
    let data_size = pcm_bytes.len() as u32;
    let chunk_size = 36u32.saturating_add(data_size);

    let mut wav = Vec::with_capacity(44 + pcm_bytes.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&chunk_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&num_channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits_per_sample.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(pcm_bytes);
    wav
}

fn parse_sample_rate(mime_type: &str) -> u32 {
    for part in mime_type.split(';') {
        let trimmed = part.trim();
        if let Some(val) = trimmed.strip_prefix("rate=") {
            if let Ok(r) = val.trim().parse::<u32>() {
                if (8_000..=96_000).contains(&r) {
                    return r;
                }
            }
        }
    }
    24_000
}

#[async_trait]
impl TtsProvider for GeminiTtsProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    async fn status(&self, settings: &AppSettings) -> TtsProviderStatus {
        let has_key = has_gemini_api_key().unwrap_or(false);
        let ready = settings.gemini_tts_enabled && has_key;
        TtsProviderStatus {
            provider_id: "gemini".to_string(),
            available: ready,
            voice_name: format!("Gemini ({} / {})", settings.gemini_model, settings.gemini_voice),
            details: if !settings.gemini_tts_enabled {
                "Gizlilik politikası gereği kapalı (ayarlardan açıkça etkinleştirin)".to_string()
            } else if !has_key {
                "OS anahtar deposunda Gemini API anahtarı yok".to_string()
            } else {
                "Etkin — yalnızca kullanıcı sesli okuma başlattığında Google Gemini'ye gönderilir".to_string()
            },
            setup_hint_tr: "Ayarlar > Sesli Okuma altından Gemini TTS onayını açın ve API anahtarını işletim sistemi anahtar deposuna kaydedin.".to_string(),
            setup_hint_en: "Enable Gemini TTS consent under Settings > Speech and store your API key in the OS keyring.".to_string(),
        }
    }

    async fn synthesize(&self, req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError> {
        if !req.settings.gemini_tts_enabled {
            return Err(AppError::NetworkDisabled(
                "Gemini TTS kapalı. Gizlilik gereği ayarlardan açıkça etkinleştirilmeden buluta metin gönderilemez.".into(),
            ));
        }

        let api_key = load_gemini_api_key_internal()?.ok_or_else(|| {
            AppError::Tts(
                "İşletim sistemi anahtar deposunda Gemini API anahtarı bulunamadı.".into(),
            )
        })?;
        let model = validate_model_id(&req.settings.gemini_model)?;
        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        );

        let prompt = format!("Türkçe doğal tonlama ile oku: {}", req.text);
        let body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: &prompt }],
            }],
            generation_config: GeminiGenerationConfig {
                response_modalities: ["AUDIO"],
                speech_config: GeminiSpeechConfig {
                    voice_config: GeminiVoiceConfig {
                        prebuilt_voice_config: GeminiPrebuiltVoice {
                            voice_name: &req.settings.gemini_voice,
                        },
                    },
                },
            },
        };

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Network(format!("Gemini HTTP istemcisi başlatılamadı: {e}")))?;

        let resp = client
            .post(endpoint)
            .header("x-goog-api-key", api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Network(format!("Gemini TTS isteği başarısız: {e}")))?;

        if !resp.status().is_success() {
            return Err(AppError::Network(format!(
                "Gemini TTS API hatası (HTTP {})",
                resp.status()
            )));
        }

        let parsed: GeminiResponse = resp
            .json()
            .await
            .map_err(|e| AppError::Network(format!("Gemini TTS yanıtı ayrıştırılamadı: {e}")))?;

        let inline = parsed
            .candidates
            .into_iter()
            .filter_map(|c| c.content)
            .flat_map(|c| c.parts)
            .find_map(|p| p.inline_data)
            .ok_or_else(|| AppError::Tts("Gemini yanıtında ses verisi bulunamadı".into()))?;

        let raw_audio = BASE64_STANDARD
            .decode(inline.data.as_bytes())
            .map_err(|e| AppError::Tts(format!("Gemini ses base64 çözülemedi: {e}")))?;

        let mime_lower = inline.mime_type.to_ascii_lowercase();
        let wav_bytes = if mime_lower.contains("wav") {
            raw_audio
        } else {
            let rate = parse_sample_rate(&inline.mime_type);
            pcm_l16_to_wav(&raw_audio, rate)
        };

        Ok((
            wav_bytes,
            format!("Gemini ({}/{})", model, req.settings.gemini_voice),
            req.text.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_gemini_when_disabled_in_settings() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let provider = GeminiTtsProvider;
            let settings = AppSettings {
                gemini_tts_enabled: false,
                ..AppSettings::default()
            };
            let err = provider
                .synthesize(&TtsRequest {
                    text: "Deneme".into(),
                    rate: 1.0,
                    settings,
                })
                .await
                .unwrap_err();
            assert_eq!(err.code(), "NETWORK_DISABLED");
        });
    }

    #[test]
    fn converts_pcm_l16_to_valid_wav_header() {
        let pcm = vec![0u8; 4800];
        let wav = pcm_l16_to_wav(&pcm, 24000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + 4800);
    }
}
