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

fn extract_object_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .filter_map(|key| object.get(*key))
        .find_map(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn render_json_inline(value: Option<&serde_json::Value>) -> Option<String> {
    let rendered = serde_json::to_string(value?).ok()?;
    let normalized = rendered.trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn build_service_skill_launch_run_example(
    adapter_name: &str,
    args: Option<&serde_json::Value>,
    profile_key: Option<&str>,
    target_id: Option<&str>,
    content_id: Option<&str>,
    project_id: Option<&str>,
    save_title: Option<&str>,
) -> String {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "adapter_name".to_string(),
        serde_json::Value::String(adapter_name.to_string()),
    );
    payload.insert(
        "args".to_string(),
        args.cloned()
            .filter(|value| value.is_object())
            .unwrap_or_else(|| serde_json::json!({})),
    );

    if let Some(value) = profile_key.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "profile_key".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    if let Some(value) = target_id.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "target_id".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    if let Some(value) = content_id.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "content_id".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    if let Some(value) = project_id.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "project_id".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    if let Some(value) = save_title.filter(|value| !value.trim().is_empty()) {
        payload.insert(
            "save_title".to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }

    serde_json::Value::Object(payload).to_string()
}

fn build_service_skill_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    if let Some(prompt) = build_service_scene_launch_system_prompt(request_metadata) {
        return Some(prompt);
    }

    let launch = extract_harness_nested_object(
        request_metadata,
        &["service_skill_launch", "serviceSkillLaunch"],
    )?;
    let kind =
        extract_object_string(launch, &["kind"]).unwrap_or_else(|| "site_adapter".to_string());
    if kind != "site_adapter" {
        return None;
    }

    let adapter_name = extract_object_string(launch, &["adapter_name", "adapterName"])?;
    let skill_title = extract_object_string(launch, &["skill_title", "skillTitle"]);
    let save_mode = extract_object_string(launch, &["save_mode", "saveMode"])
        .unwrap_or_else(|| "project_resource".to_string());
    let save_title = extract_object_string(launch, &["save_title", "saveTitle"]);
    let content_id = extract_object_string(launch, &["content_id", "contentId"]);
    let project_id = extract_object_string(launch, &["project_id", "projectId"]);
    let args_json = render_json_inline(launch.get("args")).unwrap_or_else(|| "{}".to_string());
    let launch_readiness = launch
        .get("launch_readiness")
        .and_then(serde_json::Value::as_object);
    let readiness_status =
        launch_readiness.and_then(|value| extract_object_string(value, &["status"]));
    let readiness_message =
        launch_readiness.and_then(|value| extract_object_string(value, &["message"]));
    let readiness_hint = launch_readiness
        .and_then(|value| extract_object_string(value, &["report_hint", "reportHint"]));
    let launch_profile_key = launch_readiness
        .and_then(|value| extract_object_string(value, &["profile_key", "profileKey"]));
    let launch_target_id =
        launch_readiness.and_then(|value| extract_object_string(value, &["target_id", "targetId"]));
    let browser_assist =
        extract_harness_nested_object(request_metadata, &["browser_assist", "browserAssist"]);
    let browser_profile_key = browser_assist
        .and_then(|value| extract_object_string(value, &["profile_key", "profileKey"]));
    let resolved_profile_key = launch_profile_key.or(browser_profile_key);
    let run_example = build_service_skill_launch_run_example(
        &adapter_name,
        launch.get("args"),
        resolved_profile_key.as_deref(),
        launch_target_id.as_deref(),
        content_id.as_deref(),
        project_id.as_deref(),
        save_title.as_deref(),
    );

    let mut lines = vec![
        SERVICE_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自站点技能启动，不要把它当成普通聊天或纯文本分析。".to_string(),
        "- 第一步优先调用 lime_site_run，不要先停留在解释、总结或泛化检索。".to_string(),
        "- 在 lime_site_run 完成前，不要先用 WebSearch、research、webReader 一类通用检索/阅读工具替代执行。".to_string(),
        "- 在 lime_site_run 完成前，不要直接调用 mcp__lime-browser__browser_navigate、mcp__lime-browser__read_page、browser_navigate、browser_run_code、Playwright code 或其他 mcp__lime-browser__* / browser_* 底层浏览器工具。".to_string(),
        "- lime_site_run 的参数必须是一个严格 JSON 对象；不要写注释、不要漏引号、不要输出半截对象，也不要把整个 JSON 再包成字符串。".to_string(),
        format!("- 当前站点适配器：{adapter_name}。"),
        format!("- 当前执行参数(JSON)：{args_json}。"),
        format!("- 第一工具调用示例(lime_site_run 参数 JSON)：{run_example}。"),
        format!("- 当前保存模式：{save_mode}。"),
        format!(
            "- 当前技能标题：{}。",
            skill_title.unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前 project_id：{}。",
            project_id.unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前 content_id：{}。",
            content_id.unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前 save_title：{}。",
            save_title.unwrap_or_else(|| "未提供".to_string())
        ),
    ];

    if let Some(status) = readiness_status.as_deref() {
        lines.push(format!("- 浏览器会话检测状态：{status}。"));
    }
    if let Some(message) = readiness_message.as_deref() {
        lines.push(format!("- 浏览器会话检测说明：{message}"));
    }
    if let Some(hint) = readiness_hint.as_deref() {
        lines.push(format!("- 浏览器恢复提示：{hint}"));
    }
    if let Some(profile_key) = resolved_profile_key.as_deref() {
        lines.push(format!(
            "- 调用 lime_site_run 时必须显式透传 profile_key={profile_key}。"
        ));
    }
    if let Some(target_id) = launch_target_id.as_deref() {
        lines.push(format!(
            "- 调用 lime_site_run 时必须显式透传 target_id={target_id}。"
        ));
    }

    lines.push(
        "- 如果工具返回 attached_session_required、no_matching_context、登录受限或权限受限，不要伪造成功结果；直接说明当前缺少可执行的浏览器上下文，并要求用户先完成连接、登录或授权。".to_string(),
    );
    lines.push(
        "- 当前任务已经明确来自技能启动，不要再让用户额外确认“是否继续执行站点技能”。".to_string(),
    );
    lines.push(
        "- 只有在 lime_site_run 完成后，为了补充背景资料或交叉验证，才允许再决定是否追加 WebSearch 或其他通用检索工具。".to_string(),
    );

    Some(lines.join("\n"))
}

fn build_service_scene_launch_system_prompt(
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let context =
        super::service_skill_launch::extract_service_scene_launch_context(request_metadata)?;

    let mut lines = vec![
        SERVICE_SKILL_LAUNCH_PROMPT_MARKER.to_string(),
        "- 当前回合来自服务型场景启动，不要把它当成普通聊天或纯文本分析。".to_string(),
        "- 当前主链是“目录命中 + 本地 Agent 执行”；直接在当前回合使用可见的本地工具、技能和工作区能力完成任务。".to_string(),
        "- 不要调用 lime_run_service_skill；它只为历史兼容保留，不再代表 current 执行桥。".to_string(),
        "- 不要向用户汇报“已提交云端 / 正在云端处理中”，也不要再把 OEM Session Token、scene_base_url、tenant_id 当作当前执行前提。".to_string(),
        "- 优先依据当前 user_input、scene_key、skill_title、skill_summary 与 slot_values 直接推进任务；需要额外工具时，只选当前本地回合真正需要的那一个。".to_string(),
        format!("- 当前服务型技能 ID：{}。", context.service_skill_id),
        format!(
            "- 当前服务型技能标题：{}。",
            context
                .skill_title
                .clone()
                .unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前 scene_key：{}。",
            context
                .scene_key
                .clone()
                .unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前 command_prefix：{}。",
            context
                .command_prefix
                .clone()
                .unwrap_or_else(|| "未提供".to_string())
        ),
        format!(
            "- 当前入口来源：{}。",
            context
                .entry_source
                .clone()
                .unwrap_or_else(|| "slash_scene_command".to_string())
        ),
    ];

    match context.execution_kind.as_deref() {
        Some("automation_job") => lines.push(
            "- 当前 execution_kind=automation_job：本回合先产出首轮结果、调度建议或仍需补齐的信息；除非用户明确要求，不要伪造“任务已经开始自动运行”。"
                .to_string(),
        ),
        Some("native_skill") => lines.push(
            "- 当前 execution_kind=native_skill：若当前回合里已有明确的本地 Skill/工具入口可以直接完成任务，就优先复用；否则继续在当前本地回合完成，不要回退 compat 云桥。"
                .to_string(),
        ),
        _ => lines.push(
            "- 当前 execution_kind=agent_turn：直接在本地回合完成分析、生成、检索、整理与结果回写。"
                .to_string(),
        ),
    }

    if context.launch_kind == "cloud_scene" {
        lines.push(
            "- 当前 launch kind=cloud_scene 只是旧目录兼容输入；执行仍以本地 current 主链为准。"
                .to_string(),
        );
    }

    if let Some(value) = context.user_input.as_deref() {
        lines.push(format!("- 当前补充要求：{value}"));
    } else if let Some(value) = context.raw_text.as_deref() {
        lines.push(format!("- 当前原始指令：{value}"));
    }
    if let Some(value) = context.project_id.as_deref() {
        lines.push(format!("- 当前 project_id：{value}。"));
    }
    if let Some(value) = context.content_id.as_deref() {
        lines.push(format!("- 当前 content_id：{value}。"));
    }
    if let Some(value) = context.skill_summary.as_deref() {
        lines.push(format!("- 当前技能说明：{value}"));
    }
    if let Some(value) = context.service_skill_key.as_deref() {
        lines.push(format!("- 当前服务型技能 key：{value}。"));
    }
    if let Some(value) = context.runner_type.as_deref() {
        lines.push(format!("- 当前 runner_type：{value}。"));
    }
    if let Some(value) = context.execution_kind.as_deref() {
        lines.push(format!("- 当前 execution_kind：{value}。"));
    }
    if let Some(value) = context.execution_location.as_deref() {
        lines.push(format!("- 当前 execution_location：{value}。"));
    }
    if let Some(value) = render_json_inline(context.slot_values.as_ref()) {
        lines.push(format!("- 当前 slot_values(JSON)：{value}。"));
    }
    if context.oem_runtime.scene_base_url.is_some()
        || context.oem_runtime.session_token.is_some()
        || context.oem_runtime.tenant_id.is_some()
    {
        lines.push(
            "- 当前 metadata 中仍带有旧 OEM 运行时字段；它们只再作为 compat 输入保留，不是 current 执行门槛。"
                .to_string(),
        );
    }

    Some(lines.join("\n"))
}

pub(crate) fn merge_system_prompt_with_service_skill_launch(
    base_prompt: Option<String>,
    request_metadata: Option<&serde_json::Value>,
) -> Option<String> {
    let Some(service_skill_prompt) = build_service_skill_launch_system_prompt(request_metadata)
    else {
        return base_prompt;
    };

    match base_prompt {
        Some(base) => {
            if base.contains(SERVICE_SKILL_LAUNCH_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(service_skill_prompt)
            } else {
                Some(format!("{base}\n\n{service_skill_prompt}"))
            }
        }
        None => Some(service_skill_prompt),
    }
}

fn truncate_prompt_text(value: String, max_chars: usize) -> String {
    let total_chars = value.chars().count();
    if total_chars <= max_chars {
        return value;
    }

    let truncated = value.chars().take(max_chars).collect::<String>();
    format!("{truncated}...(已截断，原始长度 {total_chars} 字)")
}

fn build_prompt_file_path(root: Option<&str>, path: &str) -> String {
    let normalized_path = path.trim().trim_start_matches(|ch| ch == '/' || ch == '\\');
    if normalized_path.is_empty() {
        return path.trim().to_string();
    }

    let Some(root) = root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches(|ch| ch == '/' || ch == '\\'))
    else {
        return normalized_path.to_string();
    };

    if root.is_empty() {
        normalized_path.to_string()
    } else {
        format!("{root}/{normalized_path}")
    }
}

fn build_markdown_bundle_translation_followup(
    execution: &ServiceSkillLaunchPreloadExecution,
) -> Vec<String> {
    if !execution.result.ok {
        return Vec::new();
    }

    let request_args = match execution.request.args.as_object() {
        Some(args) => args,
        None => return Vec::new(),
    };
    let Some(target_language) =
        extract_object_string(request_args, &["target_language", "targetLanguage"])
    else {
        return Vec::new();
    };

    let Some(saved_content) = execution.result.saved_content.as_ref() else {
        return Vec::new();
    };
    let Some(markdown_relative_path) = saved_content
        .markdown_relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };

    let export_kind = execution
        .result
        .data
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .and_then(|data| extract_object_string(data, &["export_kind", "exportKind"]));
    if export_kind.as_deref() != Some("markdown_bundle") {
        return Vec::new();
    }

    let markdown_path = build_prompt_file_path(
        saved_content.project_root_path.as_deref(),
        markdown_relative_path,
    );
    let mut lines = vec![
        format!("- 当前请求要求把已导出的 Markdown 正文翻译成{target_language}。"),
        format!("- 已保存的 Markdown 文件路径：{markdown_path}。"),
        "- 从这一刻起，本回合只允许新增 Read / Write / Edit 这类本地文件工具来处理已保存的 Markdown；不要再调用 lime_site_run，也不要转去 WebSearch、research、webReader、WebFetch 或其他通用网页工具。".to_string(),
        format!("- 必须先用 Read 读取 {markdown_path}，再把正文翻译成{target_language}。"),
        "- 翻译时必须保留 Markdown 结构、标题层级、列表、表格、引用、frontmatter（如果存在）、链接目标和相对图片路径。".to_string(),
        "- 代码块、内联代码、URL、图片路径、文件路径、命令行、API 名称默认保持原文，不要翻译。".to_string(),
        format!(
            "- 完成翻译后必须用 Write 覆写同一路径 {markdown_path}，不要另存为第二份摘要、HTML 或新的 artifact。"
        ),
        format!(
            "- 最终答复必须明确说明：已将导出的 Markdown 正文翻译成{target_language}并回写到 {markdown_path}。"
        ),
    ];

    if let Some(image_dir) = saved_content
        .images_relative_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!(
            "- 已保存的图片目录：{image_dir}。回写正文时不要破坏这些相对图片引用。"
        ));
    }

    lines
}

fn build_markdown_bundle_source_material_followup(
    execution: &ServiceSkillLaunchPreloadExecution,
) -> Vec<String> {
    if !execution.result.ok {
        return Vec::new();
    }

    let Some(saved_content) = execution.result.saved_content.as_ref() else {
        return Vec::new();
    };
    let Some(markdown_relative_path) = saved_content
        .markdown_relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Vec::new();
    };

    let export_kind = execution
        .result
        .data
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .and_then(|data| extract_object_string(data, &["export_kind", "exportKind"]));
    if export_kind.as_deref() != Some("markdown_bundle") {
        return Vec::new();
    }

    let markdown_path = build_prompt_file_path(
        saved_content.project_root_path.as_deref(),
        markdown_relative_path,
    );
    vec![
        format!("- 当前已导出的 Markdown bundle 位于 {markdown_path}。"),
        "- 这个 bundle 是系统侧采集得到的源材料，不默认等于用户要的最终交付结果。".to_string(),
        "- 如果用户当前目标是继续提炼、分析、改写、生成技能包、报告、方案、脚本或其他正式成果，必须先基于这份已保存的 Markdown 继续完成原任务，而不是只重复导出成功摘要。".to_string(),
        "- 后续处理优先使用本地文件工具(Read / Write / Edit / Glob)围绕已保存 bundle 展开；不要再次抓站点，也不要把保存路径、图片数量或采集摘要原样复述后就停止。".to_string(),
        "- 除非当前任务本身就是翻译、校对或回写源 Markdown，否则不要把 exports 下的源 bundle 直接当成最终结果目录；需要新增正式结果时，应另外写出真正可交付的工作区文件。".to_string(),
    ]
}

fn build_service_skill_launch_preload_prompt(
    execution: &ServiceSkillLaunchPreloadExecution,
) -> String {
    let request_summary = serde_json::json!({
        "adapter_name": execution.request.adapter_name.clone(),
        "args": execution.request.args.clone(),
        "profile_key": execution.request.profile_key.clone(),
        "target_id": execution.request.target_id.clone(),
        "timeout_ms": execution.request.timeout_ms,
        "content_id": execution.request.content_id.clone(),
        "project_id": execution.request.project_id.clone(),
        "save_title": execution.request.save_title.clone(),
        "require_attached_session": execution.request.require_attached_session,
        "skill_title": execution.request.skill_title.clone(),
    });
    let request_json = truncate_prompt_text(
        serde_json::to_string(&request_summary).unwrap_or_else(|_| "{}".to_string()),
        4_000,
    );
    let result_summary = serde_json::json!({
        "ok": execution.result.ok,
        "adapter": execution.result.adapter.clone(),
        "profile_key": execution.result.profile_key.clone(),
        "session_id": execution.result.session_id.clone(),
        "target_id": execution.result.target_id.clone(),
        "entry_url": execution.result.entry_url.clone(),
        "source_url": execution.result.source_url.clone(),
        "data": execution.result.data.clone(),
        "error_code": execution.result.error_code.clone(),
        "error_message": execution.result.error_message.clone(),
        "auth_hint": execution.result.auth_hint.clone(),
        "report_hint": execution.result.report_hint.clone(),
        "saved_content": execution.result.saved_content.clone(),
        "saved_project_id": execution.result.saved_project_id.clone(),
    });
    let result_json = truncate_prompt_text(
        serde_json::to_string(&result_summary).unwrap_or_else(|_| "{}".to_string()),
        12_000,
    );
    let adapter_name = execution
        .adapter
        .as_ref()
        .map(|adapter| adapter.name.clone())
        .unwrap_or_else(|| execution.request.adapter_name.clone());
    let adapter_description = execution
        .adapter
        .as_ref()
        .map(|adapter| adapter.description.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "未提供".to_string());
    let execution_requirement = if execution.result.ok {
        "- 站点技能已经在系统侧预执行成功。请直接基于下面的结构化结果完成答复，不要再次调用 lime_site_run，也不要回退到 mcp 浏览器工具、webReader、WebFetch、WebSearch、research 或其他通用网页阅读/检索工具。".to_string()
    } else {
        "- 站点技能已经在系统侧预执行，但执行失败。请直接根据失败结果向用户说明缺少的浏览器上下文、登录态或权限，不要伪造采集成功，也不要再次尝试调用 lime_site_run、mcp__lime-browser__*、browser_*、webReader、WebFetch、WebSearch、research 或其他通用网页阅读/检索工具。".to_string()
    };
    let failure_contract = match execution.result.error_code.as_deref() {
        Some("attached_session_required") => {
            "- 当前失败类型为 attached_session_required：必须明确告诉用户先连接并附着到目标站点页面，再重试当前技能。".to_string()
        }
        Some("no_matching_context") => {
            "- 当前失败类型为 no_matching_context：必须告诉用户先把浏览器切到目标站点或正确页面，再重试当前技能。".to_string()
        }
        _ => "- 如果用户追问失败原因，优先引用 error_code / error_message / report_hint / auth_hint，而不是自行编造执行细节。".to_string(),
    };
    let mut lines = vec![
        SERVICE_SKILL_LAUNCH_PRELOAD_PROMPT_MARKER.to_string(),
        execution_requirement,
        failure_contract,
        format!("- 当前适配器：{adapter_name}。"),
        format!("- 当前适配器说明：{adapter_description}"),
        format!("- 已预执行请求(JSON)：{request_json}。"),
        format!("- 已预执行结果(JSON)：{result_json}。"),
    ];
    lines.extend(build_markdown_bundle_source_material_followup(execution));
    lines.extend(build_markdown_bundle_translation_followup(execution));
    lines.push(
        "- 除非用户明确要求“重跑一次 / 换关键词 / 换筛选条件 / 重新抓取”，否则本回合不要再次调用任何站点执行工具。"
            .to_string(),
    );
    lines.join("\n")
}

pub(crate) fn merge_system_prompt_with_service_skill_launch_preload(
    base_prompt: Option<String>,
    execution: Option<&ServiceSkillLaunchPreloadExecution>,
) -> Option<String> {
    let Some(execution) = execution else {
        return base_prompt;
    };
    let preload_prompt = build_service_skill_launch_preload_prompt(execution);

    match base_prompt {
        Some(base) => {
            if base.contains(SERVICE_SKILL_LAUNCH_PRELOAD_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(preload_prompt)
            } else {
                Some(format!("{base}\n\n{preload_prompt}"))
            }
        }
        None => Some(preload_prompt),
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

fn render_team_memory_shadow_content(content: &str) -> Option<String> {
    let normalized_lines = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(6)
        .collect::<Vec<_>>();
    if normalized_lines.is_empty() {
        return None;
    }

    let joined = normalized_lines.join(" | ");
    let rendered = if joined.chars().count() > 320 {
        let truncated = joined.chars().take(320).collect::<String>();
        format!("{truncated}...")
    } else {
        joined
    };

    Some(rendered)
}

fn render_team_memory_shadow_entries(
    request_metadata: Option<&serde_json::Value>,
) -> Option<(Option<String>, Vec<String>)> {
    let shadow = extract_harness_nested_object(
        request_metadata,
        &["team_memory_shadow", "teamMemoryShadow"],
    )?;
    let repo_scope = extract_object_string(shadow, &["repo_scope", "repoScope"]);
    let entries = shadow.get("entries")?.as_array()?;

    let rendered_entries = entries
        .iter()
        .filter_map(|value| {
            let object = value.as_object()?;
            let key = extract_object_string(object, &["key"])?;
            let content = extract_object_string(object, &["content"])?;
            let updated_at_suffix = object
                .get("updated_at")
                .or_else(|| object.get("updatedAt"))
                .and_then(serde_json::Value::as_i64)
                .map(|value| format!(" / updatedAt: {value}"))
                .unwrap_or_default();
            let rendered_content = render_team_memory_shadow_content(&content)?;
            Some(format!("  - {key}{updated_at_suffix}: {rendered_content}"))
        })
        .collect::<Vec<_>>();

    if rendered_entries.is_empty() {
        return None;
    }

    Some((repo_scope, rendered_entries))
}

pub(crate) fn build_team_preference_system_prompt(
    request_metadata: Option<&serde_json::Value>,
    session_recent_team_selection: Option<&lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
    subagent_mode_enabled: bool,
) -> Option<String> {
    let request_has_team_selection = extract_harness_string(
        request_metadata,
        &["preferred_team_preset_id", "preferredTeamPresetId"],
    )
    .is_some()
        || extract_harness_string(request_metadata, &["selected_team_id", "selectedTeamId"])
            .is_some()
        || extract_harness_string(
            request_metadata,
            &["selected_team_source", "selectedTeamSource"],
        )
        .is_some()
        || extract_harness_string(
            request_metadata,
            &["selected_team_label", "selectedTeamLabel"],
        )
        .is_some()
        || extract_harness_string(
            request_metadata,
            &["selected_team_summary", "selectedTeamSummary"],
        )
        .is_some()
        || extract_harness_array(
            request_metadata,
            &["selected_team_roles", "selectedTeamRoles"],
        )
        .is_some();

    let preferred_team_preset_id = if request_has_team_selection {
        extract_harness_string(
            request_metadata,
            &["preferred_team_preset_id", "preferredTeamPresetId"],
        )
    } else {
        session_recent_team_selection
            .and_then(|selection| selection.preferred_team_preset_id.clone())
    };
    let selected_team_source = if request_has_team_selection {
        extract_harness_string(
            request_metadata,
            &["selected_team_source", "selectedTeamSource"],
        )
    } else {
        session_recent_team_selection.and_then(|selection| selection.selected_team_source.clone())
    };
    let selected_team_label = if request_has_team_selection {
        extract_harness_string(
            request_metadata,
            &["selected_team_label", "selectedTeamLabel"],
        )
    } else {
        session_recent_team_selection.and_then(|selection| selection.selected_team_label.clone())
    };
    let selected_team_summary = if request_has_team_selection {
        extract_harness_string(
            request_metadata,
            &["selected_team_summary", "selectedTeamSummary"],
        )
    } else {
        session_recent_team_selection.and_then(|selection| selection.selected_team_summary.clone())
    };
    let selected_team_roles = if request_has_team_selection {
        extract_harness_array(
            request_metadata,
            &["selected_team_roles", "selectedTeamRoles"],
        )
        .cloned()
        .filter(|roles| !roles.is_empty())
    } else {
        session_recent_team_selection
            .and_then(|selection| selection.selected_team_roles.as_ref())
            .map(|roles| {
                roles
                    .iter()
                    .map(|role| {
                        serde_json::json!({
                            "id": role.id,
                            "label": role.label,
                            "summary": role.summary,
                            "profile_id": role.profile_id,
                            "role_key": role.role_key,
                            "skill_ids": role.skill_ids,
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|roles| !roles.is_empty())
    };

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
            "- 当你判断当前任务适合多代理时，优先沿用该 preset 的 profile / skill 组合去调用 Agent。"
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

    if let Some(role_items) = selected_team_roles.as_ref() {
        let rendered_roles = render_team_roles(role_items);
        if !rendered_roles.is_empty() {
            lines.push("- 当前 Team 角色参考：".to_string());
            lines.extend(rendered_roles);
            lines.push(
                "- 如果你决定调用 Agent，请优先把上述角色信息映射到对应结构化字段，例如 description / subagent_type / name / team_name；需要保留 Team 蓝图角色锚点时，再补充 blueprintRoleId / profile_id / role_key / skill_ids，保持 GUI Team 画布与实际分工一致。"
                    .to_string(),
            );
        }
    }

    if let Some((repo_scope, rendered_shadow_entries)) =
        render_team_memory_shadow_entries(request_metadata)
    {
        lines.push("- 当前项目的 repo-scoped Team 协作记忆（低优先级参考）：".to_string());
        if let Some(repo_scope) = repo_scope.as_deref() {
            lines.push(format!("  - repoScope: {repo_scope}"));
        }
        lines.extend(rendered_shadow_entries);
        lines.push(
            "- 上述 shadow 只代表当前仓库最近一次 Team 协作痕迹；如与本次显式 selected Team、Team Preset 或当前任务意图冲突，以本次请求为准。"
                .to_string(),
        );
    }

    lines.push(
        "- Agent 支持这些结构化字段：description、prompt、subagent_type、model、run_in_background、name、team_name（别名 teamName）、reasoning_effort、fork_context、blueprint_role_id（别名 blueprintRoleId）、blueprint_role_label、profile_id、profile_name、role_key、skill_ids、skill_directories、team_preset_id、theme、system_overlay、output_contract、cwd、mode、isolation。team_name 需要与 name 搭配，并依附现有 team 上下文；当前 runtime 对 mode 只支持 default / acceptEdits / dontAsk 子集，plan / bypassPermissions 仍会被拒绝；isolation 当前只支持 worktree，remote 仍会被拒绝，且 cwd 目前不能与 worktree 同时使用。"
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
    session_recent_team_selection: Option<&lime_agent::SessionExecutionRuntimeRecentTeamSelection>,
    subagent_mode_enabled: bool,
) -> Option<String> {
    let Some(team_prompt) = build_team_preference_system_prompt(
        request_metadata,
        session_recent_team_selection,
        subagent_mode_enabled,
    ) else {
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
