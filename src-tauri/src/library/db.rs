use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::core::epub::parse_epub_metadata;
use crate::error::AppError;
use crate::paths::{ensure_inside, AppPaths};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShelfDto {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub book_count: usize,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDto {
    pub id: String,
    pub title: String,
    pub author: String,
    pub language: String,
    pub publisher: String,
    pub description: String,
    pub series: String,
    pub genre: String,
    pub reading_status: String,
    pub progress_percent: f64,
    pub last_spine_index: usize,
    pub last_scroll_offset: f64,
    pub spine_count: usize,
    pub epub_version: String,
    pub file_hash: String,
    pub cover_data_url: Option<String>,
    pub shelf_ids: Vec<String>,
    pub tags: Vec<String>,
    pub added_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
}

fn default_highlight_style() -> String {
    "solid".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDto {
    pub id: String,
    pub book_id: String,
    pub book_title: String,
    pub spine_index: usize,
    pub chapter_title: String,
    pub quote_text: String,
    pub note_text: String,
    pub color: String,
    #[serde(default = "default_highlight_style")]
    pub highlight_style: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadataUpdate {
    pub title: String,
    pub author: String,
    pub language: String,
    pub publisher: String,
    pub description: String,
    pub series: String,
    pub genre: String,
    pub reading_status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFilterQuery {
    pub search: Option<String>,
    pub shelf_id: Option<String>,
    pub tag: Option<String>,
    pub genre: Option<String>,
    pub author: Option<String>,
    pub series: Option<String>,
    pub reading_status: Option<String>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnotationInput {
    pub book_id: String,
    pub spine_index: usize,
    pub chapter_title: String,
    pub quote_text: String,
    pub note_text: String,
    pub color: String,
    #[serde(default = "default_highlight_style")]
    pub highlight_style: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: Vec<BookDto>,
    pub skipped_duplicates: Vec<String>,
    pub failed: Vec<String>,
}

pub struct LibraryDb {
    conn: Mutex<Connection>,
    paths: AppPaths,
}

impl LibraryDb {
    pub fn open(paths: AppPaths) -> Result<Self, AppError> {
        let conn = Connection::open(&paths.db_path)?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            ",
        )?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            paths,
        })
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    fn migrate(conn: &Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                language TEXT NOT NULL,
                publisher TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                series TEXT NOT NULL DEFAULT '',
                genre TEXT NOT NULL DEFAULT '',
                reading_status TEXT NOT NULL DEFAULT 'to_read',
                progress_percent REAL NOT NULL DEFAULT 0.0,
                last_spine_index INTEGER NOT NULL DEFAULT 0,
                last_scroll_offset REAL NOT NULL DEFAULT 0.0,
                spine_count INTEGER NOT NULL DEFAULT 1,
                file_path TEXT NOT NULL,
                cover_path TEXT,
                file_hash TEXT NOT NULL UNIQUE,
                epub_version TEXT NOT NULL DEFAULT '2.0',
                added_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_opened_at TEXT
            );

            CREATE TABLE IF NOT EXISTS shelves (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS book_shelves (
                book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
                PRIMARY KEY (book_id, shelf_id)
            );

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );

            CREATE TABLE IF NOT EXISTS book_tags (
                book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (book_id, tag_id)
            );

            CREATE TABLE IF NOT EXISTS annotations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                spine_index INTEGER NOT NULL,
                chapter_title TEXT NOT NULL DEFAULT '',
                quote_text TEXT NOT NULL,
                note_text TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT 'yellow',
                highlight_style TEXT NOT NULL DEFAULT 'solid',
                start_offset INTEGER NOT NULL DEFAULT 0,
                end_offset INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_books_status ON books(reading_status);
            CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id, spine_index);
            ",
        )?;

        let mut has_highlight_style = false;
        {
            let mut stmt = conn.prepare("PRAGMA table_info(annotations)")?;
            let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for col in cols {
                if col? == "highlight_style" {
                    has_highlight_style = true;
                    break;
                }
            }
        }
        if !has_highlight_style {
            conn.execute(
                "ALTER TABLE annotations ADD COLUMN highlight_style TEXT NOT NULL DEFAULT 'solid'",
                [],
            )?;
        }
        Ok(())
    }

    pub fn get_setting_json(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let val = conn
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(val)
    }

    pub fn set_setting_json(&self, key: &str, value_json: &str) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        conn.execute(
            "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![key, value_json],
        )?;
        Ok(())
    }

    pub fn import_epub_paths(&self, source_paths: &[PathBuf]) -> Result<ImportSummary, AppError> {
        let mut imported = Vec::new();
        let mut skipped_duplicates = Vec::new();
        let mut failed = Vec::new();

        for src in source_paths {
            let ext_ok = src
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("epub"))
                .unwrap_or(false);
            if !ext_ok {
                failed.push(format!("{} (desteklenmeyen uzantı)", src.display()));
                continue;
            }

            match self.import_single_epub(src) {
                Ok(Some(book)) => imported.push(book),
                Ok(None) => skipped_duplicates.push(src.display().to_string()),
                Err(e) => failed.push(format!("{}: {e}", src.display())),
            }
        }

        Ok(ImportSummary {
            imported,
            skipped_duplicates,
            failed,
        })
    }

    pub fn import_epub_folder(&self, folder: &Path) -> Result<ImportSummary, AppError> {
        if !folder.is_dir() {
            return Err(AppError::Validation("Seçilen yol bir klasör değil".into()));
        }
        let mut found = Vec::new();
        collect_epub_files_recursive(folder, &mut found, 0)?;
        self.import_epub_paths(&found)
    }

    fn import_single_epub(&self, src: &Path) -> Result<Option<BookDto>, AppError> {
        let file_hash = compute_file_sha256(src)?;

        {
            let conn = self
                .conn
                .lock()
                .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
            let existing: Option<String> = conn
                .query_row(
                    "SELECT id FROM books WHERE file_hash = ?1",
                    params![file_hash],
                    |row| row.get(0),
                )
                .optional()?;
            if existing.is_some() {
                return Ok(None);
            }
        }

        let parsed = parse_epub_metadata(src)?;
        let book_id = Uuid::new_v4().to_string();
        let dest_epub = self.paths.books_dir.join(format!("{book_id}.epub"));
        fs::copy(src, &dest_epub)?;

        let cover_rel_opt = if let Some(cover_bytes) = parsed.cover_bytes {
            let cover_file = self.paths.covers_dir.join(format!("{book_id}.jpg"));
            fs::write(&cover_file, cover_bytes)?;
            Some(format!("{book_id}.jpg"))
        } else {
            None
        };

        let now = Utc::now().to_rfc3339();
        {
            let conn = self
                .conn
                .lock()
                .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
            conn.execute(
                "INSERT INTO books (
                    id, title, author, language, publisher, description, series, genre,
                    reading_status, progress_percent, last_spine_index, last_scroll_offset,
                    spine_count, file_path, cover_path, file_hash, epub_version, added_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'to_read', 0.0, 0, 0.0, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    book_id,
                    parsed.title,
                    parsed.author,
                    parsed.language,
                    parsed.publisher,
                    parsed.description,
                    parsed.series,
                    parsed.genre,
                    parsed.spine_count as i64,
                    format!("{book_id}.epub"),
                    cover_rel_opt,
                    file_hash,
                    parsed.epub_version,
                    now
                ],
            )?;
        }

        self.get_book_by_id(&book_id)
    }

    pub fn get_book_epub_path(&self, book_id: &str) -> Result<PathBuf, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let rel_path: String = conn
            .query_row(
                "SELECT file_path FROM books WHERE id = ?1",
                params![book_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("Kitap bulunamadı: {book_id}")))?;
        let candidate = self.paths.books_dir.join(rel_path);
        ensure_inside(&self.paths.books_dir, &candidate)
    }

    pub fn get_book_by_id(&self, book_id: &str) -> Result<Option<BookDto>, AppError> {
        let books = self.list_books(None)?;
        Ok(books.into_iter().find(|b| b.id == book_id))
    }

    pub fn list_books(&self, filter: Option<BookFilterQuery>) -> Result<Vec<BookDto>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let shelf_map = load_book_shelves_map(&conn)?;
        let tag_map = load_book_tags_map(&conn)?;

        let sort_col = match filter.as_ref().and_then(|f| f.sort_by.as_deref()) {
            Some("title") => "title COLLATE NOCASE",
            Some("author") => "author COLLATE NOCASE",
            Some("series") => "series COLLATE NOCASE",
            Some("progress") => "progress_percent",
            Some("lastOpened") => "COALESCE(last_opened_at, added_at)",
            _ => "added_at",
        };
        let sort_dir = match filter.as_ref().and_then(|f| f.sort_dir.as_deref()) {
            Some("asc") => "ASC",
            _ => "DESC",
        };

        let sql = format!(
            "SELECT id, title, author, language, publisher, description, series, genre,
                    reading_status, progress_percent, last_spine_index, last_scroll_offset,
                    spine_count, epub_version, file_hash, cover_path, added_at, updated_at, last_opened_at
             FROM books
             ORDER BY {sort_col} {sort_dir}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let cover_rel: Option<String> = row.get(15)?;
            Ok((
                id,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, f64>(9)?,
                row.get::<_, i64>(10)?,
                row.get::<_, f64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
                cover_rel,
                row.get::<_, String>(16)?,
                row.get::<_, String>(17)?,
                row.get::<_, Option<String>>(18)?,
            ))
        })?;

        let mut list = Vec::new();
        for item in rows {
            let (
                id,
                title,
                author,
                language,
                publisher,
                description,
                series,
                genre,
                reading_status,
                progress_percent,
                last_spine_index,
                last_scroll_offset,
                spine_count,
                epub_version,
                file_hash,
                cover_rel,
                added_at,
                updated_at,
                last_opened_at,
            ) = item?;

            let shelf_ids = shelf_map.get(&id).cloned().unwrap_or_default();
            let tags = tag_map.get(&id).cloned().unwrap_or_default();
            let cover_data_url =
                cover_rel.and_then(|rel| load_cover_data_url(&self.paths.covers_dir, &rel));

            let dto = BookDto {
                id,
                title,
                author,
                language,
                publisher,
                description,
                series,
                genre,
                reading_status,
                progress_percent,
                last_spine_index: last_spine_index.max(0) as usize,
                last_scroll_offset,
                spine_count: spine_count.max(1) as usize,
                epub_version,
                file_hash,
                cover_data_url,
                shelf_ids,
                tags,
                added_at,
                updated_at,
                last_opened_at,
            };

            if let Some(ref f) = filter {
                if !matches_filter(&dto, f) {
                    continue;
                }
            }
            list.push(dto);
        }

        Ok(list)
    }

    pub fn update_book_metadata(
        &self,
        book_id: &str,
        update: BookMetadataUpdate,
    ) -> Result<BookDto, AppError> {
        let status = validate_reading_status(&update.reading_status)?;
        let title = update.title.trim();
        if title.is_empty() {
            return Err(AppError::Validation("Kitap başlığı boş olamaz".into()));
        }
        let now = Utc::now().to_rfc3339();
        {
            let conn = self
                .conn
                .lock()
                .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
            let changed = conn.execute(
                "UPDATE books SET
                    title = ?1, author = ?2, language = ?3, publisher = ?4,
                    description = ?5, series = ?6, genre = ?7, reading_status = ?8, updated_at = ?9
                 WHERE id = ?10",
                params![
                    title,
                    update.author.trim(),
                    update.language.trim(),
                    update.publisher.trim(),
                    update.description.trim(),
                    update.series.trim(),
                    update.genre.trim(),
                    status,
                    now,
                    book_id
                ],
            )?;
            if changed == 0 {
                return Err(AppError::NotFound(format!("Kitap bulunamadı: {book_id}")));
            }
        }
        self.get_book_by_id(book_id)?
            .ok_or_else(|| AppError::NotFound(book_id.to_string()))
    }

    pub fn update_reading_progress(
        &self,
        book_id: &str,
        spine_index: usize,
        scroll_offset: f64,
        progress_percent: f64,
        reading_status: Option<String>,
    ) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let now = Utc::now().to_rfc3339();
        let clamped_pct = progress_percent.clamp(0.0, 100.0);
        let clamped_scroll = scroll_offset.clamp(0.0, 1.0);

        if let Some(status_raw) = reading_status {
            let status = validate_reading_status(&status_raw)?;
            conn.execute(
                "UPDATE books SET
                    last_spine_index = ?1, last_scroll_offset = ?2, progress_percent = ?3,
                    reading_status = ?4, last_opened_at = ?5, updated_at = ?5
                 WHERE id = ?6",
                params![
                    spine_index as i64,
                    clamped_scroll,
                    clamped_pct,
                    status,
                    now,
                    book_id
                ],
            )?;
        } else {
            // Auto-transition to_read -> reading when progress advances
            conn.execute(
                "UPDATE books SET
                    last_spine_index = ?1, last_scroll_offset = ?2, progress_percent = ?3,
                    reading_status = CASE
                        WHEN ?3 >= 99.5 THEN 'finished'
                        WHEN reading_status = 'to_read' AND (?1 > 0 OR ?2 > 0.01) THEN 'reading'
                        ELSE reading_status
                    END,
                    last_opened_at = ?4, updated_at = ?4
                 WHERE id = ?5",
                params![
                    spine_index as i64,
                    clamped_scroll,
                    clamped_pct,
                    now,
                    book_id
                ],
            )?;
        }
        Ok(())
    }

    pub fn delete_books(&self, book_ids: &[String]) -> Result<usize, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let mut deleted = 0usize;
        for id in book_ids {
            let row: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT file_path, cover_path FROM books WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((epub_rel, cover_rel)) = row {
                conn.execute("DELETE FROM books WHERE id = ?1", params![id])?;
                if let Ok(p) =
                    ensure_inside(&self.paths.books_dir, &self.paths.books_dir.join(epub_rel))
                {
                    let _ = fs::remove_file(p);
                }
                if let Some(c) = cover_rel {
                    if let Ok(p) =
                        ensure_inside(&self.paths.covers_dir, &self.paths.covers_dir.join(c))
                    {
                        let _ = fs::remove_file(p);
                    }
                }
                deleted += 1;
            }
        }
        Ok(deleted)
    }

    pub fn list_shelves(&self) -> Result<Vec<ShelfDto>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let mut stmt = conn.prepare(
            "SELECT s.id, s.name, s.sort_order, s.created_at, COUNT(bs.book_id)
             FROM shelves s
             LEFT JOIN book_shelves bs ON bs.shelf_id = s.id
             GROUP BY s.id
             ORDER BY s.sort_order ASC, s.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ShelfDto {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
                book_count: row.get::<_, i64>(4)?.max(0) as usize,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn create_shelf(&self, name: &str) -> Result<ShelfDto, AppError> {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.len() > 80 {
            return Err(AppError::Validation(
                "Raf adı 1 ile 80 karakter arasında olmalıdır".into(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let max_order: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order), 0) FROM shelves",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO shelves (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, trimmed, max_order + 1, now],
        )
        .map_err(|e| AppError::Validation(format!("Raf oluşturulamadı (aynı ad olabilir): {e}")))?;

        Ok(ShelfDto {
            id,
            name: trimmed.to_string(),
            sort_order: max_order + 1,
            book_count: 0,
            created_at: now,
        })
    }

    pub fn rename_shelf(&self, shelf_id: &str, new_name: &str) -> Result<(), AppError> {
        let trimmed = new_name.trim();
        if trimmed.is_empty() || trimmed.len() > 80 {
            return Err(AppError::Validation(
                "Raf adı 1 ile 80 karakter arasında olmalıdır".into(),
            ));
        }
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let updated = conn.execute(
            "UPDATE shelves SET name = ?1 WHERE id = ?2",
            params![trimmed, shelf_id],
        )?;
        if updated == 0 {
            return Err(AppError::NotFound("Raf bulunamadı".into()));
        }
        Ok(())
    }

    pub fn delete_shelf(&self, shelf_id: &str) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let deleted = conn.execute("DELETE FROM shelves WHERE id = ?1", params![shelf_id])?;
        if deleted == 0 {
            return Err(AppError::NotFound("Raf bulunamadı".into()));
        }
        Ok(())
    }

    pub fn assign_books_to_shelf(
        &self,
        book_ids: &[String],
        shelf_id: &str,
    ) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        for book_id in book_ids {
            conn.execute(
                "INSERT OR IGNORE INTO book_shelves (book_id, shelf_id) VALUES (?1, ?2)",
                params![book_id, shelf_id],
            )?;
        }
        Ok(())
    }

    pub fn remove_book_from_shelf(&self, book_id: &str, shelf_id: &str) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        conn.execute(
            "DELETE FROM book_shelves WHERE book_id = ?1 AND shelf_id = ?2",
            params![book_id, shelf_id],
        )?;
        Ok(())
    }

    pub fn set_book_tags(&self, book_id: &str, tags: &[String]) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        conn.execute("DELETE FROM book_tags WHERE book_id = ?1", params![book_id])?;
        for raw_tag in tags {
            let t = raw_tag.trim();
            if t.is_empty() || t.len() > 50 {
                continue;
            }
            let tag_id = ensure_tag(&conn, t)?;
            conn.execute(
                "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
                params![book_id, tag_id],
            )?;
        }
        Ok(())
    }

    pub fn bulk_add_tags(&self, book_ids: &[String], tags: &[String]) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        for raw_tag in tags {
            let t = raw_tag.trim();
            if t.is_empty() || t.len() > 50 {
                continue;
            }
            let tag_id = ensure_tag(&conn, t)?;
            for book_id in book_ids {
                conn.execute(
                    "INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?1, ?2)",
                    params![book_id, tag_id],
                )?;
            }
        }
        Ok(())
    }

    pub fn bulk_set_reading_status(
        &self,
        book_ids: &[String],
        status: &str,
    ) -> Result<(), AppError> {
        let valid = validate_reading_status(status)?;
        let now = Utc::now().to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        for id in book_ids {
            conn.execute(
                "UPDATE books SET reading_status = ?1, updated_at = ?2 WHERE id = ?3",
                params![valid, now, id],
            )?;
        }
        Ok(())
    }

    pub fn list_all_tags(&self) -> Result<Vec<String>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let mut stmt = conn.prepare(
            "SELECT DISTINCT t.name FROM tags t
             INNER JOIN book_tags bt ON bt.tag_id = t.id
             ORDER BY t.name COLLATE NOCASE ASC",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn create_annotation(
        &self,
        input: CreateAnnotationInput,
    ) -> Result<AnnotationDto, AppError> {
        let quote = input.quote_text.trim();
        if quote.is_empty() {
            return Err(AppError::Validation("Vurgulanacak metin boş olamaz".into()));
        }
        let color = validate_highlight_color(&input.color)?;
        let highlight_style = validate_highlight_style(&input.highlight_style)?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let book_title: String = conn
            .query_row(
                "SELECT title FROM books WHERE id = ?1",
                params![input.book_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound("Kitap bulunamadı".into()))?;

        conn.execute(
            "INSERT INTO annotations (
                id, book_id, spine_index, chapter_title, quote_text, note_text, color,
                highlight_style, start_offset, end_offset, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id,
                input.book_id,
                input.spine_index as i64,
                input.chapter_title.trim(),
                quote,
                input.note_text.trim(),
                color,
                highlight_style,
                input.start_offset as i64,
                input.end_offset as i64,
                now
            ],
        )?;

        Ok(AnnotationDto {
            id,
            book_id: input.book_id,
            book_title,
            spine_index: input.spine_index,
            chapter_title: input.chapter_title.trim().to_string(),
            quote_text: quote.to_string(),
            note_text: input.note_text.trim().to_string(),
            color: color.to_string(),
            highlight_style: highlight_style.to_string(),
            start_offset: input.start_offset,
            end_offset: input.end_offset,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_annotation(
        &self,
        annotation_id: &str,
        note_text: &str,
        color: &str,
        highlight_style: Option<&str>,
    ) -> Result<(), AppError> {
        let valid_color = validate_highlight_color(color)?;
        let valid_style = match highlight_style {
            Some(s) => Some(validate_highlight_style(s)?),
            None => None,
        };
        let now = Utc::now().to_rfc3339();
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let changed = match valid_style {
            Some(style) => conn.execute(
                "UPDATE annotations SET note_text = ?1, color = ?2, highlight_style = ?3, updated_at = ?4 WHERE id = ?5",
                params![note_text.trim(), valid_color, style, now, annotation_id],
            )?,
            None => conn.execute(
                "UPDATE annotations SET note_text = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
                params![note_text.trim(), valid_color, now, annotation_id],
            )?,
        };
        if changed == 0 {
            return Err(AppError::NotFound("Not/vurgu bulunamadı".into()));
        }
        Ok(())
    }

    pub fn delete_annotation(&self, annotation_id: &str) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let deleted = conn.execute(
            "DELETE FROM annotations WHERE id = ?1",
            params![annotation_id],
        )?;
        if deleted == 0 {
            return Err(AppError::NotFound("Not/vurgu bulunamadı".into()));
        }
        Ok(())
    }

    pub fn list_annotations(
        &self,
        book_id: Option<&str>,
        search: Option<&str>,
    ) -> Result<Vec<AnnotationDto>, AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let mut stmt = conn.prepare(
            "SELECT a.id, a.book_id, b.title, a.spine_index, a.chapter_title, a.quote_text,
                    a.note_text, a.color, a.highlight_style, a.start_offset, a.end_offset,
                    a.created_at, a.updated_at
             FROM annotations a
             INNER JOIN books b ON b.id = a.book_id
             ORDER BY a.created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AnnotationDto {
                id: row.get(0)?,
                book_id: row.get(1)?,
                book_title: row.get(2)?,
                spine_index: row.get::<_, i64>(3)?.max(0) as usize,
                chapter_title: row.get(4)?,
                quote_text: row.get(5)?,
                note_text: row.get(6)?,
                color: row.get(7)?,
                highlight_style: row.get(8)?,
                start_offset: row.get::<_, i64>(9)?.max(0) as usize,
                end_offset: row.get::<_, i64>(10)?.max(0) as usize,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;

        let needle = search
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        let mut out = Vec::new();
        for item in rows {
            let dto = item?;
            if let Some(bid) = book_id {
                if dto.book_id != bid {
                    continue;
                }
            }
            if let Some(ref q) = needle {
                let matches = dto.quote_text.to_lowercase().contains(q)
                    || dto.note_text.to_lowercase().contains(q)
                    || dto.book_title.to_lowercase().contains(q)
                    || dto.chapter_title.to_lowercase().contains(q);
                if !matches {
                    continue;
                }
            }
            out.push(dto);
        }
        Ok(out)
    }

    pub fn restore_shelf_record(&self, shelf: &ShelfDto) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        conn.execute(
            "INSERT OR IGNORE INTO shelves (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![shelf.id, shelf.name, shelf.sort_order, shelf.created_at],
        )?;
        Ok(())
    }

    pub fn restore_book_metadata_if_present(&self, book: &BookDto) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::Database("DB kilidi hatası".into()))?;
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM books WHERE file_hash = ?1 OR id = ?2",
                params![book.file_hash, book.id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(target_id) = existing_id else {
            return Ok(());
        };
        let status = validate_reading_status(&book.reading_status).unwrap_or("to_read");
        conn.execute(
            "UPDATE books SET
                title = ?1, author = ?2, language = ?3, publisher = ?4,
                description = ?5, series = ?6, genre = ?7, reading_status = ?8,
                progress_percent = ?9, last_spine_index = ?10, last_scroll_offset = ?11,
                updated_at = ?12
             WHERE id = ?13",
            params![
                book.title,
                book.author,
                book.language,
                book.publisher,
                book.description,
                book.series,
                book.genre,
                status,
                book.progress_percent,
                book.last_spine_index as i64,
                book.last_scroll_offset,
                book.updated_at,
                target_id
            ],
        )?;
        drop(conn);
        for sid in &book.shelf_ids {
            let _ = self.assign_books_to_shelf(std::slice::from_ref(&target_id), sid);
        }
        let _ = self.set_book_tags(&target_id, &book.tags);
        Ok(())
    }
}

fn ensure_tag(conn: &Connection, name: &str) -> Result<String, AppError> {
    if let Some(existing) = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(existing);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name) VALUES (?1, ?2)",
        params![id, name],
    )?;
    Ok(id)
}

fn load_book_shelves_map(conn: &Connection) -> Result<HashMap<String, Vec<String>>, AppError> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT book_id, shelf_id FROM book_shelves")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (b, s) = row?;
        map.entry(b).or_default().push(s);
    }
    Ok(map)
}

fn load_book_tags_map(conn: &Connection) -> Result<HashMap<String, Vec<String>>, AppError> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT bt.book_id, t.name FROM book_tags bt
         INNER JOIN tags t ON t.id = bt.tag_id
         ORDER BY t.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in rows {
        let (b, t) = row?;
        map.entry(b).or_default().push(t);
    }
    Ok(map)
}

fn load_cover_data_url(covers_dir: &Path, rel: &str) -> Option<String> {
    let safe_path = ensure_inside(covers_dir, &covers_dir.join(rel)).ok()?;
    let bytes = fs::read(safe_path).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

fn matches_filter(book: &BookDto, f: &BookFilterQuery) -> bool {
    if let Some(ref shelf_id) = f.shelf_id {
        if !shelf_id.is_empty() && !book.shelf_ids.contains(shelf_id) {
            return false;
        }
    }
    if let Some(ref tag) = f.tag {
        if !tag.is_empty() && !book.tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            return false;
        }
    }
    if let Some(ref genre) = f.genre {
        if !genre.is_empty() && !book.genre.to_lowercase().contains(&genre.to_lowercase()) {
            return false;
        }
    }
    if let Some(ref author) = f.author {
        if !author.is_empty() && !book.author.to_lowercase().contains(&author.to_lowercase()) {
            return false;
        }
    }
    if let Some(ref series) = f.series {
        if !series.is_empty() && !book.series.to_lowercase().contains(&series.to_lowercase()) {
            return false;
        }
    }
    if let Some(ref status) = f.reading_status {
        if !status.is_empty() && book.reading_status != *status {
            return false;
        }
    }
    if let Some(ref search) = f.search {
        let q = search.trim().to_lowercase();
        if !q.is_empty() {
            let hit = book.title.to_lowercase().contains(&q)
                || book.author.to_lowercase().contains(&q)
                || book.series.to_lowercase().contains(&q)
                || book.genre.to_lowercase().contains(&q)
                || book.tags.iter().any(|t| t.to_lowercase().contains(&q));
            if !hit {
                return false;
            }
        }
    }
    true
}

fn validate_reading_status(status: &str) -> Result<&'static str, AppError> {
    match status {
        "to_read" => Ok("to_read"),
        "reading" => Ok("reading"),
        "finished" => Ok("finished"),
        _ => Err(AppError::Validation(format!(
            "Geçersiz okuma durumu: {status}"
        ))),
    }
}

fn validate_highlight_color(color: &str) -> Result<&'static str, AppError> {
    match color {
        "yellow" => Ok("yellow"),
        "green" => Ok("green"),
        "blue" => Ok("blue"),
        "pink" => Ok("pink"),
        "purple" => Ok("purple"),
        _ => Err(AppError::Validation(format!(
            "Geçersiz vurgulama rengi: {color}"
        ))),
    }
}

fn validate_highlight_style(style: &str) -> Result<&'static str, AppError> {
    match style.trim() {
        "" | "solid" => Ok("solid"),
        "underline" => Ok("underline"),
        "strikethrough" => Ok("strikethrough"),
        "wavy" => Ok("wavy"),
        other => Err(AppError::Validation(format!(
            "Geçersiz vurgulama stili: {other}"
        ))),
    }
}

fn compute_file_sha256(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn collect_epub_files_recursive(
    dir: &Path,
    out: &mut Vec<PathBuf>,
    depth: usize,
) -> Result<(), AppError> {
    const MAX_DEPTH: usize = 8;
    const MAX_FILES: usize = 500;
    if depth > MAX_DEPTH || out.len() >= MAX_FILES {
        return Ok(());
    }
    let entries = fs::read_dir(dir)?;
    let mut seen_dirs = HashSet::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if seen_dirs.insert(path.clone()) {
                collect_epub_files_recursive(&path, out, depth + 1)?;
            }
        } else if meta.is_file()
            && path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("epub"))
                .unwrap_or(false)
        {
            out.push(path);
            if out.len() >= MAX_FILES {
                break;
            }
        }
    }
    Ok(())
}
