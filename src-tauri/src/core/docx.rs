use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::core::epub::{BookSearchMatch, ChapterContent, ParsedEpub, TocItem};
use crate::core::sanitizer::{html_to_plain_text, sanitize_chapter_html};
use crate::core::zip_guard::{open_guarded_archive, read_zip_entry_by_path, MAX_XML_ENTRY_BYTES};
use crate::error::AppError;

const MAX_DOC_FILE_BYTES: u64 = 50 * 1024 * 1024;
const TARGET_SECTION_CHARS: usize = 6_000;

#[derive(Debug, Clone)]
struct DocSection {
    title: String,
    body_html: String,
    plain_text: String,
}

#[derive(Debug, Clone)]
struct DocDocument {
    title: String,
    author: String,
    language: String,
    description: String,
    format_label: String,
    sections: Vec<DocSection>,
}

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

fn read_bounded_bytes(path: &Path) -> Result<Vec<u8>, AppError> {
    let meta =
        std::fs::metadata(path).map_err(|e| AppError::NotFound(format!("Belge açılamadı: {e}")))?;
    if !meta.is_file() {
        return Err(AppError::Validation("Seçilen yol bir dosya değil".into()));
    }
    if meta.len() > MAX_DOC_FILE_BYTES {
        return Err(AppError::Security(format!(
            "Belge boyutu maksimum sınırı ({MAX_DOC_FILE_BYTES} bayt) aşıyor"
        )));
    }
    let mut file = File::open(path)?;
    let mut limited = file.by_ref().take(MAX_DOC_FILE_BYTES + 1);
    let mut buf = Vec::new();
    limited.read_to_end(&mut buf)?;
    if buf.len() as u64 > MAX_DOC_FILE_BYTES {
        return Err(AppError::Security(
            "Belge boyutu sınırı okuma sırasında aşıldı".into(),
        ));
    }
    Ok(buf)
}

fn decode_win1254(byte: u8) -> char {
    match byte {
        0x80 => '\u{20AC}',
        0x85 => '\u{2026}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0xA0 => '\u{00A0}',
        0xC7 => 'Ç',
        0xD0 => 'Ğ',
        0xD6 => 'Ö',
        0xDC => 'Ü',
        0xDD => 'İ',
        0xDE => 'Ş',
        0xE7 => 'ç',
        0xF0 => 'ğ',
        0xF6 => 'ö',
        0xFC => 'ü',
        0xFD => 'ı',
        0xFE => 'ş',
        other => char::from(other),
    }
}

fn parse_core_properties(xml: &str) -> (String, String, String, String) {
    let mut title = String::new();
    let mut author = String::new();
    let mut description = String::new();
    let mut language = String::new();

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut current = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                current = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
            }
            Ok(Event::Text(t)) => {
                if let Ok(v) = t.unescape() {
                    let s = v.trim();
                    if !s.is_empty() {
                        match current.as_str() {
                            "title" if title.is_empty() => title = s.to_string(),
                            "creator" if author.is_empty() => author = s.to_string(),
                            "description" | "subject" if description.is_empty() => {
                                description = s.to_string()
                            }
                            "language" if language.is_empty() => language = s.to_string(),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::End(_)) => current.clear(),
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    (title, author, description, language)
}

#[derive(Debug, Clone)]
struct WordParagraph {
    heading_level: Option<u8>,
    html: String,
    plain: String,
}

fn parse_docx_paragraphs(xml: &str) -> Result<Vec<WordParagraph>, AppError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();

    let mut out = Vec::new();
    let mut in_para = false;
    let mut in_run = false;
    let mut in_text = false;
    let mut bold = false;
    let mut italic = false;
    let mut heading_level: Option<u8> = None;
    let mut para_html = String::new();
    let mut para_plain = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                match local.as_str() {
                    "p" => {
                        in_para = true;
                        heading_level = None;
                        para_html.clear();
                        para_plain.clear();
                    }
                    "pstyle" if in_para => {
                        heading_level = extract_heading_level(&e).or(heading_level);
                    }
                    "r" if in_para => {
                        in_run = true;
                        bold = false;
                        italic = false;
                    }
                    "b" if in_run => bold = !is_attr_false(&e),
                    "i" if in_run => italic = !is_attr_false(&e),
                    "t" | "deltext" if in_run => in_text = true,
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                match local.as_str() {
                    "pstyle" if in_para => {
                        heading_level = extract_heading_level(&e).or(heading_level);
                    }
                    "b" if in_run => bold = !is_attr_false(&e),
                    "i" if in_run => italic = !is_attr_false(&e),
                    "br" if in_para => {
                        para_html.push_str("<br/>");
                        para_plain.push('\n');
                    }
                    "tab" if in_para => {
                        para_html.push(' ');
                        para_plain.push(' ');
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) if in_para && in_text => {
                if let Ok(txt) = t.unescape() {
                    let s = txt.as_ref();
                    para_plain.push_str(s);
                    let escaped = escape_html(s);
                    if bold && italic {
                        para_html.push_str(&format!("<strong><em>{escaped}</em></strong>"));
                    } else if bold {
                        para_html.push_str(&format!("<strong>{escaped}</strong>"));
                    } else if italic {
                        para_html.push_str(&format!("<em>{escaped}</em>"));
                    } else {
                        para_html.push_str(&escaped);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                match local.as_str() {
                    "t" | "deltext" => in_text = false,
                    "r" => {
                        in_run = false;
                        bold = false;
                        italic = false;
                    }
                    "p" if in_para => {
                        in_para = false;
                        let plain_trimmed = para_plain.trim().to_string();
                        if !plain_trimmed.is_empty() {
                            let wrapped = if let Some(lvl) = heading_level {
                                let clamped = lvl.clamp(1, 6);
                                format!("<h{clamped}>{para_html}</h{clamped}>")
                            } else {
                                format!("<p>{para_html}</p>")
                            };
                            out.push(WordParagraph {
                                heading_level,
                                html: wrapped,
                                plain: plain_trimmed,
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::Archive(format!(
                    "DOCX XML içeriği ayrıştırılamadı: {e}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(out)
}

fn extract_heading_level(e: &quick_xml::events::BytesStart<'_>) -> Option<u8> {
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_ascii_lowercase();
        if key == "val" {
            if let Ok(val) = attr.unescape_value() {
                let lower = val.trim().to_ascii_lowercase();
                if let Some(num) = lower
                    .strip_prefix("heading")
                    .or_else(|| lower.strip_prefix("baslik"))
                    .or_else(|| lower.strip_prefix("başlık"))
                {
                    if let Ok(n) = num.trim().parse::<u8>() {
                        return Some(n.clamp(1, 6));
                    }
                }
                if lower == "title" {
                    return Some(1);
                }
            }
        }
    }
    None
}

fn is_attr_false(e: &quick_xml::events::BytesStart<'_>) -> bool {
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_ascii_lowercase();
        if key == "val" {
            if let Ok(val) = attr.unescape_value() {
                let l = val.trim().to_ascii_lowercase();
                return l == "0" || l == "false" || l == "off";
            }
        }
    }
    false
}

fn group_paragraphs_into_sections(
    paragraphs: Vec<WordParagraph>,
    fallback_title: &str,
) -> Vec<DocSection> {
    if paragraphs.is_empty() {
        return vec![DocSection {
            title: fallback_title.to_string(),
            body_html: format!(
                "<p>{}</p>",
                escape_html("Belge içinde okunabilir metin bulunamadı.")
            ),
            plain_text: "Belge içinde okunabilir metin bulunamadı.".to_string(),
        }];
    }

    let has_headings = paragraphs
        .iter()
        .any(|p| matches!(p.heading_level, Some(1 | 2)));

    let mut sections: Vec<DocSection> = Vec::new();
    let mut cur_title = fallback_title.to_string();
    let mut cur_html = String::new();
    let mut cur_plain = String::new();

    for p in paragraphs {
        let split_on_heading =
            has_headings && matches!(p.heading_level, Some(1 | 2)) && !cur_plain.is_empty();
        let split_on_size = !has_headings && cur_plain.len() >= TARGET_SECTION_CHARS;

        if split_on_heading || split_on_size {
            let idx = sections.len() + 1;
            sections.push(DocSection {
                title: if cur_title.trim().is_empty() {
                    format!("Bölüm {idx}")
                } else {
                    cur_title.clone()
                },
                body_html: std::mem::take(&mut cur_html),
                plain_text: std::mem::take(&mut cur_plain),
            });
            cur_title = if matches!(p.heading_level, Some(1 | 2)) {
                p.plain.chars().take(80).collect()
            } else {
                format!("Bölüm {}", sections.len() + 1)
            };
        } else if cur_plain.is_empty() && p.heading_level.is_some() {
            cur_title = p.plain.chars().take(80).collect();
        }

        cur_html.push_str(&p.html);
        cur_html.push('\n');
        if !cur_plain.is_empty() {
            cur_plain.push('\n');
        }
        cur_plain.push_str(&p.plain);
    }

    if !cur_plain.is_empty() || sections.is_empty() {
        let idx = sections.len() + 1;
        sections.push(DocSection {
            title: if cur_title.trim().is_empty() {
                format!("Bölüm {idx}")
            } else {
                cur_title
            },
            body_html: cur_html,
            plain_text: cur_plain,
        });
    }

    sections
}

fn parse_docx_zip(path: &Path, fallback_title: &str) -> Result<DocDocument, AppError> {
    let mut archive = open_guarded_archive(path)?;
    let mut total_read = 0u64;

    let core_bytes = read_zip_entry_by_path(
        &mut archive,
        "docProps/core.xml",
        MAX_XML_ENTRY_BYTES,
        &mut total_read,
    )?;
    let (title_meta, author_meta, desc_meta, lang_meta) = core_bytes
        .map(|b| parse_core_properties(&String::from_utf8_lossy(&b)))
        .unwrap_or_default();

    let doc_bytes = read_zip_entry_by_path(
        &mut archive,
        "word/document.xml",
        MAX_XML_ENTRY_BYTES * 2,
        &mut total_read,
    )?
    .ok_or_else(|| AppError::Archive("word/document.xml bulunamadı (geçersiz DOCX)".into()))?;

    let paragraphs = parse_docx_paragraphs(&String::from_utf8_lossy(&doc_bytes))?;
    let sections = group_paragraphs_into_sections(paragraphs, fallback_title);

    Ok(DocDocument {
        title: if title_meta.is_empty() {
            fallback_title.to_string()
        } else {
            title_meta
        },
        author: if author_meta.is_empty() {
            "Bilinmeyen Yazar".to_string()
        } else {
            author_meta
        },
        language: if lang_meta.is_empty() {
            "tr".to_string()
        } else {
            lang_meta
        },
        description: desc_meta,
        format_label: "DOCX".to_string(),
        sections,
    })
}

fn decode_rtf_to_paragraphs(raw: &[u8]) -> Vec<WordParagraph> {
    let text = String::from_utf8_lossy(raw);
    let bytes = text.as_bytes();
    let mut i = 0usize;
    let mut group_depth = 0usize;
    let mut skip_depth: Option<usize> = None;
    let mut out = String::new();

    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'{' => {
                group_depth += 1;
                i += 1;
            }
            b'}' => {
                if skip_depth == Some(group_depth) {
                    skip_depth = None;
                }
                group_depth = group_depth.saturating_sub(1);
                i += 1;
            }
            b'\\' => {
                i += 1;
                if i >= bytes.len() {
                    break;
                }
                let next = bytes[i];
                if next == b'\'' && i + 2 < bytes.len() {
                    let hex_str = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                    if let Ok(code) = u8::from_str_radix(hex_str, 16) {
                        if skip_depth.is_none() {
                            out.push(decode_win1254(code));
                        }
                    }
                    i += 3;
                } else if matches!(next, b'\\' | b'{' | b'}') {
                    if skip_depth.is_none() {
                        out.push(char::from(next));
                    }
                    i += 1;
                } else if next == b'*' {
                    if skip_depth.is_none() {
                        skip_depth = Some(group_depth);
                    }
                    i += 1;
                } else if next.is_ascii_alphabetic() {
                    let start = i;
                    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
                    let mut param = String::new();
                    if i < bytes.len() && (bytes[i] == b'-' || bytes[i].is_ascii_digit()) {
                        if bytes[i] == b'-' {
                            param.push('-');
                            i += 1;
                        }
                        while i < bytes.len() && bytes[i].is_ascii_digit() {
                            param.push(char::from(bytes[i]));
                            i += 1;
                        }
                    }
                    if i < bytes.len() && bytes[i] == b' ' {
                        i += 1;
                    }

                    if matches!(
                        word,
                        "fonttbl" | "colortbl" | "stylesheet" | "info" | "pict" | "object"
                    ) && skip_depth.is_none()
                    {
                        skip_depth = Some(group_depth);
                    }

                    if skip_depth.is_none() {
                        match word {
                            "par" | "line" => out.push('\n'),
                            "tab" => out.push(' '),
                            "u" => {
                                if let Ok(code_i) = param.parse::<i32>() {
                                    let u_code = if code_i < 0 {
                                        (65536 + code_i) as u32
                                    } else {
                                        code_i as u32
                                    };
                                    if let Some(ch) = char::from_u32(u_code) {
                                        out.push(ch);
                                    }
                                    if i < bytes.len() && bytes[i] == b'?' {
                                        i += 1;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                } else {
                    i += 1;
                }
            }
            b'\r' | b'\n' => i += 1,
            _ => {
                if skip_depth.is_none() {
                    let ch = text[i..].chars().next().unwrap_or(' ');
                    out.push(ch);
                    i += ch.len_utf8();
                } else {
                    i += 1;
                }
            }
        }
    }

    out.lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| WordParagraph {
            heading_level: None,
            html: format!("<p>{}</p>", escape_html(s)),
            plain: s.to_string(),
        })
        .collect()
}

/// Minimal bounded OLE2 reader extracting readable WordDocument text streams from legacy `.doc`.
fn extract_ole2_doc_paragraphs(raw: &[u8]) -> Vec<WordParagraph> {
    let text_stream = extract_ole2_word_stream(raw).unwrap_or(raw);
    let mut chunks = Vec::new();
    let mut cur = String::new();

    // Check UTF-16LE pairs first if binary has dense zero high bytes, otherwise Windows-1254 runs
    let mut i = 0usize;
    while i + 1 < text_stream.len() {
        let lo = text_stream[i];
        let hi = text_stream[i + 1];
        if hi == 0 && (lo == 0x0D || lo == 0x0A || (0x20..=0x7E).contains(&lo)) {
            let ch = if lo == 0x0D || lo == 0x0A {
                '\n'
            } else {
                char::from(lo)
            };
            cur.push(ch);
            i += 2;
        } else if hi == 0x01 && matches!(lo, 0x1E | 0x1F | 0x30 | 0x31 | 0x5E | 0x5F) {
            let u = u16::from_le_bytes([lo, hi]);
            if let Some(ch) = char::from_u32(u32::from(u)) {
                cur.push(ch);
            }
            i += 2;
        } else {
            if cur.chars().filter(|c| c.is_alphanumeric()).count() >= 12 {
                chunks.push(cur.clone());
            }
            cur.clear();
            i += 1;
        }
    }
    if cur.chars().filter(|c| c.is_alphanumeric()).count() >= 12 {
        chunks.push(cur);
    }

    // Fallback CP1254 byte run extraction when UTF-16LE yields almost nothing
    if chunks.is_empty() {
        let mut s = String::new();
        for &b in text_stream {
            if b == b'\r' || b == b'\n' || b == b'\t' {
                s.push('\n');
            } else if (0x20..=0x7E).contains(&b)
                || matches!(
                    b,
                    0xC7 | 0xD0
                        | 0xD6
                        | 0xDC
                        | 0xDD
                        | 0xDE
                        | 0xE7
                        | 0xF0
                        | 0xF6
                        | 0xFC
                        | 0xFD
                        | 0xFE
                )
            {
                s.push(decode_win1254(b));
            } else {
                if s.chars().filter(|c| c.is_alphabetic()).count() >= 16 {
                    chunks.push(s.clone());
                }
                s.clear();
            }
        }
        if s.chars().filter(|c| c.is_alphabetic()).count() >= 16 {
            chunks.push(s);
        }
    }

    let joined = chunks.join("\n");
    joined
        .lines()
        .map(str::trim)
        .filter(|l| l.chars().filter(|c| c.is_alphanumeric()).count() >= 4)
        .map(|l| WordParagraph {
            heading_level: None,
            html: format!("<p>{}</p>", escape_html(l)),
            plain: l.to_string(),
        })
        .collect()
}

fn extract_ole2_word_stream(raw: &[u8]) -> Option<&[u8]> {
    if raw.len() < 512 {
        return None;
    }
    let sector_shift = u16::from_le_bytes([raw[30], raw[31]]) as usize;
    let sector_size = 1usize.checked_shl(sector_shift as u32)?;
    if !(512..=4096).contains(&sector_size) {
        return None;
    }
    let first_dir_sector = u32::from_le_bytes([raw[48], raw[49], raw[50], raw[51]]) as usize;
    let dir_offset = 512usize.checked_add(first_dir_sector.checked_mul(sector_size)?)?;
    if dir_offset + 128 > raw.len() {
        return None;
    }

    // Look for "WordDocument" UTF-16LE directory entry starting sector inside directory sectors
    let mut visited = HashSet::new();
    let mut offset = dir_offset;
    for _ in 0..32 {
        if offset + sector_size > raw.len() || !visited.insert(offset) {
            break;
        }
        let mut entry = offset;
        while entry + 128 <= offset + sector_size {
            let name_len = u16::from_le_bytes([raw[entry + 64], raw[entry + 65]]) as usize;
            if (4..=64).contains(&name_len) {
                let utf16: Vec<u16> = raw[entry..entry + name_len.saturating_sub(2)]
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                if String::from_utf16_lossy(&utf16) == "WordDocument" {
                    let start_sector = u32::from_le_bytes([
                        raw[entry + 116],
                        raw[entry + 117],
                        raw[entry + 118],
                        raw[entry + 119],
                    ]) as usize;
                    let stream_size = u32::from_le_bytes([
                        raw[entry + 120],
                        raw[entry + 121],
                        raw[entry + 122],
                        raw[entry + 123],
                    ]) as usize;
                    let start_byte =
                        512usize.checked_add(start_sector.checked_mul(sector_size)?)?;
                    if start_byte < raw.len() {
                        let end_byte = start_byte.saturating_add(stream_size).min(raw.len());
                        return Some(&raw[start_byte..end_byte]);
                    }
                }
            }
            entry += 128;
        }
        offset += sector_size;
    }
    None
}

fn parse_word_document(path: &Path) -> Result<DocDocument, AppError> {
    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Adsız Belge")
        .to_string();

    let raw = read_bounded_bytes(path)?;
    if raw.starts_with(b"PK\x03\x04") {
        return parse_docx_zip(path, &fallback_title);
    }

    let trimmed_start = raw
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .unwrap_or(0);
    let head = &raw[trimmed_start..];

    let (format_label, paragraphs) = if head.starts_with(b"{\\rtf") {
        ("RTF/DOC", decode_rtf_to_paragraphs(head))
    } else if head.starts_with(b"<html")
        || head.starts_with(b"<!doctype")
        || head.starts_with(b"<?xml")
    {
        let html_str = String::from_utf8_lossy(head);
        let plain = html_to_plain_text(&html_str);
        let paras = plain
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| WordParagraph {
                heading_level: None,
                html: format!("<p>{}</p>", escape_html(l)),
                plain: l.to_string(),
            })
            .collect();
        ("HTML/DOC", paras)
    } else if raw.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        ("DOC", extract_ole2_doc_paragraphs(&raw))
    } else {
        let plain = String::from_utf8_lossy(&raw);
        let paras = plain
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| WordParagraph {
                heading_level: None,
                html: format!("<p>{}</p>", escape_html(l)),
                plain: l.to_string(),
            })
            .collect();
        ("DOC", paras)
    };

    let sections = group_paragraphs_into_sections(paragraphs, &fallback_title);
    Ok(DocDocument {
        title: fallback_title,
        author: "Bilinmeyen Yazar".to_string(),
        language: "tr".to_string(),
        description: String::new(),
        format_label: format_label.to_string(),
        sections,
    })
}

pub fn parse_doc_metadata(path: &Path) -> Result<ParsedEpub, AppError> {
    let doc = parse_word_document(path)?;
    let toc = doc
        .sections
        .iter()
        .enumerate()
        .map(|(i, s)| TocItem {
            id: format!("doc-toc-{i}"),
            title: s.title.clone(),
            href: format!("section-{i}"),
            spine_index: Some(i),
            depth: 0,
        })
        .collect();

    Ok(ParsedEpub {
        title: doc.title,
        author: doc.author,
        language: doc.language,
        publisher: String::new(),
        description: doc.description,
        series: String::new(),
        genre: doc.format_label.clone(),
        epub_version: doc.format_label,
        cover_bytes: None,
        spine_count: doc.sections.len().max(1),
        toc,
    })
}

pub fn get_doc_toc(path: &Path) -> Result<Vec<TocItem>, AppError> {
    Ok(parse_doc_metadata(path)?.toc)
}

pub fn doc_spine_char_counts(path: &Path) -> Result<Vec<usize>, AppError> {
    let doc = parse_word_document(path)?;
    Ok(doc
        .sections
        .into_iter()
        .map(|s| s.plain_text.chars().count())
        .collect())
}

pub fn load_doc_chapter(
    path: &Path,
    spine_index: usize,
    theme_css: &str,
) -> Result<ChapterContent, AppError> {
    let doc = parse_word_document(path)?;
    let chapter_count = doc.sections.len();
    let sec = doc.sections.get(spine_index).ok_or_else(|| {
        AppError::Validation(format!(
            "Geçersiz bölüm indeksi: {spine_index} (toplam {chapter_count})"
        ))
    })?;

    let wrapped_html = format!(
        "<!doctype html><html><body><h1>{}</h1>{}</body></html>",
        escape_html(&sec.title),
        sec.body_html
    );
    let sanitized = sanitize_chapter_html(
        &wrapped_html,
        &mut |_| Ok(None),
        &mut |_| Ok(None),
        theme_css,
    )?;

    Ok(ChapterContent {
        spine_index,
        chapter_count,
        title: sec.title.clone(),
        src_doc: sanitized.src_doc,
        body_html: sanitized.body_html,
        plain_text: sanitized.plain_text,
    })
}

pub fn search_doc(path: &Path, query: &str) -> Result<Vec<BookSearchMatch>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let needle = trimmed.to_lowercase();
    let doc = parse_word_document(path)?;
    let mut matches = Vec::new();
    const MAX_MATCHES: usize = 100;

    for (idx, sec) in doc.sections.iter().enumerate() {
        let lower = sec.plain_text.to_lowercase();
        let mut from = 0usize;
        while let Some(rel) = lower[from..].find(&needle) {
            let pos = from + rel;
            let snippet = sec
                .plain_text
                .chars()
                .skip(sec.plain_text[..pos].chars().count().saturating_sub(30))
                .take(120)
                .collect::<String>();
            matches.push(BookSearchMatch {
                spine_index: idx,
                chapter_title: sec.title.clone(),
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
    use std::io::Write;
    use tempfile::NamedTempFile;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    #[test]
    fn parses_docx_archive_and_turkish_paragraphs() {
        let tmp = NamedTempFile::new().unwrap();
        let mut zw = ZipWriter::new(tmp.reopen().unwrap());
        let opts = SimpleFileOptions::default();

        zw.start_file("docProps/core.xml", opts).unwrap();
        zw.write_all(
            r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>DOCX Türkçe Deneme</dc:title>
  <dc:creator>Elif Demir</dc:creator>
</cp:coreProperties>"#
                .as_bytes(),
        )
        .unwrap();

        zw.start_file("word/document.xml", opts).unwrap();
        zw.write_all(
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Giriş Bölümü</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Şişli ve İzmir notları &lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>
  </w:body>
</w:document>"#
                .as_bytes(),
        )
        .unwrap();
        zw.finish().unwrap();

        let meta = parse_doc_metadata(tmp.path()).unwrap();
        assert_eq!(meta.title, "DOCX Türkçe Deneme");
        assert_eq!(meta.author, "Elif Demir");
        assert_eq!(meta.epub_version, "DOCX");
        assert_eq!(meta.spine_count, 1);

        let ch = load_doc_chapter(tmp.path(), 0, "").unwrap();
        assert!(ch.plain_text.contains("Şişli ve İzmir notları"));
        assert!(!ch.src_doc.to_ascii_lowercase().contains("<script>"));
    }

    #[test]
    fn parses_rtf_based_doc_with_turkish_escapes() {
        let tmp = NamedTempFile::new().unwrap();
        fs_write_bytes(
            tmp.path(),
            br"{\rtf1\ansi\ansicpg1254 {\fonttbl{\f0 Arial;}} Merhaba \u304?stanbul ve T\'fcrk\'e7e kitap.\par \u214?rnek ikinci paragraf.}",
        );

        let ch = load_doc_chapter(tmp.path(), 0, "").unwrap();
        assert!(ch.plain_text.contains("Türkçe kitap."));
        assert!(ch.plain_text.contains("Örnek ikinci paragraf."));
    }

    fn fs_write_bytes(path: &Path, data: &[u8]) {
        std::fs::write(path, data).unwrap();
    }
}
