//! 文档预览抽取工具。

use flate2::read::ZlibDecoder;
use std::fs;
use std::io::{self, Cursor, Read};
use std::path::Path;

use zip::ZipArchive;

const DOCX_TEXT_ENTRIES: &[&str] = &[
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
];

const DOCX_TEXT_PREFIXES: &[&str] = &["word/header", "word/footer"];
const XLSX_SHARED_STRINGS_ENTRY: &str = "xl/sharedStrings.xml";
const XLSX_SHEET_PREFIX: &str = "xl/worksheets/sheet";
const PPTX_SLIDE_PREFIX: &str = "ppt/slides/slide";

#[derive(Debug)]
pub enum DocumentPreviewError {
    Io(io::Error),
    Zip(zip::result::ZipError),
    UnsupportedFormat,
    MissingDocumentXml,
    EmptyText,
}

impl std::fmt::Display for DocumentPreviewError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "读取文档失败: {error}"),
            Self::Zip(error) => write!(formatter, "解析 DOCX 压缩包失败: {error}"),
            Self::UnsupportedFormat => write!(formatter, "不支持的文档格式"),
            Self::MissingDocumentXml => write!(formatter, "DOCX 缺少 word/document.xml"),
            Self::EmptyText => write!(formatter, "DOCX 未抽取到可预览文本"),
        }
    }
}

impl std::error::Error for DocumentPreviewError {}

impl From<io::Error> for DocumentPreviewError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<zip::result::ZipError> for DocumentPreviewError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::Zip(error)
    }
}

pub fn is_supported_document(path: &Path) -> bool {
    document_kind(path).is_some()
}

pub fn extract_document_text_from_path(
    path: &Path,
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    let bytes = fs::read(path)?;
    match document_kind(path) {
        Some(DocumentKind::Docx) => extract_docx_text(&bytes, max_size),
        Some(DocumentKind::Xlsx) => extract_xlsx_text(&bytes, max_size),
        Some(DocumentKind::Pptx) => extract_pptx_text(&bytes, max_size),
        Some(DocumentKind::Pdf) => extract_pdf_text(&bytes, max_size),
        None => Err(DocumentPreviewError::UnsupportedFormat),
    }
}

pub fn extract_docx_text(
    bytes: &[u8],
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)?;
    let mut fragments = Vec::new();
    let mut saw_document_xml = false;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name()?.into_owned();
        if !is_docx_text_entry(&name) {
            continue;
        }
        if name == "word/document.xml" {
            saw_document_xml = true;
        }

        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        let text = extract_text_from_word_xml(&xml);
        if !text.trim().is_empty() {
            fragments.push(text);
        }
    }

    if !saw_document_xml {
        return Err(DocumentPreviewError::MissingDocumentXml);
    }

    let text = normalize_plain_text(&fragments.join("\n\n"));
    if text.is_empty() {
        return Err(DocumentPreviewError::EmptyText);
    }

    Ok(truncate_to_char_boundary(&text, max_size.unwrap_or(usize::MAX)).to_string())
}

pub fn extract_xlsx_text(
    bytes: &[u8],
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)?;
    let shared_strings = read_zip_text_entry(&mut archive, XLSX_SHARED_STRINGS_ENTRY)
        .map(|xml| extract_inline_text_nodes(&xml))
        .unwrap_or_default();
    let mut fragments = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name()?.into_owned();
        if !is_xlsx_sheet_entry(&name) {
            continue;
        }

        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        let text = extract_text_from_sheet_xml(&xml, &shared_strings);
        if !text.trim().is_empty() {
            fragments.push(text);
        }
    }

    finish_extracted_text(&fragments.join("\n\n"), max_size)
}

pub fn extract_pptx_text(
    bytes: &[u8],
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)?;
    let mut fragments = Vec::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name()?.into_owned();
        if !is_pptx_slide_entry(&name) {
            continue;
        }

        let mut xml = String::new();
        file.read_to_string(&mut xml)?;
        let text = extract_inline_text_nodes(&xml).join("\n");
        if !text.trim().is_empty() {
            fragments.push(text);
        }
    }

    finish_extracted_text(&fragments.join("\n\n"), max_size)
}

pub fn extract_pdf_text(
    bytes: &[u8],
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(DocumentPreviewError::UnsupportedFormat);
    }

    let mut fragments = Vec::new();
    let mut cursor = 0;
    while let Some(stream_offset) = find_bytes(&bytes[cursor..], b"stream") {
        let stream_start_marker = cursor + stream_offset;
        let stream_start = skip_pdf_line_end(bytes, stream_start_marker + b"stream".len());
        let Some(end_offset) = find_bytes(&bytes[stream_start..], b"endstream") else {
            break;
        };
        let stream_end = stream_start + end_offset;
        let stream = trim_pdf_stream_bytes(&bytes[stream_start..stream_end]);
        let candidates = decode_pdf_stream_candidates(stream);
        for candidate in candidates {
            let text = extract_text_from_pdf_stream(&candidate);
            if !text.trim().is_empty() {
                fragments.push(text);
            }
        }
        cursor = stream_end + b"endstream".len();
    }

    finish_extracted_text(&fragments.join("\n"), max_size)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DocumentKind {
    Docx,
    Xlsx,
    Pptx,
    Pdf,
}

fn document_kind(path: &Path) -> Option<DocumentKind> {
    if extension_is(path, "docx") {
        return Some(DocumentKind::Docx);
    }
    if extension_is(path, "xlsx") {
        return Some(DocumentKind::Xlsx);
    }
    if extension_is(path, "pptx") {
        return Some(DocumentKind::Pptx);
    }
    if extension_is(path, "pdf") {
        return Some(DocumentKind::Pdf);
    }
    None
}

fn extension_is(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn is_docx_text_entry(name: &str) -> bool {
    DOCX_TEXT_ENTRIES.contains(&name)
        || DOCX_TEXT_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix) && name.ends_with(".xml"))
}

fn is_xlsx_sheet_entry(name: &str) -> bool {
    name.starts_with(XLSX_SHEET_PREFIX) && name.ends_with(".xml")
}

fn is_pptx_slide_entry(name: &str) -> bool {
    name.starts_with(PPTX_SLIDE_PREFIX) && name.ends_with(".xml")
}

fn read_zip_text_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    entry_name: &str,
) -> Result<String, DocumentPreviewError> {
    let mut file = archive.by_name(entry_name)?;
    let mut xml = String::new();
    file.read_to_string(&mut xml)?;
    Ok(xml)
}

fn extract_text_from_word_xml(xml: &str) -> String {
    let mut output = String::new();
    let mut text_node = String::new();
    let mut in_text = false;
    let mut in_tag = false;
    let mut tag = String::new();
    let mut entity = String::new();
    let mut in_entity = false;

    for character in xml.chars() {
        if in_tag {
            if character == '>' {
                handle_docx_tag(&tag, &mut output, &mut text_node, &mut in_text);
                tag.clear();
                in_tag = false;
            } else {
                tag.push(character);
            }
            continue;
        }

        if character == '<' {
            if in_text {
                output.push_str(&text_node);
                text_node.clear();
            }
            in_tag = true;
            continue;
        }

        if !in_text {
            continue;
        }

        if in_entity {
            if character == ';' {
                text_node.push_str(&decode_xml_entity(&entity));
                entity.clear();
                in_entity = false;
            } else {
                entity.push(character);
            }
            continue;
        }

        if character == '&' {
            in_entity = true;
        } else {
            text_node.push(character);
        }
    }

    if in_text {
        output.push_str(&text_node);
    }

    normalize_plain_text(&output)
}

fn extract_text_from_sheet_xml(xml: &str, shared_strings: &[String]) -> String {
    let mut values = Vec::new();
    let mut cell_type: Option<String> = None;
    let mut current_value = String::new();
    let mut current_inline_text = String::new();
    let mut in_value = false;
    let mut in_inline_text = false;
    let mut in_tag = false;
    let mut tag = String::new();
    let mut entity = String::new();
    let mut in_entity = false;

    for character in xml.chars() {
        if in_tag {
            if character == '>' {
                handle_sheet_tag(
                    &tag,
                    shared_strings,
                    &mut values,
                    &mut cell_type,
                    &mut current_value,
                    &mut current_inline_text,
                    &mut in_value,
                    &mut in_inline_text,
                );
                tag.clear();
                in_tag = false;
            } else {
                tag.push(character);
            }
            continue;
        }

        if character == '<' {
            in_tag = true;
            continue;
        }

        if !in_value && !in_inline_text {
            continue;
        }

        if in_entity {
            if character == ';' {
                let decoded = decode_xml_entity(&entity);
                if in_value {
                    current_value.push_str(&decoded);
                }
                if in_inline_text {
                    current_inline_text.push_str(&decoded);
                }
                entity.clear();
                in_entity = false;
            } else {
                entity.push(character);
            }
            continue;
        }

        if character == '&' {
            in_entity = true;
        } else {
            if in_value {
                current_value.push(character);
            }
            if in_inline_text {
                current_inline_text.push(character);
            }
        }
    }

    normalize_plain_text(&values.join("\t"))
}

#[allow(clippy::too_many_arguments)]
fn handle_sheet_tag(
    tag: &str,
    shared_strings: &[String],
    values: &mut Vec<String>,
    cell_type: &mut Option<String>,
    current_value: &mut String,
    current_inline_text: &mut String,
    in_value: &mut bool,
    in_inline_text: &mut bool,
) {
    let trimmed = tag.trim();
    let name = tag_name(trimmed);
    match local_name(&name).as_str() {
        "c" if !trimmed.starts_with('/') => {
            *cell_type = attribute_value(trimmed, "t");
            current_value.clear();
            current_inline_text.clear();
        }
        "c" if trimmed.starts_with('/') => {
            let value = if cell_type.as_deref() == Some("s") {
                current_value
                    .trim()
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| shared_strings.get(index).cloned())
                    .unwrap_or_default()
            } else if !current_inline_text.trim().is_empty() {
                current_inline_text.clone()
            } else {
                current_value.clone()
            };
            let value = normalize_plain_text(&value);
            if !value.is_empty() {
                values.push(value);
            }
            *cell_type = None;
            current_value.clear();
            current_inline_text.clear();
        }
        "v" => *in_value = !trimmed.starts_with('/'),
        "t" => *in_inline_text = !trimmed.starts_with('/'),
        "row" if trimmed.starts_with('/') => values.push("\n".to_string()),
        _ => {}
    }
}

fn extract_inline_text_nodes(xml: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut text_node = String::new();
    let mut in_text = false;
    let mut in_tag = false;
    let mut tag = String::new();
    let mut entity = String::new();
    let mut in_entity = false;

    for character in xml.chars() {
        if in_tag {
            if character == '>' {
                let trimmed = tag.trim();
                if local_name(&tag_name(trimmed)) == "t" {
                    if trimmed.starts_with('/') {
                        let text = normalize_plain_text(&text_node);
                        if !text.is_empty() {
                            values.push(text);
                        }
                        text_node.clear();
                        in_text = false;
                    } else {
                        in_text = true;
                    }
                }
                tag.clear();
                in_tag = false;
            } else {
                tag.push(character);
            }
            continue;
        }

        if character == '<' {
            in_tag = true;
            continue;
        }

        if !in_text {
            continue;
        }

        if in_entity {
            if character == ';' {
                text_node.push_str(&decode_xml_entity(&entity));
                entity.clear();
                in_entity = false;
            } else {
                entity.push(character);
            }
            continue;
        }

        if character == '&' {
            in_entity = true;
        } else {
            text_node.push(character);
        }
    }

    values
}

fn handle_docx_tag(tag: &str, output: &mut String, text_node: &mut String, in_text: &mut bool) {
    let trimmed = tag.trim();
    let name = tag_name(trimmed);

    match name.as_str() {
        "w:t" => {
            if trimmed.starts_with('/') {
                output.push_str(text_node);
                text_node.clear();
                *in_text = false;
            } else {
                *in_text = true;
            }
        }
        "w:tab" => output.push('\t'),
        "w:br" | "w:cr" => output.push('\n'),
        "w:p" if trimmed.starts_with('/') => {
            trim_trailing_inline_space(output);
            output.push('\n');
        }
        "w:tr" if trimmed.starts_with('/') => output.push('\n'),
        "w:tc" if trimmed.starts_with('/') => output.push('\t'),
        _ => {}
    }
}

fn tag_name(tag: &str) -> String {
    tag.trim_start_matches('/')
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string()
}

fn local_name(tag_name: &str) -> String {
    tag_name.rsplit(':').next().unwrap_or(tag_name).to_string()
}

fn attribute_value(tag: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn trim_trailing_inline_space(output: &mut String) {
    while matches!(output.chars().last(), Some(' ' | '\t')) {
        output.pop();
    }
}

fn decode_xml_entity(entity: &str) -> String {
    match entity {
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        "quot" => "\"".to_string(),
        "apos" => "'".to_string(),
        value if value.starts_with("#x") => u32::from_str_radix(&value[2..], 16)
            .ok()
            .and_then(char::from_u32)
            .map(|character| character.to_string())
            .unwrap_or_else(|| format!("&{entity};")),
        value if value.starts_with('#') => value[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map(|character| character.to_string())
            .unwrap_or_else(|| format!("&{entity};")),
        _ => format!("&{entity};"),
    }
}

fn normalize_plain_text(input: &str) -> String {
    let mut normalized_lines = Vec::new();
    let mut previous_blank = true;

    for line in input.lines() {
        let mut normalized_line = String::new();
        let mut previous_space = false;

        for character in line.chars() {
            if character.is_whitespace() && character != '\t' {
                if !previous_space {
                    normalized_line.push(' ');
                }
                previous_space = true;
            } else {
                normalized_line.push(character);
                previous_space = false;
            }
        }

        let line = normalized_line.trim();
        if line.is_empty() {
            if !previous_blank {
                normalized_lines.push(String::new());
            }
            previous_blank = true;
        } else {
            normalized_lines.push(line.to_string());
            previous_blank = false;
        }
    }

    while normalized_lines
        .last()
        .map(|line| line.is_empty())
        .unwrap_or(false)
    {
        normalized_lines.pop();
    }

    normalized_lines.join("\n")
}

fn finish_extracted_text(
    input: &str,
    max_size: Option<usize>,
) -> Result<String, DocumentPreviewError> {
    let text = normalize_plain_text(input);
    if text.is_empty() {
        return Err(DocumentPreviewError::EmptyText);
    }
    Ok(truncate_to_char_boundary(&text, max_size.unwrap_or(usize::MAX)).to_string())
}

fn truncate_to_char_boundary(input: &str, max_size: usize) -> &str {
    if input.len() <= max_size {
        return input;
    }

    let mut end = max_size;
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn skip_pdf_line_end(bytes: &[u8], mut index: usize) -> usize {
    if bytes.get(index) == Some(&b'\r') {
        index += 1;
    }
    if bytes.get(index) == Some(&b'\n') {
        index += 1;
    }
    index
}

fn trim_pdf_stream_bytes(bytes: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = bytes.len();
    while start < end && matches!(bytes[start], b'\r' | b'\n') {
        start += 1;
    }
    while end > start && matches!(bytes[end - 1], b'\r' | b'\n' | b' ') {
        end -= 1;
    }
    &bytes[start..end]
}

fn decode_pdf_stream_candidates(stream: &[u8]) -> Vec<Vec<u8>> {
    let mut candidates = vec![stream.to_vec()];
    let mut decoder = ZlibDecoder::new(stream);
    let mut decoded = Vec::new();
    if decoder.read_to_end(&mut decoded).is_ok() && !decoded.is_empty() {
        candidates.push(decoded);
    }
    candidates
}

fn extract_text_from_pdf_stream(stream: &[u8]) -> String {
    let text = String::from_utf8_lossy(stream);
    let mut values = Vec::new();
    let mut chars = text.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '(' {
            let literal = read_pdf_literal_string(&mut chars);
            let normalized = normalize_plain_text(&literal);
            if !normalized.is_empty() {
                values.push(normalized);
            }
            continue;
        }

        if character == '<' && chars.peek() != Some(&'<') {
            let hex = read_pdf_hex_string(&mut chars);
            let decoded = decode_pdf_hex_text(&hex);
            let normalized = normalize_plain_text(&decoded);
            if !normalized.is_empty() {
                values.push(normalized);
            }
        }
    }

    normalize_plain_text(&values.join("\n"))
}

fn read_pdf_literal_string<I>(chars: &mut std::iter::Peekable<I>) -> String
where
    I: Iterator<Item = char>,
{
    let mut output = String::new();
    let mut depth = 1;
    let mut escaped = false;

    for character in chars.by_ref() {
        if escaped {
            match character {
                'n' => output.push('\n'),
                'r' => output.push('\n'),
                't' => output.push('\t'),
                'b' | 'f' => {}
                '(' | ')' | '\\' => output.push(character),
                '\r' | '\n' => {}
                other => output.push(other),
            }
            escaped = false;
            continue;
        }

        match character {
            '\\' => escaped = true,
            '(' => {
                depth += 1;
                output.push(character);
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
                output.push(character);
            }
            other => output.push(other),
        }
    }

    output
}

fn read_pdf_hex_string<I>(chars: &mut std::iter::Peekable<I>) -> String
where
    I: Iterator<Item = char>,
{
    let mut output = String::new();
    for character in chars.by_ref() {
        if character == '>' {
            break;
        }
        if !character.is_whitespace() {
            output.push(character);
        }
    }
    output
}

fn decode_pdf_hex_text(hex: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = hex.chars();
    while let Some(high) = chars.next() {
        let low = chars.next().unwrap_or('0');
        let pair = format!("{high}{low}");
        if let Ok(value) = u8::from_str_radix(&pair, 16) {
            bytes.push(value);
        }
    }

    if bytes.starts_with(&[0xfe, 0xff]) {
        let mut output = String::new();
        for pair in bytes[2..].chunks(2) {
            if pair.len() == 2 {
                let value = u16::from_be_bytes([pair[0], pair[1]]);
                if let Some(character) = char::from_u32(value as u32) {
                    output.push(character);
                }
            }
        }
        return output;
    }

    String::from_utf8_lossy(&bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_docx(entries: &[(&str, &str)]) -> Vec<u8> {
        build_zip(entries)
    }

    fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default();
            for (name, content) in entries {
                writer.start_file(*name, options).expect("应创建 zip entry");
                writer
                    .write_all(content.as_bytes())
                    .expect("应写入 zip entry");
            }
            writer.finish().expect("应完成 zip");
        }
        buffer.into_inner()
    }

    #[test]
    fn extracts_docx_word_text_without_zip_noise() {
        let bytes = build_docx(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>第一段 &amp; Alpha</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>"#,
        )]);

        let text = extract_docx_text(&bytes, None).expect("应抽取 docx 文本");

        assert!(text.contains("第一段 & Alpha"));
        assert!(text.contains("第二段"));
        assert!(!text.contains("PK"));
        assert!(!text.contains("word/document.xml"));
    }

    #[test]
    fn extracts_docx_tabs_breaks_and_header_footer() {
        let bytes = build_docx(&[
            (
                "word/header1.xml",
                r#"<w:hdr><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>"#,
            ),
            (
                "word/document.xml",
                r#"<w:document><w:body><w:p><w:r><w:t>A</w:t></w:r><w:tab/><w:r><w:t>B</w:t></w:r><w:br/><w:r><w:t>C</w:t></w:r></w:p></w:body></w:document>"#,
            ),
            (
                "word/footer1.xml",
                r#"<w:ftr><w:p><w:r><w:t>页脚</w:t></w:r></w:p></w:ftr>"#,
            ),
        ]);

        let text = extract_docx_text(&bytes, None).expect("应抽取 docx 文本");

        assert!(text.contains("页眉"));
        assert!(text.contains("A\tB\nC"));
        assert!(text.contains("页脚"));
    }

    #[test]
    fn truncates_at_utf8_boundary() {
        let bytes = build_docx(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>你好世界</w:t></w:r></w:p></w:body></w:document>"#,
        )]);

        let text = extract_docx_text(&bytes, Some(5)).expect("应抽取 docx 文本");

        assert_eq!(text, "你");
    }

    #[test]
    fn recognizes_supported_document_extensions() {
        assert!(is_supported_document(Path::new("demo.docx")));
        assert!(is_supported_document(Path::new("demo.xlsx")));
        assert!(is_supported_document(Path::new("demo.pptx")));
        assert!(is_supported_document(Path::new("demo.pdf")));
        assert!(!is_supported_document(Path::new("demo.doc")));
    }

    #[test]
    fn extracts_xlsx_shared_strings_and_inline_text() {
        let bytes = build_zip(&[
            (
                "xl/sharedStrings.xml",
                r#"<sst><si><t>客户名称</t></si><si><t>深澜智能</t></si></sst>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="inlineStr"><is><t>备注 &amp; 结论</t></is></c></row></sheetData></worksheet>"#,
            ),
        ]);

        let text = extract_xlsx_text(&bytes, None).expect("应抽取 xlsx 文本");

        assert!(text.contains("客户名称"));
        assert!(text.contains("深澜智能"));
        assert!(text.contains("备注 & 结论"));
        assert!(!text.contains("sharedStrings.xml"));
    }

    #[test]
    fn extracts_pptx_slide_text() {
        let bytes = build_zip(&[(
            "ppt/slides/slide1.xml",
            r#"<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>第一页标题</a:t></a:r></a:p><a:p><a:r><a:t>关键结论</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>"#,
        )]);

        let text = extract_pptx_text(&bytes, None).expect("应抽取 pptx 文本");

        assert!(text.contains("第一页标题"));
        assert!(text.contains("关键结论"));
    }

    #[test]
    fn extracts_pdf_literal_text_stream() {
        let pdf = r#"%PDF-1.4
1 0 obj
<< /Length 58 >>
stream
BT
/F1 12 Tf
72 720 Td
(PDF 正文 Alpha) Tj
ET
endstream
endobj
%%EOF"#;
        let bytes = pdf.as_bytes();

        let text = extract_pdf_text(bytes, None).expect("应抽取 pdf 文本");

        assert!(text.contains("PDF 正文 Alpha"));
    }

    #[test]
    fn extracts_pdf_hex_utf16_text_stream() {
        let bytes = br#"%PDF-1.4
1 0 obj
<< /Length 64 >>
stream
BT
<FEFF6DF16F9C667A80FD> Tj
ET
endstream
endobj
%%EOF"#;

        let text = extract_pdf_text(bytes, None).expect("应抽取 pdf 文本");

        assert!(text.contains("深澜智能"));
    }
}
