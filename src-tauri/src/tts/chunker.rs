use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextChunk {
    pub index: usize,
    pub text: String,
    /// UTF-16 code unit start offset matching JS string indices.
    pub start_offset: usize,
    /// UTF-16 code unit end offset matching JS string indices.
    pub end_offset: usize,
}

const TURKISH_ABBREVIATIONS: &[&str] = &[
    "dr.", "prof.", "doç.", "yrd.", "av.", "alb.", "bnb.", "yzb.", "yb.", "gn.", "vb.", "vs.",
    "örn.", "bkz.", "sf.", "s.", "c.", "yy.", "st.", "m.", "cm.", "km.", "mm.", "kg.", "gr.",
    "lt.", "sn.", "dk.", "sa.", "no.", "mad.", "hz.", "inc.", "ltd.", "şti.", "m.ö.", "m.s.",
];

/// Splits Turkish/English prose into sentence/paragraph chunks with exact UTF-16 offsets
/// while keeping common Turkish abbreviations and numbers intact.
pub fn split_text_for_tts(input: &str, max_chars: usize) -> Vec<TextChunk> {
    let max_len = max_chars.max(60);
    let mut raw_segments: Vec<(usize, usize, String)> = Vec::new();

    // Precompute byte -> UTF-16 offset lookup
    let mut byte_to_utf16 = vec![0usize; input.len() + 1];
    let mut u16_acc = 0usize;
    for (b_idx, ch) in input.char_indices() {
        byte_to_utf16[b_idx] = u16_acc;
        u16_acc += ch.len_utf16();
        let next_b = b_idx + ch.len_utf8();
        for slot in &mut byte_to_utf16[b_idx + 1..=next_b] {
            *slot = u16_acc;
        }
    }

    let bytes = input.as_bytes();
    let mut seg_start = 0usize;
    let mut iter = input.char_indices().peekable();

    while let Some((idx, ch)) = iter.next() {
        let end_byte = idx + ch.len_utf8();
        if ch == '\n' {
            push_trimmed_segment(input, seg_start, idx, &byte_to_utf16, &mut raw_segments);
            seg_start = end_byte;
            continue;
        }

        if matches!(ch, '.' | '!' | '?' | '…') {
            let next_ch = iter.peek().map(|(_, c)| *c);
            let is_boundary = match next_ch {
                None => true,
                Some(c) if c.is_whitespace() => {
                    if ch == '.' {
                        !ends_with_abbreviation(&input[seg_start..end_byte])
                            && !is_decimal_or_ordinal(input, idx, bytes)
                    } else {
                        true
                    }
                }
                _ => false,
            };

            if is_boundary {
                push_trimmed_segment(
                    input,
                    seg_start,
                    end_byte,
                    &byte_to_utf16,
                    &mut raw_segments,
                );
                seg_start = end_byte;
            }
        }
    }
    if seg_start < input.len() {
        push_trimmed_segment(
            input,
            seg_start,
            input.len(),
            &byte_to_utf16,
            &mut raw_segments,
        );
    }

    // Sub-split overly long segments on clause punctuation or whitespace
    let mut chunks = Vec::new();
    for (u16_start, _u16_end, seg_text) in raw_segments {
        if seg_text.chars().count() <= max_len {
            let len_u16: usize = seg_text.chars().map(char::len_utf16).sum();
            chunks.push(TextChunk {
                index: chunks.len(),
                text: seg_text,
                start_offset: u16_start,
                end_offset: u16_start + len_u16,
            });
        } else {
            split_long_segment(&seg_text, u16_start, max_len, &mut chunks);
        }
    }

    chunks
}

fn push_trimmed_segment(
    full: &str,
    start_b: usize,
    end_b: usize,
    byte_to_utf16: &[usize],
    out: &mut Vec<(usize, usize, String)>,
) {
    let slice = &full[start_b..end_b];
    let trimmed_start_rel = slice.len() - slice.trim_start().len();
    let trimmed_end_rel = slice.trim_end().len();
    if trimmed_end_rel <= trimmed_start_rel {
        return;
    }
    let abs_start = start_b + trimmed_start_rel;
    let abs_end = start_b + trimmed_end_rel;
    let text = full[abs_start..abs_end].to_string();
    out.push((byte_to_utf16[abs_start], byte_to_utf16[abs_end], text));
}

fn ends_with_abbreviation(seg: &str) -> bool {
    let last_token = seg
        .split_whitespace()
        .last()
        .unwrap_or("")
        .trim_start_matches(|c: char| !c.is_alphabetic())
        .to_lowercase();
    if TURKISH_ABBREVIATIONS.contains(&last_token.as_str()) {
        return true;
    }
    // Single-letter initials like "A." or "M."
    let chars: Vec<char> = last_token.chars().collect();
    chars.len() == 2 && chars[0].is_alphabetic() && chars[1] == '.'
}

fn is_decimal_or_ordinal(full: &str, dot_byte: usize, _bytes: &[u8]) -> bool {
    let prev = full[..dot_byte].chars().last();
    let next_non_ws = full[dot_byte + 1..].trim_start().chars().next();
    if matches!(prev, Some(c) if c.is_ascii_digit()) {
        // Ordinal followed by lowercase word ("2. bölüm") -> keep together; followed by uppercase -> sentence end
        if let Some(nc) = next_non_ws {
            return nc.is_lowercase() || nc.is_ascii_digit();
        }
    }
    false
}

fn split_long_segment(seg: &str, base_u16: usize, max_len: usize, out: &mut Vec<TextChunk>) {
    let mut cursor_b = 0usize;
    let mut cur_u16 = base_u16;
    while cursor_b < seg.len() {
        let rest = &seg[cursor_b..];
        if rest.chars().count() <= max_len {
            let trimmed = rest.trim();
            if !trimmed.is_empty() {
                let lead_u16: usize = rest[..rest.len() - rest.trim_start().len()]
                    .chars()
                    .map(char::len_utf16)
                    .sum();
                let len_u16: usize = trimmed.chars().map(char::len_utf16).sum();
                out.push(TextChunk {
                    index: out.len(),
                    text: trimmed.to_string(),
                    start_offset: cur_u16 + lead_u16,
                    end_offset: cur_u16 + lead_u16 + len_u16,
                });
            }
            break;
        }

        // Find best split point within max_len chars (prefer clause punctuation, then space)
        let mut limit_byte = rest.len();
        for (count, (b_idx, ch)) in rest.char_indices().enumerate() {
            if count >= max_len {
                limit_byte = b_idx;
                break;
            }
            let _ = ch;
        }
        let window = &rest[..limit_byte];
        let split_rel = window
            .rfind([';', ':', ',', '—'])
            .map(|i| i + window[i..].chars().next().map(char::len_utf8).unwrap_or(1))
            .or_else(|| window.rfind(char::is_whitespace))
            .unwrap_or(limit_byte);

        let part = &rest[..split_rel];
        let trimmed = part.trim();
        if !trimmed.is_empty() {
            let lead_u16: usize = part[..part.len() - part.trim_start().len()]
                .chars()
                .map(char::len_utf16)
                .sum();
            let len_u16: usize = trimmed.chars().map(char::len_utf16).sum();
            out.push(TextChunk {
                index: out.len(),
                text: trimmed.to_string(),
                start_offset: cur_u16 + lead_u16,
                end_offset: cur_u16 + lead_u16 + len_u16,
            });
        }
        let advance_u16: usize = part.chars().map(char::len_utf16).sum();
        cur_u16 += advance_u16;
        cursor_b += split_rel.max(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_turkish_abbreviations_and_tracks_offsets() {
        let txt = "Prof. Dr. Mehmet Öz dün akşam geldi. İkinci cümle burada! Üçüncü mü?";
        let chunks = split_text_for_tts(txt, 300);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].text, "Prof. Dr. Mehmet Öz dün akşam geldi.");
        assert_eq!(chunks[1].text, "İkinci cümle burada!");
        assert_eq!(chunks[2].text, "Üçüncü mü?");

        // Verify UTF-16 slice equivalence
        let u16: Vec<u16> = txt.encode_utf16().collect();
        for c in &chunks {
            let sliced = String::from_utf16(&u16[c.start_offset..c.end_offset]).unwrap();
            assert_eq!(sliced, c.text);
        }
    }

    #[test]
    fn splits_overlong_sentences_cleanly() {
        let long = "Bu çok uzun bir cümledir, içinde virgüller bulunur; ayrıca noktalı virgül ve kelimeler ile maksimum sınır aşılınca bölünmelidir.";
        let chunks = split_text_for_tts(long, 60);
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 60));
    }
}
