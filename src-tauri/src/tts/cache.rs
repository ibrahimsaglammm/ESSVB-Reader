use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::paths::ensure_inside;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsCacheStats {
    pub file_count: usize,
    pub total_bytes: u64,
    pub max_bytes: u64,
}

/// Strictly local, size-bounded LRU disk cache for synthesized WAV audio clips.
#[derive(Debug, Clone)]
pub struct TtsDiskCache {
    dir: PathBuf,
}

impl TtsDiskCache {
    pub fn new(dir: PathBuf) -> Result<Self, AppError> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn cache_key(provider_id: &str, voice_or_model: &str, rate: f32, text: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(provider_id.as_bytes());
        hasher.update(b"|");
        hasher.update(voice_or_model.as_bytes());
        hasher.update(b"|");
        let rate_x100 = (rate * 100.0).round() as i32;
        hasher.update(rate_x100.to_string().as_bytes());
        hasher.update(b"|");
        hasher.update(text.as_bytes());
        hex::encode(hasher.finalize())
    }

    fn safe_entry_path(&self, key: &str) -> Result<PathBuf, AppError> {
        if key.len() != 64 || !key.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(AppError::Security("Geçersiz TTS önbellek anahtarı".into()));
        }
        Ok(self.dir.join(format!("{key}.wav")))
    }

    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, AppError> {
        let path = self.safe_entry_path(key)?;
        if !path.is_file() {
            return Ok(None);
        }
        let verified = ensure_inside(&self.dir, &path)?;
        let bytes = fs::read(verified)?;
        Ok(Some(bytes))
    }

    pub fn put(&self, key: &str, wav_bytes: &[u8], max_bytes: u64) -> Result<(), AppError> {
        if wav_bytes.is_empty() || (wav_bytes.len() as u64) > max_bytes {
            return Ok(());
        }
        let path = self.safe_entry_path(key)?;
        fs::write(&path, wav_bytes)?;
        self.evict_to_limit(max_bytes)?;
        Ok(())
    }

    pub fn evict_to_limit(&self, max_bytes: u64) -> Result<(), AppError> {
        let mut entries = self.collect_entries()?;
        let mut total: u64 = entries.iter().map(|e| e.size).sum();
        if total <= max_bytes {
            return Ok(());
        }

        // Oldest modified first (LRU-like)
        entries.sort_by_key(|e| e.modified);
        for item in entries {
            if total <= max_bytes {
                break;
            }
            if fs::remove_file(&item.path).is_ok() {
                total = total.saturating_sub(item.size);
            }
        }
        Ok(())
    }

    pub fn stats(&self, max_bytes: u64) -> Result<TtsCacheStats, AppError> {
        let entries = self.collect_entries()?;
        let total_bytes = entries.iter().map(|e| e.size).sum();
        Ok(TtsCacheStats {
            file_count: entries.len(),
            total_bytes,
            max_bytes,
        })
    }

    pub fn clear(&self) -> Result<usize, AppError> {
        let entries = self.collect_entries()?;
        let mut removed = 0usize;
        for item in entries {
            if fs::remove_file(item.path).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    fn collect_entries(&self) -> Result<Vec<CacheEntry>, AppError> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.dir)?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("wav") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    out.push(CacheEntry {
                        path,
                        size: meta.len(),
                        modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    });
                }
            }
        }
        Ok(out)
    }
}

struct CacheEntry {
    path: PathBuf,
    size: u64,
    modified: SystemTime,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;
    use tempfile::TempDir;

    #[test]
    fn evicts_oldest_files_when_exceeding_cap() {
        let dir = TempDir::new().unwrap();
        let cache = TtsDiskCache::new(dir.path().to_path_buf()).unwrap();

        let k1 = TtsDiskCache::cache_key("local", "Tolga", 1.0, "ilk");
        let k2 = TtsDiskCache::cache_key("local", "Tolga", 1.0, "iki");
        let k3 = TtsDiskCache::cache_key("local", "Tolga", 1.0, "üç");

        cache.put(&k1, &[1u8; 500], 1200).unwrap();
        sleep(Duration::from_millis(20));
        cache.put(&k2, &[2u8; 500], 1200).unwrap();
        sleep(Duration::from_millis(20));
        cache.put(&k3, &[3u8; 500], 1200).unwrap();

        let stats = cache.stats(1200).unwrap();
        assert!(stats.total_bytes <= 1200);
        assert_eq!(stats.file_count, 2);
        assert!(cache.get(&k1).unwrap().is_none());
        assert!(cache.get(&k3).unwrap().is_some());
    }
}
