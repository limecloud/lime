//! Rules 模块
//!
//! - 类型定义 (types)
//! - AGENTS.md 解析 (parser)
//! - 规则应用 (applier)

pub mod applier;
pub mod parser;
pub mod types;

#[cfg(test)]
mod tests;

// Re-exports
pub use applier::{
    apply_rules, create_agents_md_template, generate_system_prompt_addition, init_agents_md,
};
pub use parser::{
    extract_rules, find_agents_md, find_settings_files, load_project_rules, parse_agents_md,
};
pub use types::{AgentsMdSection, CustomRule, ProjectRules, RuleAction, RuleApplyResult};
