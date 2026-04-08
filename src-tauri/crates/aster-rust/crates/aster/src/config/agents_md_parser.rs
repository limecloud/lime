//! AGENTS.md 解析器
//!
//! 解析项目根目录的 AGENTS.md 文件，并注入到系统提示中

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::RwLock;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

/// 变更回调函数类型
pub(crate) type ChangeCallback = Box<dyn Fn(String) + Send + Sync>;

/// 变更回调列表类型
pub(crate) type ChangeCallbackList = Arc<RwLock<Vec<ChangeCallback>>>;

/// AGENTS.md 文件信息
#[derive(Debug, Clone)]
pub struct AgentsMdInfo {
    /// 文件内容
    pub content: String,
    /// 文件路径
    pub path: PathBuf,
    /// 文件是否存在
    pub exists: bool,
    /// 最后修改时间
    pub last_modified: Option<SystemTime>,
}

/// AGENTS.md 统计信息
#[derive(Debug, Clone)]
pub struct AgentsMdStats {
    /// 行数
    pub lines: usize,
    /// 字符数
    pub chars: usize,
    /// 文件大小（字节）
    pub size: u64,
}

/// 验证结果
#[derive(Debug, Clone)]
pub struct ValidationResult {
    /// 是否有效
    pub valid: bool,
    /// 警告信息
    pub warnings: Vec<String>,
}

/// AGENTS.md 解析器
pub struct AgentsMdParser {
    /// AGENTS.md 文件路径
    agents_md_path: PathBuf,
    /// 文件监听器
    watcher: RwLock<Option<RecommendedWatcher>>,
    /// 变更回调
    change_callbacks: ChangeCallbackList,
}

impl AgentsMdParser {
    /// 创建新的解析器
    pub fn new(working_dir: Option<&Path>) -> Self {
        let dir = working_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

        let agents_md_path = dir.join("AGENTS.md");

        Self {
            agents_md_path,
            watcher: RwLock::new(None),
            change_callbacks: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 解析 AGENTS.md 文件
    pub fn parse(&self) -> AgentsMdInfo {
        if !self.agents_md_path.exists() {
            return AgentsMdInfo {
                content: String::new(),
                path: self.agents_md_path.clone(),
                exists: false,
                last_modified: None,
            };
        }

        match fs::read_to_string(&self.agents_md_path) {
            Ok(content) => {
                let last_modified = fs::metadata(&self.agents_md_path)
                    .ok()
                    .and_then(|m| m.modified().ok());

                AgentsMdInfo {
                    content,
                    path: self.agents_md_path.clone(),
                    exists: true,
                    last_modified,
                }
            }
            Err(e) => {
                tracing::warn!("读取 AGENTS.md 失败: {}", e);
                AgentsMdInfo {
                    content: String::new(),
                    path: self.agents_md_path.clone(),
                    exists: false,
                    last_modified: None,
                }
            }
        }
    }

    /// 注入到系统提示
    ///
    /// 核心功能：将 AGENTS.md 的内容添加到系统提示中
    pub fn inject_into_system_prompt(&self, base_prompt: &str) -> String {
        let info = self.parse();

        if !info.exists || info.content.trim().is_empty() {
            return base_prompt.to_string();
        }

        format!(
            r#"{}

# agentsMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of {} (project instructions, checked into the codebase):

{}

IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task."#,
            base_prompt,
            self.agents_md_path.display(),
            info.content
        )
    }

    /// 获取 AGENTS.md 内容（简化版）
    pub fn get_content(&self) -> Option<String> {
        let info = self.parse();
        if info.exists {
            Some(info.content)
        } else {
            None
        }
    }

    /// 检查 AGENTS.md 是否存在
    pub fn exists(&self) -> bool {
        self.agents_md_path.exists()
    }

    /// 获取文件路径
    pub fn path(&self) -> &Path {
        &self.agents_md_path
    }

    /// 监听 AGENTS.md 变化
    pub fn watch<F>(&self, callback: F) -> Result<(), notify::Error>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        if !self.exists() {
            tracing::warn!(
                "AGENTS.md 不存在，无法监听: {}",
                self.agents_md_path.display()
            );
            return Ok(());
        }

        self.change_callbacks.write().push(Box::new(callback));

        let mut watcher_guard = self.watcher.write();
        if watcher_guard.is_none() {
            let callbacks = self.change_callbacks.clone();
            let path = self.agents_md_path.clone();

            let mut watcher = notify::recommended_watcher(move |res: Result<Event, _>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() {
                        if let Ok(content) = fs::read_to_string(&path) {
                            let cbs = callbacks.read();
                            for cb in cbs.iter() {
                                cb(content.clone());
                            }
                        }
                    }
                }
            })?;

            watcher.watch(&self.agents_md_path, RecursiveMode::NonRecursive)?;
            *watcher_guard = Some(watcher);
        }

        Ok(())
    }

    /// 停止监听
    pub fn unwatch(&self) {
        let mut watcher_guard = self.watcher.write();
        *watcher_guard = None;
        self.change_callbacks.write().clear();
    }

    /// 创建默认的 AGENTS.md 模板
    pub fn create_template(project_name: &str, project_type: Option<&str>) -> String {
        let pt = project_type.unwrap_or("software");
        format!(
            r#"# AGENTS.md

This file provides guidance to AI Agent when working with code in this repository.

## Project Overview

{} is a {} project.

## Development Guidelines

### Code Style

- Follow consistent formatting
- Write clear, descriptive comments
- Use meaningful variable names

### Testing

- Write tests for new features
- Ensure all tests pass before committing
- Maintain test coverage above 80%

### Git Workflow

- Use feature branches
- Write clear commit messages
- Keep commits atomic and focused

## Important Notes

- Add project-specific guidelines here
- Document any special requirements
- Include build/deployment instructions if needed
"#,
            project_name, pt
        )
    }

    /// 在项目中创建 AGENTS.md
    pub fn create(&self, content: Option<&str>) -> Result<(), std::io::Error> {
        if self.exists() {
            tracing::warn!("AGENTS.md 已存在");
            return Ok(());
        }

        let project_name = self
            .agents_md_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("project");

        let template = content
            .map(|s| s.to_string())
            .unwrap_or_else(|| Self::create_template(project_name, None));

        fs::write(&self.agents_md_path, template)
    }

    /// 更新 AGENTS.md
    pub fn update(&self, content: &str) -> Result<(), std::io::Error> {
        fs::write(&self.agents_md_path, content)
    }

    /// 验证 AGENTS.md 格式
    pub fn validate(&self) -> ValidationResult {
        let info = self.parse();
        let mut warnings = Vec::new();

        if !info.exists {
            return ValidationResult {
                valid: false,
                warnings: vec!["AGENTS.md 文件不存在".to_string()],
            };
        }

        if info.content.trim().is_empty() {
            warnings.push("AGENTS.md 文件为空".to_string());
        }

        // 检查是否包含标题
        if !info.content.contains('#') {
            warnings.push("建议使用 Markdown 标题组织内容".to_string());
        }

        // 检查文件大小（过大可能影响性能）
        if info.content.len() > 50000 {
            warnings.push("AGENTS.md 文件过大（>50KB），可能影响性能".to_string());
        }

        ValidationResult {
            valid: true,
            warnings,
        }
    }

    /// 获取 AGENTS.md 的统计信息
    pub fn get_stats(&self) -> Option<AgentsMdStats> {
        let info = self.parse();

        if !info.exists {
            return None;
        }

        let size = fs::metadata(&self.agents_md_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Some(AgentsMdStats {
            lines: info.content.lines().count(),
            chars: info.content.len(),
            size,
        })
    }
}

impl Default for AgentsMdParser {
    fn default() -> Self {
        Self::new(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parser_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));

        let info = parser.parse();
        assert!(!info.exists);
        assert!(info.content.is_empty());
    }

    #[test]
    fn test_parser_with_file() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "# Test\n\nHello world").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let info = parser.parse();

        assert!(info.exists);
        assert!(info.content.contains("Hello world"));
    }

    #[test]
    fn test_inject_into_system_prompt_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));

        let result = parser.inject_into_system_prompt("base prompt");
        assert_eq!(result, "base prompt");
    }

    #[test]
    fn test_inject_into_system_prompt_with_file() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "# Instructions\n\nDo this").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let result = parser.inject_into_system_prompt("base prompt");

        assert!(result.contains("base prompt"));
        assert!(result.contains("agentsMd"));
        assert!(result.contains("Do this"));
    }

    #[test]
    fn test_get_content() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "content here").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let content = parser.get_content();

        assert!(content.is_some());
        assert_eq!(content.unwrap(), "content here");
    }

    #[test]
    fn test_exists() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        assert!(!parser.exists());

        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "test").unwrap();

        let parser2 = AgentsMdParser::new(Some(temp_dir.path()));
        assert!(parser2.exists());
    }

    #[test]
    fn test_create_template() {
        let template = AgentsMdParser::create_template("my-project", Some("Rust"));
        assert!(template.contains("my-project"));
        assert!(template.contains("Rust"));
        assert!(template.contains("# AGENTS.md"));
    }

    #[test]
    fn test_create() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));

        parser.create(None).unwrap();
        assert!(parser.exists());

        let content = parser.get_content().unwrap();
        assert!(content.contains("# AGENTS.md"));
    }

    #[test]
    fn test_update() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "old content").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        parser.update("new content").unwrap();

        let content = parser.get_content().unwrap();
        assert_eq!(content, "new content");
    }

    #[test]
    fn test_validate_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));

        let result = parser.validate();
        assert!(!result.valid);
        assert!(result.warnings.iter().any(|w| w.contains("不存在")));
    }

    #[test]
    fn test_validate_empty_file() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "   ").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let result = parser.validate();

        assert!(result.valid);
        assert!(result.warnings.iter().any(|w| w.contains("为空")));
    }

    #[test]
    fn test_validate_no_headers() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "just plain text").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let result = parser.validate();

        assert!(result.valid);
        assert!(result.warnings.iter().any(|w| w.contains("标题")));
    }

    #[test]
    fn test_get_stats() {
        let temp_dir = TempDir::new().unwrap();
        let agents_md = temp_dir.path().join("AGENTS.md");
        fs::write(&agents_md, "line1\nline2\nline3").unwrap();

        let parser = AgentsMdParser::new(Some(temp_dir.path()));
        let stats = parser.get_stats().unwrap();

        assert_eq!(stats.lines, 3);
        assert_eq!(stats.chars, 17);
    }

    #[test]
    fn test_get_stats_no_file() {
        let temp_dir = TempDir::new().unwrap();
        let parser = AgentsMdParser::new(Some(temp_dir.path()));

        assert!(parser.get_stats().is_none());
    }
}
