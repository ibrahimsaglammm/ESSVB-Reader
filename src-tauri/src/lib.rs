pub mod assistant;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_essvb_tts::init())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            #[cfg(target_os = "android")]
            settings::secrets::init_android_secrets_dir(&paths.base_dir);
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
            commands::update_tts_progress,
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
            commands::get_book_page_map,
            commands::list_bookmarks,
            commands::create_bookmark,
            commands::delete_bookmark,
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
            commands::assist_selected_text_cmd,
            commands::open_external_url_cmd,
            commands::import_book_bytes,
            commands::get_book_file_base64,
            commands::mobile_tts_info,
            commands::mobile_tts_speak_chunk,
            commands::mobile_tts_pause,
            commands::mobile_tts_resume,
            commands::mobile_tts_stop,
            commands::mobile_tts_update_now_playing,
        ])
        .run(tauri::generate_context!())
        .expect("ESSVB-Reader başlatılırken hata oluştu");
}
