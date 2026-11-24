use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

/// Resolved application directories supporting standard and portable installs.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub base_dir: PathBuf,
    pub books_dir: PathBuf,
    pub covers_dir: PathBuf,
    pub tts_cache_dir: PathBuf,
    pub db_path: PathBuf,
    pub is_portable: bool,
}

impl AppPaths {
    /// Resolves data directory; switches to `<exe_dir>/data` when `portable.txt` or `.portable` exists.
    pub fn resolve(app_handle: &AppHandle) -> Result<Self, AppError> {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf));

        let portable_dir = exe_dir.and_then(|dir| {
            if dir.join("portable.txt").is_file() || dir.join(".portable").is_file() {
                Some(dir.join("data"))
            } else {
                None
            }
        });

        let (base_dir, is_portable) = match portable_dir {
            Some(dir) => (dir, true),
            None => {
                let dir = app_handle
                    .path()
                    .app_data_dir()
                    .map_err(|e| AppError::Io(format!("Uygulama veri klasörü alınamadı: {e}")))?;
                (dir, false)
            }
        };

        Self::from_base_dir(base_dir, is_portable)
    }

    /// Initializes directory layout from an explicit base directory (also used in tests).
    pub fn from_base_dir(base_dir: PathBuf, is_portable: bool) -> Result<Self, AppError> {
        let books_dir = base_dir.join("books");
        let covers_dir = base_dir.join("covers");
        let tts_cache_dir = base_dir.join("tts_cache");
        let db_path = base_dir.join("essvb_library.db");

        fs::create_dir_all(&base_dir)?;
        fs::create_dir_all(&books_dir)?;
        fs::create_dir_all(&covers_dir)?;
        fs::create_dir_all(&tts_cache_dir)?;

        Ok(Self {
            base_dir,
            books_dir,
            covers_dir,
            tts_cache_dir,
            db_path,
            is_portable,
        })
    }
}

/// Ensures `candidate` resides strictly inside `root` after canonicalizing existing paths.
pub fn ensure_inside(root: &Path, candidate: &Path) -> Result<PathBuf, AppError> {
    let canon_root = root
        .canonicalize()
        .map_err(|e| AppError::Io(format!("Kök dizin doğrulanamadı: {e}")))?;
    let canon_cand = candidate
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("Hedef dosya bulunamadı: {e}")))?;
    if !canon_cand.starts_with(&canon_root) {
        return Err(AppError::Security(
            "Hedef yol izin verilen uygulama dizini dışında".to_string(),
        ));
    }
    Ok(canon_cand)
}
