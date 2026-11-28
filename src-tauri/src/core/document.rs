use std::path::Path;

use crate::core::docx::{
    doc_spine_char_counts, get_doc_toc, load_doc_chapter, parse_doc_metadata, search_doc,
};
use crate::core::epub::{
    get_epub_spine_char_counts, get_epub_toc, load_epub_chapter, parse_epub_metadata,
    search_epub_book, BookSearchMatch, ChapterContent, ParsedEpub, TocItem,
};
use crate::core::pdf_doc::{
    get_pdf_toc, load_pdf_chapter, parse_pdf_metadata, pdf_spine_char_counts, search_pdf,
};
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    Epub,
    Pdf,
    Word,
}

pub fn is_supported_book_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "epub" | "pdf" | "docx" | "doc"
    )
}

pub fn detect_document_kind(path: &Path) -> Result<DocumentKind, AppError> {
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        match ext.to_ascii_lowercase().as_str() {
            "epub" => return Ok(DocumentKind::Epub),
            "pdf" => return Ok(DocumentKind::Pdf),
            "docx" | "doc" => return Ok(DocumentKind::Word),
            _ => {}
        }
    }
    Err(AppError::Validation(format!(
        "Desteklenmeyen belge biçimi: {}",
        path.display()
    )))
}

pub fn parse_document_metadata(path: &Path) -> Result<ParsedEpub, AppError> {
    match detect_document_kind(path)? {
        DocumentKind::Epub => parse_epub_metadata(path),
        DocumentKind::Pdf => parse_pdf_metadata(path),
        DocumentKind::Word => parse_doc_metadata(path),
    }
}

pub fn get_document_toc(path: &Path) -> Result<Vec<TocItem>, AppError> {
    match detect_document_kind(path)? {
        DocumentKind::Epub => get_epub_toc(path),
        DocumentKind::Pdf => get_pdf_toc(path),
        DocumentKind::Word => get_doc_toc(path),
    }
}

pub fn load_document_chapter(
    path: &Path,
    spine_index: usize,
    theme_css: &str,
) -> Result<ChapterContent, AppError> {
    match detect_document_kind(path)? {
        DocumentKind::Epub => load_epub_chapter(path, spine_index, theme_css),
        DocumentKind::Pdf => load_pdf_chapter(path, spine_index, theme_css),
        DocumentKind::Word => load_doc_chapter(path, spine_index, theme_css),
    }
}

pub fn search_document(path: &Path, query: &str) -> Result<Vec<BookSearchMatch>, AppError> {
    match detect_document_kind(path)? {
        DocumentKind::Epub => search_epub_book(path, query),
        DocumentKind::Pdf => search_pdf(path, query),
        DocumentKind::Word => search_doc(path, query),
    }
}

pub fn compute_spine_char_counts(path: &Path) -> Result<Vec<usize>, AppError> {
    match detect_document_kind(path)? {
        DocumentKind::Epub => get_epub_spine_char_counts(path),
        DocumentKind::Pdf => pdf_spine_char_counts(path),
        DocumentKind::Word => doc_spine_char_counts(path),
    }
}
