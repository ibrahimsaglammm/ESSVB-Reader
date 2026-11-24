use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use ammonia::{Builder, UrlRelative};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::error::AppError;

pub const IFRAME_CSP_META: &str = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';";

pub type ImageLoader<'a> = &'a mut dyn FnMut(&str) -> Result<Option<(String, Vec<u8>)>, AppError>;
pub type CssLoader<'a> = &'a mut dyn FnMut(&str) -> Result<Option<String>, AppError>;

#[derive(Debug, Clone)]
pub struct SanitizedChapter {
    pub src_doc: String,
    pub body_html: String,
    pub plain_text: String,
}

/// Strips dangerous CSS constructs (`@import`, `url(...)`, `expression(`, `-moz-binding`, `behavior:`)
/// and prevents closing `</style>` tag breakouts.
pub fn sanitize_css(raw_css: &str) -> String {
    // 1. Remove /* ... */ comments so obfuscated keywords cannot hide inside comments.
    let mut no_comments = String::with_capacity(raw_css.len());
    let bytes = raw_css.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            no_comments.push(' ');
        } else {
            let ch = raw_css[i..].chars().next().unwrap_or(' ');
            no_comments.push(ch);
            i += ch.len_utf8();
        }
    }

    // 2. Remove any `url(...)` calls (blocks external CSS beacons, fonts, images).
    let no_urls = strip_css_function(&no_comments, "url(");
    let no_expr = strip_css_function(&no_urls, "expression(");

    // 3. Strip @import / @charset / @namespace rules and legacy script properties line/statement-wise.
    let mut out = String::with_capacity(no_expr.len());
    for line in no_expr.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("@import")
            || lower.contains("@charset")
            || lower.contains("@namespace")
            || lower.contains("-moz-binding")
            || lower.contains("behavior:")
            || lower.contains("javascript:")
            || lower.contains("vbscript:")
            || lower.contains("</style")
        {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn strip_css_function(input: &str, needle_lower: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(rel_idx) = lower[cursor..].find(needle_lower) {
        let start = cursor + rel_idx;
        out.push_str(&input[cursor..start]);
        let mut depth = 1usize;
        let mut scan = start + needle_lower.len();
        while scan < input.len() && depth > 0 {
            let ch = input[scan..].chars().next().unwrap_or(')');
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth -= 1;
            }
            scan += ch.len_utf8();
        }
        out.push_str("none");
        cursor = scan;
    }
    out.push_str(&input[cursor..]);
    out
}

/// Extracts `<style>` contents and local `<link rel="stylesheet" href="...">` paths from raw XHTML/HTML.
fn extract_styles_and_links(raw_html: &str) -> (Vec<String>, Vec<String>) {
    let mut inline_styles = Vec::new();
    let mut stylesheet_hrefs = Vec::new();

    let mut reader = Reader::from_str(raw_html);
    reader.config_mut().check_end_names = false;
    reader.config_mut().check_comments = false;

    let mut in_style = false;
    let mut style_buf = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if name == "style" {
                    in_style = true;
                    style_buf.clear();
                } else if name == "link" {
                    inspect_link_attrs(&e, &mut stylesheet_hrefs);
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if name == "link" {
                    inspect_link_attrs(&e, &mut stylesheet_hrefs);
                }
            }
            Ok(Event::Text(t)) if in_style => {
                if let Ok(text) = t.unescape() {
                    style_buf.push_str(&text);
                }
            }
            Ok(Event::CData(c)) if in_style => {
                style_buf.push_str(&String::from_utf8_lossy(c.as_ref()));
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_ascii_lowercase();
                if name == "style" && in_style {
                    in_style = false;
                    inline_styles.push(std::mem::take(&mut style_buf));
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    (inline_styles, stylesheet_hrefs)
}

fn inspect_link_attrs(e: &quick_xml::events::BytesStart<'_>, hrefs: &mut Vec<String>) {
    let mut rel_ok = false;
    let mut href_val: Option<String> = None;
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_ascii_lowercase();
        if let Ok(val) = attr.unescape_value() {
            if key == "rel"
                && val
                    .to_ascii_lowercase()
                    .split_whitespace()
                    .any(|r| r == "stylesheet")
            {
                rel_ok = true;
            } else if key == "href" {
                href_val = Some(val.into_owned());
            }
        }
    }
    if rel_ok {
        if let Some(h) = href_val {
            hrefs.push(h);
        }
    }
}

/// Extracts inner `<body>...</body>` HTML if present so `<head><title>` does not bleed into text.
fn extract_body_slice(raw_html: &str) -> &str {
    let lower = raw_html.to_ascii_lowercase();
    if let Some(body_open) = lower.find("<body") {
        if let Some(gt_rel) = lower[body_open..].find('>') {
            let start = body_open + gt_rel + 1;
            if let Some(body_close_rel) = lower[start..].rfind("</body") {
                return &raw_html[start..start + body_close_rel];
            }
            return &raw_html[start..];
        }
    }
    raw_html
}

/// Rewrites standalone SVG `<image ... href="...">` cover wrappers into `<img src="...">` before ammonia.
fn rewrite_svg_cover_images(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<image") {
        let start = cursor + rel;
        let next_char = lower.as_bytes().get(start + 6).copied().unwrap_or(b' ');
        if !next_char.is_ascii_whitespace() && next_char != b'>' && next_char != b'/' {
            out.push_str(&html[cursor..start + 6]);
            cursor = start + 6;
            continue;
        }
        out.push_str(&html[cursor..start]);
        if let Some(end_rel) = html[start..].find('>') {
            let tag_slice = &html[start..start + end_rel + 1];
            if let Some(href) = extract_attr_value(tag_slice, "xlink:href")
                .or_else(|| extract_attr_value(tag_slice, "href"))
            {
                let escaped = href.replace('"', "&quot;");
                out.push_str(&format!("<img src=\"{escaped}\" alt=\"\" />"));
            }
            cursor = start + end_rel + 1;
        } else {
            out.push_str(&html[start..]);
            cursor = html.len();
        }
    }
    out.push_str(&html[cursor..]);
    out
}

fn extract_attr_value(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}=");
    let idx = lower.find(&needle)?;
    let rest = tag[idx + needle.len()..].trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let after_quote = &rest[1..];
        let end = after_quote.find(quote)?;
        Some(after_quote[..end].to_string())
    } else {
        let end = rest.find(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/')?;
        Some(rest[..end].to_string())
    }
}

fn is_safe_raster_data_uri(val: &str) -> bool {
    let lower = val.to_ascii_lowercase();
    let prefixes = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/jpg;base64,",
        "data:image/gif;base64,",
        "data:image/webp;base64,",
    ];
    prefixes.iter().any(|p| lower.starts_with(p))
}

/// Sanitizes an EPUB chapter into safe HTML, inlines local raster images as `data:` URIs,
/// strips ALL external resources and scripts, and injects a strict `<meta>` CSP.
pub fn sanitize_chapter_html(
    raw_html: &str,
    image_loader: ImageLoader<'_>,
    css_loader: CssLoader<'_>,
    theme_css: &str,
) -> Result<SanitizedChapter, AppError> {
    let (inline_styles, stylesheet_hrefs) = extract_styles_and_links(raw_html);

    let mut combined_css = String::new();
    for href in stylesheet_hrefs {
        if let Ok(Some(css_text)) = css_loader(&href) {
            combined_css.push_str(&sanitize_css(&css_text));
            combined_css.push('\n');
        }
    }
    for style in inline_styles {
        combined_css.push_str(&sanitize_css(&style));
        combined_css.push('\n');
    }

    let body_raw = rewrite_svg_cover_images(extract_body_slice(raw_html));
    let inlined_images = preload_local_images(&body_raw, image_loader);

    let allowed_tags: HashSet<&'static str> = [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "div",
        "span",
        "br",
        "hr",
        "blockquote",
        "pre",
        "code",
        "em",
        "strong",
        "i",
        "b",
        "u",
        "s",
        "sub",
        "sup",
        "small",
        "mark",
        "q",
        "cite",
        "abbr",
        "dfn",
        "time",
        "ul",
        "ol",
        "li",
        "dl",
        "dt",
        "dd",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "caption",
        "figure",
        "figcaption",
        "img",
        "a",
        "ruby",
        "rt",
        "rp",
        "section",
        "article",
        "aside",
        "header",
        "footer",
        "nav",
        "main",
        "del",
        "ins",
    ]
    .into_iter()
    .collect();

    let generic_attrs: HashSet<&'static str> =
        ["id", "class", "title", "lang", "dir", "role", "aria-label"]
            .into_iter()
            .collect();

    let mut tag_attrs: HashMap<&'static str, HashSet<&'static str>> = HashMap::new();
    tag_attrs.insert(
        "img",
        ["src", "alt", "width", "height"].into_iter().collect(),
    );
    tag_attrs.insert("a", ["href", "title"].into_iter().collect());
    tag_attrs.insert("td", ["colspan", "rowspan"].into_iter().collect());
    tag_attrs.insert("th", ["colspan", "rowspan"].into_iter().collect());
    tag_attrs.insert("ol", ["start", "type"].into_iter().collect());

    let url_schemes: HashSet<&'static str> = ["data"].into_iter().collect();

    let mut builder = Builder::empty();
    builder
        .tags(allowed_tags)
        .generic_attributes(generic_attrs)
        .tag_attributes(tag_attrs)
        .url_schemes(url_schemes)
        .url_relative(UrlRelative::PassThrough)
        .strip_comments(true)
        .link_rel(None)
        .attribute_filter(move |element, attribute, value| {
            if element == "img" && attribute == "src" {
                let trimmed = value.trim();
                if is_safe_raster_data_uri(trimmed) {
                    return Some(Cow::Owned(trimmed.to_string()));
                }
                if trimmed.starts_with("//")
                    || trimmed.starts_with('/')
                    || trimmed.contains(':')
                    || trimmed.contains('\\')
                {
                    return None;
                }
                return inlined_images
                    .get(trimmed)
                    .map(|data_uri| Cow::Owned(data_uri.clone()));
            }

            if element == "a" && attribute == "href" {
                let trimmed = value.trim();
                if trimmed.starts_with('#') && !trimmed.contains(':') {
                    return Some(Cow::Owned(trimmed.to_string()));
                }
                // Disallow external navigation or script URIs inside the sandboxed frame.
                return None;
            }

            Some(Cow::Borrowed(value))
        });

    let body_html = builder.clean(&body_raw).to_string();
    let plain_text = html_to_plain_text(&body_html);
    let safe_theme_css = sanitize_css(theme_css);

    let src_doc = format!(
        r#"<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="{IFRAME_CSP_META}" />
<style>
html, body {{ margin: 0; padding: 0; overflow-wrap: anywhere; word-break: break-word; }}
img {{ max-width: 100%; height: auto; }}
table {{ max-width: 100%; border-collapse: collapse; }}
mark.essvb-highlight {{ border-radius: 2px; padding: 0 1px; }}
.essvb-tts-active {{ background-color: rgba(255, 193, 7, 0.42) !important; outline: 2px solid rgba(217, 119, 6, 0.7); border-radius: 3px; }}
</style>
<style id="essvb-book-style">{combined_css}</style>
<style id="essvb-theme-style">{safe_theme_css}</style>
</head>
<body>{body_html}</body>
</html>"#
    );

    Ok(SanitizedChapter {
        src_doc,
        body_html,
        plain_text,
    })
}

/// Converts sanitized HTML into readable plain text with paragraph newlines for search and TTS.
pub fn html_to_plain_text(html: &str) -> String {
    let mut with_breaks = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag_buf = String::new();

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
        } else if ch == '>' && in_tag {
            in_tag = false;
            let tag_lower = tag_buf
                .trim()
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if matches!(
                tag_lower.as_str(),
                "p" | "div"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
                    | "li"
                    | "blockquote"
                    | "tr"
                    | "br"
                    | "hr"
                    | "section"
                    | "article"
            ) {
                with_breaks.push('\n');
            }
        } else if in_tag {
            tag_buf.push(ch);
        } else {
            with_breaks.push(ch);
        }
    }

    let decoded = decode_basic_entities(&with_breaks);
    let mut lines = Vec::new();
    for line in decoded.lines() {
        let collapsed: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !collapsed.is_empty() {
            lines.push(collapsed);
        }
    }
    lines.join("\n")
}

fn decode_basic_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(amp_idx) = rest.find('&') {
        out.push_str(&rest[..amp_idx]);
        let after = &rest[amp_idx..];
        if let Some(semi_idx) = after.bytes().take(12).position(|b| b == b';') {
            let entity = &after[1..semi_idx];
            let replacement = match entity {
                "amp" => Some("&".to_string()),
                "lt" => Some("<".to_string()),
                "gt" => Some(">".to_string()),
                "quot" => Some("\"".to_string()),
                "apos" | "#39" => Some("'".to_string()),
                "nbsp" => Some(" ".to_string()),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16)
                        .ok()
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                }
                _ if entity.starts_with('#') => entity[1..]
                    .parse::<u32>()
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string()),
                _ => None,
            };
            if let Some(rep) = replacement {
                out.push_str(&rep);
                rest = &after[semi_idx + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &rest[amp_idx + 1..];
    }
    out.push_str(rest);
    out
}

fn preload_local_images(body_html: &str, image_loader: ImageLoader<'_>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let lower = body_html.to_ascii_lowercase();
    let mut cursor = 0usize;
    while let Some(rel) = lower[cursor..].find("<img") {
        let start = cursor + rel;
        let next_ch = lower.as_bytes().get(start + 4).copied().unwrap_or(b' ');
        if !next_ch.is_ascii_whitespace() && next_ch != b'>' && next_ch != b'/' {
            cursor = start + 4;
            continue;
        }
        if let Some(end_rel) = body_html[start..].find('>') {
            let tag_slice = &body_html[start..start + end_rel + 1];
            if let Some(src) = extract_attr_value(tag_slice, "src") {
                let trimmed = src.trim();
                if !trimmed.is_empty()
                    && !trimmed.starts_with("//")
                    && !trimmed.starts_with('/')
                    && !trimmed.contains(':')
                    && !trimmed.contains('\\')
                    && !map.contains_key(trimmed)
                {
                    if let Ok(Some((mime, bytes))) = image_loader(trimmed) {
                        let encoded = BASE64_STANDARD.encode(bytes);
                        map.insert(trimmed.to_string(), format!("data:{mime};base64,{encoded}"));
                    }
                }
            }
            cursor = start + end_rel + 1;
        } else {
            break;
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_scripts_handlers_and_external_urls() {
        let malicious = r##"
<!doctype html>
<html>
<head>
  <title>Hidden Head Title</title>
  <link rel="stylesheet" href="https://evil.example/track.css" />
  <style>
    @import url("https://evil.example/beacon.css");
    body { background: url(https://evil.example/bg.png); color: #222; }
    p { line-height: 1.6; }
  </style>
  <script>alert('head-xss')</script>
</head>
<body>
  <h1 onclick="alert(1)">Bölüm 1</h1>
  <p>Merhaba <img src="https://evil.example/pixel.png" onerror="fetch('https://evil.example')" /> Dünya!</p>
  <img src="//evil.example/proto.png" alt="proto" />
  <img src="data:image/svg+xml;base64,PHN2Zy8+" alt="svg" />
  <img src="data:text/html;base64,PHNjcmlwdD4=" alt="html" />
  <img src="images/pic.png" alt="Yerel" />
  <iframe src="https://evil.example/frame.html"></iframe>
  <a href="javascript:alert(1)">Kötü Bağlantı</a>
  <a href="#dipnot1">Dipnot</a>
  <script>window.parent.postMessage('pwn', '*');</script>
</body>
</html>
"##;
        let result = sanitize_chapter_html(
            malicious,
            &mut |path| {
                if path == "images/pic.png" {
                    Ok(Some(("image/png".to_string(), vec![137, 80, 78, 71])))
                } else {
                    Ok(None)
                }
            },
            &mut |_| Ok(None),
            "body { font-size: 16px; }",
        )
        .unwrap();

        let lower = result.src_doc.to_ascii_lowercase();
        assert!(!lower.contains("<script"));
        assert!(!lower.contains("onerror"));
        assert!(!lower.contains("onclick"));
        assert!(!lower.contains("javascript:"));
        assert!(!lower.contains("evil.example"));
        assert!(!lower.contains("@import"));
        assert!(!lower.contains("<iframe"));
        assert!(!lower.contains("data:image/svg+xml"));
        assert!(!lower.contains("data:text/html"));
        assert!(!result.body_html.contains("Hidden Head Title"));
        assert!(result.body_html.contains("data:image/png;base64,"));
        assert!(result.body_html.contains("href=\"#dipnot1\""));
        assert!(result.src_doc.contains("script-src 'none'"));
        assert!(result.plain_text.contains("Merhaba Dünya!"));
    }

    #[test]
    fn decode_entities_handles_turkish_multibyte_chars_near_byte_12() {
        // Byte 11..13 is multi-byte 'ç', so naive byte slicing at index 12 previously panicked.
        let sample = "<p>Ayrıca &1234567890çalışma ve ğüşöıİ &amp; örnek metin</p>";
        let plain = html_to_plain_text(sample);
        assert!(plain.contains("&1234567890çalışma"));
        assert!(plain.contains("& örnek metin"));
    }
}
