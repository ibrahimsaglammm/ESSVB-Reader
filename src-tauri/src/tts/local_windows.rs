use async_trait::async_trait;
use windows::core::{Result as WinResult, HSTRING};
use windows::Media::SpeechSynthesis::{SpeechSynthesizer, VoiceInformation};
use windows::Storage::Streams::DataReader;

use crate::error::AppError;
use crate::settings::AppSettings;
use crate::tts::provider::{TtsProvider, TtsProviderStatus, TtsRequest};

pub struct LocalWindowsTtsProvider;

fn find_turkish_voice_sync() -> WinResult<Option<(VoiceInformation, String, String)>> {
    let voices = SpeechSynthesizer::AllVoices()?;
    let count = voices.Size()?;
    let mut fallback_tr: Option<(VoiceInformation, String, String)> = None;

    for i in 0..count {
        let v = voices.GetAt(i)?;
        let name = v.DisplayName()?.to_string_lossy();
        let lang = v.Language()?.to_string_lossy();
        let name_lower = name.to_ascii_lowercase();
        let lang_lower = lang.to_ascii_lowercase();

        if name_lower.contains("tolga") {
            return Ok(Some((v, name, lang)));
        }
        if fallback_tr.is_none() && (lang_lower == "tr-tr" || lang_lower.starts_with("tr")) {
            fallback_tr = Some((v, name, lang));
        }
    }

    Ok(fallback_tr)
}

fn synthesize_tolga_sync(text: &str, rate: f32) -> Result<(Vec<u8>, String), AppError> {
    let Some((voice, voice_name, _lang)) = find_turkish_voice_sync()
        .map_err(|e| AppError::Tts(format!("Windows OneCore sesleri sorgulanamadı: {e}")))?
    else {
        return Err(AppError::Tts(
            "Sistemde Türkçe ses (Microsoft Tolga) bulunamadı. Windows Ayarları > Zaman ve Dil > Konuşma bölümünden Türkçe ses paketini yükleyin.".into(),
        ));
    };

    let synth = SpeechSynthesizer::new()
        .map_err(|e| AppError::Tts(format!("WinRT SpeechSynthesizer başlatılamadı: {e}")))?;
    synth
        .SetVoice(&voice)
        .map_err(|e| AppError::Tts(format!("Türkçe ses seçilemedi: {e}")))?;
    if let Ok(opts) = synth.Options() {
        let _ = opts.SetSpeakingRate(f64::from(rate.clamp(0.5, 2.0)));
    }

    let stream = synth
        .SynthesizeTextToStreamAsync(&HSTRING::from(text))
        .map_err(|e| AppError::Tts(format!("Ses sentezi başlatılamadı: {e}")))?
        .get()
        .map_err(|e| AppError::Tts(format!("Ses sentezi başarısız: {e}")))?;

    let size_u64 = stream
        .Size()
        .map_err(|e| AppError::Tts(format!("Ses akış boyutu okunamadı: {e}")))?;
    if size_u64 == 0 || size_u64 > 64 * 1024 * 1024 {
        return Err(AppError::Tts("Üretilen ses verisi geçersiz boyutta".into()));
    }
    let size = size_u64 as u32;

    let input = stream
        .GetInputStreamAt(0)
        .map_err(|e| AppError::Tts(format!("Ses akışı açılamadı: {e}")))?;
    let reader = DataReader::CreateDataReader(&input)
        .map_err(|e| AppError::Tts(format!("DataReader oluşturulamadı: {e}")))?;
    reader
        .LoadAsync(size)
        .map_err(|e| AppError::Tts(format!("Ses verisi yüklenemedi: {e}")))?
        .get()
        .map_err(|e| AppError::Tts(format!("Ses verisi okuma hatası: {e}")))?;

    let mut wav_bytes = vec![0u8; size as usize];
    reader
        .ReadBytes(&mut wav_bytes)
        .map_err(|e| AppError::Tts(format!("Ses tamponu okunamadı: {e}")))?;

    Ok((wav_bytes, voice_name))
}

pub async fn synthesize_windows_offline(
    text: &str,
    rate: f32,
) -> Result<(Vec<u8>, String), AppError> {
    let text_owned = text.to_string();
    tokio::task::spawn_blocking(move || synthesize_tolga_sync(&text_owned, rate))
        .await
        .map_err(|e| AppError::Tts(format!("TTS iş parçacığı hatası: {e}")))?
}

pub fn probe_windows_voice() -> TtsProviderStatus {
    match find_turkish_voice_sync() {
        Ok(Some((_, name, lang))) => TtsProviderStatus {
            provider_id: "local".to_string(),
            available: true,
            voice_name: format!("{name} ({lang})"),
            details: "Windows OneCore çevrimdışı Türkçe TTS hazır".to_string(),
            setup_hint_tr: String::new(),
            setup_hint_en: String::new(),
        },
        Ok(None) => TtsProviderStatus {
            provider_id: "local".to_string(),
            available: false,
            voice_name: String::new(),
            details: "Türkçe OneCore (Microsoft Tolga) sesi bulunamadı".to_string(),
            setup_hint_tr: "Windows 11 Ayarlar > Zaman ve Dil > Konuşma > Ses ekle yolundan Türkçe (Microsoft Tolga) sesini yükleyin.".to_string(),
            setup_hint_en: "Install the Turkish (Microsoft Tolga) voice under Windows 11 Settings > Time & Language > Speech > Add voices.".to_string(),
        },
        Err(e) => TtsProviderStatus {
            provider_id: "local".to_string(),
            available: false,
            voice_name: String::new(),
            details: format!("Ses denetimi başarısız: {e}"),
            setup_hint_tr: "Windows Konuşma çalışma zamanını ve Türkçe ses paketini kontrol edin.".to_string(),
            setup_hint_en: "Verify the Windows Speech runtime and Turkish voice package.".to_string(),
        },
    }
}

#[async_trait]
impl TtsProvider for LocalWindowsTtsProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    async fn status(&self, _settings: &AppSettings) -> TtsProviderStatus {
        tokio::task::spawn_blocking(probe_windows_voice)
            .await
            .unwrap_or_else(|_| TtsProviderStatus {
                provider_id: "local".to_string(),
                available: false,
                voice_name: String::new(),
                details: "Ses durumu denetlenemedi".to_string(),
                setup_hint_tr: "Windows ses ayarlarını kontrol edin.".to_string(),
                setup_hint_en: "Check Windows Speech settings.".to_string(),
            })
    }

    async fn synthesize(&self, req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError> {
        let (wav, voice_name) = synthesize_windows_offline(&req.text, req.rate).await?;
        Ok((wav, voice_name, req.text.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_synthesizes_microsoft_tolga_when_installed() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let status = tokio::task::spawn_blocking(probe_windows_voice)
                .await
                .unwrap();
            if status.available {
                assert!(status.voice_name.to_ascii_lowercase().contains("tr"));
                let (wav, voice) = synthesize_windows_offline("Merhaba ESSVB okuyucu.", 1.0)
                    .await
                    .unwrap();
                assert!(!voice.is_empty());
                assert!(wav.len() > 44);
                assert_eq!(&wav[0..4], b"RIFF");
            }
        });
    }
}
