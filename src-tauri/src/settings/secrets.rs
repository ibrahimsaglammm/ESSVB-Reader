use keyring::Entry;

use crate::error::AppError;

const SERVICE_NAME: &str = "dev.essvb.reader";
const GEMINI_KEY_ACCOUNT: &str = "gemini_tts_api_key";

/// Stores the Gemini API key in the OS credential store (Windows Credential Manager / Linux libsecret).
pub fn set_gemini_api_key(api_key: &str) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err(AppError::Validation(
            "API anahtarı boş olamaz ve 512 karakteri geçemez".into(),
        ));
    }
    let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
        .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
    entry.set_password(trimmed).map_err(|e| {
        AppError::Keyring(format!("API anahtarı güvenli depoya kaydedilemedi: {e}"))
    })?;
    Ok(())
}

/// Checks whether a Gemini API key exists in the OS credential store without exposing its value.
pub fn has_gemini_api_key() -> Result<bool, AppError> {
    let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
        .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
    match entry.get_password() {
        Ok(val) => Ok(!val.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::Keyring(format!("Anahtar deposu okunamadı: {e}"))),
    }
}

/// Deletes the stored Gemini API key from the OS credential store.
pub fn delete_gemini_api_key() -> Result<(), AppError> {
    let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
        .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Keyring(format!("API anahtarı silinemedi: {e}"))),
    }
}

/// Internal Rust-only accessor; never exposed directly to the WebView frontend.
pub(crate) fn load_gemini_api_key_internal() -> Result<Option<String>, AppError> {
    let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
        .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
    match entry.get_password() {
        Ok(val) => {
            let trimmed = val.trim().to_string();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keyring(format!("API anahtarı okunamadı: {e}"))),
    }
}
