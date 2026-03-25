use super::*;

fn build_auto_continue_system_prompt(config: &AutoContinuePayload) -> String {
    let mode_instruction = if config.fast_mode_enabled {
        "快速模式：优先产出可用结果，减少解释与冗余。"
    } else {
        "标准模式：兼顾可读性、完整性与发布可用性。"
    };
    let source = config
        .source
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document_canvas");

    format!(
        "{AUTO_CONTINUE_PROMPT_MARKER}\n\
执行来源：{source}\n\
执行要求：\n\
1. 当前任务是“基于已有文稿的续写”，不得重复已有内容。\n\
2. 从现有结尾自然衔接，保持原文语气、受众和主题方向。\n\
3. 续写长度：{}。\n\
4. 灵敏度（{}%）：{}。\n\
5. {}\n\
6. 输出正文时不要显式提及你看到了该策略配置。",
        config.length_instruction(),
        config.sensitivity,
        config.sensitivity_instruction(),
        mode_instruction,
    )
}

pub(crate) fn merge_system_prompt_with_auto_continue(
    base_prompt: Option<String>,
    auto_continue: Option<&AutoContinuePayload>,
) -> Option<String> {
    let Some(config) = auto_continue else {
        return base_prompt;
    };
    if !config.enabled {
        return base_prompt;
    }

    let auto_continue_prompt = build_auto_continue_system_prompt(config);

    match base_prompt {
        Some(base) => {
            if base.contains(AUTO_CONTINUE_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(auto_continue_prompt)
            } else {
                Some(format!("{base}\n\n{auto_continue_prompt}"))
            }
        }
        None => Some(auto_continue_prompt),
    }
}

fn build_elicitation_context_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let metadata = request_metadata?.as_object()?;
    let context = metadata.get("elicitation_context")?.as_object()?;
    let entries = context.get("entries")?.as_array()?;

    let rendered_entries = entries
        .iter()
        .filter_map(|entry| {
            let entry_object = entry.as_object()?;
            let label = entry_object
                .get("label")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let summary = entry_object
                .get("summary")
                .or_else(|| entry_object.get("value"))
                .and_then(render_elicitation_context_value)?;
            Some(format!("- {label}: {summary}"))
        })
        .collect::<Vec<_>>();

    if rendered_entries.is_empty() {
        return None;
    }

    let source = context
        .get("source")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("structured_form");
    let mode = context
        .get("mode")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("runtime_metadata");

    Some(format!(
        "{ELICITATION_CONTEXT_PROMPT_MARKER}\n\
来源：{source}\n\
模式：{mode}\n\
执行要求：\n\
1. 下列信息来自用户刚刚提交的结构化补充信息，视为当前已确认约束。\n\
2. 回答与后续执行时优先吸收这些信息，不要重复追问同一字段。\n\
3. 若仍缺关键信息，只追问尚未填写的最少字段。\n\
已确认信息：\n\
{}",
        rendered_entries.join("\n")
    ))
}

fn render_elicitation_context_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let normalized = text.trim();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized.to_string())
            }
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(boolean) => Some(if *boolean {
            "是".to_string()
        } else {
            "否".to_string()
        }),
        serde_json::Value::Array(items) => {
            let rendered = items
                .iter()
                .filter_map(render_elicitation_context_value)
                .collect::<Vec<_>>();
            if rendered.is_empty() {
                None
            } else {
                Some(rendered.join("、"))
            }
        }
        serde_json::Value::Object(object) => {
            let rendered = serde_json::to_string(object).ok()?;
            let normalized = rendered.trim();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized.to_string())
            }
        }
        serde_json::Value::Null => None,
    }
}

pub(crate) fn merge_system_prompt_with_elicitation_context(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(elicitation_prompt) = build_elicitation_context_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(ELICITATION_CONTEXT_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(elicitation_prompt)
            } else {
                Some(format!("{base}\n\n{elicitation_prompt}"))
            }
        }
        None => Some(elicitation_prompt),
    }
}

fn render_team_roles(role_items: &[serde_json::Value]) -> Vec<String> {
    role_items
        .iter()
        .filter_map(|value| {
            let object = value.as_object()?;
            let label = object
                .get("label")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let summary = object
                .get("summary")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("负责当前分工。");
            let role_id_suffix = object
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!(" / id: {value}"))
                .unwrap_or_default();
            let profile_suffix = object
                .get("profile_id")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!(" / profile: {value}"))
                .unwrap_or_default();
            let role_key_suffix = object
                .get("role_key")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| format!(" / roleKey: {value}"))
                .unwrap_or_default();
            let skill_suffix = object
                .get("skill_ids")
                .and_then(serde_json::Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .collect::<Vec<_>>()
                })
                .filter(|items| !items.is_empty())
                .map(|items| format!(" / skills: {}", items.join(", ")))
                .unwrap_or_default();

            Some(format!(
                "  - {label}：{summary}{role_id_suffix}{profile_suffix}{role_key_suffix}{skill_suffix}"
            ))
        })
        .collect()
}

pub(crate) fn build_team_preference_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let subagent_mode_enabled = extract_harness_bool(
        request_metadata,
        &["subagent_mode_enabled", "subagentModeEnabled"],
    )
    .unwrap_or(false);
    let preferred_team_preset_id = extract_harness_string(
        request_metadata,
        &["preferred_team_preset_id", "preferredTeamPresetId"],
    );
    let selected_team_source = extract_harness_string(
        request_metadata,
        &["selected_team_source", "selectedTeamSource"],
    );
    let selected_team_label = extract_harness_string(
        request_metadata,
        &["selected_team_label", "selectedTeamLabel"],
    );
    let selected_team_summary = extract_harness_string(
        request_metadata,
        &["selected_team_summary", "selectedTeamSummary"],
    );
    let selected_team_roles = extract_harness_array(
        request_metadata,
        &["selected_team_roles", "selectedTeamRoles"],
    );

    if !subagent_mode_enabled {
        return None;
    }

    let mut lines = vec![TEAM_PREFERENCE_PROMPT_MARKER.to_string()];
    if subagent_mode_enabled {
        lines.push(
            "- 当前 GUI 已开启 Team 模式，但只有在任务确实适合拆分、并行或隔离上下文时才进入 team。"
                .to_string(),
        );
    }

    if let Some(team_preset_id) = preferred_team_preset_id.as_deref() {
        let preset_label =
            builtin_team_preset_label_by_id(team_preset_id).unwrap_or(team_preset_id);
        lines.push(format!(
            "- 用户偏好的 Team Preset：{preset_label} ({team_preset_id})。"
        ));
        lines.push(
            "- 当你判断当前任务适合多代理时，优先沿用该 preset 的 profile / skill 组合去调用 spawn_agent。"
                .to_string(),
        );
    }

    if let Some(team_label) = selected_team_label.as_deref() {
        let source_suffix = selected_team_source
            .as_deref()
            .map(|source| format!(" / 来源：{source}"))
            .unwrap_or_default();
        lines.push(format!(
            "- 当前 GUI 已选 Team：{team_label}{source_suffix}。"
        ));
    }

    if let Some(team_summary) = selected_team_summary.as_deref() {
        lines.push(format!("- Team 摘要：{team_summary}"));
    }

    if let Some(role_items) = selected_team_roles {
        let rendered_roles = render_team_roles(role_items);
        if !rendered_roles.is_empty() {
            lines.push("- 当前 Team 角色参考：".to_string());
            lines.extend(rendered_roles);
            lines.push(
                "- 如果你决定调用 spawn_agent，请优先把上述 profile / roleKey / skillIds 映射到对应结构化字段；若该角色带有 id，优先同步写入 blueprintRoleId / blueprintRoleLabel，保持 GUI Team 画布与实际分工一致。"
                    .to_string(),
            );
        }
    }

    lines.push(
        "- spawn_agent 支持这些结构化字段：blueprintRoleId、blueprintRoleLabel、teamPresetId、profileId、profileName、roleKey、skillIds、skillDirectories、theme、systemOverlay、outputContract。"
            .to_string(),
    );
    lines.push(
        "- 如果任务简单、强依赖当前上下文或下一步立即阻塞在结果上，不要为了套用 preset 而滥用 team。"
            .to_string(),
    );
    lines.push(
        "- 主对话需要承担协调职责：说明为什么要拆分、谁先处理哪一部分，并在拿到子 agent 结果后主动汇总关键进展、风险和下一步。"
            .to_string(),
    );

    Some(lines.join("\n"))
}

pub(crate) fn merge_system_prompt_with_team_preference(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(team_prompt) = build_team_preference_system_prompt(request_metadata) else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(TEAM_PREFERENCE_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(team_prompt)
            } else {
                Some(format!("{base}\n\n{team_prompt}"))
            }
        }
        None => Some(team_prompt),
    }
}
