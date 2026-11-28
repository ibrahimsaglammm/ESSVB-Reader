pub mod secrets;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::library::db::LibraryDb;

pub const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://api.github.com/repos/ibrahimsaglammm/ESSVB-Reader/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomThemeColors {
    pub background: String,
    pub text: String,
    pub surface: String,
    pub accent: String,
}

impl Default for CustomThemeColors {
    fn default() -> Self {
        Self {
            background: "#f7f3eb".to_string(),
            text: "#1f2933".to_string(),
            surface: "#ebe4d5".to_string(),
            accent: "#0f766e".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub language: String,
    pub theme_preset: String,
    pub follow_system_theme: bool,
    pub custom_theme: CustomThemeColors,
    pub font_family: String,
    pub font_size_px: u16,
    pub line_height: f32,
    pub margin_px: u16,
    pub text_align: String,
    pub show_cover_thumbnails: bool,
    pub tts_provider: String,
    pub tts_rate: f32,
    pub tts_cache_max_mb: u32,
    pub linux_piper_model_path: String,
    pub ollama_url: String,
    pub ollama_model: String,
    pub gemini_tts_enabled: bool,
    pub gemini_model: String,
    pub gemini_voice: String,
    pub gemini_confirm_before_send: bool,
    pub ask_update_on_startup: bool,
    pub auto_update_enabled: bool,
    pub update_check_interval_minutes: u32,
    pub update_manifest_url: String,
    pub last_opened_book_id: Option<String>,
    pub reopen_last_book_on_startup: bool,
    pub reader_layout_mode: String,
    pub tts_follow_page: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "tr".to_string(),
            theme_preset: "light".to_string(),
            follow_system_theme: true,
            custom_theme: CustomThemeColors::default(),
            font_family: "serif".to_string(),
            font_size_px: 18,
            line_height: 1.7,
            margin_px: 48,
            text_align: "left".to_string(),
            show_cover_thumbnails: false,
            tts_provider: "local".to_string(),
            tts_rate: 1.0,
            tts_cache_max_mb: 50,
            linux_piper_model_path: String::new(),
            ollama_url: "http://127.0.0.1:11434".to_string(),
            ollama_model: String::new(),
            gemini_tts_enabled: false,
            gemini_model: "gemini-2.5-flash-preview-tts".to_string(),
            gemini_voice: "Kore".to_string(),
            gemini_confirm_before_send: true,
            ask_update_on_startup: true,
            auto_update_enabled: true,
            update_check_interval_minutes: 60,
            update_manifest_url: DEFAULT_UPDATE_MANIFEST_URL.to_string(),
            last_opened_book_id: None,
            reopen_last_book_on_startup: true,
            reader_layout_mode: "paginated-1".to_string(),
            tts_follow_page: true,
        }
    }
}

impl AppSettings {
    pub fn sanitized(mut self) -> Self {
        self.language = match self.language.as_str() {
            "en" => "en".to_string(),
            _ => "tr".to_string(),
        };
        self.theme_preset = match self.theme_preset.as_str() {
            "dark" | "sepia" | "high-contrast" | "custom" => self.theme_preset,
            _ => "light".to_string(),
        };
        self.custom_theme.background = sanitize_hex_color(&self.custom_theme.background, "#f7f3eb");
        self.custom_theme.text = sanitize_hex_color(&self.custom_theme.text, "#1f2933");
        self.custom_theme.surface = sanitize_hex_color(&self.custom_theme.surface, "#ebe4d5");
        self.custom_theme.accent = sanitize_hex_color(&self.custom_theme.accent, "#0f766e");

        self.font_family = match self.font_family.as_str() {
            "sans" | "mono" => self.font_family,
            _ => "serif".to_string(),
        };
        self.font_size_px = self.font_size_px.clamp(12, 36);
        self.line_height = self.line_height.clamp(1.2, 2.4);
        self.margin_px = self.margin_px.clamp(12, 120);
        self.text_align = match self.text_align.as_str() {
            "justify" => "justify".to_string(),
            _ => "left".to_string(),
        };
        self.tts_provider = match self.tts_provider.as_str() {
            "ollama" | "gemini" => self.tts_provider,
            _ => "local".to_string(),
        };
        self.tts_rate = self.tts_rate.clamp(0.5, 2.0);
        self.tts_cache_max_mb = self.tts_cache_max_mb.clamp(5, 500);
        self.ollama_url = self.ollama_url.trim().to_string();
        if self.ollama_url.is_empty() {
            self.ollama_url = "http://127.0.0.1:11434".to_string();
        }
        self.ollama_model = self.ollama_model.trim().to_string();
        self.gemini_model = if self.gemini_model.trim().is_empty() {
            "gemini-2.5-flash-preview-tts".to_string()
        } else {
            self.gemini_model.trim().to_string()
        };
        self.gemini_voice = if self.gemini_voice.trim().is_empty() {
            "Kore".to_string()
        } else {
            self.gemini_voice.trim().to_string()
        };
        self.update_check_interval_minutes = self.update_check_interval_minutes.clamp(5, 1440);
        self.update_manifest_url = if self.update_manifest_url.trim().is_empty() {
            DEFAULT_UPDATE_MANIFEST_URL.to_string()
        } else {
            self.update_manifest_url.trim().to_string()
        };
        self.last_opened_book_id = self
            .last_opened_book_id
            .take()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty());
        self.reader_layout_mode = match self.reader_layout_mode.as_str() {
            "paginated-2" | "scroll" => self.reader_layout_mode,
            _ => "paginated-1".to_string(),
        };
        self
    }
}

fn sanitize_hex_color(input: &str, fallback: &str) -> String {
    let trimmed = input.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|c| c.is_ascii_hexdigit())
    {
        trimmed.to_string()
    } else {
        fallback.to_string()
    }
}

pub fn load_settings(db: &LibraryDb) -> Result<AppSettings, AppError> {
    match db.get_setting_json("app_settings")? {
        Some(raw) => {
            let parsed: AppSettings = serde_json::from_str(&raw).unwrap_or_default();
            Ok(parsed.sanitized())
        }
        None => Ok(AppSettings::default()),
    }
}

pub fn save_settings(db: &LibraryDb, settings: AppSettings) -> Result<AppSettings, AppError> {
    let clean = settings.sanitized();
    let json = serde_json::to_string(&clean).map_err(|e| AppError::Database(e.to_string()))?;
    db.set_setting_json("app_settings", &json)?;
    Ok(clean)
}
