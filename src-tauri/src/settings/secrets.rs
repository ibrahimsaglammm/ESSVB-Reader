use crate::error::AppError;

#[cfg(not(target_os = "android"))]
use keyring::Entry;

#[cfg(not(target_os = "android"))]
const SERVICE_NAME: &str = "dev.essvb.reader";
#[cfg(not(target_os = "android"))]
const GEMINI_KEY_ACCOUNT: &str = "gemini_tts_api_key";

#[cfg(target_os = "android")]
mod android_store {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;

    use crate::error::AppError;

    static SECRETS_DIR: OnceLock<PathBuf> = OnceLock::new();

    pub fn init_dir(dir: &Path) {
        let _ = SECRETS_DIR.set(dir.to_path_buf());
    }

    fn key_file_path() -> Result<PathBuf, AppError> {
        let dir = SECRETS_DIR
            .get()
            .ok_or_else(|| AppError::Keyring("Android uygulama veri dizini başlatılmadı".into()))?;
        Ok(dir.join(".essvb_secret_key"))
    }

    pub fn set_key(trimmed: &str) -> Result<(), AppError> {
        let path = key_file_path()?;
        fs::write(&path, trimmed.as_bytes())?;
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
        Ok(())
    }

    pub fn get_key() -> Result<Option<String>, AppError> {
        let path = key_file_path()?;
        if !path.is_file() {
            return Ok(None);
        }
        let val = fs::read_to_string(path)?;
        let trimmed = val.trim().to_string();
        if trimmed.is_empty() {
            Ok(None)
        } else {
            Ok(Some(trimmed))
        }
    }

    pub fn delete_key() -> Result<(), AppError> {
        let path = key_file_path()?;
        if path.is_file() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
pub fn init_android_secrets_dir(dir: &std::path::Path) {
    android_store::init_dir(dir);
}

/// Stores the Gemini API key in the OS credential store (Windows/Linux/Apple Keychain)
/// or app-private 0o600 storage on Android (excluded from JSON backups).
pub fn set_gemini_api_key(api_key: &str) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err(AppError::Validation(
            "API anahtarı boş olamaz ve 512 karakteri geçemez".into(),
        ));
    }

    #[cfg(target_os = "android")]
    {
        return android_store::set_key(trimmed);
    }

    #[cfg(not(target_os = "android"))]
    {
        let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
            .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
        entry.set_password(trimmed).map_err(|e| {
            AppError::Keyring(format!("API anahtarı güvenli depoya kaydedilemedi: {e}"))
        })?;
        Ok(())
    }
}

/// Checks whether a Gemini API key exists in the OS credential store without exposing its value.
pub fn has_gemini_api_key() -> Result<bool, AppError> {
    #[cfg(target_os = "android")]
    {
        return Ok(android_store::get_key()?.is_some());
    }

    #[cfg(not(target_os = "android"))]
    {
        let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
            .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
        match entry.get_password() {
            Ok(val) => Ok(!val.trim().is_empty()),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(AppError::Keyring(format!("Anahtar deposu okunamadı: {e}"))),
        }
    }
}

/// Deletes the stored Gemini API key from the OS credential store.
pub fn delete_gemini_api_key() -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    {
        return android_store::delete_key();
    }

    #[cfg(not(target_os = "android"))]
    {
        let entry = Entry::new(SERVICE_NAME, GEMINI_KEY_ACCOUNT)
            .map_err(|e| AppError::Keyring(format!("Anahtar deposu başlatılamadı: {e}")))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keyring(format!("API anahtarı silinemedi: {e}"))),
        }
    }
}

/// Internal Rust-only accessor; never exposed directly to the WebView frontend.
pub(crate) fn load_gemini_api_key_internal() -> Result<Option<String>, AppError> {
    #[cfg(target_os = "android")]
    {
        return android_store::get_key();
    }

    #[cfg(not(target_os = "android"))]
    {
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
}
