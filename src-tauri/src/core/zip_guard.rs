use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use percent_encoding::percent_decode_str;
use zip::read::ZipFile;
use zip::ZipArchive;

use crate::error::AppError;

pub const MAX_EPUB_FILE_BYTES: u64 = 250 * 1024 * 1024;
pub const MAX_ZIP_ENTRIES: usize = 10_000;
pub const MAX_XML_ENTRY_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_IMAGE_ENTRY_BYTES: u64 = 15 * 1024 * 1024;
pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_COMPRESSION_RATIO: u64 = 100;
pub const RATIO_CHECK_MIN_BYTES: u64 = 1024 * 1024;

/// Validates an archive entry path against zip-slip / traversal / invalid characters.
pub fn validate_archive_entry_path(raw: &str) -> Result<String, AppError> {
    if raw.is_empty() {
        return Err(AppError::Security("Boş arşiv yolu reddedildi".to_string()));
    }
    if raw.chars().any(|c| c == '\0' || (c as u32) < 0x20) {
        return Err(AppError::Security(
            "Arşiv yolunda kontrol karakteri bulundu".to_string(),
        ));
    }
    if raw.contains('\\') || raw.contains(':') {
        return Err(AppError::Security(format!(
            "Güvensiz arşiv yolu reddedildi: {raw}"
        )));
    }
    if raw.starts_with('/') {
        return Err(AppError::Security(format!(
            "Mutlak arşiv yolu reddedildi: {raw}"
        )));
    }

    let trimmed = raw.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::Security(
            "Kök dizin girişi reddedildi".to_string(),
        ));
    }

    let mut clean_segments = Vec::new();
    for seg in trimmed.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(AppError::Security(format!(
                "Zip-slip girişimi engellendi: {raw}"
            )));
        }
        clean_segments.push(seg);
    }

    Ok(clean_segments.join("/"))
}

/// Resolves a relative href inside the archive against `base_dir` (e.g. `OEBPS/Text`).
/// Rejects external schemes (`http:`, `javascript:`, `file:`, `//`) and traversal past root.
pub fn resolve_zip_relative(base_dir: &str, href: &str) -> Result<String, AppError> {
    let without_frag = href.split('#').next().unwrap_or(href);
    let without_query = without_frag
        .split('?')
        .next()
        .unwrap_or(without_frag)
        .trim();
    if without_query.is_empty() {
        return Err(AppError::Validation("Boş göreli yol".to_string()));
    }

    if without_query.starts_with("//")
        || without_query.starts_with('/')
        || without_query.contains('\\')
    {
        return Err(AppError::Security(format!(
            "Harici veya mutlak kaynak yolu reddedildi: {href}"
        )));
    }

    // Check for URI schemes like http:, https:, javascript:, data:, file:
    if let Some(colon_idx) = without_query.find(':') {
        let before_colon = &without_query[..colon_idx];
        if !before_colon.is_empty()
            && before_colon
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
        {
            return Err(AppError::Security(format!(
                "İzin verilmeyen URI şeması reddedildi: {href}"
            )));
        }
        return Err(AppError::Security(format!(
            "Arşiv yolunda geçersiz ':' karakteri: {href}"
        )));
    }

    let decoded = percent_decode_str(without_query)
        .decode_utf8()
        .map_err(|_| AppError::Validation(format!("Geçersiz UTF-8 arşiv yolu: {href}")))?;

    let mut stack: Vec<String> = if base_dir.is_empty() {
        Vec::new()
    } else {
        base_dir
            .split('/')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    };

    for seg in decoded.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if stack.pop().is_none() {
                return Err(AppError::Security(format!(
                    "Arşiv kökü dışına çıkış engellendi: {href}"
                )));
            }
        } else {
            if seg.contains('\0') || seg.contains('\\') || seg.contains(':') {
                return Err(AppError::Security(format!(
                    "Güvensiz yol segmenti engellendi: {href}"
                )));
            }
            stack.push(seg.to_string());
        }
    }

    if stack.is_empty() {
        return Err(AppError::Validation("Geçersiz boş hedef yol".to_string()));
    }

    Ok(stack.join("/"))
}

/// Opens a ZIP/EPUB archive after verifying file size, entry count, and all entry paths.
pub fn open_guarded_archive(path: &Path) -> Result<ZipArchive<File>, AppError> {
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::NotFound(format!("EPUB dosyası açılamadı: {e}")))?;
    if !meta.is_file() {
        return Err(AppError::Validation(
            "Seçilen yol bir dosya değil".to_string(),
        ));
    }
    if meta.len() > MAX_EPUB_FILE_BYTES {
        return Err(AppError::Security(format!(
            "EPUB dosyası izin verilen maksimum boyutu ({MAX_EPUB_FILE_BYTES} bayt) aşıyor"
        )));
    }

    let file = File::open(path)?;
    let archive = ZipArchive::new(file)
        .map_err(|e| AppError::Archive(format!("Geçersiz ZIP/EPUB arşivi: {e}")))?;

    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(AppError::Security(format!(
            "ZIP girdi sayısı sınırı ({MAX_ZIP_ENTRIES}) aşıldı"
        )));
    }

    let mut seen = HashSet::with_capacity(archive.len());
    for idx in 0..archive.len() {
        let name = archive
            .name_for_index(idx)
            .ok_or_else(|| AppError::Archive("Arşiv girdisi adı okunamadı".to_string()))?;
        if name.ends_with('/') {
            // Directory entries still must not contain traversal or invalid characters.
            let _ = validate_archive_entry_path(name)?;
            continue;
        }
        let clean = validate_archive_entry_path(name)?;
        seen.insert(clean);
    }

    Ok(archive)
}

/// Reads an entry from an open ZIP archive enforcing strict byte and compression-ratio limits
/// without trusting the header's declared `uncompressed_size`.
pub fn read_entry_capped<R: Read>(
    entry: &mut ZipFile<'_, R>,
    max_bytes: u64,
    total_read: &mut u64,
) -> Result<Vec<u8>, AppError> {
    let compressed_size = entry.compressed_size();
    let mut limited = entry.take(max_bytes + 1);
    let mut buf = Vec::new();
    limited
        .read_to_end(&mut buf)
        .map_err(|e| AppError::Archive(format!("Arşiv girdisi okunamadı: {e}")))?;

    let actual_len = buf.len() as u64;
    if actual_len > max_bytes {
        return Err(AppError::Security(format!(
            "Zip-bomb koruması: girdi boyutu sınırı ({max_bytes} bayt) aşıldı"
        )));
    }

    let new_total = total_read
        .checked_add(actual_len)
        .ok_or_else(|| AppError::Security("Toplam açılan boyut taşması".to_string()))?;
    if new_total > MAX_TOTAL_UNCOMPRESSED_BYTES {
        return Err(AppError::Security(format!(
            "Zip-bomb koruması: toplam açılan boyut sınırı ({MAX_TOTAL_UNCOMPRESSED_BYTES} bayt) aşıldı"
        )));
    }

    if actual_len >= RATIO_CHECK_MIN_BYTES
        && (compressed_size == 0 || (actual_len / compressed_size) > MAX_COMPRESSION_RATIO)
    {
        return Err(AppError::Security(format!(
            "Zip-bomb koruması: sıkıştırma oranı ({MAX_COMPRESSION_RATIO}:1) aşıldı"
        )));
    }

    *total_read = new_total;
    Ok(buf)
}

/// Finds an archive entry index using exact path, percent-decoded match, or case-insensitive match.
pub fn lookup_entry_index(archive: &ZipArchive<File>, target_path: &str) -> Option<usize> {
    let norm_target = target_path.trim_start_matches('/');
    if let Some(idx) = archive.index_for_name(norm_target) {
        return Some(idx);
    }
    let decoded_target = percent_decode_str(norm_target).decode_utf8().ok();
    for idx in 0..archive.len() {
        let Some(raw_name) = archive.name_for_index(idx) else {
            continue;
        };
        if raw_name.ends_with('/') {
            continue;
        }
        if raw_name == norm_target {
            return Some(idx);
        }
        if let Ok(decoded_entry) = percent_decode_str(raw_name).decode_utf8() {
            if decoded_entry == norm_target {
                return Some(idx);
            }
            if let Some(ref dt) = decoded_target {
                if decoded_entry.eq_ignore_ascii_case(dt) {
                    return Some(idx);
                }
            }
        }
        if raw_name.eq_ignore_ascii_case(norm_target) {
            return Some(idx);
        }
    }
    None
}

/// Reads an archive entry by validated path with capped streaming limits.
pub fn read_zip_entry_by_path(
    archive: &mut ZipArchive<File>,
    target_path: &str,
    max_bytes: u64,
    total_read: &mut u64,
) -> Result<Option<Vec<u8>>, AppError> {
    let clean = validate_archive_entry_path(target_path)?;
    let Some(idx) = lookup_entry_index(archive, &clean) else {
        return Ok(None);
    };
    let mut entry = archive
        .by_index(idx)
        .map_err(|e| AppError::Archive(format!("Arşiv girdisine erişilemedi: {e}")))?;
    let bytes = read_entry_capped(&mut entry, max_bytes, total_read)?;
    Ok(Some(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    #[test]
    fn rejects_zip_slip_vectors() {
        let bad_paths = [
            "../etc/passwd",
            "OEBPS/../../secret.txt",
            "/etc/passwd",
            "\\Windows\\System32\\cmd.exe",
            "OEBPS\\Text\\ch1.xhtml",
            "C:\\evil.txt",
            "C:evil.txt",
            "OEBPS/./ch1.xhtml",
            "OEBPS//ch1.xhtml",
            "bad\0name.txt",
            "",
        ];
        for p in bad_paths {
            assert!(
                validate_archive_entry_path(p).is_err(),
                "Expected zip-slip path to be rejected: {p:?}"
            );
        }

        assert_eq!(
            validate_archive_entry_path("OEBPS/Text/bölüm_1.xhtml").unwrap(),
            "OEBPS/Text/bölüm_1.xhtml"
        );
    }

    #[test]
    fn resolves_relative_and_blocks_traversal_and_schemes() {
        assert_eq!(
            resolve_zip_relative("OEBPS/Text", "../Images/kapak.jpg#top").unwrap(),
            "OEBPS/Images/kapak.jpg"
        );
        assert_eq!(
            resolve_zip_relative("OEBPS/Text", "Alt%20Klas%C3%B6r/resim.png?v=1").unwrap(),
            "OEBPS/Text/Alt Klasör/resim.png"
        );
        assert_eq!(
            resolve_zip_relative("OEBPS/Text", "../../OEBPS/ch1.xhtml").unwrap(),
            "OEBPS/ch1.xhtml"
        );
        assert!(resolve_zip_relative("OEBPS/Text", "../../../etc/passwd").is_err());
        assert!(resolve_zip_relative("OEBPS", "../../etc/passwd").is_err());
        assert!(resolve_zip_relative("OEBPS", "https://evil.com/track.png").is_err());
        assert!(resolve_zip_relative("OEBPS", "http://evil.com/x.css").is_err());
        assert!(resolve_zip_relative("OEBPS", "//evil.com/x.png").is_err());
        assert!(resolve_zip_relative("OEBPS", "javascript:alert(1)").is_err());
        assert!(resolve_zip_relative("OEBPS", "/abs/path.png").is_err());
    }

    #[test]
    fn blocks_zip_bomb_entry_and_ratio_limits() {
        let tmp = NamedTempFile::new().unwrap();
        {
            let mut zw = ZipWriter::new(tmp.reopen().unwrap());
            let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            zw.start_file("OEBPS/bomb.xhtml", opts).unwrap();
            let payload = vec![b'A'; 3 * 1024 * 1024]; // 3 MiB of 'A' compresses > 1000:1
            zw.write_all(&payload).unwrap();
            zw.finish().unwrap();
        }

        let mut archive = open_guarded_archive(tmp.path()).unwrap();
        let mut total = 0u64;
        // Entry cap check (2 MiB cap vs 3 MiB entry)
        let err_cap = read_zip_entry_by_path(
            &mut archive,
            "OEBPS/bomb.xhtml",
            2 * 1024 * 1024,
            &mut total,
        )
        .unwrap_err();
        assert_eq!(err_cap.code(), "SECURITY_ERROR");

        // Ratio check (8 MiB entry cap allows reading 3 MiB, then compression ratio > 100:1 triggers)
        let mut total2 = 0u64;
        let err_ratio = read_zip_entry_by_path(
            &mut archive,
            "OEBPS/bomb.xhtml",
            8 * 1024 * 1024,
            &mut total2,
        )
        .unwrap_err();
        assert_eq!(err_ratio.code(), "SECURITY_ERROR");
    }
}
