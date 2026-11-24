use serde::Serialize;
use thiserror::Error;

/// Unified application error serialized safely across the Tauri IPC boundary.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Geçersiz girdi: {0}")]
    Validation(String),
    #[error("Güvenlik ihlali engellendi: {0}")]
    Security(String),
    #[error("Kayıt veya dosya bulunamadı: {0}")]
    NotFound(String),
    #[error("Dosya sistemi hatası: {0}")]
    Io(String),
    #[error("Arşiv hatası: {0}")]
    Archive(String),
    #[error("EPUB ayrıştırma hatası: {0}")]
    Epub(String),
    #[error("Veritabanı hatası: {0}")]
    Database(String),
    #[error("Anahtar deposu hatası: {0}")]
    Keyring(String),
    #[error("Sesli okuma (TTS) hatası: {0}")]
    Tts(String),
    #[error("Ağ erişimi gizlilik politikası gereği kapalı: {0}")]
    NetworkDisabled(String),
    #[error("Ağ isteği hatası: {0}")]
    Network(String),
}

#[derive(Serialize)]
struct SerializedError<'a> {
    code: &'a str,
    message: String,
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "VALIDATION_ERROR",
            Self::Security(_) => "SECURITY_ERROR",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Io(_) => "IO_ERROR",
            Self::Archive(_) => "ARCHIVE_ERROR",
            Self::Epub(_) => "EPUB_ERROR",
            Self::Database(_) => "DATABASE_ERROR",
            Self::Keyring(_) => "KEYRING_ERROR",
            Self::Tts(_) => "TTS_ERROR",
            Self::NetworkDisabled(_) => "NETWORK_DISABLED",
            Self::Network(_) => "NETWORK_ERROR",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        SerializedError {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Database(err.to_string())
    }
}
