use std::path::{Path, PathBuf};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use tauri::{AppHandle, State};
use tauri_plugin_essvb_tts::{
    CopyContentUriRequest, EssvbTtsExt, MobileTtsInfo, NowPlayingRequest, SpeakChunkRequest,
    SpeakChunkResponse,
};
use uuid::Uuid;

use crate::assistant::{
    assist_selected_text, open_external_url, TextAssistRequest, TextAssistResponse,
};
use crate::core::document::{
    compute_spine_char_counts, get_document_toc, is_supported_book_extension,
    load_document_chapter, search_document,
};
use crate::core::epub::{BookSearchMatch, ChapterContent, TocItem};
use crate::error::AppError;
use crate::library::backup::{
    export_library_json, export_notes_json, export_notes_markdown, import_library_json,
    RestoreBackupResult,
};
use crate::library::db::{
    AnnotationDto, BookDto, BookFilterQuery, BookMetadataUpdate, BookmarkDto,
    CreateAnnotationInput, CreateBookmarkInput, ImportSummary, LibraryDb, ShelfDto,
};
use crate::settings::secrets::{delete_gemini_api_key, has_gemini_api_key, set_gemini_api_key};
use crate::settings::{load_settings, save_settings, AppSettings};
use crate::tts::cache::TtsCacheStats;
use crate::tts::chunker::{split_text_for_tts, TextChunk};
use crate::tts::ollama::list_ollama_models;
use crate::tts::provider::{TtsProviderStatus, TtsSynthesisResponse};
use crate::tts::TtsManager;
use crate::updater::{
    check_for_updates, download_and_launch_update, get_app_version_info, AppVersionInfo,
    UpdateApplyResult, UpdateCheckResult,
};

pub struct AppState {
    pub db: Arc<LibraryDb>,
    pub tts: Arc<TtsManager>,
}

#[tauri::command]
pub fn get_app_version_info_cmd(state: State<'_, AppState>) -> AppVersionInfo {
    get_app_version_info(state.db.paths().is_portable)
}

#[tauri::command]
pub async fn check_for_updates_cmd(
    state: State<'_, AppState>,
    explicit_user_request: bool,
) -> Result<UpdateCheckResult, AppError> {
    let settings = load_settings(&state.db)?;
    let permitted = explicit_user_request || settings.auto_update_enabled;
    check_for_updates(
        &settings.update_manifest_url,
        state.db.paths().is_portable,
        permitted,
    )
    .await
}

#[tauri::command]
pub async fn download_and_apply_update_cmd(
    state: State<'_, AppState>,
    download_url: String,
    file_name: String,
    expected_sha256: Option<String>,
    user_confirmed: bool,
) -> Result<UpdateApplyResult, AppError> {
    let updates_dir = state.db.paths().base_dir.join("updates");
    download_and_launch_update(
        &updates_dir,
        &download_url,
        &file_name,
        expected_sha256,
        user_confirmed,
    )
    .await
}

#[tauri::command]
pub async fn import_epub_files(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportSummary, AppError> {
    let mut resolved_paths: Vec<PathBuf> = Vec::with_capacity(paths.len());
    let mut staged_temps: Vec<PathBuf> = Vec::new();
    let mut stage_failures: Vec<String> = Vec::new();

    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("content://") || trimmed.starts_with("file://") {
            match app.essvb_tts().copy_content_uri(CopyContentUriRequest {
                uri: trimmed.to_string(),
            }) {
                Ok(staged) => {
                    let p = PathBuf::from(&staged.path);
                    staged_temps.push(p.clone());
                    resolved_paths.push(p);
                }
                Err(e) => {
                    stage_failures.push(format!("{trimmed}: {e}"));
                }
            }
        } else {
            resolved_paths.push(PathBuf::from(trimmed));
        }
    }

    let db = Arc::clone(&state.db);
    let mut summary = tokio::task::spawn_blocking(move || {
        let out = db.import_epub_paths(&resolved_paths);
        for tmp in staged_temps {
            let _ = std::fs::remove_file(tmp);
        }
        out
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;

    summary.failed.extend(stage_failures);
    Ok(summary)
}

#[tauri::command]
pub async fn get_book_file_base64(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<String, AppError> {
    const MAX_FILE_BYTES: u64 = 150 * 1024 * 1024;
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
        let path = db.get_book_epub_path(&book_id)?;
        let meta = std::fs::metadata(&path)?;
        if meta.len() > MAX_FILE_BYTES {
            return Err(AppError::Security(
                "Belge boyutu güvenlik sınırını aşıyor".into(),
            ));
        }
        let bytes = std::fs::read(&path)?;
        Ok(BASE64_STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn import_epub_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<ImportSummary, AppError> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || db.import_epub_folder(&PathBuf::from(folder_path)))
        .await
        .map_err(|e| AppError::Io(e.to_string()))?
}

#[tauri::command]
pub fn list_books(
    state: State<'_, AppState>,
    filter: Option<BookFilterQuery>,
) -> Result<Vec<BookDto>, AppError> {
    state.db.list_books(filter)
}

#[tauri::command]
pub fn update_book_metadata(
    state: State<'_, AppState>,
    book_id: String,
    update: BookMetadataUpdate,
) -> Result<BookDto, AppError> {
    state.db.update_book_metadata(&book_id, update)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_reading_progress(
    state: State<'_, AppState>,
    book_id: String,
    spine_index: usize,
    scroll_offset: f64,
    progress_percent: f64,
    reading_status: Option<String>,
    last_page_index: Option<usize>,
    last_char_offset: Option<usize>,
) -> Result<(), AppError> {
    state.db.update_reading_progress(
        &book_id,
        spine_index,
        scroll_offset,
        progress_percent,
        reading_status,
        last_page_index,
        last_char_offset,
    )
}

#[tauri::command]
pub fn update_tts_progress(
    state: State<'_, AppState>,
    book_id: String,
    tts_spine_index: usize,
    tts_char_offset: usize,
    tts_page_number: usize,
    tts_snippet: String,
) -> Result<(), AppError> {
    state.db.update_tts_progress(
        &book_id,
        tts_spine_index,
        tts_char_offset,
        tts_page_number,
        &tts_snippet,
    )
}

#[tauri::command]
pub fn delete_books(state: State<'_, AppState>, book_ids: Vec<String>) -> Result<usize, AppError> {
    state.db.delete_books(&book_ids)
}

#[tauri::command]
pub fn list_all_tags(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    state.db.list_all_tags()
}

#[tauri::command]
pub fn set_book_tags(
    state: State<'_, AppState>,
    book_id: String,
    tags: Vec<String>,
) -> Result<(), AppError> {
    state.db.set_book_tags(&book_id, &tags)
}

#[tauri::command]
pub fn bulk_add_tags(
    state: State<'_, AppState>,
    book_ids: Vec<String>,
    tags: Vec<String>,
) -> Result<(), AppError> {
    state.db.bulk_add_tags(&book_ids, &tags)
}

#[tauri::command]
pub fn bulk_set_reading_status(
    state: State<'_, AppState>,
    book_ids: Vec<String>,
    status: String,
) -> Result<(), AppError> {
    state.db.bulk_set_reading_status(&book_ids, &status)
}

#[tauri::command]
pub fn list_shelves(state: State<'_, AppState>) -> Result<Vec<ShelfDto>, AppError> {
    state.db.list_shelves()
}

#[tauri::command]
pub fn create_shelf(state: State<'_, AppState>, name: String) -> Result<ShelfDto, AppError> {
    state.db.create_shelf(&name)
}

#[tauri::command]
pub fn rename_shelf(
    state: State<'_, AppState>,
    shelf_id: String,
    new_name: String,
) -> Result<(), AppError> {
    state.db.rename_shelf(&shelf_id, &new_name)
}

#[tauri::command]
pub fn delete_shelf(state: State<'_, AppState>, shelf_id: String) -> Result<(), AppError> {
    state.db.delete_shelf(&shelf_id)
}

#[tauri::command]
pub fn assign_books_to_shelf(
    state: State<'_, AppState>,
    book_ids: Vec<String>,
    shelf_id: String,
) -> Result<(), AppError> {
    state.db.assign_books_to_shelf(&book_ids, &shelf_id)
}

#[tauri::command]
pub fn remove_book_from_shelf(
    state: State<'_, AppState>,
    book_id: String,
    shelf_id: String,
) -> Result<(), AppError> {
    state.db.remove_book_from_shelf(&book_id, &shelf_id)
}

#[tauri::command]
pub async fn get_book_toc(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<TocItem>, AppError> {
    let doc_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || get_document_toc(&doc_path))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
}

#[tauri::command]
pub async fn load_chapter(
    state: State<'_, AppState>,
    book_id: String,
    spine_index: usize,
    theme_css: String,
) -> Result<ChapterContent, AppError> {
    let doc_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || load_document_chapter(&doc_path, spine_index, &theme_css))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
}

#[tauri::command]
pub async fn search_book(
    state: State<'_, AppState>,
    book_id: String,
    query: String,
) -> Result<Vec<BookSearchMatch>, AppError> {
    let doc_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || search_document(&doc_path, &query))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
}

#[tauri::command]
pub async fn get_book_page_map(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<usize>, AppError> {
    let doc_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || compute_spine_char_counts(&doc_path))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
}

#[tauri::command]
pub fn list_bookmarks(
    state: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<BookmarkDto>, AppError> {
    state.db.list_bookmarks(&book_id)
}

#[tauri::command]
pub fn create_bookmark(
    state: State<'_, AppState>,
    input: CreateBookmarkInput,
) -> Result<BookmarkDto, AppError> {
    state.db.create_bookmark(input)
}

#[tauri::command]
pub fn delete_bookmark(state: State<'_, AppState>, bookmark_id: String) -> Result<(), AppError> {
    state.db.delete_bookmark(&bookmark_id)
}

#[tauri::command]
pub fn list_annotations(
    state: State<'_, AppState>,
    book_id: Option<String>,
    search: Option<String>,
) -> Result<Vec<AnnotationDto>, AppError> {
    state
        .db
        .list_annotations(book_id.as_deref(), search.as_deref())
}

#[tauri::command]
pub fn create_annotation(
    state: State<'_, AppState>,
    input: CreateAnnotationInput,
) -> Result<AnnotationDto, AppError> {
    state.db.create_annotation(input)
}

#[tauri::command]
pub fn update_annotation(
    state: State<'_, AppState>,
    annotation_id: String,
    note_text: String,
    color: String,
    highlight_style: Option<String>,
) -> Result<(), AppError> {
    state.db.update_annotation(
        &annotation_id,
        &note_text,
        &color,
        highlight_style.as_deref(),
    )
}

#[tauri::command]
pub fn delete_annotation(
    state: State<'_, AppState>,
    annotation_id: String,
) -> Result<(), AppError> {
    state.db.delete_annotation(&annotation_id)
}

#[tauri::command]
pub fn export_notes_markdown_cmd(
    state: State<'_, AppState>,
    book_id: Option<String>,
    dest_path: String,
) -> Result<usize, AppError> {
    export_notes_markdown(&state.db, book_id.as_deref(), &PathBuf::from(dest_path))
}

#[tauri::command]
pub fn export_notes_json_cmd(
    state: State<'_, AppState>,
    book_id: Option<String>,
    dest_path: String,
) -> Result<usize, AppError> {
    export_notes_json(&state.db, book_id.as_deref(), &PathBuf::from(dest_path))
}

#[tauri::command]
pub fn export_library_backup_cmd(
    state: State<'_, AppState>,
    dest_path: String,
) -> Result<(), AppError> {
    let settings = load_settings(&state.db)?;
    export_library_json(&state.db, &settings, &PathBuf::from(dest_path))
}

#[tauri::command]
pub fn import_library_backup_cmd(
    state: State<'_, AppState>,
    src_path: String,
) -> Result<RestoreBackupResult, AppError> {
    import_library_json(&state.db, &PathBuf::from(src_path))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    load_settings(&state.db)
}

#[tauri::command]
pub fn save_settings_cmd(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, AppError> {
    save_settings(&state.db, settings)
}

#[tauri::command]
pub fn has_gemini_api_key_cmd() -> Result<bool, AppError> {
    has_gemini_api_key()
}

#[tauri::command]
pub fn set_gemini_api_key_cmd(api_key: String) -> Result<(), AppError> {
    set_gemini_api_key(&api_key)
}

#[tauri::command]
pub fn delete_gemini_api_key_cmd() -> Result<(), AppError> {
    delete_gemini_api_key()
}

#[tauri::command]
pub async fn get_tts_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<TtsProviderStatus>, AppError> {
    let settings = load_settings(&state.db)?;
    Ok(state.tts.all_statuses(&settings).await)
}

#[tauri::command]
pub fn split_tts_chunks(text: String, max_chars: Option<usize>) -> Vec<TextChunk> {
    split_text_for_tts(&text, max_chars.unwrap_or(340))
}

#[tauri::command]
pub async fn synthesize_tts_chunk(
    state: State<'_, AppState>,
    text: String,
    rate: Option<f32>,
) -> Result<TtsSynthesisResponse, AppError> {
    let settings = load_settings(&state.db)?;
    state.tts.synthesize(&text, &settings, rate).await
}

#[tauri::command]
pub async fn list_ollama_models_cmd(
    state: State<'_, AppState>,
    base_url: Option<String>,
) -> Result<Vec<String>, AppError> {
    let settings = load_settings(&state.db)?;
    let url = base_url.unwrap_or(settings.ollama_url);
    list_ollama_models(&url).await
}

#[tauri::command]
pub fn get_tts_cache_stats(state: State<'_, AppState>) -> Result<TtsCacheStats, AppError> {
    let settings = load_settings(&state.db)?;
    state.tts.cache_stats(&settings)
}

#[tauri::command]
pub fn clear_tts_cache(state: State<'_, AppState>) -> Result<usize, AppError> {
    state.tts.clear_cache()
}

#[tauri::command]
pub async fn assist_selected_text_cmd(
    state: State<'_, AppState>,
    request: TextAssistRequest,
) -> Result<TextAssistResponse, AppError> {
    let settings = load_settings(&state.db)?;
    assist_selected_text(&settings, &request).await
}

#[tauri::command]
pub fn open_external_url_cmd(url: String) -> Result<(), AppError> {
    open_external_url(&url)
}

#[tauri::command]
pub async fn import_book_bytes(
    state: State<'_, AppState>,
    file_name: String,
    bytes_base64: String,
) -> Result<ImportSummary, AppError> {
    const MAX_UPLOAD_BYTES: usize = 150 * 1024 * 1024;
    let safe_name = Path::new(file_name.trim())
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Validation("Geçersiz dosya adı".into()))?
        .to_string();
    let ext = Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_supported_book_extension(&ext) {
        return Err(AppError::Validation(format!(
            "Desteklenmeyen dosya biçimi: {safe_name}"
        )));
    }
    let decoded = BASE64_STANDARD
        .decode(bytes_base64.trim())
        .map_err(|e| AppError::Validation(format!("Dosya verisi çözümlenemedi: {e}")))?;
    if decoded.is_empty() || decoded.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::Security(
            "Dosya boyutu izin verilen sınırı aşıyor veya boş".into(),
        ));
    }

    let db = Arc::clone(&state.db);
    let temp_dir = db.paths().base_dir.join("tmp_imports");
    std::fs::create_dir_all(&temp_dir)?;
    let temp_path = temp_dir.join(format!("{}.{}", Uuid::new_v4(), ext));
    std::fs::write(&temp_path, &decoded)?;

    let res = tokio::task::spawn_blocking(move || {
        let out = db.import_epub_paths(std::slice::from_ref(&temp_path));
        let _ = std::fs::remove_file(&temp_path);
        out
    })
    .await
    .map_err(|e| AppError::Io(e.to_string()))??;
    Ok(res)
}

#[tauri::command]
pub fn mobile_tts_info(app: AppHandle) -> Result<MobileTtsInfo, AppError> {
    app.essvb_tts()
        .get_info()
        .map_err(|e| AppError::Tts(e.to_string()))
}

#[tauri::command]
pub fn mobile_tts_speak_chunk(
    app: AppHandle,
    text: String,
    rate: f32,
    lang: String,
) -> Result<SpeakChunkResponse, AppError> {
    app.essvb_tts()
        .speak_chunk(SpeakChunkRequest { text, rate, lang })
        .map_err(|e| AppError::Tts(e.to_string()))
}

#[tauri::command]
pub fn mobile_tts_pause(app: AppHandle) -> Result<(), AppError> {
    app.essvb_tts()
        .pause()
        .map_err(|e| AppError::Tts(e.to_string()))
}

#[tauri::command]
pub fn mobile_tts_resume(app: AppHandle) -> Result<(), AppError> {
    app.essvb_tts()
        .resume()
        .map_err(|e| AppError::Tts(e.to_string()))
}

#[tauri::command]
pub fn mobile_tts_stop(app: AppHandle) -> Result<(), AppError> {
    app.essvb_tts()
        .stop()
        .map_err(|e| AppError::Tts(e.to_string()))
}

#[tauri::command]
pub fn mobile_tts_update_now_playing(
    app: AppHandle,
    title: String,
    author: String,
    chapter: String,
    playing: bool,
) -> Result<(), AppError> {
    app.essvb_tts()
        .update_now_playing(NowPlayingRequest {
            title,
            author,
            chapter,
            playing,
        })
        .map_err(|e| AppError::Tts(e.to_string()))
}
