//! Artifact Workbench 提示词装配服务
//!
//! 统一根据 turn metadata 组装 Artifact 交付策略、来源策略与阶段合同，
//! 避免前端或 runtime_turn 直接散落拼接规则。

use serde_json::Value;

const ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER: &str = "【Artifact 交付策略】";
const ARTIFACT_SOURCE_POLICY_PROMPT_MARKER: &str = "【Artifact 来源策略】";
const ARTIFACT_STAGE1_PROMPT_MARKER: &str = "【Artifact Stage 1 合同】";
const ARTIFACT_STAGE2_PROMPT_MARKER: &str = "【Artifact Stage 2 合同】";
const ARTIFACT_REWRITE_PROMPT_MARKER: &str = "【Artifact Rewrite 合同】";
const ARTIFACT_SCHEMA_HINT_PROMPT_MARKER: &str = "【Artifact 输出 Schema 提示】";
const ARTIFACT_DOCUMENT_SCHEMA_VERSION: &str = "artifact_document.v1";
const ARTIFACT_ALLOWED_BLOCKS: &[&str] = &[
    "section_header",
    "hero_summary",
    "key_points",
    "rich_text",
    "callout",
    "table",
    "checklist",
    "metric_grid",
    "quote",
    "citation_list",
    "image",
    "code_block",
    "divider",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ArtifactPromptContext {
    mode: Option<String>,
    kind: Option<String>,
    stage: Option<String>,
    source_policy: Option<String>,
    workbench_surface: Option<String>,
    request_id: Option<String>,
    target_block_id: Option<String>,
    rewrite_instruction: Option<String>,
}

fn normalize_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_artifact_object(
    request_metadata: Option<&Value>,
) -> Option<&serde_json::Map<String, Value>> {
    let metadata = request_metadata?;
    let object = metadata.as_object()?;
    if let Some(artifact) = object.get("artifact").and_then(Value::as_object) {
        return Some(artifact);
    }
    Some(object)
}

fn extract_artifact_string(request_metadata: Option<&Value>, keys: &[&str]) -> Option<String> {
    let artifact = extract_artifact_object(request_metadata)?;
    keys.iter()
        .filter_map(|key| artifact.get(*key))
        .find_map(Value::as_str)
        .and_then(|value| normalize_text(Some(value)))
}

fn build_artifact_prompt_context(
    request_metadata: Option<&Value>,
) -> Option<ArtifactPromptContext> {
    let context = ArtifactPromptContext {
        mode: extract_artifact_string(request_metadata, &["artifact_mode", "artifactMode"]),
        kind: extract_artifact_string(request_metadata, &["artifact_kind", "artifactKind"]),
        stage: extract_artifact_string(request_metadata, &["artifact_stage", "artifactStage"]),
        source_policy: extract_artifact_string(
            request_metadata,
            &["source_policy", "sourcePolicy"],
        ),
        workbench_surface: extract_artifact_string(
            request_metadata,
            &["workbench_surface", "workbenchSurface"],
        ),
        request_id: extract_artifact_string(
            request_metadata,
            &["artifact_request_id", "artifactRequestId"],
        ),
        target_block_id: extract_artifact_string(
            request_metadata,
            &["artifact_target_block_id", "artifactTargetBlockId"],
        ),
        rewrite_instruction: extract_artifact_string(
            request_metadata,
            &["artifact_rewrite_instruction", "artifactRewriteInstruction"],
        ),
    };

    let has_meaningful_fields = [
        context.mode.as_ref(),
        context.kind.as_ref(),
        context.stage.as_ref(),
        context.source_policy.as_ref(),
        context.workbench_surface.as_ref(),
        context.request_id.as_ref(),
        context.target_block_id.as_ref(),
        context.rewrite_instruction.as_ref(),
    ]
    .iter()
    .any(|value| value.is_some());

    if has_meaningful_fields {
        Some(context)
    } else {
        None
    }
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

fn build_artifact_delivery_prompt(context: &ArtifactPromptContext) -> Option<String> {
    if matches!(context.mode.as_deref(), Some("none")) {
        return None;
    }

    let mut lines = vec![ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER.to_string()];
    match context.mode.as_deref() {
        Some("rewrite") => {
            lines
                .push("- 当前回合是对现有 Artifact 的定向改写，不是一次普通聊天回复。".to_string());
        }
        _ => {
            lines.push("- 当前回合需要进入 Artifact Workbench 正式交付链。".to_string());
        }
    }

    if let Some(kind) = context.kind.as_deref() {
        lines.push(format!("- 目标交付物类型：{kind}。"));
    }
    if let Some(surface) = context.workbench_surface.as_deref() {
        lines.push(format!("- 主要承载面：{surface}。"));
    }
    if let Some(request_id) = context.request_id.as_deref() {
        lines.push(format!("- 本轮 artifact request id：{request_id}。"));
    }

    lines.push("执行要求：".to_string());
    lines.push(
        "1. 消息区只保留进度、结论、缺口与下一步，不要把整篇正式产物再贴回消息区。".to_string(),
    );
    lines.push("2. 只要需要正式交付物，优先通过文件写入或 write_file 工具把结果落到工作区，以便右侧 Artifact Workbench 实时预览。".to_string());
    lines.push(
        "3. 正式交付物优先使用 ArtifactDocument v1 JSON，而不是自由 Markdown 长文。".to_string(),
    );
    lines.push("4. 如果信息不足以完成正式交付，先明确缺口，再产出最稳妥的结构化草稿。".to_string());

    Some(lines.join("\n"))
}

fn build_artifact_source_policy_prompt(context: &ArtifactPromptContext) -> Option<String> {
    let source_policy = context.source_policy.as_deref()?;
    let policy_text = match source_policy {
        "required" => "本轮来源为强约束。关键结论、比较和事实判断必须绑定 sources，不要编造来源。",
        "preferred" => "本轮来源为软约束。有真实来源时应尽量保留 sources，没有就明确说明来源不足。",
        "none" => "本轮来源不是硬门槛，但仍然禁止伪造来源或把推断冒充成已验证事实。",
        _ => return None,
    };

    Some(format!(
        "{ARTIFACT_SOURCE_POLICY_PROMPT_MARKER}\n\
- source_policy：{source_policy}\n\
- {policy_text}"
    ))
}

fn build_artifact_stage_prompt(context: &ArtifactPromptContext) -> Option<String> {
    let stage = context
        .stage
        .as_deref()
        .or(context.mode.as_deref())
        .unwrap_or("stage2");

    match stage {
        "stage1" => Some(format!(
            "{ARTIFACT_STAGE1_PROMPT_MARKER}\n\
执行目标：\n\
1. 判断是否需要正式 Artifact。\n\
2. 锁定 kind、标题、source policy、section outline 与 block plan。\n\
3. 标出当前缺口、假设与风险。\n\
禁止项：\n\
1. 不要直接写完整正文。\n\
2. 不要输出 HTML / CSS / 视觉样式说明。\n\
3. 不要在消息区和交付区重复粘贴同一份长文。\
"
        )),
        "rewrite" => {
            let mut lines = vec![ARTIFACT_REWRITE_PROMPT_MARKER.to_string()];
            lines.push(
                "- 当前回合只改写指定 Artifact 范围，除非明确要求，不要重写整份文档。".to_string(),
            );
            if let Some(target_block_id) = context.target_block_id.as_deref() {
                lines.push(format!("- 目标 block：{target_block_id}。"));
            }
            if let Some(instruction) = context.rewrite_instruction.as_deref() {
                lines.push(format!("- 改写指令：{instruction}"));
            }
            lines.push("执行要求：".to_string());
            lines.push(
                "1. 优先输出 `artifact_rewrite_patch`；如果更适合 current 主链，也只允许输出 rewrite 专用单条 incremental op：`artifact.source.upsert / artifact.block.upsert / artifact.complete / artifact.fail`；只有兼容旧链路时才回退到 `artifact_ops`。".to_string(),
            );
            lines.push(
                "2. 如果提供了目标 block，则不要改写其他 block，也不要借机重排整个文档结构。"
                    .to_string(),
            );
            lines.push("3. 保留原有结构与来源绑定，优先最小改动。".to_string());
            lines.push("4. 若局部改写无法满足要求，再明确说明需要扩大的范围。".to_string());
            Some(lines.join("\n"))
        }
        _ => Some(format!(
            "{ARTIFACT_STAGE2_PROMPT_MARKER}\n\
执行目标：\n\
1. 输出正式结构化交付物草稿。\n\
2. 初次生成可输出 `artifact_document_draft`；对已有文档做增量补充时优先输出正式单条 op：`artifact.begin / artifact.meta.patch / artifact.source.upsert / artifact.block.upsert / artifact.block.remove / artifact.complete / artifact.fail`；仅兼容旧链路时才回退到 `artifact_ops`。\n\
3. 交付物必须满足 ArtifactDocument v1。\n\
4. block 类型只能来自白名单，不要自由发明新 block。\n\
5. 若已知 sources，应挂到 sources[] 并让 block.sourceIds 指向已有来源。"
        )),
    }
}

fn build_artifact_schema_hint_prompt(context: &ArtifactPromptContext) -> Option<String> {
    if matches!(context.mode.as_deref(), Some("none"))
        || matches!(context.stage.as_deref(), Some("stage1"))
    {
        return None;
    }

    let is_rewrite = matches!(
        context.stage.as_deref().or(context.mode.as_deref()),
        Some("rewrite")
    );
    let output_contract = if is_rewrite {
        "本轮优先输出 `artifact_rewrite_patch`；也允许输出 rewrite 专用正式单条 op envelope（仅 `artifact.source.upsert / artifact.block.upsert / artifact.complete / artifact.fail`）；仅兼容情况下才回退到 `artifact_ops`，不要返回整篇 `artifact_document_draft`。"
    } else {
        "本轮可以输出 `artifact_document_draft`；若做增量补充，优先输出正式单条 op envelope，兼容情况下也可回退到 `artifact_ops`。"
    };
    let shape_hint = if is_rewrite {
        "`artifact_rewrite_patch` 顶层字段优先包含：type、artifactId、targetBlockId、block\n- 可选补充 `source / sources / summary / status`\n- 若使用正式单条 op，仅允许 `artifact.source.upsert / artifact.block.upsert / artifact.complete / artifact.fail`，顶层字段包含：type、artifactId，以及 source / block / summary / reason 中对应字段\n- 只有兼容旧链路时才回退到 `artifact_ops`\n- 若存在 target block，schema 与运行时都会限制改写范围，只允许命中该 block"
    } else {
        "顶层字段优先包含：artifactId、kind、title、status、language、summary、blocks、sources、metadata\n- 若使用正式单条 op，顶层字段包含：type、artifactId，以及 block / source / patch / blockId / summary / reason 中对应字段\n- 若需兼容旧链路，也可回退到 `artifact_ops`，其顶层字段包含：type、artifactId、ops"
    };
    let example = if is_rewrite {
        "Patch 示例：\n{\n  \
\"type\": \"artifact_rewrite_patch\",\n  \
\"artifactId\": \"artifact-demo\",\n  \
\"targetBlockId\": \"body-1\",\n  \
\"block\": { \"id\": \"body-1\", \"type\": \"rich_text\", \"contentFormat\": \"markdown\", \"content\": \"改写后的正文\" },\n  \
\"summary\": \"把正文改成更适合董事会的措辞\"\n\
}\n\n\
单条 op 示例：\n{\n  \
\"type\": \"artifact.block.upsert\",\n  \
\"artifactId\": \"artifact-demo\",\n  \
\"block\": { \"id\": \"body-1\", \"type\": \"rich_text\", \"contentFormat\": \"markdown\", \"content\": \"改写后的正文\" }\n\
}"
    } else {
        "草稿示例：\n{\n  \
\"type\": \"artifact_document_draft\",\n  \
\"document\": {\n    \
\"schemaVersion\": \"artifact_document.v1\",\n    \
\"kind\": \"report\",\n    \
\"title\": \"示例标题\",\n    \
\"status\": \"ready\",\n    \
\"language\": \"zh-CN\",\n    \
\"summary\": \"一句话摘要\",\n    \
\"blocks\": [\n      \
{ \"id\": \"hero-1\", \"type\": \"hero_summary\", \"summary\": \"核心结论\" },\n      \
{ \"id\": \"body-1\", \"type\": \"rich_text\", \"contentFormat\": \"markdown\", \"content\": \"正文内容\" }\n    \
],\n    \
\"sources\": [\n      \
{ \"id\": \"source-1\", \"type\": \"web\", \"label\": \"OpenAI Blog\", \"locator\": { \"url\": \"https://openai.com\" }, \"snippet\": \"来源摘录\" }\n    \
],\n    \
\"metadata\": {}\n  \
}\n\
}\n\n\
增量示例：\n{\n  \
\"type\": \"artifact.block.upsert\",\n  \
\"artifactId\": \"artifact-demo\",\n  \
\"block\": { \"id\": \"body-1\", \"type\": \"rich_text\", \"contentFormat\": \"markdown\", \"content\": \"补充后的正文\" }\n\
}"
    };

    Some(format!(
        "{ARTIFACT_SCHEMA_HINT_PROMPT_MARKER}\n\
{output_contract}\n\
本轮正式交付物优先满足以下结构：\n\
- schemaVersion 必须为 `{ARTIFACT_DOCUMENT_SCHEMA_VERSION}`\n\
- {shape_hint}\n\
- blocks 至少 1 个，允许的 block 类型只有：{allowed_blocks}\n\
- rich_text 可以承载 markdown 或编辑器 JSON，但文档顶层不能退化成整篇无结构长文\n\n\
最小可用示例（你的输出必须是这种 JSON 结构，不要包裹在 markdown code fence 中）：\n\
{example}",
        allowed_blocks = ARTIFACT_ALLOWED_BLOCKS.join(", ")
    ))
}

pub fn merge_system_prompt_with_artifact_context(
    base_prompt: Option<String>,
    request_metadata: Option<&Value>,
) -> Option<String> {
    let Some(context) = build_artifact_prompt_context(request_metadata) else {
        return base_prompt;
    };

    let with_delivery = merge_prompt_section(
        base_prompt,
        build_artifact_delivery_prompt(&context),
        ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER,
    );
    let with_sources = merge_prompt_section(
        with_delivery,
        build_artifact_source_policy_prompt(&context),
        ARTIFACT_SOURCE_POLICY_PROMPT_MARKER,
    );
    let with_stage = merge_prompt_section(
        with_sources,
        build_artifact_stage_prompt(&context),
        if matches!(context.stage.as_deref(), Some("stage1")) {
            ARTIFACT_STAGE1_PROMPT_MARKER
        } else if matches!(
            context.stage.as_deref().or(context.mode.as_deref()),
            Some("rewrite")
        ) {
            ARTIFACT_REWRITE_PROMPT_MARKER
        } else {
            ARTIFACT_STAGE2_PROMPT_MARKER
        },
    );

    merge_prompt_section(
        with_stage,
        build_artifact_schema_hint_prompt(&context),
        ARTIFACT_SCHEMA_HINT_PROMPT_MARKER,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_ignore_empty_artifact_metadata() {
        let merged = merge_system_prompt_with_artifact_context(None, None);
        assert!(merged.is_none());
    }

    #[test]
    fn should_build_draft_prompt_sections() {
        let metadata = serde_json::json!({
            "artifact": {
                "artifact_mode": "draft",
                "artifact_kind": "report",
                "artifact_stage": "stage2",
                "source_policy": "required",
                "workbench_surface": "right_panel"
            }
        });

        let merged =
            merge_system_prompt_with_artifact_context(None, Some(&metadata)).unwrap_or_default();

        assert!(merged.contains(ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER));
        assert!(merged.contains(ARTIFACT_SOURCE_POLICY_PROMPT_MARKER));
        assert!(merged.contains(ARTIFACT_STAGE2_PROMPT_MARKER));
        assert!(merged.contains(ARTIFACT_SCHEMA_HINT_PROMPT_MARKER));
        assert!(merged.contains("ArtifactDocument v1"));
        assert!(merged.contains("artifact.block.upsert"));
        assert!(merged.contains("artifact_ops"));
    }

    #[test]
    fn should_build_rewrite_prompt() {
        let metadata = serde_json::json!({
            "artifact": {
                "artifact_mode": "rewrite",
                "artifact_stage": "rewrite",
                "artifact_target_block_id": "block-3",
                "artifact_rewrite_instruction": "把语言改得更适合董事会"
            }
        });

        let merged =
            merge_system_prompt_with_artifact_context(None, Some(&metadata)).unwrap_or_default();

        assert!(merged.contains(ARTIFACT_REWRITE_PROMPT_MARKER));
        assert!(merged.contains("block-3"));
        assert!(merged.contains("更适合董事会"));
        assert!(merged.contains("artifact_rewrite_patch"));
        assert!(merged.contains("artifact.source.upsert"));
        assert!(merged.contains("artifact.block.upsert"));
        assert!(merged.contains("artifact_ops"));
        assert!(!merged.contains("artifact.begin"));
        assert!(!merged.contains("artifact.meta.patch"));
        assert!(!merged.contains("artifact.block.remove"));
    }

    #[test]
    fn should_not_duplicate_existing_marker() {
        let metadata = serde_json::json!({
            "artifact": {
                "artifact_mode": "draft",
                "artifact_kind": "analysis"
            }
        });
        let base = Some(format!(
            "已有内容\n\n{ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER}\n已有 Artifact 段"
        ));

        let merged = merge_system_prompt_with_artifact_context(base.clone(), Some(&metadata));
        let merged_text = merged.unwrap_or_default();

        assert_eq!(
            merged_text
                .matches(ARTIFACT_DELIVERY_POLICY_PROMPT_MARKER)
                .count(),
            1
        );
    }
}
