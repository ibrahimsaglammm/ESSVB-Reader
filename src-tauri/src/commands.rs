use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::assistant::{
    assist_selected_text, open_external_url, TextAssistRequest, TextAssistResponse,
};
use crate::core::epub::{
    get_epub_toc, load_epub_chapter, search_epub_book, BookSearchMatch, ChapterContent, TocItem,
};
use crate::error::AppError;
use crate::library::backup::{
    export_library_json, export_notes_json, export_notes_markdown, import_library_json,
    RestoreBackupResult,
};
use crate::library::db::{
    AnnotationDto, BookDto, BookFilterQuery, BookMetadataUpdate, CreateAnnotationInput,
    ImportSummary, LibraryDb, ShelfDto,
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
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportSummary, AppError> {
    let db = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
        let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        db.import_epub_paths(&path_bufs)
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
pub fn update_reading_progress(
    state: State<'_, AppState>,
    book_id: String,
    spine_index: usize,
    scroll_offset: f64,
    progress_percent: f64,
    reading_status: Option<String>,
) -> Result<(), AppError> {
    state.db.update_reading_progress(
        &book_id,
        spine_index,
        scroll_offset,
        progress_percent,
        reading_status,
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
    let epub_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || get_epub_toc(&epub_path))
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
    let epub_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || load_epub_chapter(&epub_path, spine_index, &theme_css))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
}

#[tauri::command]
pub async fn search_book(
    state: State<'_, AppState>,
    book_id: String,
    query: String,
) -> Result<Vec<BookSearchMatch>, AppError> {
    let epub_path = state.db.get_book_epub_path(&book_id)?;
    tokio::task::spawn_blocking(move || search_epub_book(&epub_path, &query))
        .await
        .map_err(|e| AppError::Epub(e.to_string()))?
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
