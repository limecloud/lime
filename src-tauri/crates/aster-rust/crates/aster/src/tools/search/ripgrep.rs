//! Ripgrep Integration Module
//!
//! Provides enhanced ripgrep support with vendored binary detection,
//! JSON output parsing, and file listing capabilities.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

/// Ripgrep version
pub const RG_VERSION: &str = "14.1.0";

/// Platform binary names
#[cfg(target_os = "macos")]
pub const PLATFORM_BINARY: &str = if cfg!(target_arch = "aarch64") {
    "rg-darwin-arm64"
} else {
    "rg-darwin-x64"
};

#[cfg(target_os = "linux")]
pub const PLATFORM_BINARY: &str = if cfg!(target_arch = "aarch64") {
    "rg-linux-arm64"
} else {
    "rg-linux-x64"
};

#[cfg(target_os = "windows")]
pub const PLATFORM_BINARY: &str = "rg-win32-x64.exe";

/// Ripgrep search options
#[derive(Debug, Clone, Default)]
pub struct RipgrepOptions {
    pub cwd: Option<PathBuf>,
    pub pattern: String,
    pub paths: Vec<PathBuf>,
    pub glob: Option<String>,
    pub file_type: Option<String>,
    pub ignore_case: bool,
    pub fixed_strings: bool,
    pub max_count: Option<usize>,
    pub context: Option<usize>,
    pub before_context: Option<usize>,
    pub after_context: Option<usize>,
    pub files_with_matches: bool,
    pub count: bool,
    pub json: bool,
    pub no_ignore: bool,
    pub hidden: bool,
    pub multiline: bool,
    pub timeout: Option<u64>,
}

/// A single ripgrep match
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RipgrepMatch {
    pub path: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

/// Ripgrep search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RipgrepResult {
    pub matches: Vec<RipgrepMatch>,
    pub files_searched: usize,
    pub match_count: usize,
    pub truncated: bool,
}

/// Get vendored ripgrep path based on platform
pub fn get_vendored_rg_path() -> Option<PathBuf> {
    // Check multiple possible locations
    let possible_paths = [
        // Package vendor directory
        PathBuf::from("vendor/ripgrep").join(PLATFORM_BINARY),
        // Home directory
        dirs::home_dir()
            .map(|h| h.join(".aster/bin").join(PLATFORM_BINARY))
            .unwrap_or_default(),
        // Current executable directory
        std::env::current_exe()
            .ok()
            .and_then(|p| {
                p.parent()
                    .map(|p| p.join("vendor/ripgrep").join(PLATFORM_BINARY))
            })
            .unwrap_or_default(),
    ];

    for rg_path in &possible_paths {
        if rg_path.exists() {
            return Some(rg_path.clone());
        }
    }

    None
}

/// Get system ripgrep path
pub fn get_system_rg_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let cmd = Command::new("where").arg("rg").output();

    #[cfg(not(target_os = "windows"))]
    let cmd = Command::new("which").arg("rg").output();

    match cmd {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(|s| PathBuf::from(s.trim()));
            path
        }
        _ => None,
    }
}

/// Check if should use system ripgrep based on environment variable
fn should_use_system_ripgrep() -> bool {
    std::env::var("USE_BUILTIN_RIPGREP")
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

/// Get available ripgrep path
/// Respects USE_BUILTIN_RIPGREP environment variable
pub fn get_rg_path() -> Option<PathBuf> {
    if should_use_system_ripgrep() {
        // Prefer system version when env var is set
        get_system_rg_path().or_else(get_vendored_rg_path)
    } else {
        // Default: prefer vendored version
        get_vendored_rg_path().or_else(get_system_rg_path)
    }
}

/// Check if ripgrep is available
pub fn is_ripgrep_available() -> bool {
    get_rg_path().is_some()
}

/// Get ripgrep version
pub fn get_ripgrep_version() -> Option<String> {
    let rg_path = get_rg_path()?;

    let output = Command::new(&rg_path).arg("--version").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let version_str = String::from_utf8_lossy(&output.stdout);
    // Parse "ripgrep X.Y.Z" format
    version_str
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1).map(|v| v.to_string()))
}

/// Build ripgrep command arguments
fn build_rg_args(options: &RipgrepOptions) -> Vec<String> {
    let mut args = Vec::new();

    // Fixed strings mode
    if options.fixed_strings {
        args.push("-F".to_string());
    }

    // Case insensitive
    if options.ignore_case {
        args.push("-i".to_string());
    }

    // Multiline mode
    if options.multiline {
        args.push("-U".to_string());
        args.push("--multiline-dotall".to_string());
    }

    // Output format
    if options.json {
        args.push("--json".to_string());
    } else {
        args.push("--line-number".to_string());
        args.push("--column".to_string());
    }

    // Glob filter
    if let Some(ref glob) = options.glob {
        args.push("--glob".to_string());
        args.push(glob.clone());
    }

    // File type filter
    if let Some(ref file_type) = options.file_type {
        args.push("--type".to_string());
        args.push(file_type.clone());
    }

    // Ignore settings
    if options.no_ignore {
        args.push("--no-ignore".to_string());
    }

    if options.hidden {
        args.push("--hidden".to_string());
    }

    // Max count
    if let Some(max) = options.max_count {
        args.push("--max-count".to_string());
        args.push(max.to_string());
    }

    // Files with matches only
    if options.files_with_matches {
        args.push("--files-with-matches".to_string());
    }

    // Count mode
    if options.count {
        args.push("--count".to_string());
    }

    // Context lines
    if let Some(ctx) = options.context {
        args.push("-C".to_string());
        args.push(ctx.to_string());
    } else {
        if let Some(before) = options.before_context {
            args.push("-B".to_string());
            args.push(before.to_string());
        }
        if let Some(after) = options.after_context {
            args.push("-A".to_string());
            args.push(after.to_string());
        }
    }

    // Pattern (use -- to separate from paths)
    args.push("--".to_string());
    args.push(options.pattern.clone());

    // Search paths
    if options.paths.is_empty() {
        args.push(".".to_string());
    } else {
        for path in &options.paths {
            args.push(path.display().to_string());
        }
    }

    args
}

/// JSON output types from ripgrep
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RgJsonMessage {
    Begin {
        data: RgBeginData,
    },
    Match {
        data: RgMatchData,
    },
    End {
        data: RgEndData,
    },
    Summary {
        data: RgSummaryData,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct RgBeginData {
    path: RgPath,
}

#[derive(Debug, Deserialize)]
struct RgMatchData {
    path: RgPath,
    lines: RgLines,
    line_number: usize,
    submatches: Vec<RgSubmatch>,
}

#[derive(Debug, Deserialize)]
struct RgEndData {
    path: RgPath,
    stats: Option<RgStats>,
}

#[derive(Debug, Deserialize)]
struct RgSummaryData {
    stats: RgStats,
}

#[derive(Debug, Deserialize)]
struct RgPath {
    text: String,
}

#[derive(Debug, Deserialize)]
struct RgLines {
    text: String,
}

#[derive(Debug, Deserialize)]
struct RgSubmatch {
    start: usize,
    end: usize,
}

#[derive(Debug, Deserialize)]
struct RgStats {
    matched_lines: Option<usize>,
    matches: Option<usize>,
}

/// Parse JSON output from ripgrep
fn parse_json_output(output: &str) -> RipgrepResult {
    let mut matches = Vec::new();
    let mut files = std::collections::HashSet::new();
    let mut match_count = 0;

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }

        if let Ok(RgJsonMessage::Match { data }) = serde_json::from_str::<RgJsonMessage>(line) {
            files.insert(data.path.text.clone());

            for submatch in &data.submatches {
                matches.push(RipgrepMatch {
                    path: data.path.text.clone(),
                    line_number: data.line_number,
                    line_content: data.lines.text.trim_end_matches('\n').to_string(),
                    match_start: submatch.start,
                    match_end: submatch.end,
                });
                match_count += 1;
            }
        }
    }

    RipgrepResult {
        matches,
        files_searched: files.len(),
        match_count,
        truncated: false,
    }
}

/// Execute ripgrep search asynchronously
pub async fn search(options: RipgrepOptions) -> Result<RipgrepResult, String> {
    let rg_path = get_rg_path().ok_or("ripgrep is not available")?;

    let mut search_options = options.clone();
    search_options.json = true;

    let args = build_rg_args(&search_options);

    let mut cmd = tokio::process::Command::new(&rg_path);
    cmd.args(&args);

    if let Some(ref cwd) = options.cwd {
        cmd.current_dir(cwd);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute ripgrep: {}", e))?;

    // ripgrep returns 1 when no matches found, which is not an error
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_json_output(&stdout))
}

/// Execute ripgrep search synchronously
pub fn search_sync(options: &RipgrepOptions) -> Result<String, String> {
    let rg_path = get_rg_path().ok_or("ripgrep is not available")?;

    let args = build_rg_args(options);

    let mut cmd = Command::new(&rg_path);
    cmd.args(&args);

    if let Some(ref cwd) = options.cwd {
        cmd.current_dir(cwd);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute ripgrep: {}", e))?;

    // ripgrep returns 1 when no matches found
    if output.status.code() == Some(1) {
        return Ok(String::new());
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// List files using ripgrep (rg --files)
pub async fn list_files(options: ListFilesOptions) -> Result<Vec<String>, String> {
    let rg_path = get_rg_path().ok_or("ripgrep is not available")?;

    let mut args = vec!["--files".to_string()];

    if let Some(ref glob) = options.glob {
        args.push("--glob".to_string());
        args.push(glob.clone());
    }

    if let Some(ref file_type) = options.file_type {
        args.push("--type".to_string());
        args.push(file_type.clone());
    }

    if options.hidden {
        args.push("--hidden".to_string());
    }

    if options.no_ignore {
        args.push("--no-ignore".to_string());
    }

    let mut cmd = tokio::process::Command::new(&rg_path);
    cmd.args(&args);

    if let Some(ref cwd) = options.cwd {
        cmd.current_dir(cwd);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute ripgrep: {}", e))?;

    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();

    Ok(files)
}

/// Options for listing files
#[derive(Debug, Clone, Default)]
pub struct ListFilesOptions {
    pub cwd: Option<PathBuf>,
    pub glob: Option<String>,
    pub file_type: Option<String>,
    pub hidden: bool,
    pub no_ignore: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ripgrep_options_default() {
        let opts = RipgrepOptions::default();
        assert!(opts.pattern.is_empty());
        assert!(opts.paths.is_empty());
        assert!(!opts.ignore_case);
        assert!(!opts.json);
    }

    #[test]
    fn test_ripgrep_match_struct() {
        let m = RipgrepMatch {
            path: "test.rs".to_string(),
            line_number: 10,
            line_content: "fn main()".to_string(),
            match_start: 3,
            match_end: 7,
        };
        assert_eq!(m.path, "test.rs");
        assert_eq!(m.line_number, 10);
    }

    #[test]
    fn test_ripgrep_result_struct() {
        let result = RipgrepResult {
            matches: vec![],
            files_searched: 5,
            match_count: 0,
            truncated: false,
        };
        assert_eq!(result.files_searched, 5);
        assert!(!result.truncated);
    }

    #[test]
    fn test_build_rg_args_basic() {
        let opts = RipgrepOptions {
            pattern: "test".to_string(),
            ..Default::default()
        };
        let args = build_rg_args(&opts);
        assert!(args.contains(&"--".to_string()));
        assert!(args.contains(&"test".to_string()));
        assert!(args.contains(&".".to_string()));
    }

    #[test]
    fn test_build_rg_args_with_options() {
        let opts = RipgrepOptions {
            pattern: "fn".to_string(),
            ignore_case: true,
            hidden: true,
            json: true,
            max_count: Some(10),
            ..Default::default()
        };
        let args = build_rg_args(&opts);
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"--hidden".to_string()));
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--max-count".to_string()));
    }

    #[test]
    fn test_build_rg_args_with_context() {
        let opts = RipgrepOptions {
            pattern: "test".to_string(),
            before_context: Some(2),
            after_context: Some(3),
            ..Default::default()
        };
        let args = build_rg_args(&opts);
        assert!(args.contains(&"-B".to_string()));
        assert!(args.contains(&"2".to_string()));
        assert!(args.contains(&"-A".to_string()));
        assert!(args.contains(&"3".to_string()));
    }

    #[test]
    fn test_build_rg_args_with_paths() {
        let opts = RipgrepOptions {
            pattern: "test".to_string(),
            paths: vec![PathBuf::from("src"), PathBuf::from("tests")],
            ..Default::default()
        };
        let args = build_rg_args(&opts);
        assert!(args.contains(&"src".to_string()));
        assert!(args.contains(&"tests".to_string()));
        assert!(!args.contains(&".".to_string()));
    }

    #[test]
    fn test_parse_json_output_empty() {
        let result = parse_json_output("");
        assert!(result.matches.is_empty());
        assert_eq!(result.files_searched, 0);
        assert_eq!(result.match_count, 0);
    }

    #[test]
    fn test_parse_json_output_with_match() {
        let json = r#"{"type":"match","data":{"path":{"text":"test.rs"},"lines":{"text":"fn main()\n"},"line_number":1,"submatches":[{"start":0,"end":2}]}}"#;
        let result = parse_json_output(json);
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].path, "test.rs");
        assert_eq!(result.matches[0].line_number, 1);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn test_list_files_options_default() {
        let opts = ListFilesOptions::default();
        assert!(opts.cwd.is_none());
        assert!(opts.glob.is_none());
        assert!(!opts.hidden);
    }

    #[test]
    fn test_is_ripgrep_available() {
        // This test just verifies the function runs without panic
        let _ = is_ripgrep_available();
    }

    #[test]
    fn test_get_ripgrep_version() {
        // This test just verifies the function runs without panic
        let _ = get_ripgrep_version();
    }
}
