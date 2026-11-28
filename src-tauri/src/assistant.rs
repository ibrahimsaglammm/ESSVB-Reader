#[cfg(any(windows, target_os = "linux", target_os = "macos"))]
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::AppError;
use crate::settings::secrets::load_gemini_api_key_internal;
use crate::settings::AppSettings;
use crate::tts::ollama::validate_localhost_ollama_url;

const MAX_ASSIST_TEXT_CHARS: usize = 4_000;
const MAX_PROMPT_CHARS: usize = 500;
const GEMINI_TEXT_MODEL: &str = "gemini-2.5-flash";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAssistRequest {
    pub mode: String,
    pub text: String,
    #[serde(default)]
    pub target_lang: Option<String>,
    #[serde(default)]
    pub user_prompt: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub cloud_confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAssistResponse {
    pub provider_used: String,
    pub model: String,
    pub result: String,
}

#[derive(Debug, Serialize)]
struct OllamaGenerateReq<'a> {
    model: &'a str,
    prompt: &'a str,
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct OllamaGenerateResp {
    #[serde(default)]
    response: String,
}

#[derive(Debug, Serialize)]
struct GeminiTextReq<'a> {
    contents: Vec<GeminiTextContent<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiTextContent<'a> {
    parts: Vec<GeminiTextPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiTextPart<'a> {
    text: &'a str,
}

#[derive(Debug, Deserialize)]
struct GeminiTextResp {
    #[serde(default)]
    candidates: Vec<GeminiTextCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiTextCandidate {
    content: Option<GeminiTextCandidateContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiTextCandidateContent {
    #[serde(default)]
    parts: Vec<GeminiTextRespPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiTextRespPart {
    #[serde(default)]
    text: Option<String>,
}

/// Validates and executes translation, dictionary lookup, or Q&A strictly via explicit local
/// Ollama (`localhost`) or user-enabled & explicitly confirmed Google Gemini API.
pub async fn assist_selected_text(
    settings: &AppSettings,
    req: &TextAssistRequest,
) -> Result<TextAssistResponse, AppError> {
    let mode = req.mode.trim();
    if !matches!(mode, "translate" | "dictionary" | "ask") {
        return Err(AppError::Validation(format!(
            "Desteklenmeyen metin yardımcı modu: {mode}"
        )));
    }

    let trimmed_text = req.text.trim();
    if trimmed_text.is_empty() {
        return Err(AppError::Validation(
            "İşlenecek metin boş olamaz".to_string(),
        ));
    }

    let clipped_text: String = trimmed_text.chars().take(MAX_ASSIST_TEXT_CHARS).collect();
    let provider = resolve_assist_provider(settings, req.provider.as_deref())?;
    let prompt = build_assist_prompt(
        mode,
        &clipped_text,
        req.target_lang.as_deref(),
        req.user_prompt.as_deref(),
    );

    match provider {
        "ollama" => call_ollama_assist(settings, &prompt).await,
        "gemini" => call_gemini_assist(settings, req.cloud_confirmed, &prompt).await,
        _ => Err(AppError::Validation(
            "Geçersiz yapay zekâ sağlayıcısı".into(),
        )),
    }
}

fn resolve_assist_provider(
    settings: &AppSettings,
    requested: Option<&str>,
) -> Result<&'static str, AppError> {
    if let Some(raw) = requested.map(str::trim).filter(|s| !s.is_empty()) {
        return match raw {
            "ollama" => Ok("ollama"),
            "gemini" => Ok("gemini"),
            _ => Err(AppError::Validation(format!("Bilinmeyen sağlayıcı: {raw}"))),
        };
    }

    if !settings.ollama_model.trim().is_empty() {
        Ok("ollama")
    } else if settings.gemini_tts_enabled {
        Ok("gemini")
    } else {
        Err(AppError::Validation(
            "Çeviri, Sözlük veya AI yanıtı için Ayarlar > Sesli Okuma bölümünden yerel bir Ollama modeli seçin ya da isteğe bağlı Gemini seçeneğini etkinleştirin."
                .to_string(),
        ))
    }
}

fn build_assist_prompt(
    mode: &str,
    text: &str,
    target_lang: Option<&str>,
    user_prompt: Option<&str>,
) -> String {
    match mode {
        "translate" => {
            let lang_label = match target_lang.unwrap_or("tr").trim() {
                "en" => "İngilizce (English)",
                "de" => "Almanca (German)",
                "fr" => "Fransızca (French)",
                "ar" => "Arapça (Arabic)",
                _ => "Türkçe",
            };
            format!(
                "Aşağıdaki alıntıyı anlamını ve üslubunu koruyarak {lang_label} diline doğal şekilde çevir. Yalnızca çeviriyi döndür:\n\n{text}"
            )
        }
        "dictionary" => format!(
            "Aşağıdaki sözcük veya kısa ifadeyi Türkçe sözlük formatında açıkla (kısa tanım, tür, varsa eş anlamlısı ve 1 kısa örnek cümle):\n\n{text}"
        ),
        _ => {
            let question: String = user_prompt
                .unwrap_or("Bu pasajı açık ve anlaşılır şekilde özetle ve ana fikrini anlat.")
                .trim()
                .chars()
                .take(MAX_PROMPT_CHARS)
                .collect();
            let q = if question.is_empty() {
                "Bu pasajı açık ve anlaşılır şekilde özetle ve ana fikrini anlat."
            } else {
                question.as_str()
            };
            format!(
                "Okunan kitaptan seçilen metin:\n\"\"\"\n{text}\n\"\"\"\n\nKullanıcı sorusu: {q}\n\nYanıtı Türkçe olarak net ve öz ver."
            )
        }
    }
}

async fn call_ollama_assist(
    settings: &AppSettings,
    prompt: &str,
) -> Result<TextAssistResponse, AppError> {
    let model = settings.ollama_model.trim();
    if model.is_empty() {
        return Err(AppError::Validation(
            "Yerel Ollama modeli seçilmemiş. Ayarlar > Sesli Okuma altından bir model seçin."
                .to_string(),
        ));
    }

    let mut endpoint = validate_localhost_ollama_url(&settings.ollama_url)?;
    endpoint.set_path("/api/generate");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| AppError::Network(format!("Ollama istemcisi oluşturulamadı: {e}")))?;

    let resp = client
        .post(endpoint)
        .json(&OllamaGenerateReq {
            model,
            prompt,
            stream: false,
        })
        .send()
        .await
        .map_err(|e| {
            AppError::Network(format!(
                "Yerel Ollama sunucusuna bağlanılamadı (127.0.0.1:11434 açık mı?): {e}"
            ))
        })?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Ollama yanıt hatası (HTTP {})",
            resp.status()
        )));
    }

    let parsed: OllamaGenerateResp = resp
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Ollama JSON yanıtı okunamadı: {e}")))?;

    let out = parsed.response.trim();
    if out.is_empty() {
        return Err(AppError::Network("Ollama boş yanıt döndürdü".into()));
    }

    Ok(TextAssistResponse {
        provider_used: "ollama".to_string(),
        model: model.to_string(),
        result: out.to_string(),
    })
}

async fn call_gemini_assist(
    settings: &AppSettings,
    cloud_confirmed: bool,
    prompt: &str,
) -> Result<TextAssistResponse, AppError> {
    if !settings.gemini_tts_enabled || !cloud_confirmed {
        return Err(AppError::NetworkDisabled(
            "Bulut Gemini isteği için Ayarlar'da Gemini seçeneğinin açık olması ve gönderim onayı gerekir."
                .to_string(),
        ));
    }

    let api_key = load_gemini_api_key_internal()?.ok_or_else(|| {
        AppError::Validation(
            "İşletim sistemi anahtar deposunda kayıtlı Gemini API anahtarı bulunamadı.".to_string(),
        )
    })?;

    let endpoint = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TEXT_MODEL}:generateContent"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Network(format!("Gemini HTTP istemcisi başlatılamadı: {e}")))?;

    let body = GeminiTextReq {
        contents: vec![GeminiTextContent {
            parts: vec![GeminiTextPart { text: prompt }],
        }],
    };

    let resp = client
        .post(&endpoint)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Gemini API isteği başarısız: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Gemini API hatası (HTTP {})",
            resp.status()
        )));
    }

    let parsed: GeminiTextResp = resp
        .json()
        .await
        .map_err(|e| AppError::Network(format!("Gemini yanıtı çözümlenemedi: {e}")))?;

    let text = parsed
        .candidates
        .into_iter()
        .filter_map(|c| c.content)
        .flat_map(|c| c.parts)
        .filter_map(|p| p.text)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err(AppError::Network("Gemini metin yanıtı üretmedi".into()));
    }

    Ok(TextAssistResponse {
        provider_used: "gemini".to_string(),
        model: GEMINI_TEXT_MODEL.to_string(),
        result: text,
    })
}

/// Strictly validates external URLs opened via user click (`https://` only, no embedded credentials,
/// no control characters, bounded length).
pub fn validate_external_https_url(raw: &str) -> Result<Url, AppError> {
    if raw.chars().any(char::is_control) {
        return Err(AppError::Security(
            "Dış bağlantıda kontrol karakteri kullanılamaz".into(),
        ));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 {
        return Err(AppError::Security(
            "Geçersiz veya çok uzun dış bağlantı reddedildi".into(),
        ));
    }

    let parsed = Url::parse(trimmed)
        .map_err(|e| AppError::Validation(format!("URL ayrıştırılamadı: {e}")))?;

    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Security(
            "Güvenlik politikası gereği yalnızca kimlik bilgisiz https:// bağlantıları açılabilir"
                .into(),
        ));
    }

    if parsed.host_str().map(str::is_empty).unwrap_or(true) {
        return Err(AppError::Security("Geçersiz hedef sunucu".into()));
    }

    Ok(parsed)
}

/// Opens a validated `https://` URL in the OS default browser without invoking a shell interpreter.
pub fn open_external_url(raw: &str) -> Result<(), AppError> {
    let validated = validate_external_https_url(raw)?;
    let url_str = validated.as_str();

    #[cfg(windows)]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url_str])
            .spawn()
            .map_err(|e| AppError::Io(format!("Tarayıcı açılamadı: {e}")))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url_str)
            .spawn()
            .map_err(|e| AppError::Io(format!("Tarayıcı açılamadı (xdg-open): {e}")))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url_str)
            .spawn()
            .map_err(|e| AppError::Io(format!("Tarayıcı açılamadı (open): {e}")))?;
        Ok(())
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = url_str;
        Err(AppError::Io(
            "Mobil webview dış bağlantı açmayı ön yüzde yönetir".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_external_urls() {
        assert!(validate_external_https_url("http://duckduckgo.com/?q=test").is_err());
        assert!(validate_external_https_url("javascript:alert(1)").is_err());
        assert!(validate_external_https_url("file:///C:/Windows/win.ini").is_err());
        assert!(validate_external_https_url("https://user:pass@example.com").is_err());
        assert!(validate_external_https_url("https://duckduckgo.com/?q=yapay+zeka\n").is_err());
        assert!(validate_external_https_url("https://duckduckgo.com/?q=yapay+zeka").is_ok());
    }

    #[test]
    fn blocks_gemini_assist_without_enable_and_confirmation() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        let mut settings = AppSettings {
            gemini_tts_enabled: false,
            ..Default::default()
        };
        let req = TextAssistRequest {
            mode: "translate".into(),
            text: "Merhaba dünya".into(),
            target_lang: Some("en".into()),
            user_prompt: None,
            provider: Some("gemini".into()),
            cloud_confirmed: true,
        };

        rt.block_on(async {
            let err1 = assist_selected_text(&settings, &req).await.unwrap_err();
            assert_eq!(err1.code(), "NETWORK_DISABLED");

            settings.gemini_tts_enabled = true;
            let unconfirmed = TextAssistRequest {
                cloud_confirmed: false,
                ..req
            };
            let err2 = assist_selected_text(&settings, &unconfirmed)
                .await
                .unwrap_err();
            assert_eq!(err2.code(), "NETWORK_DISABLED");
        });
    }

    #[test]
    fn blocks_non_localhost_ollama_assist() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        let settings = AppSettings {
            ollama_url: "https://remote-llm.example:11434".into(),
            ollama_model: "llama3.2".into(),
            ..Default::default()
        };

        let req = TextAssistRequest {
            mode: "ask".into(),
            text: "Örnek paragraf".into(),
            target_lang: None,
            user_prompt: Some("Özetle".into()),
            provider: Some("ollama".into()),
            cloud_confirmed: false,
        };

        rt.block_on(async {
            let err = assist_selected_text(&settings, &req).await.unwrap_err();
            assert_eq!(err.code(), "SECURITY_ERROR");
        });
    }
}
