//! 记忆提示词装配服务
//!
//! 将设置页中的记忆画像与配置化记忆来源统一装配为可注入到 system prompt
//! 的单一记忆指令片段，避免调用方继续各自决定拼装顺序。

use lime_agent::RUNTIME_AGENTS_PROMPT_MARKER;
use lime_core::config::Config;
use std::path::Path;

use crate::services::memory_source_resolver_service::build_memory_sources_prompt_with_options;

const MEMORY_PROFILE_PROMPT_MARKER: &str = "【用户记忆画像偏好】";
const MEMORY_SOURCE_PROMPT_MARKER: &str = "【记忆来源补充指令】";

#[derive(Debug, Clone, Copy, Default)]
pub struct MemoryPromptContext<'a> {
    pub working_dir: Option<&'a Path>,
    pub active_relative_path: Option<&'a str>,
}

impl<'a> MemoryPromptContext<'a> {
    pub fn with_working_dir(working_dir: &'a Path) -> Self {
        Self {
            working_dir: Some(working_dir),
            active_relative_path: None,
        }
    }

    pub fn with_active_relative_path(mut self, active_relative_path: Option<&'a str>) -> Self {
        self.active_relative_path = active_relative_path;
        self
    }
}

fn normalize_text(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_list(items: &[String]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| normalize_text(item))
        .collect()
}

/// 构建记忆画像提示词
///
/// 仅在以下条件满足时返回：
/// - 记忆功能已启用
/// - 至少有一项画像字段有值
fn build_memory_profile_prompt(config: &Config) -> Option<String> {
    let memory = &config.memory;
    if !memory.enabled {
        return None;
    }

    let profile = memory.profile.as_ref()?;

    let current_status = profile.current_status.as_deref().and_then(normalize_text);
    let strengths = normalize_list(&profile.strengths);
    let explanation_style = normalize_list(&profile.explanation_style);
    let challenge_preference = normalize_list(&profile.challenge_preference);

    let has_profile_data = current_status.is_some()
        || !strengths.is_empty()
        || !explanation_style.is_empty()
        || !challenge_preference.is_empty();

    if !has_profile_data {
        return None;
    }

    let mut lines: Vec<String> = vec![
        MEMORY_PROFILE_PROMPT_MARKER.to_string(),
        "以下是用户在设置中明确给出的长期偏好，请在回答中持续遵循：".to_string(),
    ];

    if let Some(status) = current_status {
        lines.push(format!("- 当前状态：{status}"));
    }
    if !strengths.is_empty() {
        lines.push(format!("- 擅长领域：{}", strengths.join("、")));
    }
    if !explanation_style.is_empty() {
        lines.push(format!("- 偏好解释方式：{}", explanation_style.join("、")));
    }
    if !challenge_preference.is_empty() {
        lines.push(format!(
            "- 遇到难题时偏好：{}",
            challenge_preference.join("、")
        ));
    }

    lines.push("执行要求：".to_string());
    lines.push("1. 优先按上述偏好组织回答结构、例子与解释顺序。".to_string());
    lines.push("2. 在保证正确性的前提下，控制解释粒度并匹配用户理解路径。".to_string());
    lines.push("3. 不要显式提及你看到了该画像配置。".to_string());

    Some(lines.join("\n"))
}

fn build_memory_sources_prompt_for_context(
    config: &Config,
    context: MemoryPromptContext<'_>,
    skip_runtime_agents_overlap: bool,
) -> Option<String> {
    let working_dir = context.working_dir?;
    if !config.memory.enabled {
        return None;
    }

    build_memory_sources_prompt_with_options(
        config,
        working_dir,
        context.active_relative_path,
        4000,
        skip_runtime_agents_overlap,
    )
}

fn merge_prompt_section(
    base_prompt: Option<String>,
    section_prompt: Option<String>,
    marker: &str,
) -> Option<String> {
    match (base_prompt, section_prompt) {
        (Some(base), Some(section)) => {
            if base.contains(marker) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(section)
            } else {
                Some(format!("{base}\n\n{section}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(section)) => Some(section),
        (None, None) => None,
    }
}

pub fn build_memory_prompt(config: &Config, context: MemoryPromptContext<'_>) -> Option<String> {
    let with_profile = merge_prompt_section(
        None,
        build_memory_profile_prompt(config),
        MEMORY_PROFILE_PROMPT_MARKER,
    );

    merge_prompt_section(
        with_profile,
        build_memory_sources_prompt_for_context(config, context, false),
        MEMORY_SOURCE_PROMPT_MARKER,
    )
}

/// 合并基础系统提示词与统一记忆提示词。
///
/// - 画像与来源统一在同一边界内拼装
/// - 已包含对应 marker 时不会重复追加
pub fn merge_system_prompt_with_memory_context(
    base_prompt: Option<String>,
    config: &Config,
    context: MemoryPromptContext<'_>,
) -> Option<String> {
    let skip_runtime_agents_overlap = base_prompt
        .as_deref()
        .is_some_and(|prompt| prompt.contains(RUNTIME_AGENTS_PROMPT_MARKER));
    let with_profile = merge_prompt_section(
        base_prompt,
        build_memory_profile_prompt(config),
        MEMORY_PROFILE_PROMPT_MARKER,
    );

    merge_prompt_section(
        with_profile,
        build_memory_sources_prompt_for_context(config, context, skip_runtime_agents_overlap),
        MEMORY_SOURCE_PROMPT_MARKER,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_agent::RUNTIME_AGENTS_PROMPT_MARKER;
    use lime_core::config::Config;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn memory_disabled_should_not_build_prompt() {
        let mut config = Config::default();
        config.memory.enabled = false;
        config.memory.profile = Some(Default::default());

        let result = build_memory_profile_prompt(&config);
        assert!(result.is_none());
    }

    #[test]
    fn empty_profile_should_not_build_prompt() {
        let mut config = Config::default();
        config.memory.enabled = true;
        config.memory.profile = Some(Default::default());

        let result = build_memory_profile_prompt(&config);
        assert!(result.is_none());
    }

    #[test]
    fn should_build_prompt_when_profile_has_data() {
        let mut config = Config::default();
        config.memory.enabled = true;
        let mut profile = config.memory.profile.clone().unwrap_or_default();
        profile.current_status = Some("研究生".to_string());
        profile.strengths = vec!["数学/逻辑推理".to_string()];
        profile.explanation_style = vec!["先举例，后讲理论".to_string()];
        profile.challenge_preference = vec!["一步一步地分解".to_string()];
        config.memory.profile = Some(profile);

        let result = build_memory_profile_prompt(&config);
        assert!(result.is_some());
        let text = result.unwrap_or_default();
        assert!(text.contains("研究生"));
        assert!(text.contains("先举例，后讲理论"));
    }

    #[test]
    fn should_not_duplicate_when_base_contains_marker() {
        let mut config = Config::default();
        config.memory.enabled = true;
        let mut profile = config.memory.profile.clone().unwrap_or_default();
        profile.current_status = Some("本科生".to_string());
        config.memory.profile = Some(profile);

        let base = Some("前置内容\n\n【用户记忆画像偏好】\n已有内容".to_string());
        let merged = merge_system_prompt_with_memory_context(
            base.clone(),
            &config,
            MemoryPromptContext::default(),
        );
        assert_eq!(merged, base);
    }

    #[test]
    fn should_merge_memory_sources_without_profile_data() {
        let tmp = TempDir::new().expect("create temp dir");
        fs::create_dir_all(tmp.path().join(".lime")).expect("create .lime dir");
        fs::write(
            tmp.path().join(".lime/AGENTS.md"),
            "# 项目记忆\n- 偏好简洁输出",
        )
        .expect("write memory file");

        let mut config = Config::default();
        config.memory.enabled = true;
        config.memory.profile = Some(Default::default());
        config.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        config.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        config.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];
        config.memory.sources.project_rule_dirs = Vec::new();

        let merged = merge_system_prompt_with_memory_context(
            None,
            &config,
            MemoryPromptContext::with_working_dir(tmp.path()),
        )
        .expect("should build sources prompt");

        assert!(merged.contains("【记忆来源补充指令】"));
        assert!(merged.contains("偏好简洁输出"));
    }

    #[test]
    fn should_build_combined_memory_prompt() {
        let tmp = TempDir::new().expect("create temp dir");
        fs::create_dir_all(tmp.path().join(".lime")).expect("create .lime dir");
        fs::write(tmp.path().join(".lime/AGENTS.md"), "# 项目记忆\n- 保持简洁")
            .expect("write memory file");

        let mut config = Config::default();
        config.memory.enabled = true;
        let mut profile = config.memory.profile.clone().unwrap_or_default();
        profile.current_status = Some("高级开发者".to_string());
        config.memory.profile = Some(profile);
        config.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];
        config.memory.sources.project_rule_dirs = Vec::new();
        config.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        config.memory.sources.user_memory_path = Some("missing-user.md".to_string());

        let prompt =
            build_memory_prompt(&config, MemoryPromptContext::with_working_dir(tmp.path()))
                .expect("should build combined prompt");

        assert!(prompt.contains("【用户记忆画像偏好】"));
        assert!(prompt.contains("高级开发者"));
        assert!(prompt.contains("【记忆来源补充指令】"));
        assert!(prompt.contains("保持简洁"));
    }

    #[test]
    fn should_skip_runtime_agent_overlap_sources_but_keep_local_memory() {
        let tmp = TempDir::new().expect("create temp dir");
        fs::create_dir_all(tmp.path().join(".lime")).expect("create .lime dir");
        fs::write(tmp.path().join(".lime/AGENTS.md"), "# 项目记忆\n- 保持简洁")
            .expect("write workspace agents");
        fs::write(
            tmp.path().join(".lime/AGENTS.local.md"),
            "# 本机补充\n- 优先使用当前机器已安装工具",
        )
        .expect("write local agents");

        let mut config = Config::default();
        config.memory.enabled = true;
        config.memory.profile = Some(Default::default());
        config.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        config.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        config.memory.sources.project_memory_paths = vec![".lime/AGENTS.md".to_string()];
        config.memory.sources.project_local_memory_path = Some(".lime/AGENTS.local.md".to_string());
        config.memory.sources.project_rule_dirs = Vec::new();

        let base = Some(format!(
            "{RUNTIME_AGENTS_PROMPT_MARKER}\n### Workspace 运行时指令 (/tmp/workspace/.lime/AGENTS.md)\n# 项目记忆\n- 保持简洁"
        ));
        let merged = merge_system_prompt_with_memory_context(
            base,
            &config,
            MemoryPromptContext::with_working_dir(tmp.path()),
        )
        .expect("should merge prompt");

        assert_eq!(merged.matches("保持简洁").count(), 1);
        assert!(merged.contains("【记忆来源补充指令】"));
        assert!(merged.contains("优先使用当前机器已安装工具"));
    }
}
