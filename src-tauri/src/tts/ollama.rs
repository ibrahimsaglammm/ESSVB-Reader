use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::AppError;
use crate::settings::AppSettings;
use crate::tts::provider::{TtsProvider, TtsProviderStatus, TtsRequest};
use crate::tts::synthesize_local_offline;

pub struct OllamaTtsProvider;

#[derive(Debug, Deserialize)]
struct OllamaTagsResponse {
    #[serde(default)]
    models: Vec<OllamaModelItem>,
}

#[derive(Debug, Deserialize)]
struct OllamaModelItem {
    name: String,
}

#[derive(Debug, Serialize)]
struct OllamaGenerateRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResponse {
    #[serde(default)]
    response: String,
}

/// Enforces that Ollama requests can ONLY ever target `localhost`, `127.0.0.1`, or `[::1]`.
pub fn validate_localhost_ollama_url(raw: &str) -> Result<Url, AppError> {
    let parsed = Url::parse(raw.trim())
        .map_err(|e| AppError::Validation(format!("Geçersiz Ollama adresi: {e}")))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::Security(
            "Ollama adresi yalnızca http veya https olabilir".into(),
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Security(
            "Ollama adresinde kimlik bilgisi kullanılamaz".into(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::Security(
            "Ollama adresinde sorgu/parça kullanılamaz".into(),
        ));
    }

    let host = parsed.host_str().unwrap_or("");
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "[::1]"
        || host == "::1";

    if !is_loopback {
        return Err(AppError::Security(format!(
            "Ollama güvenlik politikası gereği yalnızca localhost / 127.0.0.1 adresine bağlanabilir (reddedilen: {host})"
        )));
    }

    Ok(parsed)
}

pub async fn list_ollama_models(base_url: &str) -> Result<Vec<String>, AppError> {
    let mut endpoint = validate_localhost_ollama_url(base_url)?;
    endpoint.set_path("/api/tags");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Tts(format!("Ollama istemcisi oluşturulamadı: {e}")))?;

    let resp = client
        .get(endpoint)
        .send()
        .await
        .map_err(|e| AppError::Tts(format!("Yerel Ollama sunucusuna bağlanılamadı: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Tts(format!(
            "Ollama model listesi alınamadı (HTTP {})",
            resp.status()
        )));
    }

    let parsed: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Tts(format!("Ollama model yanıtı okunamadı: {e}")))?;

    Ok(parsed.models.into_iter().map(|m| m.name).collect())
}

async fn prepare_turkish_pronunciation(
    base_url: &str,
    model: &str,
    text: &str,
) -> Result<String, AppError> {
    let model_trimmed = model.trim();
    if model_trimmed.is_empty() {
        return Err(AppError::Tts(
            "Ollama seçili ancak model adı ayarlanmamış. Ayarlardan bir yerel Ollama modeli seçin."
                .into(),
        ));
    }

    let mut endpoint = validate_localhost_ollama_url(base_url)?;
    endpoint.set_path("/api/generate");

    let prompt = format!(
        "Sen bir Türkçe sesli okuma metin hazırlayıcısısın. Verilen metni anlamını değiştirmeden yalnızca sesli okuma için doğal Türkçe yazıma hazırla (ör. Dr. -> Doktor, vb. -> ve benzeri, %20 -> yüzde yirmi, sayıları/kısaltmaları okunuşa uygun aç). Açıklama ekleme, tırnak koyma, yalnızca hazırlanmış metni döndür.\n\nMetin:\n{text}"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| AppError::Tts(format!("Ollama istemcisi oluşturulamadı: {e}")))?;

    let body = OllamaGenerateRequest {
        model: model_trimmed,
        prompt: &prompt,
        stream: false,
    };

    let resp = client
        .post(endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            AppError::Tts(format!(
                "Ollama isteği başarısız (yerel sunucu çalışıyor mu?): {e}"
            ))
        })?;

    if !resp.status().is_success() {
        return Err(AppError::Tts(format!(
            "Ollama metin hazırlama hatası (HTTP {})",
            resp.status()
        )));
    }

    let parsed: OllamaGenerateResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Tts(format!("Ollama yanıtı ayrıştırılamadı: {e}")))?;

    let prepared = parsed.response.trim();
    if prepared.is_empty() {
        return Err(AppError::Tts("Ollama boş metin döndürdü".into()));
    }

    Ok(prepared.to_string())
}

#[async_trait]
impl TtsProvider for OllamaTtsProvider {
    fn id(&self) -> &'static str {
        "ollama"
    }

    async fn status(&self, settings: &AppSettings) -> TtsProviderStatus {
        match list_ollama_models(&settings.ollama_url).await {
            Ok(models) => {
                let selected_ok = !settings.ollama_model.trim().is_empty()
                    && models.iter().any(|m| m == settings.ollama_model.trim());
                TtsProviderStatus {
                    provider_id: "ollama".to_string(),
                    available: !models.is_empty() && selected_ok,
                    voice_name: if settings.ollama_model.is_empty() {
                        format!("Ollama ({} model bulundu)", models.len())
                    } else {
                        format!("Ollama ({}) + Yerel TTS", settings.ollama_model)
                    },
                    details: if models.is_empty() {
                        "Ollama çalışıyor ancak yüklü model bulunamadı".to_string()
                    } else if !selected_ok {
                        "Ayarlardan yüklü bir Ollama modeli seçin".to_string()
                    } else {
                        "Yerel Ollama Türkçe telaffuz hazırlığı + çevrimdışı ses hazır".to_string()
                    },
                    setup_hint_tr: "Ollama yalnızca localhost üzerinden çalışır; ayarlardan modeli seçin.".to_string(),
                    setup_hint_en: "Ollama runs strictly on localhost; select an installed model in Settings.".to_string(),
                }
            }
            Err(e) => TtsProviderStatus {
                provider_id: "ollama".to_string(),
                available: false,
                voice_name: String::new(),
                details: e.to_string(),
                setup_hint_tr: "Yerel makinede Ollama'nın http://127.0.0.1:11434 adresinde çalıştığından emin olun.".to_string(),
                setup_hint_en: "Ensure local Ollama is running on http://127.0.0.1:11434.".to_string(),
            },
        }
    }

    async fn synthesize(&self, req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError> {
        let prepared = prepare_turkish_pronunciation(
            &req.settings.ollama_url,
            &req.settings.ollama_model,
            &req.text,
        )
        .await?;
        let (wav, local_voice) =
            synthesize_local_offline(&prepared, req.rate, &req.settings).await?;
        Ok((
            wav,
            format!("Ollama [{}] -> {local_voice}", req.settings.ollama_model),
            prepared,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_localhost_only_ollama_urls() {
        assert!(validate_localhost_ollama_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_localhost_ollama_url("http://localhost:11434").is_ok());
        assert!(validate_localhost_ollama_url("http://[::1]:11434").is_ok());

        assert!(validate_localhost_ollama_url("https://api.openai.com").is_err());
        assert!(validate_localhost_ollama_url("http://192.168.1.50:11434").is_err());
        assert!(validate_localhost_ollama_url("http://localhost@evil.com:11434").is_err());
        assert!(validate_localhost_ollama_url("file:///etc/passwd").is_err());
    }
}
