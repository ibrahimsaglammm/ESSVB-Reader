use std::fs::File;
use std::io::Read;
use std::path::Path;

use lopdf::{Document, Object};

use crate::core::epub::{BookSearchMatch, ChapterContent, ParsedEpub, TocItem};
use crate::core::sanitizer::sanitize_chapter_html;
use crate::error::AppError;

const MAX_PDF_FILE_BYTES: u64 = 150 * 1024 * 1024;

fn escape_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn validate_pdf_header(path: &Path) -> Result<(), AppError> {
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::NotFound(format!("PDF dosyası açılamadı: {e}")))?;
    if !meta.is_file() {
        return Err(AppError::Validation("Seçilen yol bir dosya değil".into()));
    }
    if meta.len() > MAX_PDF_FILE_BYTES {
        return Err(AppError::Security(format!(
            "PDF dosyası izin verilen maksimum boyutu ({MAX_PDF_FILE_BYTES} bayt) aşıyor"
        )));
    }
    let mut f = File::open(path)?;
    let mut head = [0u8; 8];
    let n = f.read(&mut head)?;
    if !head[..n].starts_with(b"%PDF-") {
        return Err(AppError::Validation(
            "Geçerli bir PDF dosya başlığı (%PDF-) bulunamadı".into(),
        ));
    }
    Ok(())
}

fn decode_pdf_string_bytes(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units).trim().to_string();
    }
    if let Ok(utf8) = std::str::from_utf8(bytes) {
        return utf8.trim().to_string();
    }
    bytes
        .iter()
        .map(|&b| char::from(b))
        .collect::<String>()
        .trim()
        .to_string()
}

fn extract_info_field(doc: &Document, key: &[u8]) -> Option<String> {
    let info_obj = doc.trailer.get(b"Info").ok()?;
    let resolved = match info_obj {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    let dict = resolved.as_dict().ok()?;
    let val = dict.get(key).ok()?;
    match val {
        Object::String(bytes, _) => {
            let s = decode_pdf_string_bytes(bytes);
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        _ => None,
    }
}

fn format_pdf_page_html(page_num: u32, raw_text: &str) -> String {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return format!(
            "<!doctype html><html><body><h2>Sayfa {page_num}</h2><p>Bu PDF sayfasında seçilebilir metin katmanı bulunamadı (taranmış görsel sayfası olabilir).</p></body></html>"
        );
    }

    let mut body = format!("<h2>Sayfa {page_num}</h2>");
    for block in trimmed.split("\n\n") {
        let clean = block
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if !clean.is_empty() {
            body.push_str("<p>");
            body.push_str(&escape_html(&clean));
            body.push_str("</p>");
        }
    }
    if body == format!("<h2>Sayfa {page_num}</h2>") {
        for line in trimmed.lines() {
            let clean = line.trim();
            if !clean.is_empty() {
                body.push_str("<p>");
                body.push_str(&escape_html(clean));
                body.push_str("</p>");
            }
        }
    }
    format!("<!doctype html><html><body>{body}</body></html>")
}

pub fn parse_pdf_metadata(path: &Path) -> Result<ParsedEpub, AppError> {
    validate_pdf_header(path)?;
    let doc = Document::load(path)
        .map_err(|e| AppError::Archive(format!("PDF dosyası ayrıştırılamadı: {e}")))?;

    let page_numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    if page_numbers.is_empty() {
        return Err(AppError::Validation(
            "PDF belgesi hiç sayfa içermiyor".to_string(),
        ));
    }

    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Adsız PDF")
        .to_string();

    let title = extract_info_field(&doc, b"Title").unwrap_or(fallback_title);
    let author = extract_info_field(&doc, b"Author").unwrap_or_else(|| "Bilinmeyen Yazar".into());
    let description = extract_info_field(&doc, b"Subject").unwrap_or_default();

    let toc = page_numbers
        .iter()
        .enumerate()
        .map(|(idx, &pnum)| TocItem {
            id: format!("pdf-page-{pnum}"),
            title: format!("Sayfa {pnum}"),
            href: format!("page-{pnum}"),
            spine_index: Some(idx),
            depth: 0,
        })
        .collect();

    Ok(ParsedEpub {
        title,
        author,
        language: "tr".to_string(),
        publisher: String::new(),
        description,
        series: String::new(),
        genre: "PDF".to_string(),
        epub_version: "PDF".to_string(),
        cover_bytes: None,
        spine_count: page_numbers.len(),
        toc,
    })
}

pub fn get_pdf_toc(path: &Path) -> Result<Vec<TocItem>, AppError> {
    Ok(parse_pdf_metadata(path)?.toc)
}

pub fn pdf_spine_char_counts(path: &Path) -> Result<Vec<usize>, AppError> {
    validate_pdf_header(path)?;
    let doc = Document::load(path)
        .map_err(|e| AppError::Archive(format!("PDF dosyası ayrıştırılamadı: {e}")))?;
    let page_numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    let counts = page_numbers
        .into_iter()
        .map(|p| {
            doc.extract_text(&[p])
                .map(|t| t.trim().chars().count().max(1))
                .unwrap_or(1)
        })
        .collect();
    Ok(counts)
}

pub fn load_pdf_chapter(
    path: &Path,
    spine_index: usize,
    theme_css: &str,
) -> Result<ChapterContent, AppError> {
    validate_pdf_header(path)?;
    let doc = Document::load(path)
        .map_err(|e| AppError::Archive(format!("PDF dosyası açılamadı: {e}")))?;
    let page_numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    let chapter_count = page_numbers.len();
    let &page_num = page_numbers.get(spine_index).ok_or_else(|| {
        AppError::Validation(format!(
            "Geçersiz PDF sayfa indeksi: {spine_index} (toplam {chapter_count})"
        ))
    })?;

    let extracted = doc.extract_text(&[page_num]).unwrap_or_default();
    let raw_html = format_pdf_page_html(page_num, &extracted);
    let sanitized =
        sanitize_chapter_html(&raw_html, &mut |_| Ok(None), &mut |_| Ok(None), theme_css)?;

    Ok(ChapterContent {
        spine_index,
        chapter_count,
        title: format!("Sayfa {page_num}"),
        src_doc: sanitized.src_doc,
        body_html: sanitized.body_html,
        plain_text: sanitized.plain_text,
    })
}

pub fn search_pdf(path: &Path, query: &str) -> Result<Vec<BookSearchMatch>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    validate_pdf_header(path)?;
    let doc = Document::load(path).map_err(|e| AppError::Archive(format!("PDF aranamadı: {e}")))?;
    let page_numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    let needle = trimmed.to_lowercase();
    let mut matches = Vec::new();
    const MAX_MATCHES: usize = 100;

    for (idx, &page_num) in page_numbers.iter().enumerate() {
        let Ok(txt) = doc.extract_text(&[page_num]) else {
            continue;
        };
        let lower = txt.to_lowercase();
        let mut from = 0usize;
        while let Some(rel) = lower[from..].find(&needle) {
            let pos = from + rel;
            let snippet = txt
                .chars()
                .skip(txt[..pos].chars().count().saturating_sub(30))
                .take(120)
                .collect::<String>();
            matches.push(BookSearchMatch {
                spine_index: idx,
                chapter_title: format!("Sayfa {page_num}"),
                snippet: format!("...{snippet}..."),
                match_offset: pos,
            });
            if matches.len() >= MAX_MATCHES {
                return Ok(matches);
            }
            from = pos + needle.len().max(1);
        }
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Stream};
    use tempfile::NamedTempFile;

    fn build_sample_pdf() -> NamedTempFile {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Td", vec![50.into(), 700.into()]),
                Operation::new(
                    "Tj",
                    vec![Object::string_literal("Merhaba PDF Kitap Testi")],
                ),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => resources_id,
        });
        let pages = dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages));
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        let info_id = doc.add_object(dictionary! {
            "Title" => Object::string_literal("Deneme PDF Belgesi"),
            "Author" => Object::string_literal("Ayse Yilmaz"),
        });
        doc.trailer.set("Root", catalog_id);
        doc.trailer.set("Info", info_id);

        let tmp = NamedTempFile::new().unwrap();
        doc.save(tmp.path()).unwrap();
        tmp
    }

    #[test]
    fn parses_pdf_metadata_pages_and_search() {
        let pdf = build_sample_pdf();
        let meta = parse_pdf_metadata(pdf.path()).unwrap();
        assert_eq!(meta.title, "Deneme PDF Belgesi");
        assert_eq!(meta.author, "Ayse Yilmaz");
        assert_eq!(meta.epub_version, "PDF");
        assert_eq!(meta.spine_count, 1);

        let page = load_pdf_chapter(pdf.path(), 0, "").unwrap();
        assert!(page.plain_text.contains("Merhaba PDF Kitap Testi"));

        let hits = search_pdf(pdf.path(), "kitap").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chapter_title, "Sayfa 1");
    }
}
