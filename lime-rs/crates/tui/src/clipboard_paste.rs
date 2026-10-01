use std::io::Cursor;
use std::path::PathBuf;

use image::{DynamicImage, ImageFormat, RgbaImage};
use lime_core::config::RightClickPaste;
use tempfile::{Builder, NamedTempFile};

pub(crate) mod worker;

/// Clipboard surface selected by a mouse gesture in the composer.
///
/// `Primary` is intentionally Linux/X11-only.  Other terminal transports fail closed rather
/// than silently reading a different clipboard than the one the user selected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ClipboardTextSource {
    Clipboard,
    Primary,
}

/// Whether a mouse paste source can be read in the current terminal session.
pub(crate) fn mouse_paste_source_allowed(source: ClipboardTextSource) -> bool {
    match source {
        ClipboardTextSource::Clipboard => !crate::clipboard_copy::is_ssh_session(),
        ClipboardTextSource::Primary => {
            #[cfg(target_os = "linux")]
            {
                std::env::var_os("DISPLAY").is_some()
                    && std::env::var_os("WAYLAND_DISPLAY").is_none()
                    && !crate::clipboard_copy::is_ssh_session()
                    && !crate::clipboard_copy::is_tmux_session()
                    && !crate::clipboard_copy::is_wsl_session()
            }
            #[cfg(not(target_os = "linux"))]
            {
                false
            }
        }
    }
}

/// Apply Codex's right-click paste policy and terminal safety guards.
pub(crate) fn right_click_paste_allowed(
    mode: RightClickPaste,
    source: ClipboardTextSource,
) -> bool {
    if crate::clipboard_copy::is_ssh_session()
        || detect_vscode_terminal() == VscodeDetection::VsCode
    {
        return false;
    }
    match source {
        ClipboardTextSource::Primary => mouse_paste_source_allowed(source),
        ClipboardTextSource::Clipboard => {
            if cfg!(target_os = "android") {
                return false;
            }
            match mode {
                RightClickPaste::Off => false,
                RightClickPaste::On => true,
                RightClickPaste::Auto => {
                    cfg!(any(target_os = "windows", target_os = "linux"))
                        && !(crate::clipboard_copy::is_wsl_session()
                            && detect_vscode_terminal() == VscodeDetection::Unknown)
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VscodeDetection {
    VsCode,
    Other,
    Unknown,
}

fn detect_vscode_terminal() -> VscodeDetection {
    if std::env::var_os("TERM_PROGRAM")
        .is_some_and(|value| value.to_string_lossy().eq_ignore_ascii_case("vscode"))
        || std::env::var_os("VSCODE_PID").is_some()
        || std::env::var_os("VSCODE_INJECTION").is_some()
    {
        return VscodeDetection::VsCode;
    }
    if std::env::var_os("TERM_PROGRAM").is_some() {
        VscodeDetection::Other
    } else {
        VscodeDetection::Unknown
    }
}

/// Read text for a mouse paste action.
///
/// The TUI invokes this function only from the session clipboard worker. Keeping the native
/// operation behind one owner means a slow platform clipboard cannot block the terminal event
/// loop, and the worker can discard results that arrive after its deadline.
pub(crate) fn read_clipboard_text(source: ClipboardTextSource) -> Result<String, String> {
    if !mouse_paste_source_allowed(source) {
        return Err(match source {
            ClipboardTextSource::Clipboard => "clipboard text is unavailable over SSH".to_string(),
            ClipboardTextSource::Primary => {
                "X11 primary selection is unavailable in this terminal".to_string()
            }
        });
    }

    match source {
        ClipboardTextSource::Clipboard => {
            #[cfg(not(target_os = "android"))]
            {
                let mut clipboard = arboard::Clipboard::new()
                    .map_err(|error| format!("clipboard unavailable: {error}"))?;
                clipboard
                    .get_text()
                    .map_err(|error| format!("clipboard text unavailable: {error}"))
            }
            #[cfg(target_os = "android")]
            {
                Err("clipboard text paste is unsupported on Android".to_string())
            }
        }
        ClipboardTextSource::Primary => {
            #[cfg(target_os = "linux")]
            {
                use arboard::GetExtLinux;
                let mut clipboard = arboard::Clipboard::new()
                    .map_err(|error| format!("clipboard unavailable: {error}"))?;
                clipboard
                    .get()
                    .clipboard(arboard::LinuxClipboardKind::Primary)
                    .text()
                    .map_err(|error| format!("X11 primary selection unavailable: {error}"))
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err("X11 primary selection is unavailable on this platform".to_string())
            }
        }
    }
}

/// Keep mouse clipboard text on the same insertion path as bracketed paste.
pub(crate) fn normalize_clipboard_text(text: String) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PasteImageError {
    ClipboardUnavailable(String),
    NoImage(String),
    EncodeFailed(String),
    Io(String),
}

/// Normalize pasted text for a single-line search query.
pub(crate) fn normalize_pasted_search_query(pasted: &str) -> Option<String> {
    let normalized = pasted.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

/// Resolve a single pasted file URL, Windows/UNC path or shell-quoted local path.
pub(crate) fn normalize_pasted_path(pasted: &str) -> Option<PathBuf> {
    let pasted = pasted.trim();
    let unquoted = pasted
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            pasted
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(pasted);
    if let Ok(url) = url::Url::parse(unquoted) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
    }
    if let Some(path) = normalize_windows_path(unquoted) {
        return Some(path);
    }
    let parts = shlex::split(pasted)?;
    let [part] = parts.as_slice() else {
        return None;
    };
    normalize_windows_path(part).or_else(|| Some(PathBuf::from(part)))
}

fn normalize_windows_path(input: &str) -> Option<PathBuf> {
    let drive = input
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_alphabetic())
        && input.get(1..2) == Some(":")
        && matches!(input.get(2..3), Some("\\" | "/"));
    if !drive && !input.starts_with("\\\\") {
        return None;
    }
    #[cfg(target_os = "linux")]
    if is_wsl_session() {
        if let Some(path) = windows_path_to_wsl(input) {
            return Some(path);
        }
    }
    Some(PathBuf::from(input))
}

impl std::fmt::Display for PasteImageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClipboardUnavailable(message) => {
                write!(formatter, "clipboard unavailable: {message}")
            }
            Self::NoImage(message) => write!(formatter, "no image on clipboard: {message}"),
            Self::EncodeFailed(message) => write!(formatter, "could not encode image: {message}"),
            Self::Io(message) => write!(formatter, "io error: {message}"),
        }
    }
}

impl std::error::Error for PasteImageError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PastedImageInfo {
    pub(crate) width: u32,
    pub(crate) height: u32,
}

#[cfg(not(target_os = "android"))]
pub(crate) fn paste_image_to_temp_png() -> Result<(PathBuf, PastedImageInfo), PasteImageError> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| PasteImageError::ClipboardUnavailable(error.to_string()))?;
    let result = read_clipboard_image(&mut clipboard).and_then(|(image, info)| {
        let mut png = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .map_err(|error| PasteImageError::EncodeFailed(error.to_string()))?;
        persist_temp_png(&png).map(|path| (path, info))
    });

    #[cfg(target_os = "linux")]
    if let Err(error) = &result {
        if let Ok(image) = try_wsl_clipboard_fallback(error) {
            return Ok(image);
        }
    }

    result
}

#[cfg(target_os = "android")]
pub(crate) fn paste_image_to_temp_png() -> Result<(PathBuf, PastedImageInfo), PasteImageError> {
    Err(PasteImageError::ClipboardUnavailable(
        "clipboard image paste is unsupported on Android".to_string(),
    ))
}

#[cfg(test)]
fn encode_rgba_as_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, PasteImageError> {
    let image = RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| PasteImageError::EncodeFailed("invalid RGBA buffer".to_string()))?;
    let mut png = Vec::new();
    DynamicImage::ImageRgba8(image)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|error| PasteImageError::EncodeFailed(error.to_string()))?;
    Ok(png)
}

#[cfg(not(target_os = "android"))]
fn read_clipboard_image(
    clipboard: &mut arboard::Clipboard,
) -> Result<(DynamicImage, PastedImageInfo), PasteImageError> {
    if let Some(image) = clipboard
        .get()
        .file_list()
        .unwrap_or_default()
        .into_iter()
        .find_map(|path| image::open(path).ok())
    {
        let info = PastedImageInfo {
            width: image.width(),
            height: image.height(),
        };
        return Ok((image, info));
    }

    let image = clipboard
        .get_image()
        .map_err(|error| PasteImageError::NoImage(error.to_string()))?;
    let width = u32::try_from(image.width)
        .map_err(|_| PasteImageError::EncodeFailed("image width exceeds u32".to_string()))?;
    let height = u32::try_from(image.height)
        .map_err(|_| PasteImageError::EncodeFailed("image height exceeds u32".to_string()))?;
    let rgba = RgbaImage::from_raw(width, height, image.bytes.into_owned())
        .ok_or_else(|| PasteImageError::EncodeFailed("invalid RGBA buffer".to_string()))?;
    Ok((
        DynamicImage::ImageRgba8(rgba),
        PastedImageInfo { width, height },
    ))
}

fn persist_temp_png(png: &[u8]) -> Result<PathBuf, PasteImageError> {
    let file = write_temp_png(png)?;
    let (_file, path) = file
        .keep()
        .map_err(|error| PasteImageError::Io(error.error.to_string()))?;
    Ok(path)
}

fn write_temp_png(png: &[u8]) -> Result<NamedTempFile, PasteImageError> {
    let file = Builder::new()
        .prefix("tui-clipboard-")
        .suffix(".png")
        .tempfile()
        .map_err(|error| PasteImageError::Io(error.to_string()))?;
    std::fs::write(file.path(), png).map_err(|error| PasteImageError::Io(error.to_string()))?;
    Ok(file)
}

#[cfg(target_os = "linux")]
fn try_wsl_clipboard_fallback(
    error: &PasteImageError,
) -> Result<(PathBuf, PastedImageInfo), PasteImageError> {
    if !is_wsl_session()
        || !matches!(
            error,
            PasteImageError::ClipboardUnavailable(_) | PasteImageError::NoImage(_)
        )
    {
        return Err(error.clone());
    }
    let windows_path = dump_windows_clipboard_image().ok_or_else(|| error.clone())?;
    let path = windows_path_to_wsl(&windows_path).ok_or_else(|| error.clone())?;
    let (width, height) = image::image_dimensions(&path).map_err(|_| error.clone())?;
    Ok((path, PastedImageInfo { width, height }))
}

#[cfg(target_os = "linux")]
fn dump_windows_clipboard_image() -> Option<String> {
    let script = r#"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $img = Get-Clipboard -Format Image; if ($img -ne $null) { $p=[System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(),'png'); $img.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); Write-Output $p } else { exit 1 }"#;
    for command in ["powershell.exe", "pwsh", "powershell"] {
        let Ok(output) = std::process::Command::new(command)
            .args(["-NoProfile", "-Command", script])
            .output()
        else {
            continue;
        };
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn is_wsl_session() -> bool {
    std::env::var_os("WSL_DISTRO_NAME").is_some()
        || std::env::var_os("WSL_INTEROP").is_some()
        || std::fs::read_to_string("/proc/version").is_ok_and(|version| {
            let version = version.to_ascii_lowercase();
            version.contains("microsoft") || version.contains("wsl")
        })
}

#[cfg(target_os = "linux")]
fn windows_path_to_wsl(path: &str) -> Option<PathBuf> {
    if path.starts_with("\\\\") || path.get(1..2) != Some(":") {
        return None;
    }
    let drive = path.chars().next()?.to_ascii_lowercase();
    if !drive.is_ascii_lowercase() {
        return None;
    }
    let mut mapped = PathBuf::from(format!("/mnt/{drive}"));
    for component in path
        .get(2..)?
        .trim_start_matches(['\\', '/'])
        .split(['\\', '/'])
        .filter(|component| !component.is_empty())
    {
        mapped.push(component);
    }
    Some(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasted_paths_resolve_urls_quotes_and_shell_escapes_but_reject_multiple_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("图片 with spaces.png");
        let literal = path.to_string_lossy();
        for input in [
            url::Url::from_file_path(&path).unwrap().to_string(),
            format!("'{}'", literal),
            format!("\"{}\"", literal),
            literal.replace(' ', "\\ "),
        ] {
            assert_eq!(normalize_pasted_path(&input), Some(path.clone()), "{input}");
        }
        for input in ["", "one.png two.png", "'unterminated", "one.png\ntwo.png"] {
            assert_eq!(normalize_pasted_path(input), None, "{input}");
        }
        #[cfg(not(target_os = "linux"))]
        for input in [
            r"C:\Users\Alice\image with spaces.png",
            r"\\server\share\image.png",
        ] {
            assert_eq!(normalize_pasted_path(input), Some(PathBuf::from(input)));
        }
    }

    #[test]
    fn rgba_clipboard_pixels_encode_as_png() {
        let png = encode_rgba_as_png(1, 1, &[255, 0, 0, 255]).expect("encode PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(encode_rgba_as_png(2, 1, &[255, 0, 0, 255]).is_err());
    }

    #[test]
    fn temporary_clipboard_image_uses_png_suffix_and_bytes() {
        let png = encode_rgba_as_png(1, 1, &[0, 0, 0, 0]).expect("encode PNG");
        let file = write_temp_png(&png).expect("write PNG");
        let path = file.path();
        assert_eq!(
            path.extension().and_then(|value| value.to_str()),
            Some("png")
        );
        assert_eq!(std::fs::read(path).expect("read PNG"), png);
    }

    #[test]
    fn pasted_search_query_collapses_whitespace() {
        assert_eq!(
            normalize_pasted_search_query("  alpha\n\tbeta\r\n gamma  "),
            Some(String::from("alpha beta gamma"))
        );
        assert_eq!(normalize_pasted_search_query(" \n\t "), None);
    }

    #[test]
    fn clipboard_text_normalizes_terminal_newlines() {
        assert_eq!(
            normalize_clipboard_text("alpha\r\nbeta\rgamma".to_string()),
            "alpha\nbeta\ngamma"
        );
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn primary_mouse_paste_is_fail_closed_off_linux() {
        assert!(!mouse_paste_source_allowed(ClipboardTextSource::Primary));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn maps_windows_temp_paths_for_wsl() {
        assert_eq!(
            windows_path_to_wsl(r"C:\Users\Alice\AppData\Local\Temp\image.png"),
            Some(PathBuf::from(
                "/mnt/c/Users/Alice/AppData/Local/Temp/image.png"
            ))
        );
        assert_eq!(windows_path_to_wsl(r"\\server\share\image.png"), None);
    }
}
