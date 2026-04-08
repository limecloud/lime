//! Ripgrep 集成
//!
//! 提供内置的 ripgrep 二进制文件支持

#![allow(clippy::items_after_test_module)]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tokio::process::Command as AsyncCommand;

/// Ripgrep 版本
pub const RG_VERSION: &str = "14.1.0";

/// Ripgrep 搜索选项
#[derive(Debug, Clone, Default)]
pub struct RipgrepOptions {
    /// 工作目录
    pub cwd: Option<PathBuf>,
    /// 搜索模式
    pub pattern: String,
    /// 搜索路径
    pub paths: Vec<PathBuf>,
    /// Glob 模式
    pub glob: Option<String>,
    /// 文件类型
    pub file_type: Option<String>,
    /// 忽略大小写
    pub ignore_case: bool,
    /// 固定字符串搜索
    pub fixed_strings: bool,
    /// 最大匹配数
    pub max_count: Option<u32>,
    /// 上下文行数
    pub context: Option<u32>,
    /// 前置上下文行数
    pub before_context: Option<u32>,
    /// 后置上下文行数
    pub after_context: Option<u32>,
    /// 只返回匹配的文件名
    pub files_with_matches: bool,
    /// 只返回匹配数量
    pub count: bool,
    /// JSON 输出
    pub json: bool,
    /// 不使用 ignore 文件
    pub no_ignore: bool,
    /// 搜索隐藏文件
    pub hidden: bool,
    /// 多行模式
    pub multiline: bool,
    /// 超时（毫秒）
    pub timeout_ms: Option<u64>,
}

/// Ripgrep 匹配结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RipgrepMatch {
    /// 文件路径
    pub path: String,
    /// 行号
    pub line_number: u32,
    /// 行内容
    pub line_content: String,
    /// 匹配开始位置
    pub match_start: u32,
    /// 匹配结束位置
    pub match_end: u32,
}

/// Ripgrep 搜索结果
#[derive(Debug, Clone, Default)]
pub struct RipgrepResult {
    /// 匹配列表
    pub matches: Vec<RipgrepMatch>,
    /// 搜索的文件数
    pub files_searched: usize,
    /// 匹配数量
    pub match_count: usize,
    /// 是否被截断
    pub truncated: bool,
}

/// 获取系统 ripgrep 路径
pub fn get_system_rg_path() -> Option<PathBuf> {
    // 尝试 which/where 命令
    let output = if cfg!(windows) {
        Command::new("where").arg("rg").output()
    } else {
        Command::new("which").arg("rg").output()
    };

    output
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| PathBuf::from(s.trim().lines().next().unwrap_or("")))
        .filter(|p| p.exists())
}

/// 获取 vendored ripgrep 路径
pub fn get_vendored_rg_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let binary_name = if cfg!(windows) { "rg.exe" } else { "rg" };

    // 检查多个可能的位置
    let possible_paths = [
        home.join(".aster").join("bin").join(binary_name),
        home.join(".local").join("bin").join(binary_name),
    ];

    possible_paths.into_iter().find(|p| p.exists())
}

/// 获取可用的 ripgrep 路径
pub fn get_rg_path() -> Option<PathBuf> {
    // 检查环境变量
    if std::env::var("USE_BUILTIN_RIPGREP")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false)
    {
        if let Some(path) = get_system_rg_path() {
            return Some(path);
        }
        return get_vendored_rg_path();
    }

    // 默认优先使用 vendored 版本
    get_vendored_rg_path().or_else(get_system_rg_path)
}

/// 检查 ripgrep 是否可用
pub fn is_ripgrep_available() -> bool {
    get_rg_path().is_some()
}

/// 获取 ripgrep 版本
pub fn get_ripgrep_version() -> Option<String> {
    let rg_path = get_rg_path()?;

    let output = Command::new(&rg_path).arg("--version").output().ok()?;

    let version_str = String::from_utf8(output.stdout).ok()?;

    // 解析版本号 "ripgrep X.Y.Z"
    version_str
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .map(|v| v.to_string())
}

/// 构建 ripgrep 命令参数
fn build_rg_args(options: &RipgrepOptions) -> Vec<String> {
    let mut args = Vec::new();

    // 基本模式
    if options.fixed_strings {
        args.push("-F".to_string());
    }

    if options.ignore_case {
        args.push("-i".to_string());
    }

    if options.multiline {
        args.push("-U".to_string());
        args.push("--multiline-dotall".to_string());
    }

    // 输出格式
    if options.json {
        args.push("--json".to_string());
    } else {
        args.push("--line-number".to_string());
        args.push("--column".to_string());
    }

    // 过滤
    if let Some(ref glob) = options.glob {
        args.push("--glob".to_string());
        args.push(glob.clone());
    }

    if let Some(ref file_type) = options.file_type {
        args.push("--type".to_string());
        args.push(file_type.clone());
    }

    if options.no_ignore {
        args.push("--no-ignore".to_string());
    }

    if options.hidden {
        args.push("--hidden".to_string());
    }

    // 输出限制
    if let Some(max) = options.max_count {
        args.push("--max-count".to_string());
        args.push(max.to_string());
    }

    if options.files_with_matches {
        args.push("--files-with-matches".to_string());
    }

    if options.count {
        args.push("--count".to_string());
    }

    // 上下文
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

    // 搜索模式
    args.push("--".to_string());
    args.push(options.pattern.clone());

    // 搜索路径
    if options.paths.is_empty() {
        args.push(".".to_string());
    } else {
        for path in &options.paths {
            args.push(path.display().to_string());
        }
    }

    args
}

/// 异步执行 ripgrep 搜索
pub async fn search(options: RipgrepOptions) -> Result<RipgrepResult, String> {
    let rg_path = get_rg_path().ok_or("ripgrep 不可用")?;

    let mut search_options = options.clone();
    search_options.json = true;

    let args = build_rg_args(&search_options);
    let cwd = options
        .cwd
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let output = AsyncCommand::new(&rg_path)
        .args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("执行 ripgrep 失败: {}", e))?;

    // ripgrep 返回 1 表示没有匹配，不是错误
    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep 错误: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_json_output(&stdout)
}

/// 同步执行 ripgrep 搜索
pub fn search_sync(options: RipgrepOptions) -> Result<String, String> {
    let rg_path = get_rg_path().ok_or("ripgrep 不可用")?;

    let args = build_rg_args(&options);
    let cwd = options
        .cwd
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let output = Command::new(&rg_path)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("执行 ripgrep 失败: {}", e))?;

    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep 错误: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 解析 JSON 输出
fn parse_json_output(output: &str) -> Result<RipgrepResult, String> {
    let mut matches = Vec::new();
    let mut files = std::collections::HashSet::new();
    let mut match_count = 0;

    for line in output.lines().filter(|l| !l.is_empty()) {
        if let Ok(obj) = serde_json::from_str::<serde_json::Value>(line) {
            if obj.get("type").and_then(|t| t.as_str()) == Some("match") {
                if let Some(data) = obj.get("data") {
                    let path = data
                        .get("path")
                        .and_then(|p| p.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("");

                    files.insert(path.to_string());

                    let line_number = data
                        .get("line_number")
                        .and_then(|n| n.as_u64())
                        .unwrap_or(0) as u32;

                    let line_content = data
                        .get("lines")
                        .and_then(|l| l.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .trim_end_matches('\n');

                    if let Some(submatches) = data.get("submatches").and_then(|s| s.as_array()) {
                        for submatch in submatches {
                            let start =
                                submatch.get("start").and_then(|s| s.as_u64()).unwrap_or(0) as u32;
                            let end =
                                submatch.get("end").and_then(|e| e.as_u64()).unwrap_or(0) as u32;

                            matches.push(RipgrepMatch {
                                path: path.to_string(),
                                line_number,
                                line_content: line_content.to_string(),
                                match_start: start,
                                match_end: end,
                            });
                            match_count += 1;
                        }
                    }
                }
            }
        }
    }

    Ok(RipgrepResult {
        matches,
        files_searched: files.len(),
        match_count,
        truncated: false,
    })
}

/// 列出文件（使用 rg --files）
pub async fn list_files(
    cwd: Option<PathBuf>,
    glob: Option<&str>,
    file_type: Option<&str>,
    hidden: bool,
    no_ignore: bool,
) -> Result<Vec<String>, String> {
    let rg_path = get_rg_path().ok_or("ripgrep 不可用")?;

    let mut args = vec!["--files".to_string()];

    if let Some(g) = glob {
        args.push("--glob".to_string());
        args.push(g.to_string());
    }

    if let Some(t) = file_type {
        args.push("--type".to_string());
        args.push(t.to_string());
    }

    if hidden {
        args.push("--hidden".to_string());
    }

    if no_ignore {
        args.push("--no-ignore".to_string());
    }

    let working_dir = cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let output = AsyncCommand::new(&rg_path)
        .args(&args)
        .current_dir(&working_dir)
        .output()
        .await
        .map_err(|e| format!("执行 ripgrep 失败: {}", e))?;

    if !output.status.success() && output.status.code() != Some(1) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ripgrep 错误: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_rg_args_basic() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--line-number".to_string()));
        assert!(args.contains(&"test".to_string()));
    }

    #[test]
    fn test_build_rg_args_with_options() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            ignore_case: true,
            hidden: true,
            glob: Some("*.rs".to_string()),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"-i".to_string()));
        assert!(args.contains(&"--hidden".to_string()));
        assert!(args.contains(&"--glob".to_string()));
        assert!(args.contains(&"*.rs".to_string()));
    }

    #[test]
    fn test_build_rg_args_fixed_strings() {
        let options = RipgrepOptions {
            pattern: "test.pattern".to_string(),
            fixed_strings: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"-F".to_string()));
    }

    #[test]
    fn test_build_rg_args_multiline() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            multiline: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"-U".to_string()));
        assert!(args.contains(&"--multiline-dotall".to_string()));
    }

    #[test]
    fn test_build_rg_args_context() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            context: Some(3),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"-C".to_string()));
        assert!(args.contains(&"3".to_string()));
    }

    #[test]
    fn test_build_rg_args_before_after_context() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            before_context: Some(2),
            after_context: Some(4),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"-B".to_string()));
        assert!(args.contains(&"2".to_string()));
        assert!(args.contains(&"-A".to_string()));
        assert!(args.contains(&"4".to_string()));
    }

    #[test]
    fn test_build_rg_args_max_count() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            max_count: Some(10),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--max-count".to_string()));
        assert!(args.contains(&"10".to_string()));
    }

    #[test]
    fn test_build_rg_args_files_with_matches() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            files_with_matches: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--files-with-matches".to_string()));
    }

    #[test]
    fn test_build_rg_args_count() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            count: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--count".to_string()));
    }

    #[test]
    fn test_build_rg_args_no_ignore() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            no_ignore: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--no-ignore".to_string()));
    }

    #[test]
    fn test_build_rg_args_file_type() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            file_type: Some("rust".to_string()),
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--type".to_string()));
        assert!(args.contains(&"rust".to_string()));
    }

    #[test]
    fn test_build_rg_args_json() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            json: true,
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"--json".to_string()));
        assert!(!args.contains(&"--line-number".to_string()));
    }

    #[test]
    fn test_build_rg_args_with_paths() {
        let options = RipgrepOptions {
            pattern: "test".to_string(),
            paths: vec![PathBuf::from("src"), PathBuf::from("tests")],
            ..Default::default()
        };

        let args = build_rg_args(&options);
        assert!(args.contains(&"src".to_string()));
        assert!(args.contains(&"tests".to_string()));
        assert!(!args.contains(&".".to_string()));
    }

    #[test]
    fn test_is_ripgrep_available() {
        // 这个测试依赖于系统是否安装了 ripgrep
        let available = is_ripgrep_available();
        println!("ripgrep available: {}", available);
    }

    #[test]
    fn test_get_ripgrep_version() {
        if is_ripgrep_available() {
            let version = get_ripgrep_version();
            assert!(version.is_some());
            println!("ripgrep version: {:?}", version);
        }
    }

    #[test]
    fn test_parse_json_output() {
        let json = r#"{"type":"match","data":{"path":{"text":"test.rs"},"lines":{"text":"fn test() {}\n"},"line_number":1,"submatches":[{"match":{"text":"test"},"start":3,"end":7}]}}"#;

        let result = parse_json_output(json).unwrap();
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].path, "test.rs");
        assert_eq!(result.matches[0].line_number, 1);
        assert_eq!(result.matches[0].match_start, 3);
        assert_eq!(result.matches[0].match_end, 7);
    }

    #[test]
    fn test_parse_json_output_multiple_matches() {
        let json = r#"{"type":"match","data":{"path":{"text":"test.rs"},"lines":{"text":"test test test\n"},"line_number":1,"submatches":[{"match":{"text":"test"},"start":0,"end":4},{"match":{"text":"test"},"start":5,"end":9}]}}
{"type":"match","data":{"path":{"text":"test.rs"},"lines":{"text":"another test\n"},"line_number":2,"submatches":[{"match":{"text":"test"},"start":8,"end":12}]}}"#;

        let result = parse_json_output(json).unwrap();
        assert_eq!(result.matches.len(), 3);
        assert_eq!(result.match_count, 3);
        assert_eq!(result.files_searched, 1);
    }

    #[test]
    fn test_parse_json_output_multiple_files() {
        let json = r#"{"type":"match","data":{"path":{"text":"file1.rs"},"lines":{"text":"test\n"},"line_number":1,"submatches":[{"match":{"text":"test"},"start":0,"end":4}]}}
{"type":"match","data":{"path":{"text":"file2.rs"},"lines":{"text":"test\n"},"line_number":1,"submatches":[{"match":{"text":"test"},"start":0,"end":4}]}}"#;

        let result = parse_json_output(json).unwrap();
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.files_searched, 2);
    }

    #[test]
    fn test_parse_json_output_empty() {
        let result = parse_json_output("").unwrap();
        assert!(result.matches.is_empty());
        assert_eq!(result.files_searched, 0);
        assert_eq!(result.match_count, 0);
    }

    #[test]
    fn test_parse_json_output_invalid_json() {
        let result = parse_json_output("not json at all");
        assert!(result.is_ok());
        assert!(result.unwrap().matches.is_empty());
    }

    #[test]
    fn test_parse_json_output_non_match_type() {
        let json = r#"{"type":"begin","data":{"path":{"text":"test.rs"}}}
{"type":"end","data":{"path":{"text":"test.rs"}}}"#;

        let result = parse_json_output(json).unwrap();
        assert!(result.matches.is_empty());
    }

    #[test]
    fn test_ripgrep_options_default() {
        let options = RipgrepOptions::default();
        assert!(options.pattern.is_empty());
        assert!(options.paths.is_empty());
        assert!(!options.ignore_case);
        assert!(!options.hidden);
        assert!(!options.json);
    }

    #[test]
    fn test_ripgrep_result_default() {
        let result = RipgrepResult::default();
        assert!(result.matches.is_empty());
        assert_eq!(result.files_searched, 0);
        assert_eq!(result.match_count, 0);
        assert!(!result.truncated);
    }

    #[test]
    fn test_get_platform_binary_name() {
        let name = get_platform_binary_name();
        // 应该在支持的平台上返回 Some
        #[cfg(any(
            all(target_os = "macos", target_arch = "x86_64"),
            all(target_os = "macos", target_arch = "aarch64"),
            all(target_os = "linux", target_arch = "x86_64"),
            all(target_os = "linux", target_arch = "aarch64"),
            all(target_os = "windows", target_arch = "x86_64"),
        ))]
        assert!(name.is_some());
    }

    #[test]
    fn test_get_download_url() {
        let url = get_download_url();
        if let Some(u) = url {
            assert!(u.contains("ripgrep"));
            assert!(u.contains(RG_VERSION));
        }
    }

    #[tokio::test]
    async fn test_search_with_ripgrep() {
        if !is_ripgrep_available() {
            println!("跳过测试：ripgrep 不可用");
            return;
        }

        let options = RipgrepOptions {
            pattern: "fn ".to_string(),
            cwd: Some(std::env::current_dir().unwrap()),
            glob: Some("*.rs".to_string()),
            max_count: Some(5),
            ..Default::default()
        };

        let result = search(options).await;
        // 应该能成功执行（可能有或没有匹配）
        assert!(result.is_ok());
    }

    #[test]
    fn test_search_sync_with_ripgrep() {
        if !is_ripgrep_available() {
            println!("跳过测试：ripgrep 不可用");
            return;
        }

        let options = RipgrepOptions {
            pattern: "fn ".to_string(),
            cwd: Some(std::env::current_dir().unwrap()),
            glob: Some("*.rs".to_string()),
            max_count: Some(5),
            ..Default::default()
        };

        let result = search_sync(options);
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_list_files_with_ripgrep() {
        if !is_ripgrep_available() {
            println!("跳过测试：ripgrep 不可用");
            return;
        }

        let result = list_files(
            Some(std::env::current_dir().unwrap()),
            Some("*.rs"),
            None,
            false,
            false,
        )
        .await;

        assert!(result.is_ok());
    }
}

// ============ Vendored Ripgrep 下载 ============

/// 平台到二进制名称的映射
fn get_platform_binary_name() -> Option<&'static str> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    match (os, arch) {
        ("macos", "x86_64") => Some("rg-darwin-x64"),
        ("macos", "aarch64") => Some("rg-darwin-arm64"),
        ("linux", "x86_64") => Some("rg-linux-x64"),
        ("linux", "aarch64") => Some("rg-linux-arm64"),
        ("windows", "x86_64") => Some("rg-win32-x64.exe"),
        _ => None,
    }
}

/// 获取下载 URL
fn get_download_url() -> Option<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let archive_name = match (os, arch) {
        ("windows", "x86_64") => format!("ripgrep-{}-x86_64-pc-windows-msvc.zip", RG_VERSION),
        ("macos", "x86_64") => format!("ripgrep-{}-x86_64-apple-darwin.tar.gz", RG_VERSION),
        ("macos", "aarch64") => format!("ripgrep-{}-aarch64-apple-darwin.tar.gz", RG_VERSION),
        ("linux", "x86_64") => format!("ripgrep-{}-x86_64-unknown-linux-musl.tar.gz", RG_VERSION),
        ("linux", "aarch64") => format!("ripgrep-{}-aarch64-unknown-linux-gnu.tar.gz", RG_VERSION),
        _ => return None,
    };

    Some(format!(
        "https://github.com/BurntSushi/ripgrep/releases/download/{}/{}",
        RG_VERSION, archive_name
    ))
}

/// 下载 vendored ripgrep
#[allow(unexpected_cfgs)]
pub async fn download_vendored_rg(target_dir: &Path) -> Result<PathBuf, String> {
    let binary_name = get_platform_binary_name().ok_or("不支持的平台")?;
    let download_url = get_download_url().ok_or("无法获取下载 URL")?;

    // 确保目录存在
    std::fs::create_dir_all(target_dir).map_err(|e| format!("创建目录失败: {}", e))?;

    let target_path = target_dir.join(binary_name);

    tracing::info!("下载 ripgrep: {} -> {:?}", download_url, target_path);

    // 使用 reqwest 下载（如果可用）或回退到 curl
    #[cfg(feature = "http")]
    {
        let response = reqwest::get(&download_url)
            .await
            .map_err(|e| format!("下载失败: {}", e))?;

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        // 解压并保存
        // 简化实现：假设已经是二进制文件
        std::fs::write(&target_path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    }

    #[cfg(not(feature = "http"))]
    {
        // 使用 curl 下载
        let temp_file = std::env::temp_dir().join("rg_download.tar.gz");

        let status = Command::new("curl")
            .args(["-L", "-o"])
            .arg(&temp_file)
            .arg(&download_url)
            .status()
            .map_err(|e| format!("执行 curl 失败: {}", e))?;

        if !status.success() {
            return Err("curl 下载失败".to_string());
        }

        // 解压
        let status = Command::new("tar")
            .args(["-xzf"])
            .arg(&temp_file)
            .arg("-C")
            .arg(target_dir)
            .arg("--strip-components=1")
            .status()
            .map_err(|e| format!("解压失败: {}", e))?;

        if !status.success() {
            return Err("解压失败".to_string());
        }

        // 清理临时文件
        let _ = std::fs::remove_file(&temp_file);

        // 重命名
        let extracted = target_dir.join("rg");
        if extracted.exists() && extracted != target_path {
            std::fs::rename(&extracted, &target_path).map_err(|e| format!("重命名失败: {}", e))?;
        }

        // 设置执行权限
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&target_path)
                .map_err(|e| format!("获取权限失败: {}", e))?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&target_path, perms)
                .map_err(|e| format!("设置权限失败: {}", e))?;
        }
    }

    tracing::info!("ripgrep 已安装到 {:?}", target_path);
    Ok(target_path)
}

/// 确保 ripgrep 可用（如果不可用则下载）
pub async fn ensure_ripgrep_available() -> Result<PathBuf, String> {
    if let Some(path) = get_rg_path() {
        return Ok(path);
    }

    // 下载到默认位置
    let target_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".aster")
        .join("bin");

    download_vendored_rg(&target_dir).await
}
