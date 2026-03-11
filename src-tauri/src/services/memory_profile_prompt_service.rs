//! 记忆画像提示词服务
//!
//! 将设置页中的记忆画像（学习状态、擅长领域、解释偏好、难题偏好）
//! 转换为可注入到系统提示词中的统一指令片段。

use proxycast_core::config::Config;
use std::path::Path;

use crate::services::memory_source_resolver_service::build_memory_sources_prompt;

const MEMORY_PROFILE_PROMPT_MARKER: &str = "【用户记忆画像偏好】";
const MEMORY_SOURCE_PROMPT_MARKER: &str = "【记忆来源补充指令】";

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
pub fn build_memory_profile_prompt(config: &Config) -> Option<String> {
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

/// 合并基础系统提示词与记忆画像提示词
///
/// - 已包含画像标记时不会重复追加
/// - 任一方为空时返回另一方
pub fn merge_system_prompt_with_memory_profile(
    base_prompt: Option<String>,
    config: &Config,
) -> Option<String> {
    let memory_prompt = build_memory_profile_prompt(config);

    match (base_prompt, memory_prompt) {
        (Some(base), Some(memory)) => {
            if base.contains(MEMORY_PROFILE_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(memory)
            } else {
                Some(format!("{base}\n\n{memory}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(memory)) => Some(memory),
        (None, None) => None,
    }
}

pub fn merge_system_prompt_with_memory_sources(
    base_prompt: Option<String>,
    config: &Config,
    working_dir: &Path,
    active_relative_path: Option<&str>,
) -> Option<String> {
    if !config.memory.enabled {
        return base_prompt;
    }

    let memory_sources_prompt =
        build_memory_sources_prompt(config, working_dir, active_relative_path, 4000);

    match (base_prompt, memory_sources_prompt) {
        (Some(base), Some(source_prompt)) => {
            if base.contains(MEMORY_SOURCE_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(source_prompt)
            } else {
                Some(format!("{base}\n\n{source_prompt}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(source_prompt)) => Some(source_prompt),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::config::Config;
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
        let merged = merge_system_prompt_with_memory_profile(base.clone(), &config);
        assert_eq!(merged, base);
    }

    #[test]
    fn should_merge_memory_sources_without_profile_data() {
        let tmp = TempDir::new().expect("create temp dir");
        fs::write(tmp.path().join("AGENTS.md"), "# 项目记忆\n- 偏好简洁输出")
            .expect("write memory file");

        let mut config = Config::default();
        config.memory.enabled = true;
        config.memory.profile = Some(Default::default());
        config.memory.sources.managed_policy_path = Some("missing-managed.md".to_string());
        config.memory.sources.user_memory_path = Some("missing-user.md".to_string());
        config.memory.sources.project_memory_paths = vec!["AGENTS.md".to_string()];
        config.memory.sources.project_rule_dirs = Vec::new();

        let merged = merge_system_prompt_with_memory_sources(None, &config, tmp.path(), None)
            .expect("should build sources prompt");

        assert!(merged.contains("【记忆来源补充指令】"));
        assert!(merged.contains("偏好简洁输出"));
    }
}
