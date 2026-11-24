use async_trait::async_trait;
use serde::Serialize;

use crate::error::AppError;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsProviderStatus {
    pub provider_id: String,
    pub available: bool,
    pub voice_name: String,
    pub details: String,
    pub setup_hint_tr: String,
    pub setup_hint_en: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsSynthesisResponse {
    pub audio_base64: String,
    pub mime_type: String,
    pub provider_id: String,
    pub voice_name: String,
    pub from_cache: bool,
    pub prepared_text: String,
}

#[derive(Debug, Clone)]
pub struct TtsRequest {
    pub text: String,
    pub rate: f32,
    pub settings: AppSettings,
}

#[async_trait]
pub trait TtsProvider: Send + Sync {
    fn id(&self) -> &'static str;
    async fn status(&self, settings: &AppSettings) -> TtsProviderStatus;
    /// Synthesizes speech into `(wav_bytes, voice_name, prepared_text)`.
    async fn synthesize(&self, req: &TtsRequest) -> Result<(Vec<u8>, String, String), AppError>;
}
