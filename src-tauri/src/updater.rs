use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use chrono::Utc;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::error::AppError;
use crate::paths::ensure_inside;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_UPDATE_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionInfo {
    pub version: String,
    pub stage_tr: String,
    pub stage_en: String,
    pub is_portable: bool,
    pub license: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAssetInfo {
    pub name: String,
    pub download_url: String,
    pub size_bytes: u64,
    pub sha256: Option<String>,
    pub platform_tag: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub release_page_url: String,
    pub download_url: String,
    pub recommended_asset: Option<UpdateAssetInfo>,
    pub assets: Vec<UpdateAssetInfo>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplyResult {
    pub file_path: String,
    pub file_name: String,
    pub sha256: String,
    pub launched: bool,
    pub action_hint_tr: String,
    pub action_hint_en: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomManifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    download_url: String,
    #[serde(default)]
    release_page_url: String,
    #[serde(default)]
    assets: Vec<CustomManifestAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomManifestAsset {
    name: String,
    download_url: String,
    #[serde(default)]
    size_bytes: u64,
    #[serde(default)]
    sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}

pub fn get_app_version_info(is_portable: bool) -> AppVersionInfo {
    AppVersionInfo {
        version: APP_VERSION.to_string(),
        stage_tr: "Hazırlık Aşaması (Ön Sürüm)".to_string(),
        stage_en: "Development Preview (Pre-release)".to_string(),
        is_portable,
        license: "MIT".to_string(),
    }
}

pub fn classify_asset_platform(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".msi") {
        "windows-msi"
    } else if lower.contains("portable") && lower.ends_with(".zip") {
        "windows-portable"
    } else if lower.ends_with(".exe") {
        "windows-nsis"
    } else if lower.ends_with(".appimage") {
        "linux-appimage"
    } else if lower.ends_with(".pkg.tar.zst") {
        "arch-pkg"
    } else {
        "other"
    }
}

fn is_arch_like_linux() -> bool {
    #[cfg(target_os = "linux")]
    {
        if Path::new("/etc/arch-release").exists() {
            return true;
        }
        if let Ok(os_release) = fs::read_to_string("/etc/os-release") {
            let lower = os_release.to_ascii_lowercase();
            return lower.contains("cachyos") || lower.contains("arch");
        }
        false
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

pub fn select_recommended_asset(
    assets: &[UpdateAssetInfo],
    is_portable: bool,
    is_windows: bool,
    is_arch_linux: bool,
) -> Option<UpdateAssetInfo> {
    let preferred_tags: &[&str] = if is_windows {
        if is_portable {
            &["windows-portable", "windows-nsis", "windows-msi"]
        } else {
            &["windows-nsis", "windows-msi", "windows-portable"]
        }
    } else if is_arch_linux {
        &["arch-pkg", "linux-appimage"]
    } else {
        &["linux-appimage", "arch-pkg"]
    };

    for tag in preferred_tags {
        if let Some(found) = assets.iter().find(|a| a.platform_tag == *tag) {
            return Some(found.clone());
        }
    }
    None
}

fn parse_sha256_sums(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let mut parts = line.split_whitespace();
        let Some(hash) = parts.next() else {
            continue;
        };
        let Some(name_raw) = parts.next() else {
            continue;
        };
        let clean_name = name_raw.trim_start_matches('*').to_string();
        if hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            map.insert(clean_name, hash.to_ascii_lowercase());
        }
    }
    map
}

fn normalize_github_digest(digest: Option<String>) -> Option<String> {
    digest.and_then(|d| {
        let trimmed = d.trim();
        let hex_part = trimmed.strip_prefix("sha256:").unwrap_or(trimmed);
        if hex_part.len() == 64 && hex_part.chars().all(|c| c.is_ascii_hexdigit()) {
            Some(hex_part.to_ascii_lowercase())
        } else {
            None
        }
    })
}

fn is_allowed_update_host(url: &Url) -> bool {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let lower = host.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "api.github.com"
            | "github.com"
            | "objects.githubusercontent.com"
            | "release-assets.githubusercontent.com"
            | "github-releases.githubusercontent.com"
    )
}

fn validate_update_filename(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::Security(format!(
            "Güvensiz güncelleme dosya adı reddedildi: {name}"
        )));
    }
    let lower = trimmed.to_ascii_lowercase();
    let ext_ok = lower.ends_with(".exe")
        || lower.ends_with(".msi")
        || lower.ends_with(".zip")
        || lower.ends_with(".appimage")
        || lower.ends_with(".pkg.tar.zst");
    if !ext_ok {
        return Err(AppError::Security(format!(
            "İzin verilmeyen güncelleme dosya uzantısı: {name}"
        )));
    }
    Ok(trimmed.to_string())
}

pub fn parse_release_payload(
    raw_json: &str,
    is_portable: bool,
    is_windows: bool,
    is_arch_linux: bool,
    sha256_overrides: Option<&HashMap<String, String>>,
) -> Result<UpdateCheckResult, AppError> {
    let current = Version::parse(APP_VERSION)
        .map_err(|e| AppError::Validation(format!("Geçersiz yerel sürüm: {e}")))?;

    let (latest_raw, notes, page_url, fallback_dl, assets) =
        if let Ok(gh) = serde_json::from_str::<GitHubRelease>(raw_json) {
            let mut mapped_assets = Vec::new();
            for a in gh.assets {
                let tag = classify_asset_platform(&a.name);
                if tag == "other" || !a.browser_download_url.starts_with("https://") {
                    continue;
                }
                let sha = normalize_github_digest(a.digest)
                    .or_else(|| sha256_overrides.and_then(|m| m.get(&a.name).cloned()));
                mapped_assets.push(UpdateAssetInfo {
                    name: a.name,
                    download_url: a.browser_download_url,
                    size_bytes: a.size,
                    sha256: sha,
                    platform_tag: tag.to_string(),
                });
            }
            (
                gh.tag_name,
                gh.body.unwrap_or_default(),
                if gh.html_url.starts_with("https://") {
                    gh.html_url
                } else {
                    String::new()
                },
                String::new(),
                mapped_assets,
            )
        } else if let Ok(custom) = serde_json::from_str::<CustomManifest>(raw_json) {
            let mapped_assets: Vec<UpdateAssetInfo> = custom
                .assets
                .into_iter()
                .filter_map(|a| {
                    let tag = classify_asset_platform(&a.name);
                    if tag == "other" || !a.download_url.starts_with("https://") {
                        return None;
                    }
                    Some(UpdateAssetInfo {
                        name: a.name,
                        download_url: a.download_url,
                        size_bytes: a.size_bytes,
                        sha256: normalize_github_digest(a.sha256),
                        platform_tag: tag.to_string(),
                    })
                })
                .collect();
            (
                custom.version,
                custom.notes,
                if custom.release_page_url.starts_with("https://") {
                    custom.release_page_url
                } else {
                    String::new()
                },
                if custom.download_url.starts_with("https://") {
                    custom.download_url
                } else {
                    String::new()
                },
                mapped_assets,
            )
        } else {
            return Err(AppError::Network(
                "Güncelleme JSON yanıtı GitHub Release veya sürüm bildirimi biçiminde değil".into(),
            ));
        };

    let latest_clean = latest_raw.trim().trim_start_matches('v');
    let latest = Version::parse(latest_clean)
        .map_err(|e| AppError::Validation(format!("Geçersiz uzak sürüm ({latest_raw}): {e}")))?;

    let recommended_asset =
        select_recommended_asset(&assets, is_portable, is_windows, is_arch_linux);
    let download_url = recommended_asset
        .as_ref()
        .map(|a| a.download_url.clone())
        .or_else(|| {
            if !fallback_dl.is_empty() {
                Some(fallback_dl)
            } else if !page_url.is_empty() {
                Some(page_url.clone())
            } else {
                None
            }
        })
        .unwrap_or_default();

    Ok(UpdateCheckResult {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        update_available: latest > current,
        release_notes: notes,
        release_page_url: page_url,
        download_url,
        recommended_asset,
        assets,
        checked_at: Utc::now().to_rfc3339(),
    })
}

/// Checks GitHub Releases API (or custom HTTPS manifest) ONLY when explicitly permitted.
/// Never downloads or executes binaries automatically.
pub async fn check_for_updates(
    manifest_url: &str,
    is_portable: bool,
    explicit_permission: bool,
) -> Result<UpdateCheckResult, AppError> {
    if !explicit_permission {
        return Err(AppError::NetworkDisabled(
            "Güncelleme kontrolü için açık kullanıcı onayı gereklidir".into(),
        ));
    }

    let parsed = Url::parse(manifest_url.trim())
        .map_err(|e| AppError::Validation(format!("Geçersiz güncelleme URL'si: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::Security(
            "Güvenlik politikası gereği güncelleme kontrolü yalnızca HTTPS kullanabilir".into(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(format!("ESSVB-Reader/{APP_VERSION}"))
        .build()
        .map_err(|e| AppError::Network(format!("HTTP istemcisi oluşturulamadı: {e}")))?;

    let resp = client
        .get(parsed)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Güncelleme sunucusuna bağlanılamadı: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Sürüm bilgisi alınamadı (HTTP {})",
            resp.status()
        )));
    }

    let raw_json = resp
        .text()
        .await
        .map_err(|e| AppError::Network(format!("Güncelleme yanıtı okunamadı: {e}")))?;

    // If GitHub Release includes SHA256SUMS.txt and an asset lacks inline digest, fetch SHA256SUMS.txt
    let mut sha_map = HashMap::new();
    if let Ok(gh) = serde_json::from_str::<GitHubRelease>(&raw_json) {
        if let Some(sums_asset) = gh.assets.iter().find(|a| a.name == "SHA256SUMS.txt") {
            if let Ok(sums_url) = Url::parse(&sums_asset.browser_download_url) {
                if is_allowed_update_host(&sums_url) {
                    if let Ok(sums_resp) = client.get(sums_url).send().await {
                        if sums_resp.status().is_success() {
                            if let Ok(sums_txt) = sums_resp.text().await {
                                sha_map = parse_sha256_sums(&sums_txt);
                            }
                        }
                    }
                }
            }
        }
    }

    parse_release_payload(
        &raw_json,
        is_portable,
        cfg!(windows),
        is_arch_like_linux(),
        Some(&sha_map),
    )
}

/// Downloads a verified GitHub Release asset strictly after explicit user confirmation,
/// checks size & SHA-256 digest, and launches the installer or reveals the package.
pub async fn download_and_launch_update(
    updates_dir: &Path,
    download_url: &str,
    file_name: &str,
    expected_sha256: Option<String>,
    user_confirmed: bool,
) -> Result<UpdateApplyResult, AppError> {
    if !user_confirmed {
        return Err(AppError::NetworkDisabled(
            "Güncelleme indirme ve kurulum için kullanıcı onayı zorunludur".into(),
        ));
    }

    let parsed = Url::parse(download_url.trim())
        .map_err(|e| AppError::Validation(format!("Geçersiz indirme adresi: {e}")))?;
    if !is_allowed_update_host(&parsed) {
        return Err(AppError::Security(
            "Güvenlik politikası: güncelleme yalnızca resmi GitHub HTTPS adreslerinden indirilebilir".into(),
        ));
    }

    let safe_name = validate_update_filename(file_name)?;
    fs::create_dir_all(updates_dir)?;
    let part_path = updates_dir.join(format!("{safe_name}.part"));
    let final_path = updates_dir.join(&safe_name);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent(format!("ESSVB-Reader/{APP_VERSION}"))
        .build()
        .map_err(|e| AppError::Network(format!("İndirme istemcisi başlatılamadı: {e}")))?;

    let mut resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Güncelleme dosyası indirilemedi: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Network(format!(
            "Güncelleme indirme hatası (HTTP {})",
            resp.status()
        )));
    }

    if let Some(len) = resp.content_length() {
        if len > MAX_UPDATE_DOWNLOAD_BYTES {
            return Err(AppError::Security(
                "Güncelleme dosyası izin verilen maksimum boyutu (200 MiB) aşıyor".into(),
            ));
        }
    }

    let mut out_file = File::create(&part_path)?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Network(format!("İndirme akışı kesildi: {e}")))?
    {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| AppError::Security("Dosya boyutu taşması".into()))?;
        if downloaded > MAX_UPDATE_DOWNLOAD_BYTES {
            drop(out_file);
            let _ = fs::remove_file(&part_path);
            return Err(AppError::Security(
                "Güncelleme dosyası maksimum boyut sınırını (200 MiB) aştı".into(),
            ));
        }
        hasher.update(&chunk);
        out_file.write_all(&chunk)?;
    }
    out_file.flush()?;
    drop(out_file);

    let actual_sha = hex::encode(hasher.finalize());
    if let Some(expected_raw) = expected_sha256 {
        let expected = expected_raw
            .trim()
            .strip_prefix("sha256:")
            .unwrap_or(expected_raw.trim())
            .to_ascii_lowercase();
        if !expected.is_empty() && actual_sha != expected {
            let _ = fs::remove_file(&part_path);
            return Err(AppError::Security(format!(
                "SHA-256 doğrulaması başarısız (beklenen: {expected}, indirilen: {actual_sha})"
            )));
        }
    }

    if final_path.exists() {
        let _ = fs::remove_file(&final_path);
    }
    fs::rename(&part_path, &final_path)?;
    let verified_path = ensure_inside(updates_dir, &final_path)?;

    let (launched, hint_tr, hint_en) = launch_downloaded_package(&verified_path, &safe_name)?;

    Ok(UpdateApplyResult {
        file_path: verified_path.display().to_string(),
        file_name: safe_name,
        sha256: actual_sha,
        launched,
        action_hint_tr: hint_tr,
        action_hint_en: hint_en,
    })
}

fn launch_downloaded_package(
    path: &Path,
    safe_name: &str,
) -> Result<(bool, String, String), AppError> {
    let lower = safe_name.to_ascii_lowercase();

    #[cfg(windows)]
    {
        if lower.ends_with(".msi") {
            Command::new("msiexec")
                .arg("/i")
                .arg(path)
                .spawn()
                .map_err(|e| AppError::Io(format!("MSI kurulumu başlatılamadı: {e}")))?;
            return Ok((
                true,
                "MSI kurulum sihirbazı başlatıldı. Kurulumu tamamlamak için ekrandaki adımları izleyin.".into(),
                "MSI installer launched. Follow the on-screen instructions to complete updating.".into(),
            ));
        }
        if lower.ends_with(".exe") {
            Command::new(path)
                .spawn()
                .map_err(|e| AppError::Io(format!("Kurulum dosyası çalıştırılamadı: {e}")))?;
            return Ok((
                true,
                "Kurulum sihirbazı başlatıldı.".into(),
                "Installer launched.".into(),
            ));
        }
        let _ = Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
        Ok((
            false,
            format!(
                "Taşınabilir paket indirildi: {}. Dosyayı mevcut klasörünüze açın.",
                path.display()
            ),
            format!(
                "Portable package downloaded to {}. Extract it over your portable folder.",
                path.display()
            ),
        ))
    }

    #[cfg(target_os = "linux")]
    {
        if lower.ends_with(".appimage") {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(path, perms);
            }
            if let Some(parent) = path.parent() {
                let _ = Command::new("xdg-open").arg(parent).spawn();
            }
            return Ok((
                false,
                format!(
                    "Yeni AppImage indirildi ve çalıştırılabilir yapıldı: {}",
                    path.display()
                ),
                format!(
                    "New AppImage downloaded and marked executable: {}",
                    path.display()
                ),
            ));
        }
        if lower.ends_with(".pkg.tar.zst") {
            if let Some(parent) = path.parent() {
                let _ = Command::new("xdg-open").arg(parent).spawn();
            }
            return Ok((
                false,
                format!("Arch/CachyOS paketi indirildi. Kurmak için uçbirimde çalıştırın: sudo pacman -U \"{}\"", path.display()),
                format!("Arch/CachyOS package downloaded. Install via: sudo pacman -U \"{}\"", path.display()),
            ));
        }
        let _ = lower;
        Ok((
            false,
            format!("Paket indirildi: {}", path.display()),
            format!("Package downloaded: {}", path.display()),
        ))
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (path, lower);
        Ok((
            false,
            "Güncelleme indirildi.".into(),
            "Update downloaded.".into(),
        ))
    }
}

pub fn verify_file_sha256_mismatch_guard(path: &Path, expected: &str) -> Result<(), AppError> {
    let bytes = fs::read(path)?;
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != expected.to_ascii_lowercase() {
        return Err(AppError::Security("SHA-256 uyuşmazlığı".into()));
    }
    Ok(())
}

#[allow(dead_code)]
fn _unused_pathbuf_anchor(_p: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_network_call_without_explicit_permission() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let err = check_for_updates(
                "https://api.github.com/repos/a/b/releases/latest",
                false,
                false,
            )
            .await
            .unwrap_err();
            assert_eq!(err.code(), "NETWORK_DISABLED");
        });
    }

    #[test]
    fn rejects_non_https_manifest_url() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let err = check_for_updates("http://example.com/latest.json", false, true)
                .await
                .unwrap_err();
            assert_eq!(err.code(), "SECURITY_ERROR");
        });
    }

    #[test]
    fn parses_github_release_and_picks_platform_assets() {
        let sample_gh = r#"{
          "tag_name": "v0.2.0",
          "html_url": "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/tag/v0.2.0",
          "body": "Yeni özellikler eklendi.",
          "assets": [
            {
              "name": "ESSVB-Reader_0.2.0_x64-setup.exe",
              "browser_download_url": "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.2.0/ESSVB-Reader_0.2.0_x64-setup.exe",
              "size": 5400000,
              "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            },
            {
              "name": "ESSVB-Reader-0.2.0-windows-x64-portable.zip",
              "browser_download_url": "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.2.0/ESSVB-Reader-0.2.0-windows-x64-portable.zip",
              "size": 4600000
            },
            {
              "name": "essvb-reader-0.2.0-1-x86_64.pkg.tar.zst",
              "browser_download_url": "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.2.0/essvb-reader-0.2.0-1-x86_64.pkg.tar.zst",
              "size": 4200000
            },
            {
              "name": "ESSVB-Reader_0.2.0_amd64.AppImage",
              "browser_download_url": "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.2.0/ESSVB-Reader_0.2.0_amd64.AppImage",
              "size": 92000000
            }
          ]
        }"#;

        let win_inst = parse_release_payload(sample_gh, false, true, false, None).unwrap();
        assert!(win_inst.update_available);
        assert_eq!(win_inst.latest_version, "0.2.0");
        assert_eq!(
            win_inst.recommended_asset.as_ref().unwrap().platform_tag,
            "windows-nsis"
        );

        let win_port = parse_release_payload(sample_gh, true, true, false, None).unwrap();
        assert_eq!(
            win_port.recommended_asset.as_ref().unwrap().platform_tag,
            "windows-portable"
        );

        let arch = parse_release_payload(sample_gh, false, false, true, None).unwrap();
        assert_eq!(
            arch.recommended_asset.as_ref().unwrap().platform_tag,
            "arch-pkg"
        );
    }

    #[test]
    fn blocks_unconfirmed_or_non_github_downloads() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let tmp = tempfile::TempDir::new().unwrap();
            let err_unconfirmed = download_and_launch_update(
                tmp.path(),
                "https://github.com/ibrahimsaglammm/ESSVB-Reader/releases/download/v0.2.0/setup.exe",
                "setup.exe",
                None,
                false,
            )
            .await
            .unwrap_err();
            assert_eq!(err_unconfirmed.code(), "NETWORK_DISABLED");

            let err_host = download_and_launch_update(
                tmp.path(),
                "https://evil.example/setup.exe",
                "setup.exe",
                None,
                true,
            )
            .await
            .unwrap_err();
            assert_eq!(err_host.code(), "SECURITY_ERROR");
        });
    }

    #[test]
    fn reports_version_0_1_0() {
        let info = get_app_version_info(false);
        assert_eq!(info.version, "0.1.0");
    }
}
