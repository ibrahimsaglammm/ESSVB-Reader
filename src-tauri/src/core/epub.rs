use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::core::sanitizer::{html_to_plain_text, sanitize_chapter_html};
use crate::core::zip_guard::{
    open_guarded_archive, read_zip_entry_by_path, resolve_zip_relative, MAX_IMAGE_ENTRY_BYTES,
    MAX_XML_ENTRY_BYTES,
};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocItem {
    pub id: String,
    pub title: String,
    pub href: String,
    pub spine_index: Option<usize>,
    pub depth: usize,
}

#[derive(Debug, Clone)]
pub struct ParsedEpub {
    pub title: String,
    pub author: String,
    pub language: String,
    pub publisher: String,
    pub description: String,
    pub series: String,
    pub genre: String,
    pub epub_version: String,
    pub cover_bytes: Option<Vec<u8>>,
    pub spine_count: usize,
    pub toc: Vec<TocItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterContent {
    pub spine_index: usize,
    pub chapter_count: usize,
    pub title: String,
    pub src_doc: String,
    pub body_html: String,
    pub plain_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSearchMatch {
    pub spine_index: usize,
    pub chapter_title: String,
    pub snippet: String,
    pub match_offset: usize,
}

#[derive(Debug, Clone)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: String,
}

#[derive(Debug, Clone)]
struct OpfPackage {
    opf_dir: String,
    epub_version: String,
    title: String,
    author: String,
    language: String,
    publisher: String,
    description: String,
    series: String,
    subjects: Vec<String>,
    cover_meta_id: Option<String>,
    toc_ncx_id: Option<String>,
    manifest: HashMap<String, ManifestItem>,
    spine_paths: Vec<String>,
}

fn dir_of(path: &str) -> String {
    match path.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    }
}

fn find_opf_path(
    archive: &mut ZipArchive<std::fs::File>,
    total_read: &mut u64,
) -> Result<String, AppError> {
    let container_bytes = read_zip_entry_by_path(
        archive,
        "META-INF/container.xml",
        MAX_XML_ENTRY_BYTES,
        total_read,
    )?
    .ok_or_else(|| AppError::Epub("META-INF/container.xml bulunamadı".to_string()))?;

    let xml = String::from_utf8(container_bytes)
        .map_err(|_| AppError::Epub("container.xml geçerli UTF-8 değil".to_string()))?;

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "rootfile" {
                    for attr in e.attributes().flatten() {
                        let key = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if key == "full-path" {
                            if let Ok(val) = attr.unescape_value() {
                                return resolve_zip_relative("", val.as_ref());
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(AppError::Epub(format!(
                    "container.xml ayrıştırılamadı: {e}"
                )))
            }
            _ => {}
        }
        buf.clear();
    }

    Err(AppError::Epub(
        "container.xml içinde rootfile yolu bulunamadı".to_string(),
    ))
}

fn parse_opf(
    archive: &mut ZipArchive<std::fs::File>,
    total_read: &mut u64,
) -> Result<OpfPackage, AppError> {
    let opf_path = find_opf_path(archive, total_read)?;
    let opf_dir = dir_of(&opf_path);
    let opf_bytes = read_zip_entry_by_path(archive, &opf_path, MAX_XML_ENTRY_BYTES, total_read)?
        .ok_or_else(|| AppError::Epub(format!("OPF dosyası bulunamadı: {opf_path}")))?;

    let xml = String::from_utf8(opf_bytes)
        .map_err(|_| AppError::Epub("OPF dosyası geçerli UTF-8 değil".to_string()))?;

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);

    let mut epub_version = "2.0".to_string();
    let mut title = String::new();
    let mut authors = Vec::new();
    let mut language = String::new();
    let mut publisher = String::new();
    let mut description = String::new();
    let mut series = String::new();
    let mut subjects = Vec::new();
    let mut cover_meta_id = None;
    let mut toc_ncx_id = None;
    let mut manifest = HashMap::new();
    let mut spine_idrefs = Vec::new();

    let mut current_tag = String::new();
    let mut current_meta_prop = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                current_tag = local.clone();
                current_meta_prop.clear();

                if local == "package" {
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "version" {
                            if let Ok(v) = attr.unescape_value() {
                                epub_version = v.into_owned();
                            }
                        }
                    }
                } else if local == "spine" {
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "toc" {
                            if let Ok(v) = attr.unescape_value() {
                                toc_ncx_id = Some(v.into_owned());
                            }
                        }
                    }
                } else if local == "meta" {
                    let mut m_name = String::new();
                    let mut m_content = String::new();
                    let mut m_prop = String::new();
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if let Ok(v) = attr.unescape_value() {
                            match k.as_str() {
                                "name" => m_name = v.into_owned(),
                                "content" => m_content = v.into_owned(),
                                "property" => m_prop = v.into_owned(),
                                _ => {}
                            }
                        }
                    }
                    if m_name.eq_ignore_ascii_case("cover") && !m_content.is_empty() {
                        cover_meta_id = Some(m_content);
                    } else if m_name.eq_ignore_ascii_case("calibre:series") && !m_content.is_empty()
                    {
                        series = m_content;
                    }
                    current_meta_prop = m_prop;
                } else if local == "item" {
                    if let Some(item) = parse_manifest_item(&e) {
                        manifest.insert(item.id.clone(), item);
                    }
                } else if local == "itemref" {
                    if let Some(idref) = parse_itemref(&e) {
                        spine_idrefs.push(idref);
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "meta" {
                    let mut m_name = String::new();
                    let mut m_content = String::new();
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if let Ok(v) = attr.unescape_value() {
                            match k.as_str() {
                                "name" => m_name = v.into_owned(),
                                "content" => m_content = v.into_owned(),
                                _ => {}
                            }
                        }
                    }
                    if m_name.eq_ignore_ascii_case("cover") && !m_content.is_empty() {
                        cover_meta_id = Some(m_content);
                    } else if m_name.eq_ignore_ascii_case("calibre:series") && !m_content.is_empty()
                    {
                        series = m_content;
                    }
                } else if local == "item" {
                    if let Some(item) = parse_manifest_item(&e) {
                        manifest.insert(item.id.clone(), item);
                    }
                } else if local == "itemref" {
                    if let Some(idref) = parse_itemref(&e) {
                        spine_idrefs.push(idref);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Ok(txt) = t.unescape() {
                    let trimmed = txt.trim();
                    if trimmed.is_empty() {
                        buf.clear();
                        continue;
                    }
                    match current_tag.as_str() {
                        "title" if title.is_empty() => title = trimmed.to_string(),
                        "creator" => authors.push(trimmed.to_string()),
                        "language" if language.is_empty() => language = trimmed.to_string(),
                        "publisher" if publisher.is_empty() => publisher = trimmed.to_string(),
                        "description" if description.is_empty() => {
                            description = html_to_plain_text(trimmed);
                        }
                        "subject" => subjects.push(trimmed.to_string()),
                        "meta"
                            if current_meta_prop == "belongs-to-collection"
                                && series.is_empty() =>
                        {
                            series = trimmed.to_string();
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::End(_)) => {
                current_tag.clear();
                current_meta_prop.clear();
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(AppError::Epub(format!("OPF XML ayrıştırılamadı: {e}"))),
            _ => {}
        }
        buf.clear();
    }

    let mut spine_paths = Vec::new();
    for idref in spine_idrefs {
        if let Some(item) = manifest.get(&idref) {
            if let Ok(resolved) = resolve_zip_relative(&opf_dir, &item.href) {
                spine_paths.push(resolved);
            }
        }
    }

    if spine_paths.is_empty() {
        return Err(AppError::Epub(
            "EPUB omurgası (spine) boş veya geçersiz".to_string(),
        ));
    }

    Ok(OpfPackage {
        opf_dir,
        epub_version,
        title,
        author: authors.join(", "),
        language,
        publisher,
        description,
        series,
        subjects,
        cover_meta_id,
        toc_ncx_id,
        manifest,
        spine_paths,
    })
}

fn parse_manifest_item(e: &quick_xml::events::BytesStart<'_>) -> Option<ManifestItem> {
    let mut id = String::new();
    let mut href = String::new();
    let mut media_type = String::new();
    let mut properties = String::new();

    for attr in e.attributes().flatten() {
        let k = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_ascii_lowercase();
        if let Ok(v) = attr.unescape_value() {
            match k.as_str() {
                "id" => id = v.into_owned(),
                "href" => href = v.into_owned(),
                "media-type" => media_type = v.into_owned(),
                "properties" => properties = v.into_owned(),
                _ => {}
            }
        }
    }
    if id.is_empty() || href.is_empty() {
        None
    } else {
        Some(ManifestItem {
            id,
            href,
            media_type,
            properties,
        })
    }
}

fn parse_itemref(e: &quick_xml::events::BytesStart<'_>) -> Option<String> {
    for attr in e.attributes().flatten() {
        let k = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_ascii_lowercase();
        if k == "idref" {
            if let Ok(v) = attr.unescape_value() {
                return Some(v.into_owned());
            }
        }
    }
    None
}

fn extract_toc(
    archive: &mut ZipArchive<std::fs::File>,
    pkg: &OpfPackage,
    total_read: &mut u64,
) -> Vec<TocItem> {
    // Prefer EPUB 3 nav document if available
    if let Some(nav_item) = pkg
        .manifest
        .values()
        .find(|m| m.properties.split_whitespace().any(|p| p == "nav"))
    {
        if let Ok(nav_path) = resolve_zip_relative(&pkg.opf_dir, &nav_item.href) {
            if let Ok(Some(bytes)) =
                read_zip_entry_by_path(archive, &nav_path, MAX_XML_ENTRY_BYTES, total_read)
            {
                if let Ok(xml) = String::from_utf8(bytes) {
                    let items = parse_epub3_nav(&xml, &dir_of(&nav_path), &pkg.spine_paths);
                    if !items.is_empty() {
                        return items;
                    }
                }
            }
        }
    }

    // Fallback to EPUB 2 NCX
    let ncx_item = pkg
        .toc_ncx_id
        .as_deref()
        .and_then(|id| pkg.manifest.get(id))
        .or_else(|| {
            pkg.manifest.values().find(|m| {
                m.media_type
                    .eq_ignore_ascii_case("application/x-dtbncx+xml")
            })
        });

    if let Some(ncx) = ncx_item {
        if let Ok(ncx_path) = resolve_zip_relative(&pkg.opf_dir, &ncx.href) {
            if let Ok(Some(bytes)) =
                read_zip_entry_by_path(archive, &ncx_path, MAX_XML_ENTRY_BYTES, total_read)
            {
                if let Ok(xml) = String::from_utf8(bytes) {
                    let items = parse_epub2_ncx(&xml, &dir_of(&ncx_path), &pkg.spine_paths);
                    if !items.is_empty() {
                        return items;
                    }
                }
            }
        }
    }

    // Synthetic fallback TOC from spine indices
    pkg.spine_paths
        .iter()
        .enumerate()
        .map(|(i, p)| TocItem {
            id: format!("spine-{i}"),
            title: format!("Bölüm {}", i + 1),
            href: p.clone(),
            spine_index: Some(i),
            depth: 0,
        })
        .collect()
}

fn find_spine_index(base_dir: &str, href: &str, spine_paths: &[String]) -> Option<usize> {
    let resolved = resolve_zip_relative(base_dir, href).ok()?;
    spine_paths
        .iter()
        .position(|p| p == &resolved || p.eq_ignore_ascii_case(&resolved))
}

fn parse_epub3_nav(xml: &str, nav_dir: &str, spine_paths: &[String]) -> Vec<TocItem> {
    let mut items = Vec::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().check_end_names = false;

    let mut in_toc_nav = false;
    let mut nav_depth = 0usize;
    let mut ol_depth = 0usize;
    let mut in_link = false;
    let mut current_href = String::new();
    let mut current_text = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "nav" {
                    let mut is_toc = false;
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "type" {
                            if let Ok(v) = attr.unescape_value() {
                                if v.eq_ignore_ascii_case("toc") {
                                    is_toc = true;
                                }
                            }
                        }
                    }
                    if is_toc && !in_toc_nav {
                        in_toc_nav = true;
                        nav_depth = 1;
                    } else if in_toc_nav {
                        nav_depth += 1;
                    }
                } else if in_toc_nav && local == "ol" {
                    ol_depth += 1;
                } else if in_toc_nav && local == "a" {
                    in_link = true;
                    current_href.clear();
                    current_text.clear();
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "href" {
                            if let Ok(v) = attr.unescape_value() {
                                current_href = v.into_owned();
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) if in_toc_nav && in_link => {
                if let Ok(txt) = t.unescape() {
                    current_text.push_str(&txt);
                }
            }
            Ok(Event::End(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if in_toc_nav && local == "a" && in_link {
                    in_link = false;
                    let title = current_text
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !title.is_empty() && !current_href.is_empty() {
                        let spine_index = find_spine_index(nav_dir, &current_href, spine_paths);
                        items.push(TocItem {
                            id: format!("toc-{}", items.len()),
                            title,
                            href: current_href.clone(),
                            spine_index,
                            depth: ol_depth.saturating_sub(1),
                        });
                    }
                } else if in_toc_nav && local == "ol" {
                    ol_depth = ol_depth.saturating_sub(1);
                } else if in_toc_nav && local == "nav" {
                    nav_depth = nav_depth.saturating_sub(1);
                    if nav_depth == 0 {
                        in_toc_nav = false;
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    items
}

fn parse_epub2_ncx(xml: &str, ncx_dir: &str, spine_paths: &[String]) -> Vec<TocItem> {
    let mut items = Vec::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut depth = 0usize;
    let mut in_nav_label = false;
    let mut in_text = false;
    let mut pending_title = String::new();
    let mut pending_depth = 0usize;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "navpoint" {
                    depth += 1;
                    pending_depth = depth.saturating_sub(1);
                    pending_title.clear();
                } else if local == "navlabel" {
                    in_nav_label = true;
                } else if local == "text" && in_nav_label {
                    in_text = true;
                } else if local == "content" && depth > 0 {
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "src" {
                            if let Ok(v) = attr.unescape_value() {
                                let href = v.into_owned();
                                let title = pending_title.trim().to_string();
                                if !title.is_empty() {
                                    let spine_index = find_spine_index(ncx_dir, &href, spine_paths);
                                    items.push(TocItem {
                                        id: format!("ncx-{}", items.len()),
                                        title,
                                        href,
                                        spine_index,
                                        depth: pending_depth,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "content" && depth > 0 {
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.local_name().as_ref())
                            .to_ascii_lowercase();
                        if k == "src" {
                            if let Ok(v) = attr.unescape_value() {
                                let href = v.into_owned();
                                let title = pending_title.trim().to_string();
                                if !title.is_empty() {
                                    let spine_index = find_spine_index(ncx_dir, &href, spine_paths);
                                    items.push(TocItem {
                                        id: format!("ncx-{}", items.len()),
                                        title,
                                        href,
                                        spine_index,
                                        depth: pending_depth,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(t)) if in_text => {
                if let Ok(txt) = t.unescape() {
                    pending_title.push_str(&txt);
                }
            }
            Ok(Event::End(e)) => {
                let local = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if local == "text" {
                    in_text = false;
                } else if local == "navlabel" {
                    in_nav_label = false;
                } else if local == "navpoint" {
                    depth = depth.saturating_sub(1);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    items
}

fn extract_cover_thumbnail(
    archive: &mut ZipArchive<std::fs::File>,
    pkg: &OpfPackage,
    total_read: &mut u64,
) -> Option<Vec<u8>> {
    let cover_item = pkg
        .manifest
        .values()
        .find(|m| m.properties.split_whitespace().any(|p| p == "cover-image"))
        .or_else(|| {
            pkg.cover_meta_id
                .as_deref()
                .and_then(|id| pkg.manifest.get(id))
        })
        .or_else(|| {
            pkg.manifest.values().find(|m| {
                m.media_type.starts_with("image/")
                    && (m.id.to_ascii_lowercase().contains("cover")
                        || m.href.to_ascii_lowercase().contains("cover"))
            })
        })?;

    let cover_path = resolve_zip_relative(&pkg.opf_dir, &cover_item.href).ok()?;
    let raw =
        read_zip_entry_by_path(archive, &cover_path, MAX_IMAGE_ENTRY_BYTES, total_read).ok()??;

    let img = image::load_from_memory(&raw).ok()?;
    let resized = if img.height() > 320 || img.width() > 240 {
        img.thumbnail(240, 320)
    } else {
        img
    };

    let mut out = Cursor::new(Vec::new());
    resized
        .to_rgb8()
        .write_to(&mut out, image::ImageFormat::Jpeg)
        .ok()?;
    Some(out.into_inner())
}

/// Parses metadata, cover thumbnail, TOC, and spine length from an EPUB 2/3 file.
pub fn parse_epub_metadata(path: &Path) -> Result<ParsedEpub, AppError> {
    let mut archive = open_guarded_archive(path)?;
    let mut total_read = 0u64;
    let pkg = parse_opf(&mut archive, &mut total_read)?;
    let toc = extract_toc(&mut archive, &pkg, &mut total_read);
    let cover_bytes = extract_cover_thumbnail(&mut archive, &pkg, &mut total_read);

    let fallback_title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Adsız Kitap")
        .to_string();

    Ok(ParsedEpub {
        title: if pkg.title.is_empty() {
            fallback_title
        } else {
            pkg.title
        },
        author: if pkg.author.is_empty() {
            "Bilinmeyen Yazar".to_string()
        } else {
            pkg.author
        },
        language: if pkg.language.is_empty() {
            "tr".to_string()
        } else {
            pkg.language
        },
        publisher: pkg.publisher,
        description: pkg.description,
        series: pkg.series,
        genre: pkg
            .subjects
            .into_iter()
            .take(3)
            .collect::<Vec<_>>()
            .join(", "),
        epub_version: pkg.epub_version,
        cover_bytes,
        spine_count: pkg.spine_paths.len(),
        toc,
    })
}

/// Returns the table of contents for a stored EPUB file.
pub fn get_epub_toc(path: &Path) -> Result<Vec<TocItem>, AppError> {
    let mut archive = open_guarded_archive(path)?;
    let mut total_read = 0u64;
    let pkg = parse_opf(&mut archive, &mut total_read)?;
    Ok(extract_toc(&mut archive, &pkg, &mut total_read))
}

/// Loads and strictly sanitizes a single spine chapter for sandboxed iframe rendering.
pub fn load_epub_chapter(
    path: &Path,
    spine_index: usize,
    theme_css: &str,
) -> Result<ChapterContent, AppError> {
    let mut archive = open_guarded_archive(path)?;
    let mut total_read = 0u64;
    let pkg = parse_opf(&mut archive, &mut total_read)?;
    let toc = extract_toc(&mut archive, &pkg, &mut total_read);

    let chapter_count = pkg.spine_paths.len();
    if spine_index >= chapter_count {
        return Err(AppError::Validation(format!(
            "Geçersiz bölüm indeksi: {spine_index} (toplam {chapter_count})"
        )));
    }

    let chapter_path = pkg.spine_paths[spine_index].clone();
    let chapter_dir = dir_of(&chapter_path);
    let raw_bytes = read_zip_entry_by_path(
        &mut archive,
        &chapter_path,
        MAX_XML_ENTRY_BYTES,
        &mut total_read,
    )?
    .ok_or_else(|| AppError::Epub(format!("Bölüm dosyası bulunamadı: {chapter_path}")))?;

    let raw_html = String::from_utf8_lossy(&raw_bytes).into_owned();

    // Clone archive file handle for nested resource resolution inside closures cleanly by reusing archive.
    let mut image_loader = |href: &str| -> Result<Option<(String, Vec<u8>)>, AppError> {
        let Ok(resolved) = resolve_zip_relative(&chapter_dir, href) else {
            return Ok(None);
        };
        let lower = resolved.to_ascii_lowercase();
        let mime = if lower.ends_with(".png") {
            "image/png"
        } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
            "image/jpeg"
        } else if lower.ends_with(".gif") {
            "image/gif"
        } else if lower.ends_with(".webp") {
            "image/webp"
        } else {
            return Ok(None);
        };
        let Some(bytes) = read_zip_entry_by_path(
            &mut archive,
            &resolved,
            MAX_IMAGE_ENTRY_BYTES,
            &mut total_read,
        )?
        else {
            return Ok(None);
        };
        Ok(Some((mime.to_string(), bytes)))
    };

    // Separate archive handle for CSS loader so both closures can capture independently without borrow conflict.
    let mut css_archive = open_guarded_archive(path)?;
    let mut css_total_read = 0u64;
    let mut css_loader = |href: &str| -> Result<Option<String>, AppError> {
        let Ok(resolved) = resolve_zip_relative(&chapter_dir, href) else {
            return Ok(None);
        };
        let Some(bytes) = read_zip_entry_by_path(
            &mut css_archive,
            &resolved,
            MAX_XML_ENTRY_BYTES,
            &mut css_total_read,
        )?
        else {
            return Ok(None);
        };
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    };

    let sanitized =
        sanitize_chapter_html(&raw_html, &mut image_loader, &mut css_loader, theme_css)?;

    let title = toc
        .iter()
        .find(|t| t.spine_index == Some(spine_index))
        .map(|t| t.title.clone())
        .unwrap_or_else(|| format!("Bölüm {}", spine_index + 1));

    Ok(ChapterContent {
        spine_index,
        chapter_count,
        title,
        src_doc: sanitized.src_doc,
        body_html: sanitized.body_html,
        plain_text: sanitized.plain_text,
    })
}

/// Performs a case-insensitive full-text search across all sanitized chapters in the EPUB.
pub fn search_epub_book(path: &Path, query: &str) -> Result<Vec<BookSearchMatch>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let mut archive = open_guarded_archive(path)?;
    let mut total_read = 0u64;
    let pkg = parse_opf(&mut archive, &mut total_read)?;
    let toc = extract_toc(&mut archive, &pkg, &mut total_read);

    let (needle, _) = fold_turkish_case_with_offsets(trimmed);
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    const MAX_MATCHES: usize = 100;

    for (idx, chapter_path) in pkg.spine_paths.iter().enumerate() {
        if results.len() >= MAX_MATCHES {
            break;
        }
        let Some(raw_bytes) = read_zip_entry_by_path(
            &mut archive,
            chapter_path,
            MAX_XML_ENTRY_BYTES,
            &mut total_read,
        )?
        else {
            continue;
        };
        let raw_html = String::from_utf8_lossy(&raw_bytes);
        let sanitized = sanitize_chapter_html(&raw_html, &mut |_| Ok(None), &mut |_| Ok(None), "")?;
        let plain = sanitized.plain_text;
        let (plain_folded, byte_map) = fold_turkish_case_with_offsets(&plain);

        let chapter_title = toc
            .iter()
            .find(|t| t.spine_index == Some(idx))
            .map(|t| t.title.clone())
            .unwrap_or_else(|| format!("Bölüm {}", idx + 1));

        let mut search_from = 0usize;
        while let Some(rel) = plain_folded[search_from..].find(&needle) {
            let folded_start = search_from + rel;
            let folded_end = folded_start + needle.len();
            let orig_start = byte_map.get(folded_start).copied().unwrap_or(0);
            let orig_end = byte_map.get(folded_end).copied().unwrap_or(plain.len());
            let snippet = build_snippet(&plain, orig_start, orig_end);
            results.push(BookSearchMatch {
                spine_index: idx,
                chapter_title: chapter_title.clone(),
                snippet,
                match_offset: orig_start,
            });
            if results.len() >= MAX_MATCHES {
                break;
            }
            search_from = folded_end.max(folded_start + 1);
        }
    }

    Ok(results)
}

/// Lowercases text while stripping U+0307 combining dot above (so Turkish 'İ' -> 'i')
/// and maps every byte index of the folded string back to a valid UTF-8 byte boundary in `input`.
fn fold_turkish_case_with_offsets(input: &str) -> (String, Vec<usize>) {
    let mut folded = String::with_capacity(input.len());
    let mut map = Vec::with_capacity(input.len() + 1);
    for (orig_b, ch) in input.char_indices() {
        for lower_ch in ch.to_lowercase() {
            if lower_ch == '\u{0307}' {
                continue;
            }
            let prev_len = folded.len();
            folded.push(lower_ch);
            for _ in prev_len..folded.len() {
                map.push(orig_b);
            }
        }
    }
    map.push(input.len());
    (folded, map)
}

fn floor_char_boundary(s: &str, idx: usize) -> usize {
    let mut b = idx.min(s.len());
    while b > 0 && !s.is_char_boundary(b) {
        b -= 1;
    }
    b
}

fn build_snippet(text: &str, match_start: usize, match_end: usize) -> String {
    let safe_start = floor_char_boundary(text, match_start);
    let safe_end = floor_char_boundary(text, match_end).max(safe_start);
    let before = text[..safe_start]
        .chars()
        .rev()
        .take(50)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    let matched = &text[safe_start..safe_end];
    let after = text[safe_end..].chars().take(60).collect::<String>();
    format!("...{before}{matched}{after}...")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn build_sample_epub2() -> NamedTempFile {
        let tmp = NamedTempFile::new().unwrap();
        let mut zw = ZipWriter::new(tmp.reopen().unwrap());
        let opts = SimpleFileOptions::default();

        zw.start_file("mimetype", opts).unwrap();
        zw.write_all(b"application/epub+zip").unwrap();

        zw.start_file("META-INF/container.xml", opts).unwrap();
        zw.write_all(
            br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .unwrap();

        zw.start_file("OEBPS/content.opf", opts).unwrap();
        zw.write_all(
            r#"<?xml version="1.0" encoding="utf-8"?>
<package version="2.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Örnek EPUB2 Kitabı</dc:title>
    <dc:creator>Ahmet Yılmaz</dc:creator>
    <dc:language>tr</dc:language>
    <dc:subject>Roman</dc:subject>
    <meta name="calibre:series" content="Anadolu Serisi"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>"#
                .as_bytes(),
        )
        .unwrap();

        zw.start_file("OEBPS/toc.ncx", opts).unwrap();
        zw.write_all(
            r#"<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>Birinci Bölüm</text></navLabel>
      <content src="Text/ch1.xhtml"/>
    </navPoint>
  </navMap>
</ncx>"#
                .as_bytes(),
        )
        .unwrap();

        zw.start_file("OEBPS/Text/ch1.xhtml", opts).unwrap();
        zw.write_all(
            r#"<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Ch1</title><script>alert('evil')</script></head>
<body>
  <h1>Birinci Bölüm</h1>
  <p>İstanbul sabahı çok güzeldi.</p>
  <img src="https://tracker.evil/pixel.png" onerror="alert(1)" />
</body>
</html>"#
                .as_bytes(),
        )
        .unwrap();

        zw.finish().unwrap();
        tmp
    }

    fn build_sample_epub3() -> NamedTempFile {
        let tmp = NamedTempFile::new().unwrap();
        let mut zw = ZipWriter::new(tmp.reopen().unwrap());
        let opts = SimpleFileOptions::default();

        zw.start_file("META-INF/container.xml", opts).unwrap();
        zw.write_all(
            br#"<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
        )
        .unwrap();

        zw.start_file("EPUB/package.opf", opts).unwrap();
        zw.write_all(
            br#"<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>EPUB3 Test</dc:title>
    <dc:creator>Zeynep Kaya</dc:creator>
    <dc:language>tr</dc:language>
    <meta property="belongs-to-collection">Bilim Serisi</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="s1" href="s1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="s1"/>
  </spine>
</package>"#,
        )
        .unwrap();

        zw.start_file("EPUB/nav.xhtml", opts).unwrap();
        zw.write_all(
            r#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol><li><a href="s1.xhtml">Giriş</a></li></ol></nav></body>
</html>"#
                .as_bytes(),
        )
        .unwrap();

        zw.start_file("EPUB/s1.xhtml", opts).unwrap();
        zw.write_all(b"<html><body><p>Kuantum ve Ankara.</p></body></html>")
            .unwrap();

        zw.finish().unwrap();
        tmp
    }

    #[test]
    fn parses_epub2_and_sanitizes_xss() {
        let epub2 = build_sample_epub2();
        let parsed = parse_epub_metadata(epub2.path()).unwrap();
        assert_eq!(parsed.title, "Örnek EPUB2 Kitabı");
        assert_eq!(parsed.author, "Ahmet Yılmaz");
        assert_eq!(parsed.series, "Anadolu Serisi");
        assert_eq!(parsed.genre, "Roman");
        assert_eq!(parsed.toc.len(), 1);
        assert_eq!(parsed.toc[0].title, "Birinci Bölüm");

        let ch = load_epub_chapter(epub2.path(), 0, "").unwrap();
        assert!(!ch.src_doc.to_ascii_lowercase().contains("<script"));
        assert!(!ch.src_doc.to_ascii_lowercase().contains("onerror"));
        assert!(!ch.src_doc.to_ascii_lowercase().contains("tracker.evil"));
        assert!(ch.plain_text.contains("İstanbul sabahı çok güzeldi."));

        let matches = search_epub_book(epub2.path(), "istanbul").unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].chapter_title, "Birinci Bölüm");
    }

    #[test]
    fn parses_epub3_nav_and_series() {
        let epub3 = build_sample_epub3();
        let parsed = parse_epub_metadata(epub3.path()).unwrap();
        assert_eq!(parsed.title, "EPUB3 Test");
        assert_eq!(parsed.series, "Bilim Serisi");
        assert_eq!(parsed.epub_version, "3.0");
        assert_eq!(parsed.toc.len(), 1);
        assert_eq!(parsed.toc[0].title, "Giriş");
        assert_eq!(parsed.toc[0].spine_index, Some(0));
    }
}
