//! Local file-link parsing and display adapted from 上游 TUI.

use std::path::Path;

use url::Url;

pub(super) fn is_local_path_like_link(destination: &str) -> bool {
    destination
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://"))
        || destination.starts_with('/')
        || destination.starts_with("~/")
        || destination.starts_with("./")
        || destination.starts_with("../")
        || destination.starts_with("\\\\")
        || matches!(
            destination.as_bytes(),
            [drive, b':', separator, ..]
                if drive.is_ascii_alphabetic() && matches!(separator, b'/' | b'\\')
        )
}

pub(super) fn render_local_link_target(destination: &str, cwd: Option<&Path>) -> Option<String> {
    let (path, suffix) = parse_local_link_target(destination)?;
    let mut rendered = display_path(&path, cwd);
    if let Some(suffix) = suffix {
        rendered.push_str(&suffix);
    }
    Some(rendered)
}

pub(super) fn should_render_local_link_label(label: &str, destination: &str) -> bool {
    let label = label.trim();
    if label.is_empty() {
        return false;
    }
    let Some(label_path) = comparable_path(label) else {
        return true;
    };
    let Some(target_path) = comparable_path(destination) else {
        return true;
    };
    let literal_label_path = normalize_path(label).to_lowercase();
    let label_path = trim_trailing_separator(label_path.trim_start_matches("./"));
    let target_path = trim_trailing_separator(target_path.trim_start_matches("./"));
    let boundary_suffix = |path: &str, suffix: &str| {
        !suffix.is_empty()
            && path
                .strip_suffix(suffix)
                .is_some_and(|prefix| prefix.is_empty() || prefix.ends_with('/'))
    };

    let matches_target = [literal_label_path.as_str(), label_path]
        .into_iter()
        .any(|label_path| {
            let label_path = trim_trailing_separator(label_path.trim_start_matches("./"));
            boundary_suffix(target_path, label_path)
                || (is_absolute_path(label_path) && boundary_suffix(label_path, target_path))
        });
    !matches_target
}

fn comparable_path(text: &str) -> Option<String> {
    let (path, _) = parse_local_link_target(text)?;
    Some(normalize_path(&path).to_lowercase())
}

fn parse_local_link_target(destination: &str) -> Option<(String, Option<String>)> {
    if destination
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://"))
    {
        let normalized = format!("file://{}", &destination[7..]);
        let url = Url::parse(&normalized).ok()?;
        let path = file_url_path(&url)?;
        let suffix = url.fragment().and_then(normalize_hash_location);
        return Some((path, suffix));
    }

    let mut path = destination;
    let mut suffix = None;
    if let Some((candidate, fragment)) = destination.rsplit_once('#') {
        if let Some(location) = normalize_hash_location(fragment) {
            path = candidate;
            suffix = Some(location);
        }
    }
    if suffix.is_none() {
        if let Some((candidate, location)) = split_colon_location(path) {
            path = candidate;
            suffix = Some(location);
        }
    }
    let decoded = urlencoding::decode(path).unwrap_or_else(|_| path.into());
    Some((normalize_path(&decoded), suffix))
}

fn file_url_path(url: &Url) -> Option<String> {
    if let Ok(path) = url.to_file_path() {
        let mut path = normalize_path(&path.to_string_lossy());
        if matches!(
            path.as_bytes(),
            [b'/', drive, b':', b'/', ..] if drive.is_ascii_alphabetic()
        ) {
            path.remove(0);
        }
        return Some(path);
    }

    let mut path = urlencoding::decode(url.path())
        .unwrap_or_else(|_| url.path().into())
        .into_owned();
    if let Some(host) = url.host_str() {
        if !host.is_empty() && !host.eq_ignore_ascii_case("localhost") {
            path = format!("//{host}{path}");
        } else if matches!(
            path.as_bytes(),
            [b'/', drive, b':', b'/', ..] if drive.is_ascii_alphabetic()
        ) {
            path.remove(0);
        }
    }
    Some(normalize_path(&path))
}

fn normalize_hash_location(fragment: &str) -> Option<String> {
    let rest = fragment.strip_prefix('L')?;
    let (start, end) = rest
        .split_once("-L")
        .or_else(|| rest.split_once("–L"))
        .map_or((rest, None), |(start, end)| (start, Some(end)));
    let start = normalize_line_column(start)?;
    match end {
        Some(end) => Some(format!(":{start}-{}", normalize_line_column(end)?)),
        None => Some(format!(":{start}")),
    }
}

fn normalize_line_column(value: &str) -> Option<String> {
    let (line, column) = value
        .split_once('C')
        .map_or((value, None), |(line, column)| (line, Some(column)));
    if line.is_empty() || !line.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    match column {
        Some(column) if !column.is_empty() && column.bytes().all(|byte| byte.is_ascii_digit()) => {
            Some(format!("{line}:{column}"))
        }
        Some(_) => None,
        None => Some(line.to_string()),
    }
}

fn split_colon_location(path: &str) -> Option<(&str, String)> {
    for (index, _) in path.match_indices(':') {
        let location = &path[index..];
        if let Some(normalized) = normalize_colon_location(location) {
            return Some((&path[..index], normalized));
        }
    }
    None
}

fn normalize_colon_location(location: &str) -> Option<String> {
    let location = location.strip_prefix(':')?;
    let (start, end) = location
        .split_once('-')
        .or_else(|| location.split_once('–'))
        .map_or((location, None), |(start, end)| (start, Some(end)));
    let start = normalize_line_column(start)?;
    match end {
        Some(end) => Some(format!(":{start}-{}", normalize_line_column(end)?)),
        None => Some(format!(":{start}")),
    }
}

fn normalize_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("\\\\") {
        format!("//{}", rest.replace('\\', "/").trim_start_matches('/'))
    } else {
        path.replace('\\', "/")
    }
}

fn is_absolute_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("//")
        || matches!(
            path.as_bytes(),
            [drive, b':', b'/', ..] if drive.is_ascii_alphabetic()
        )
}

fn display_path(path: &str, cwd: Option<&Path>) -> String {
    let path = normalize_path(path);
    if !is_absolute_path(&path) {
        return path;
    }

    let Some(cwd) = cwd.filter(|cwd| !cwd.as_os_str().is_empty()) else {
        return path;
    };
    let cwd = normalize_path(&cwd.to_string_lossy());
    strip_path_prefix(&path, &cwd).map_or(path.clone(), str::to_string)
}

fn strip_path_prefix<'a>(path: &'a str, cwd: &str) -> Option<&'a str> {
    let path = trim_trailing_separator(path);
    let cwd = trim_trailing_separator(cwd);
    if path == cwd {
        return None;
    }
    if cwd == "/" || cwd == "//" {
        return path.strip_prefix('/');
    }
    path.strip_prefix(cwd)
        .and_then(|rest| rest.strip_prefix('/'))
}

fn trim_trailing_separator(path: &str) -> &str {
    if path == "/" || path == "//" {
        return path;
    }
    if matches!(path.as_bytes(), [drive, b':', b'/'] if drive.is_ascii_alphabetic()) {
        return path;
    }
    path.trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_unix_windows_unc_and_file_url_paths() {
        for path in [
            "file:///tmp/a.rs",
            "/tmp/a.rs",
            "~/a.rs",
            "./a.rs",
            "../a.rs",
            r"C:\repo\a.rs",
            r"\\server\share\a.rs",
        ] {
            assert!(is_local_path_like_link(path), "{path}");
        }
        assert!(!is_local_path_like_link("https://example.com/a.rs"));
    }

    #[test]
    fn renders_encoded_paths_and_location_suffixes_without_filesystem_access() {
        assert_eq!(
            render_local_link_target("file:///tmp/My%20File.rs#L12C3", None),
            Some("/tmp/My File.rs:12:3".to_string())
        );
        assert_eq!(
            render_local_link_target(r"C:\Repo\src\lib.rs:8", None),
            Some("C:/Repo/src/lib.rs:8".to_string())
        );
        assert_eq!(
            render_local_link_target(r"\\server\share\My%20File.rs", None),
            Some("//server/share/My File.rs".to_string())
        );
    }

    #[test]
    fn renders_hash_and_colon_ranges_without_duplicate_separators() {
        for (destination, expected) in [
            ("/repo/src/lib.rs#L12C3-L14C9", "/repo/src/lib.rs:12:3-14:9"),
            ("/repo/src/lib.rs:12:3-14:9", "/repo/src/lib.rs:12:3-14:9"),
            ("/repo/src/lib.rs:12–14", "/repo/src/lib.rs:12-14"),
        ] {
            assert_eq!(
                render_local_link_target(destination, None),
                Some(expected.into())
            );
        }
    }

    #[test]
    fn shortens_absolute_targets_only_inside_the_session_cwd() {
        let cwd = Path::new("/repo");
        assert_eq!(
            render_local_link_target("/repo/src/lib.rs:12", Some(cwd)),
            Some("src/lib.rs:12".to_string())
        );
        assert_eq!(
            render_local_link_target("/outside/src/lib.rs:12", Some(cwd)),
            Some("/outside/src/lib.rs:12".to_string())
        );
        assert_eq!(
            render_local_link_target(
                "file:///C:/repo/report.xlsx#L4C2",
                Some(Path::new("C:/repo"))
            ),
            Some("report.xlsx:4:2".to_string())
        );
    }

    #[test]
    fn compares_literal_percent_encoding_before_decoding_labels() {
        assert!(!should_render_local_link_label(
            "percent%20.rs",
            "/repo/percent%2520.rs"
        ));
    }

    #[test]
    fn matching_path_labels_collapse_but_descriptive_labels_remain() {
        assert!(!should_render_local_link_label(
            "src/lib.rs",
            "./src/lib.rs"
        ));
        assert!(!should_render_local_link_label(
            "My File.rs",
            "file:///tmp/My%20File.rs"
        ));
        assert!(should_render_local_link_label(
            "open generated source",
            "./src/lib.rs"
        ));
        assert!(should_render_local_link_label(
            "other/src/lib.rs",
            "./src/lib.rs"
        ));
    }

    #[test]
    fn invalid_percent_encoding_stays_visible() {
        assert_eq!(
            render_local_link_target("/tmp/bad%FF.rs", None),
            Some("/tmp/bad%FF.rs".to_string())
        );
    }
}
