//! Media 模块测试

use super::*;
#[allow(unused_imports)]
use std::fs;
#[allow(unused_imports)]
use std::path::PathBuf;
#[allow(unused_imports)]
use tempfile::TempDir;

// ============ MIME Tests ============

#[test]
fn test_get_mime_type_png() {
    let png_header: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    assert_eq!(get_mime_type_sync(png_header), Some("image/png"));
}

#[test]
fn test_get_mime_type_jpeg() {
    let jpeg_header: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0];
    assert_eq!(get_mime_type_sync(jpeg_header), Some("image/jpeg"));
}

#[test]
fn test_get_mime_type_gif() {
    let gif_header: &[u8] = &[0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
    assert_eq!(get_mime_type_sync(gif_header), Some("image/gif"));
}

#[test]
fn test_get_mime_type_webp() {
    let webp_header: &[u8] = &[
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ];
    assert_eq!(get_mime_type_sync(webp_header), Some("image/webp"));
}

#[test]
fn test_get_mime_type_pdf() {
    let pdf_header: &[u8] = b"%PDF-1.4";
    assert_eq!(get_mime_type_sync(pdf_header), Some("application/pdf"));
}

#[test]
fn test_get_mime_type_unknown() {
    let unknown: &[u8] = &[0x00, 0x01, 0x02, 0x03];
    assert_eq!(get_mime_type_sync(unknown), None);
}

#[test]
fn test_get_media_category() {
    assert_eq!(get_media_category("image/png"), MediaCategory::Image);
    assert_eq!(get_media_category("application/pdf"), MediaCategory::Pdf);
    assert_eq!(get_media_category("video/mp4"), MediaCategory::Video);
    assert_eq!(get_media_category("audio/mp3"), MediaCategory::Audio);
    assert_eq!(get_media_category("text/plain"), MediaCategory::Unknown);
}

#[test]
fn test_get_mime_type_from_extension() {
    assert_eq!(get_mime_type_from_extension("png"), "image/png");
    assert_eq!(get_mime_type_from_extension("jpg"), "image/jpeg");
    assert_eq!(get_mime_type_from_extension("pdf"), "application/pdf");
    assert_eq!(
        get_mime_type_from_extension("unknown"),
        "application/octet-stream"
    );
}

// ============ Image Tests ============

#[test]
fn test_is_supported_image_format() {
    assert!(is_supported_image_format("png"));
    assert!(is_supported_image_format("PNG"));
    assert!(is_supported_image_format("jpg"));
    assert!(is_supported_image_format("jpeg"));
    assert!(is_supported_image_format("gif"));
    assert!(is_supported_image_format("webp"));
    assert!(!is_supported_image_format("bmp"));
    assert!(!is_supported_image_format("tiff"));
}

#[test]
fn test_estimate_image_tokens() {
    let base64 = "a".repeat(1000);
    let tokens = estimate_image_tokens(&base64);
    assert_eq!(tokens, 125); // ceil(1000 * 0.125)
}

#[test]
fn test_validate_image_file_not_exists() {
    let result = validate_image_file(Path::new("/nonexistent/file.png"));
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("does not exist"));
}

#[test]
fn test_validate_image_file_unsupported() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.bmp");
    fs::write(&file_path, "test").unwrap();

    let result = validate_image_file(&file_path);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Unsupported"));
}

// ============ PDF Tests ============

#[test]
fn test_is_pdf_extension() {
    assert!(is_pdf_extension("pdf"));
    assert!(is_pdf_extension("PDF"));
    assert!(is_pdf_extension(".pdf"));
    assert!(!is_pdf_extension("doc"));
}

#[test]
fn test_is_pdf_supported() {
    // 默认应该支持
    assert!(is_pdf_supported());
}

#[test]
fn test_read_pdf_file() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");
    let content = b"%PDF-1.4 test content";
    fs::write(&file_path, content).unwrap();

    let result = read_pdf_file(&file_path);
    assert!(result.is_ok());

    let pdf = result.unwrap();
    assert_eq!(pdf.original_size, content.len() as u64);
    assert!(!pdf.base64.is_empty());
}

#[test]
fn test_read_pdf_file_empty() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("empty.pdf");
    fs::write(&file_path, "").unwrap();

    let result = read_pdf_file(&file_path);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("empty"));
}

#[test]
fn test_validate_pdf_file() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.pdf");
    fs::write(&file_path, b"%PDF-1.4 test").unwrap();

    let result = validate_pdf_file(&file_path);
    assert!(result.is_ok());
}

#[test]
fn test_validate_pdf_file_invalid_header() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("fake.pdf");
    fs::write(&file_path, b"not a pdf file").unwrap();

    let result = validate_pdf_file(&file_path);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("invalid header"));
}

// ============ SVG Tests ============

#[test]
fn test_is_svg_render_enabled() {
    assert!(is_svg_render_enabled());
}

#[test]
fn test_validate_svg_file() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.svg");
    fs::write(&file_path, r#"<svg width="100" height="100"></svg>"#).unwrap();

    let result = validate_svg_file(&file_path);
    assert!(result.is_ok());
}

#[test]
fn test_validate_svg_file_invalid() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("fake.svg");
    fs::write(&file_path, "not an svg").unwrap();

    let result = validate_svg_file(&file_path);
    assert!(result.is_err());
}

#[test]
fn test_get_svg_dimensions() {
    let temp_dir = TempDir::new().unwrap();
    let file_path = temp_dir.path().join("test.svg");
    fs::write(&file_path, r#"<svg width="200" height="150"></svg>"#).unwrap();

    let dims = get_svg_dimensions(&file_path);
    assert_eq!(dims, Some((200, 150)));
}

// ============ Media Type Detection Tests ============

#[test]
fn test_detect_media_type() {
    assert_eq!(detect_media_type(Path::new("test.png")), MediaType::Image);
    assert_eq!(detect_media_type(Path::new("test.jpg")), MediaType::Image);
    assert_eq!(detect_media_type(Path::new("test.pdf")), MediaType::Pdf);
    assert_eq!(detect_media_type(Path::new("test.svg")), MediaType::Svg);
    assert_eq!(detect_media_type(Path::new("test.txt")), MediaType::Unknown);
}

#[test]
fn test_is_supported_media_file() {
    assert!(is_supported_media_file(Path::new("test.png")));
    assert!(is_supported_media_file(Path::new("test.pdf")));
    assert!(is_supported_media_file(Path::new("test.svg")));
    assert!(!is_supported_media_file(Path::new("test.txt")));
}

// ============ Blacklist Tests ============

#[test]
fn test_is_blacklisted_file() {
    assert!(is_blacklisted_file(Path::new("video.mp4")));
    assert!(is_blacklisted_file(Path::new("archive.zip")));
    assert!(is_blacklisted_file(Path::new("program.exe")));
    assert!(!is_blacklisted_file(Path::new("code.rs")));
    assert!(!is_blacklisted_file(Path::new("image.png")));
}
