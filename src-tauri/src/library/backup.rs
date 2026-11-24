use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::library::db::{AnnotationDto, BookDto, CreateAnnotationInput, LibraryDb, ShelfDto};
use crate::settings::AppSettings;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBackupPayload {
    pub schema_version: u32,
    pub app_version: String,
    pub exported_at: String,
    pub shelves: Vec<ShelfDto>,
    pub books: Vec<BookDto>,
    pub annotations: Vec<AnnotationDto>,
    pub settings: AppSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreBackupResult {
    pub shelves_restored: usize,
    pub books_updated: usize,
    pub annotations_restored: usize,
}

/// Exports the full library catalog, shelves, annotations, and safe settings to JSON.
/// API keys / secrets stored in the OS keyring are NEVER exported.
pub fn export_library_json(
    db: &LibraryDb,
    settings: &AppSettings,
    dest_path: &Path,
) -> Result<(), AppError> {
    let shelves = db.list_shelves()?;
    let books = db
        .list_books(None)?
        .into_iter()
        .map(|mut b| {
            // Keep backup lightweight & portable without bloating JSON with base64 covers.
            b.cover_data_url = None;
            b
        })
        .collect();
    let annotations = db.list_annotations(None, None)?;

    let payload = LibraryBackupPayload {
        schema_version: 1,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: Utc::now().to_rfc3339(),
        shelves,
        books,
        annotations,
        settings: settings.clone(),
    };

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| AppError::Io(format!("JSON yedek serileştirilemedi: {e}")))?;
    fs::write(dest_path, json)?;
    Ok(())
}

/// Imports a JSON library backup safely (restores shelves, matching book metadata/tags/progress,
/// annotations, and safe non-secret settings).
pub fn import_library_json(
    db: &LibraryDb,
    src_path: &Path,
) -> Result<RestoreBackupResult, AppError> {
    let raw = fs::read_to_string(src_path)?;
    let payload: LibraryBackupPayload = serde_json::from_str(&raw)
        .map_err(|e| AppError::Validation(format!("Geçersiz yedek JSON formatı: {e}")))?;
    if payload.schema_version != 1 {
        return Err(AppError::Validation(format!(
            "Desteklenmeyen yedek şema sürümü: {}",
            payload.schema_version
        )));
    }

    let mut shelves_restored = 0usize;
    for shelf in &payload.shelves {
        db.restore_shelf_record(shelf)?;
        shelves_restored += 1;
    }

    let mut books_updated = 0usize;
    for book in &payload.books {
        db.restore_book_metadata_if_present(book)?;
        books_updated += 1;
    }

    let existing_notes = db.list_annotations(None, None)?;
    let mut annotations_restored = 0usize;
    for note in payload.annotations {
        let already = existing_notes.iter().any(|e| {
            e.book_id == note.book_id
                && e.spine_index == note.spine_index
                && e.quote_text == note.quote_text
                && e.note_text == note.note_text
        });
        if !already && db.get_book_by_id(&note.book_id)?.is_some() {
            let _ = db.create_annotation(CreateAnnotationInput {
                book_id: note.book_id,
                spine_index: note.spine_index,
                chapter_title: note.chapter_title,
                quote_text: note.quote_text,
                note_text: note.note_text,
                color: note.color,
                highlight_style: note.highlight_style,
                start_offset: note.start_offset,
                end_offset: note.end_offset,
            });
            annotations_restored += 1;
        }
    }

    let sanitized_settings = payload.settings.sanitized();
    let settings_json = serde_json::to_string(&sanitized_settings)
        .map_err(|e| AppError::Database(e.to_string()))?;
    db.set_setting_json("app_settings", &settings_json)?;

    Ok(RestoreBackupResult {
        shelves_restored,
        books_updated,
        annotations_restored,
    })
}

/// Exports annotations (for one book or globally) to Markdown.
pub fn export_notes_markdown(
    db: &LibraryDb,
    book_id: Option<&str>,
    dest_path: &Path,
) -> Result<usize, AppError> {
    let notes = db.list_annotations(book_id, None)?;
    let mut md = String::new();
    md.push_str("# ESSVB-Reader Notlar ve Vurgular\n\n");
    md.push_str(&format!(
        "Dışa aktarma tarihi: {}\n\n",
        Utc::now().to_rfc3339()
    ));

    let mut current_book = String::new();
    for item in &notes {
        if item.book_title != current_book {
            current_book = item.book_title.clone();
            md.push_str(&format!("## {}\n\n", current_book));
        }
        md.push_str(&format!(
            "### {} (Renk: {})\n\n",
            if item.chapter_title.is_empty() {
                format!("Bölüm {}", item.spine_index + 1)
            } else {
                item.chapter_title.clone()
            },
            item.color
        ));
        md.push_str(&format!("> {}\n\n", item.quote_text.replace('\n', "\n> ")));
        if !item.note_text.is_empty() {
            md.push_str(&format!("**Not:** {}\n\n", item.note_text));
        }
        md.push_str(&format!("*Tarih:* `{}`\n\n---\n\n", item.updated_at));
    }

    fs::write(dest_path, md)?;
    Ok(notes.len())
}

/// Exports annotations (for one book or globally) to JSON.
pub fn export_notes_json(
    db: &LibraryDb,
    book_id: Option<&str>,
    dest_path: &Path,
) -> Result<usize, AppError> {
    let notes = db.list_annotations(book_id, None)?;
    let json = serde_json::to_string_pretty(&notes)
        .map_err(|e| AppError::Io(format!("Notlar JSON olarak yazılamadı: {e}")))?;
    fs::write(dest_path, json)?;
    Ok(notes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::AppPaths;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn make_test_epub_file() -> NamedTempFile {
        let tmp = NamedTempFile::new().unwrap();
        let mut zw = ZipWriter::new(tmp.reopen().unwrap());
        let opts = SimpleFileOptions::default();
        zw.start_file("META-INF/container.xml", opts).unwrap();
        zw.write_all(
            br#"<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
        )
        .unwrap();
        zw.start_file("content.opf", opts).unwrap();
        zw.write_all(
            r#"<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Kitabı</dc:title>
    <dc:creator>Deneme Yazar</dc:creator>
    <dc:language>tr</dc:language>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>"#
                .as_bytes(),
        )
        .unwrap();
        zw.start_file("ch1.xhtml", opts).unwrap();
        zw.write_all(b"<html><body><p>Deneme metni.</p></body></html>")
            .unwrap();
        zw.finish().unwrap();
        tmp
    }

    #[test]
    fn library_shelves_tags_notes_and_backup_roundtrip() {
        let dir = TempDir::new().unwrap();
        let paths = AppPaths::from_base_dir(dir.path().to_path_buf(), true).unwrap();
        let db = LibraryDb::open(paths).unwrap();

        let epub = make_test_epub_file();
        let epub_path = dir.path().join("sample.epub");
        fs::copy(epub.path(), &epub_path).unwrap();

        let summary = db.import_epub_paths(&[epub_path]).unwrap();
        assert_eq!(summary.imported.len(), 1);
        let book_id = summary.imported[0].id.clone();

        let shelf1 = db.create_shelf("Favoriler").unwrap();
        let shelf2 = db.create_shelf("Okuma Listem").unwrap();
        db.assign_books_to_shelf(std::slice::from_ref(&book_id), &shelf1.id)
            .unwrap();
        db.assign_books_to_shelf(std::slice::from_ref(&book_id), &shelf2.id)
            .unwrap();
        db.set_book_tags(&book_id, &["bilim".into(), "klasik".into()])
            .unwrap();

        let fetched = db.get_book_by_id(&book_id).unwrap().unwrap();
        assert_eq!(fetched.shelf_ids.len(), 2);
        assert_eq!(fetched.tags.len(), 2);

        let note = db
            .create_annotation(CreateAnnotationInput {
                book_id: book_id.clone(),
                spine_index: 0,
                chapter_title: "Bölüm 1".into(),
                quote_text: "Deneme metni.".into(),
                note_text: "Önemli alıntı".into(),
                color: "yellow".into(),
                highlight_style: "solid".into(),
                start_offset: 0,
                end_offset: 13,
            })
            .unwrap();
        assert_eq!(db.list_annotations(None, Some("Önemli")).unwrap().len(), 1);

        let backup_json = dir.path().join("backup.json");
        export_library_json(&db, &AppSettings::default(), &backup_json).unwrap();
        let raw_backup = fs::read_to_string(&backup_json).unwrap();
        assert!(!raw_backup.contains("AIza")); // Never stores keys
        assert!(raw_backup.contains("Favoriler"));

        let notes_md = dir.path().join("notes.md");
        let count_md = export_notes_markdown(&db, Some(&book_id), &notes_md).unwrap();
        assert_eq!(count_md, 1);
        assert!(fs::read_to_string(&notes_md)
            .unwrap()
            .contains("Önemli alıntı"));

        db.delete_annotation(&note.id).unwrap();
        let restore_res = import_library_json(&db, &backup_json).unwrap();
        assert_eq!(restore_res.annotations_restored, 1);
    }
}
