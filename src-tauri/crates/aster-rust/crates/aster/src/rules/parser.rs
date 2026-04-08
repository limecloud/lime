//! AGENTS.md 解析器
//!
//! 解析项目指令和规则

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

use super::types::{AgentsMdSection, CustomRule, ProjectRules, RuleAction};

/// 要查找的 AGENTS.md 文件名
const AGENTS_MD_FILES: &[&str] = &[
    "AGENTS.md",
    ".agents.md",
    "agents.md",
    ".aster/AGENTS.md",
    ".aster/instructions.md",
];

/// 设置文件名
const SETTINGS_FILES: &[&str] = &[".aster/settings.json", ".aster/settings.local.json"];

/// 在目录层级中查找 AGENTS.md 文件
pub fn find_agents_md(start_dir: Option<&Path>) -> Option<PathBuf> {
    let mut dir = start_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    // 向上遍历目录树
    loop {
        for filename in AGENTS_MD_FILES {
            let file_path = dir.join(filename);
            if file_path.exists() {
                return Some(file_path);
            }
        }

        match dir.parent() {
            Some(parent) if parent != dir => dir = parent.to_path_buf(),
            _ => break,
        }
    }

    // 检查 home 目录
    if let Some(home) = dirs::home_dir() {
        let home_agents_md = home.join(".aster").join("AGENTS.md");
        if home_agents_md.exists() {
            return Some(home_agents_md);
        }
    }

    None
}

/// 查找设置文件
pub fn find_settings_files(start_dir: Option<&Path>) -> Vec<PathBuf> {
    let dir = start_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let mut found = Vec::new();

    // 本地设置
    for filename in SETTINGS_FILES {
        let file_path = dir.join(filename);
        if file_path.exists() {
            found.push(file_path);
        }
    }

    // 全局设置
    if let Some(home) = dirs::home_dir() {
        let global_settings = home.join(".aster").join("settings.json");
        if global_settings.exists() {
            found.push(global_settings);
        }
    }

    found
}

/// 解析 AGENTS.md 文件
pub fn parse_agents_md(file_path: &Path) -> Vec<AgentsMdSection> {
    let content = match fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let mut sections = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let heading_re = Regex::new(r"^(#{1,6})\s+(.+)$").unwrap();

    let mut current_section: Option<AgentsMdSection> = None;
    let mut content_lines: Vec<&str> = Vec::new();

    for line in lines {
        if let Some(caps) = heading_re.captures(line) {
            // 保存之前的章节
            if let Some(mut section) = current_section.take() {
                section.content = content_lines.join("\n").trim().to_string();
                sections.push(section);
            }

            // 开始新章节
            current_section = Some(AgentsMdSection {
                title: caps.get(2).unwrap().as_str().trim().to_string(),
                content: String::new(),
                level: caps.get(1).unwrap().as_str().len(),
            });
            content_lines.clear();
        } else if current_section.is_some() {
            content_lines.push(line);
        } else if !line.trim().is_empty() {
            // 第一个标题之前的内容
            current_section = Some(AgentsMdSection {
                title: "Instructions".to_string(),
                content: String::new(),
                level: 0,
            });
            content_lines.push(line);
        }
    }

    // 保存最后一个章节
    if let Some(mut section) = current_section {
        section.content = content_lines.join("\n").trim().to_string();
        sections.push(section);
    }

    sections
}

/// 从章节中提取规则
pub fn extract_rules(sections: &[AgentsMdSection]) -> ProjectRules {
    let mut rules = ProjectRules::default();

    for section in sections {
        let title_lower = section.title.to_lowercase();

        if title_lower.contains("instruction") || section.level == 0 {
            let instructions = rules.instructions.get_or_insert_with(String::new);
            instructions.push_str(&section.content);
            instructions.push('\n');
        } else if title_lower.contains("allowed tool") {
            rules.allowed_tools = Some(parse_list_from_content(&section.content));
        } else if title_lower.contains("disallowed tool") || title_lower.contains("forbidden tool")
        {
            rules.disallowed_tools = Some(parse_list_from_content(&section.content));
        } else if title_lower.contains("permission") {
            let mode = section.content.lines().next().unwrap_or("").trim();
            if ["default", "acceptEdits", "bypassPermissions", "plan"].contains(&mode) {
                rules.permission_mode = Some(mode.to_string());
            }
        } else if title_lower.contains("model") {
            rules.model = section.content.lines().next().map(|s| s.trim().to_string());
        } else if title_lower.contains("system prompt") {
            rules.system_prompt = Some(section.content.clone());
        } else if title_lower.contains("rule") {
            rules.custom_rules = Some(parse_custom_rules(&section.content));
        } else if title_lower.contains("memory") || title_lower.contains("context") {
            rules.memory = Some(parse_memory_from_content(&section.content));
        }
    }

    rules
}

/// 从内容中解析列表项
fn parse_list_from_content(content: &str) -> Vec<String> {
    let list_re = Regex::new(r"^\s*[-*+]\s+(.+)$").unwrap();
    let mut items = Vec::new();

    for line in content.lines() {
        if let Some(caps) = list_re.captures(line) {
            items.push(caps.get(1).unwrap().as_str().trim().to_string());
        }
    }

    items
}

/// 解析自定义规则
fn parse_custom_rules(content: &str) -> Vec<CustomRule> {
    let rule_re = Regex::new(r"^\s*[-*+]\s+\*\*(.+?)\*\*:\s*(.+)$").unwrap();
    let action_re = Regex::new(r"(?i)action:\s*(allow|deny|warn|transform)").unwrap();
    let pattern_re = Regex::new(r"(?i)pattern:\s*(.+)").unwrap();

    let mut rules = Vec::new();
    let mut current_rule: Option<CustomRule> = None;

    for line in content.lines() {
        if let Some(caps) = rule_re.captures(line) {
            // 保存之前的规则
            if let Some(rule) = current_rule.take() {
                rules.push(rule);
            }

            current_rule = Some(CustomRule {
                name: caps.get(1).unwrap().as_str().trim().to_string(),
                pattern: None,
                action: RuleAction::Warn,
                message: Some(caps.get(2).unwrap().as_str().trim().to_string()),
                transform: None,
            });
        } else if let Some(ref mut rule) = current_rule {
            if let Some(caps) = action_re.captures(line) {
                rule.action = match caps.get(1).unwrap().as_str().to_lowercase().as_str() {
                    "allow" => RuleAction::Allow,
                    "deny" => RuleAction::Deny,
                    "transform" => RuleAction::Transform,
                    _ => RuleAction::Warn,
                };
            }

            if let Some(caps) = pattern_re.captures(line) {
                rule.pattern = Some(caps.get(1).unwrap().as_str().trim().to_string());
            }
        }
    }

    if let Some(rule) = current_rule {
        rules.push(rule);
    }

    rules
}

/// 解析记忆/上下文内容
fn parse_memory_from_content(content: &str) -> HashMap<String, String> {
    let memory_re = Regex::new(r"^\s*[-*+]\s+\*\*(.+?)\*\*:\s*(.+)$").unwrap();
    let mut memory = HashMap::new();

    for line in content.lines() {
        if let Some(caps) = memory_re.captures(line) {
            memory.insert(
                caps.get(1).unwrap().as_str().trim().to_string(),
                caps.get(2).unwrap().as_str().trim().to_string(),
            );
        }
    }

    memory
}

/// 加载所有项目规则
pub fn load_project_rules(project_dir: Option<&Path>) -> ProjectRules {
    let dir = project_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    let mut rules = ProjectRules::default();

    // 加载 AGENTS.md
    if let Some(agents_md_path) = find_agents_md(Some(&dir)) {
        let sections = parse_agents_md(&agents_md_path);
        rules = merge_rules(rules, extract_rules(&sections));
    }

    // 加载设置文件
    for settings_path in find_settings_files(Some(&dir)) {
        if let Ok(content) = fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<ProjectRules>(&content) {
                rules = merge_rules(rules, settings);
            }
        }
    }

    rules
}

/// 合并规则（后者优先）
fn merge_rules(base: ProjectRules, override_rules: ProjectRules) -> ProjectRules {
    ProjectRules {
        instructions: override_rules.instructions.or(base.instructions),
        allowed_tools: override_rules.allowed_tools.or(base.allowed_tools),
        disallowed_tools: override_rules.disallowed_tools.or(base.disallowed_tools),
        permission_mode: override_rules.permission_mode.or(base.permission_mode),
        model: override_rules.model.or(base.model),
        system_prompt: override_rules.system_prompt.or(base.system_prompt),
        custom_rules: match (base.custom_rules, override_rules.custom_rules) {
            (Some(mut b), Some(o)) => {
                b.extend(o);
                Some(b)
            }
            (b, o) => o.or(b),
        },
        memory: match (base.memory, override_rules.memory) {
            (Some(mut b), Some(o)) => {
                b.extend(o);
                Some(b)
            }
            (b, o) => o.or(b),
        },
    }
}
