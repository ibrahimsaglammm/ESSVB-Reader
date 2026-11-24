pub mod commands;
pub mod core;
pub mod error;
pub mod library;
pub mod paths;
pub mod settings;
pub mod tts;
pub mod updater;

use std::sync::Arc;
use tauri::Manager;

use crate::commands::AppState;
use crate::library::db::LibraryDb;
use crate::paths::AppPaths;
use crate::tts::TtsManager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            let cache_dir = paths.tts_cache_dir.clone();
            let db = Arc::new(LibraryDb::open(paths)?);
            let tts = Arc::new(TtsManager::new(cache_dir)?);
            app.manage(AppState { db, tts });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version_info_cmd,
            commands::check_for_updates_cmd,
            commands::download_and_apply_update_cmd,
            commands::import_epub_files,
            commands::import_epub_folder,
            commands::list_books,
            commands::update_book_metadata,
            commands::update_reading_progress,
            commands::delete_books,
            commands::list_all_tags,
            commands::set_book_tags,
            commands::bulk_add_tags,
            commands::bulk_set_reading_status,
            commands::list_shelves,
            commands::create_shelf,
            commands::rename_shelf,
            commands::delete_shelf,
            commands::assign_books_to_shelf,
            commands::remove_book_from_shelf,
            commands::get_book_toc,
            commands::load_chapter,
            commands::search_book,
            commands::list_annotations,
            commands::create_annotation,
            commands::update_annotation,
            commands::delete_annotation,
            commands::export_notes_markdown_cmd,
            commands::export_notes_json_cmd,
            commands::export_library_backup_cmd,
            commands::import_library_backup_cmd,
            commands::get_settings,
            commands::save_settings_cmd,
            commands::has_gemini_api_key_cmd,
            commands::set_gemini_api_key_cmd,
            commands::delete_gemini_api_key_cmd,
            commands::get_tts_statuses,
            commands::split_tts_chunks,
            commands::synthesize_tts_chunk,
            commands::list_ollama_models_cmd,
            commands::get_tts_cache_stats,
            commands::clear_tts_cache,
        ])
        .run(tauri::generate_context!())
        .expect("ESSVB-Reader başlatılırken hata oluştu");
}
