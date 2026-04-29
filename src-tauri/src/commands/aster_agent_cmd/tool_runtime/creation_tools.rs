use super::*;
use crate::agent_tools::catalog::LIME_CREATE_AUDIO_TASK_TOOL_NAME;
use crate::commands::media_task_cmd::{
    create_audio_generation_task_artifact_inner, create_image_generation_task_artifact_inner,
    finalize_audio_generation_task_creation, finalize_image_generation_task_creation,
    CreateAudioGenerationTaskArtifactRequest, CreateImageGenerationTaskArtifactRequest,
    ImageStoryboardSlotInput,
};
use crate::commands::modality_runtime_contracts::{
    image_generation_required_capabilities, IMAGE_GENERATION_CONTRACT_KEY,
    IMAGE_GENERATION_MODALITY, IMAGE_GENERATION_ROUTING_SLOT, VOICE_GENERATION_CONTRACT_KEY,
    VOICE_GENERATION_MODALITY, VOICE_GENERATION_ROUTING_SLOT,
};
use lime_media_runtime::{
    write_task_artifact, MediaTaskType, TaskRelationships, TaskType, TaskWriteOptions,
};
use serde::{de, Deserialize, Deserializer};

const PROJECT_ID_ENV_KEYS: &[&str] = &["LIME_PROJECT_ID", "PROXYCAST_PROJECT_ID"];
const CONTENT_ID_ENV_KEYS: &[&str] = &["LIME_CONTENT_ID", "PROXYCAST_CONTENT_ID"];
const IMAGE_TASK_DEFAULT_ENTRY_SOURCE: &str = "at_image_command";
const AUDIO_TASK_DEFAULT_ENTRY_SOURCE: &str = "at_voice_command";

fn submit_creation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    task_type: TaskType,
    title: Option<String>,
    payload: serde_json::Value,
    status: Option<String>,
    output_path: Option<&str>,
) -> Result<ToolResult, ToolError> {
    let output = write_task_artifact(
        context.working_directory.as_path(),
        task_type,
        title,
        payload,
        TaskWriteOptions {
            status,
            output_path,
            artifact_dir: None,
            idempotency_key: None,
            relationships: TaskRelationships::default(),
        },
    )
    .map_err(media_cli_bridge::tool_error_from_media_runtime)?;

    media_cli_bridge::emit_media_creation_task_event(app_handle, &output);
    let serialized = serde_json::to_string_pretty(&output)
        .unwrap_or_else(|_| serde_json::json!(&output).to_string());
    Ok(media_cli_bridge::attach_media_task_metadata(
        ToolResult::success(serialized),
        &output,
    ))
}

fn submit_media_generation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    task_type: MediaTaskType,
    title: Option<String>,
    payload: serde_json::Value,
    status: Option<String>,
    output_path: Option<&str>,
) -> Result<ToolResult, ToolError> {
    submit_creation_task_record(
        app_handle,
        context,
        task_type,
        title,
        payload,
        status,
        output_path,
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BroadcastTaskInput {
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    audience: Option<String>,
    #[serde(default)]
    tone: Option<String>,
    #[serde(default)]
    duration_hint_minutes: Option<u32>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateBroadcastTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateBroadcastTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateBroadcastTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_BROADCAST_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建播客内容整理任务（broadcast_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "可播报正文内容。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "audience": { "type": "string", "description": "目标听众（可选）。" },
                "tone": { "type": "string", "description": "语气风格（可选）。" },
                "durationHintMinutes": { "type": "integer", "minimum": 1, "maximum": 180, "description": "建议时长（分钟，可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["content"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["broadcast", "task", "creation"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: BroadcastTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.content.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "content 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "content": input.content,
            "audience": input.audience,
            "tone": input.tone,
            "durationHintMinutes": input.duration_hint_minutes
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            TaskType::BroadcastGenerate,
            input.title,
            payload,
            None,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverTaskInput {
    prompt: String,
    #[serde(default)]
    raw_text: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    reference_image_url: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    remark: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    content_id: Option<String>,
    #[serde(default)]
    entry_source: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateCoverTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateCoverTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateCoverTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_COVER_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建封面生成任务记录（cover_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "封面提示词。" },
                "rawText": { "type": "string", "description": "原始用户输入（可选）。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "style": { "type": "string", "description": "视觉风格（可选）。" },
                "platform": { "type": "string", "description": "目标平台（可选）。" },
                "size": { "type": "string", "description": "尺寸（可选）。" },
                "imageUrl": { "type": "string", "description": "生成后的封面 URL（可选）。" },
                "referenceImageUrl": { "type": "string", "description": "参考图 URL（可选）。" },
                "status": { "type": "string", "description": "状态（成功/失败，可选）。" },
                "remark": { "type": "string", "description": "备注（可选）。" },
                "sessionId": { "type": "string", "description": "会话 ID（可选）。" },
                "projectId": { "type": "string", "description": "项目 ID（可选）。" },
                "contentId": { "type": "string", "description": "内容 ID（可选）。" },
                "entrySource": { "type": "string", "description": "入口来源（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["cover", "image", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: CoverTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.prompt.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "prompt 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "prompt": input.prompt,
            "raw_text": input.raw_text,
            "model": "lime-cover-cli",
            "style": input.style,
            "platform": input.platform,
            "size": input.size,
            "imageUrl": input.image_url,
            "referenceImageUrl": input.reference_image_url,
            "usage": "cover",
            "status": input.status,
            "remark": input.remark,
            "session_id": input.session_id,
            "project_id": input.project_id,
            "content_id": input.content_id,
            "entry_source": input.entry_source
        });
        submit_media_generation_task_record(
            &self.app_handle,
            context,
            MediaTaskType::CoverGenerate,
            input.title,
            payload,
            Some("pending_submit".to_string()),
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceSearchTaskInput {
    resource_type: String,
    query: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    usage: Option<String>,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    filters: Option<serde_json::Value>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateResourceSearchTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateResourceSearchTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateResourceSearchTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建资源检索任务（modal_resource_search）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "resourceType": { "type": "string", "description": "资源类型，例如 image/bgm/sfx。" },
                "query": { "type": "string", "description": "检索关键词。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "usage": { "type": "string", "description": "用途说明（可选）。" },
                "count": { "type": "integer", "minimum": 1, "maximum": 50, "description": "候选数量（可选）。" },
                "filters": { "type": "object", "description": "过滤条件（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["resourceType", "query"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["resource", "search", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ResourceSearchTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.resource_type.trim().is_empty() || input.query.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "resourceType/query 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "resourceType": input.resource_type,
            "query": input.query,
            "usage": input.usage,
            "count": input.count,
            "filters": input.filters
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            TaskType::ModalResourceSearch,
            input.title,
            payload,
            None,
            input.output_path.as_deref(),
        )
    }
}

fn deserialize_optional_u32_from_any<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(value) = value else {
        return Ok(None);
    };

    match value {
        serde_json::Value::Number(number) => number
            .as_u64()
            .and_then(|raw| u32::try_from(raw).ok())
            .map(Some)
            .ok_or_else(|| de::Error::custom("count 必须是正整数")),
        serde_json::Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            trimmed
                .parse::<u32>()
                .map(Some)
                .map_err(|_| de::Error::custom("count 必须是正整数"))
        }
        _ => Err(de::Error::custom("count 必须是整数或整数字符串")),
    }
}

fn normalize_image_task_tool_params(
    params: serde_json::Value,
) -> Result<serde_json::Value, ToolError> {
    let serde_json::Value::Object(mut record) = params else {
        return Ok(params);
    };

    let Some(image_task_value) = record.remove("image_task") else {
        return Ok(serde_json::Value::Object(record));
    };

    let normalized = match image_task_value {
        serde_json::Value::Object(task) => serde_json::Value::Object(task),
        serde_json::Value::String(raw) => {
            let parsed: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|error| {
                ToolError::invalid_params(format!(
                    "image_task JSON 字符串解析失败，请直接传扁平对象参数: {error}"
                ))
            })?;
            if !parsed.is_object() {
                return Err(ToolError::invalid_params(
                    "image_task JSON 字符串必须解析为对象".to_string(),
                ));
            }
            parsed
        }
        _ => {
            return Err(ToolError::invalid_params(
                "image_task 必须是对象或 JSON 字符串".to_string(),
            ))
        }
    };

    tracing::warn!(
        "[AsterAgent] lime_create_image_generation_task 收到兼容包装 image_task，已自动归一化为扁平对象参数"
    );
    normalize_flat_image_task_tool_params(normalized)
}

fn normalize_array_string_field(
    record: &mut serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Result<(), ToolError> {
    let Some(value) = record.get(field).cloned() else {
        return Ok(());
    };
    let serde_json::Value::String(raw) = value else {
        return Ok(());
    };
    let trimmed = raw.trim();
    if !trimmed.starts_with('[') {
        return Ok(());
    }

    let parsed: serde_json::Value = serde_json::from_str(trimmed).map_err(|error| {
        ToolError::invalid_params(format!("{field} JSON 数组字符串解析失败: {error}"))
    })?;
    if !parsed.is_array() {
        return Err(ToolError::invalid_params(format!(
            "{field} JSON 字符串必须解析为数组"
        )));
    }
    record.insert(field.to_string(), parsed);
    Ok(())
}

fn canonicalize_image_task_alias_fields(record: &mut serde_json::Map<String, serde_json::Value>) {
    const FIELD_ALIASES: &[(&str, &str)] = &[
        ("rawText", "raw_text"),
        ("layoutHint", "layout_hint"),
        ("aspectRatio", "aspect_ratio"),
        ("providerId", "provider_id"),
        ("sessionId", "session_id"),
        ("projectId", "project_id"),
        ("contentId", "content_id"),
        ("entrySource", "entry_source"),
        ("modalityContractKey", "modality_contract_key"),
        ("requiredCapabilities", "required_capabilities"),
        ("routingSlot", "routing_slot"),
        ("runtimeContract", "runtime_contract"),
        ("requestedTarget", "requested_target"),
        ("slotId", "slot_id"),
        ("anchorHint", "anchor_hint"),
        ("anchorSectionTitle", "anchor_section_title"),
        ("anchorText", "anchor_text"),
        ("titleGenerationResult", "title_generation_result"),
        ("targetOutputId", "target_output_id"),
        ("targetOutputRefId", "target_output_ref_id"),
        ("referenceImages", "reference_images"),
        ("storyboardSlots", "storyboard_slots"),
        ("skillInputImages", "skill_input_images"),
        ("outputPath", "output_path"),
    ];

    for (camel_case, snake_case) in FIELD_ALIASES {
        let Some(value) = record.remove(*camel_case) else {
            continue;
        };
        if !record.contains_key(*snake_case) {
            record.insert((*snake_case).to_string(), value);
        }
    }
}

fn normalize_flat_image_task_tool_params(
    params: serde_json::Value,
) -> Result<serde_json::Value, ToolError> {
    let serde_json::Value::Object(mut record) = params else {
        return Ok(params);
    };

    canonicalize_image_task_alias_fields(&mut record);
    normalize_array_string_field(&mut record, "reference_images")?;
    normalize_array_string_field(&mut record, "storyboard_slots")?;

    if record.remove("skill_input_images").is_some() || record.remove("skillInputImages").is_some()
    {
        tracing::warn!(
            "[AsterAgent] lime_create_image_generation_task 收到冗余 skill_input_images 字段，已忽略"
        );
    }

    Ok(serde_json::Value::Object(record))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageTaskInput {
    prompt: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, alias = "title_generation_result")]
    title_generation_result: Option<serde_json::Value>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default, alias = "raw_text")]
    raw_text: Option<String>,
    #[serde(default, alias = "layout_hint")]
    layout_hint: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default, alias = "aspect_ratio")]
    aspect_ratio: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u32_from_any")]
    count: Option<u32>,
    #[serde(default)]
    usage: Option<String>,
    #[serde(default, alias = "provider_id")]
    provider_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default, alias = "session_id")]
    session_id: Option<String>,
    #[serde(default, alias = "project_id")]
    project_id: Option<String>,
    #[serde(default, alias = "content_id")]
    content_id: Option<String>,
    #[serde(default, alias = "entry_source")]
    entry_source: Option<String>,
    #[serde(default, alias = "modality_contract_key")]
    modality_contract_key: Option<String>,
    #[serde(default)]
    modality: Option<String>,
    #[serde(default, alias = "required_capabilities")]
    required_capabilities: Vec<String>,
    #[serde(default, alias = "routing_slot")]
    routing_slot: Option<String>,
    #[serde(default, alias = "runtime_contract")]
    runtime_contract: Option<serde_json::Value>,
    #[serde(default, alias = "requested_target")]
    requested_target: Option<String>,
    #[serde(default, alias = "slot_id")]
    slot_id: Option<String>,
    #[serde(default, alias = "anchor_hint")]
    anchor_hint: Option<String>,
    #[serde(default, alias = "anchor_section_title")]
    anchor_section_title: Option<String>,
    #[serde(default, alias = "anchor_text")]
    anchor_text: Option<String>,
    #[serde(default, alias = "target_output_id")]
    target_output_id: Option<String>,
    #[serde(default, alias = "target_output_ref_id")]
    target_output_ref_id: Option<String>,
    #[serde(default, alias = "reference_images")]
    reference_images: Vec<String>,
    #[serde(default, alias = "storyboard_slots")]
    storyboard_slots: Vec<ImageStoryboardSlotInput>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioTaskInput {
    #[serde(default, alias = "source_text", alias = "prompt", alias = "text")]
    source_text: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default, alias = "raw_text")]
    raw_text: Option<String>,
    #[serde(default)]
    voice: Option<String>,
    #[serde(default, alias = "voice_style")]
    voice_style: Option<String>,
    #[serde(default, alias = "target_language")]
    target_language: Option<String>,
    #[serde(default, alias = "mime_type")]
    mime_type: Option<String>,
    #[serde(default, alias = "audio_path")]
    audio_path: Option<String>,
    #[serde(default, alias = "duration_ms")]
    duration_ms: Option<u64>,
    #[serde(default, alias = "provider_id")]
    provider_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default, alias = "session_id")]
    session_id: Option<String>,
    #[serde(default, alias = "project_id")]
    project_id: Option<String>,
    #[serde(default, alias = "content_id")]
    content_id: Option<String>,
    #[serde(default, alias = "entry_source")]
    entry_source: Option<String>,
    #[serde(default, alias = "modality_contract_key")]
    modality_contract_key: Option<String>,
    #[serde(default)]
    modality: Option<String>,
    #[serde(default, alias = "required_capabilities")]
    required_capabilities: Vec<String>,
    #[serde(default, alias = "routing_slot")]
    routing_slot: Option<String>,
    #[serde(default, alias = "runtime_contract")]
    runtime_contract: Option<serde_json::Value>,
    #[serde(default, alias = "requested_target")]
    requested_target: Option<String>,
    #[serde(default, alias = "output_path")]
    output_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptionTaskInput {
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    raw_text: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    source_path: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    output_format: Option<String>,
    #[serde(default)]
    speaker_labels: Option<bool>,
    #[serde(default)]
    timestamps: Option<bool>,
    #[serde(default)]
    provider_id: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    content_id: Option<String>,
    #[serde(default)]
    entry_source: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateImageTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateImageTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

fn image_task_input_schema() -> serde_json::Value {
    let count_schema = serde_json::json!({
        "oneOf": [
            { "type": "integer", "minimum": 1, "maximum": 20 },
            { "type": "string" }
        ],
        "description": "生成数量（可选，兼容整数字符串）。"
    });
    let reference_images_schema = serde_json::json!({
        "oneOf": [
            {
                "type": "array",
                "items": { "type": "string" }
            },
            { "type": "string" }
        ],
        "description": "参考图 URL、文件路径或已物化的输入图片路径（可选，兼容 JSON 数组字符串）。"
    });
    let storyboard_slots_schema = serde_json::json!({
        "oneOf": [
            {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "prompt": { "type": "string", "description": "该格的完整提示词。" },
                        "slotId": { "type": "string", "description": "可选槽位 ID。" },
                        "slot_id": { "type": "string", "description": "可选槽位 ID（snake_case 兼容）。" },
                        "label": { "type": "string", "description": "该格标签，例如“建立镜头”“人物对峙”" },
                        "shotType": { "type": "string", "description": "可选镜头类型。" },
                        "shot_type": { "type": "string", "description": "可选镜头类型（snake_case 兼容）。" }
                    },
                    "required": ["prompt"],
                    "additionalProperties": false
                }
            },
            { "type": "string" }
        ],
        "description": "多格分镜的逐格提示词数组（可选，兼容 JSON 数组字符串）。"
    });
    let ignored_skill_input_images_schema = serde_json::json!({
        "oneOf": [
            {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": true
                }
            },
            { "type": "string" }
        ],
        "description": "兼容字段，运行时会忽略 skill_input_images。"
    });
    let mut properties = serde_json::Map::new();
    let mut insert_property = |key: &str, value: serde_json::Value| {
        properties.insert(key.to_string(), value);
    };

    insert_property(
        "prompt",
        serde_json::json!({ "type": "string", "description": "图像提示词。" }),
    );
    insert_property(
        "title",
        serde_json::json!({ "type": "string", "description": "任务标题（可选）。" }),
    );
    insert_property(
        "titleGenerationResult",
        serde_json::json!({
            "type": ["object", "null"],
            "description": "辅助标题生成的 runtime 诊断快照（可选）。",
            "additionalProperties": true
        }),
    );
    insert_property(
        "title_generation_result",
        serde_json::json!({
            "type": ["object", "null"],
            "description": "辅助标题生成的 runtime 诊断快照（snake_case 兼容，可选）。",
            "additionalProperties": true
        }),
    );
    insert_property(
        "mode",
        serde_json::json!({ "type": "string", "description": "任务模式 generate/edit/variation（可选）。" }),
    );
    insert_property(
        "rawText",
        serde_json::json!({ "type": "string", "description": "原始用户输入（可选）。" }),
    );
    insert_property(
        "raw_text",
        serde_json::json!({ "type": "string", "description": "原始用户输入（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "layoutHint",
        serde_json::json!({ "type": "string", "description": "展示布局提示（可选），例如 storyboard_3x3。" }),
    );
    insert_property(
        "layout_hint",
        serde_json::json!({ "type": "string", "description": "展示布局提示（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "style",
        serde_json::json!({ "type": "string", "description": "风格（可选）。" }),
    );
    insert_property(
        "size",
        serde_json::json!({ "type": "string", "description": "尺寸（可选）。" }),
    );
    insert_property(
        "aspectRatio",
        serde_json::json!({ "type": "string", "description": "宽高比（可选）。" }),
    );
    insert_property(
        "aspect_ratio",
        serde_json::json!({ "type": "string", "description": "宽高比（snake_case 兼容，可选）。" }),
    );
    insert_property("count", count_schema);
    insert_property(
        "usage",
        serde_json::json!({ "type": "string", "description": "用途（可选）。" }),
    );
    insert_property(
        "providerId",
        serde_json::json!({ "type": "string", "description": "Provider 标识（可选）。" }),
    );
    insert_property(
        "provider_id",
        serde_json::json!({ "type": "string", "description": "Provider 标识（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "model",
        serde_json::json!({ "type": "string", "description": "首选模型（可选）。" }),
    );
    insert_property(
        "sessionId",
        serde_json::json!({ "type": "string", "description": "会话 ID（可选）。" }),
    );
    insert_property(
        "session_id",
        serde_json::json!({ "type": "string", "description": "会话 ID（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "projectId",
        serde_json::json!({ "type": "string", "description": "项目 ID（可选）。" }),
    );
    insert_property(
        "project_id",
        serde_json::json!({ "type": "string", "description": "项目 ID（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "contentId",
        serde_json::json!({ "type": "string", "description": "内容 ID（可选）。" }),
    );
    insert_property(
        "content_id",
        serde_json::json!({ "type": "string", "description": "内容 ID（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "entrySource",
        serde_json::json!({ "type": "string", "description": "入口来源（可选）。" }),
    );
    insert_property(
        "entry_source",
        serde_json::json!({ "type": "string", "description": "入口来源（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "modalityContractKey",
        serde_json::json!({
            "type": "string",
            "enum": [IMAGE_GENERATION_CONTRACT_KEY],
            "description": "底层多模态运行合同键（可选，默认 image_generation）。"
        }),
    );
    insert_property(
        "modality_contract_key",
        serde_json::json!({
            "type": "string",
            "enum": [IMAGE_GENERATION_CONTRACT_KEY],
            "description": "底层多模态运行合同键（snake_case 兼容，可选）。"
        }),
    );
    insert_property(
        "modality",
        serde_json::json!({
            "type": "string",
            "enum": [IMAGE_GENERATION_MODALITY],
            "description": "底层模态（可选，默认 image）。"
        }),
    );
    insert_property(
        "requiredCapabilities",
        serde_json::json!({
            "type": "array",
            "items": { "type": "string" },
            "description": "运行合同要求的能力集合（可选，运行时会补齐 image_generation contract 全量能力）。"
        }),
    );
    insert_property(
        "required_capabilities",
        serde_json::json!({
            "type": "array",
            "items": { "type": "string" },
            "description": "运行合同要求的能力集合（snake_case 兼容，可选）。"
        }),
    );
    insert_property(
        "routingSlot",
        serde_json::json!({
            "type": "string",
            "enum": [IMAGE_GENERATION_ROUTING_SLOT],
            "description": "模型路由槽位（可选，默认 image_generation_model）。"
        }),
    );
    insert_property(
        "routing_slot",
        serde_json::json!({
            "type": "string",
            "enum": [IMAGE_GENERATION_ROUTING_SLOT],
            "description": "模型路由槽位（snake_case 兼容，可选）。"
        }),
    );
    insert_property(
        "runtimeContract",
        serde_json::json!({
            "type": "object",
            "description": "运行合同快照（可选；运行时以 image_generation contract 事实源重写）。",
            "additionalProperties": true
        }),
    );
    insert_property(
        "runtime_contract",
        serde_json::json!({
            "type": "object",
            "description": "运行合同快照（snake_case 兼容，可选；运行时以 image_generation contract 事实源重写）。",
            "additionalProperties": true
        }),
    );
    insert_property(
        "requestedTarget",
        serde_json::json!({ "type": "string", "description": "目标类型 generate/cover（可选）。" }),
    );
    insert_property(
        "requested_target",
        serde_json::json!({ "type": "string", "description": "目标类型（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "slotId",
        serde_json::json!({ "type": "string", "description": "正文插图 slot 绑定（可选）。" }),
    );
    insert_property(
        "slot_id",
        serde_json::json!({ "type": "string", "description": "正文插图 slot 绑定（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "anchorHint",
        serde_json::json!({ "type": "string", "description": "正文插图锚点提示（可选）。" }),
    );
    insert_property(
        "anchor_hint",
        serde_json::json!({ "type": "string", "description": "正文插图锚点提示（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "anchorSectionTitle",
        serde_json::json!({ "type": "string", "description": "正文插图小节标题（可选）。" }),
    );
    insert_property(
        "anchor_section_title",
        serde_json::json!({ "type": "string", "description": "正文插图小节标题（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "anchorText",
        serde_json::json!({ "type": "string", "description": "正文插图锚点文本（可选）。" }),
    );
    insert_property(
        "anchor_text",
        serde_json::json!({ "type": "string", "description": "正文插图锚点文本（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "targetOutputId",
        serde_json::json!({ "type": "string", "description": "目标图片输出 ID（可选）。" }),
    );
    insert_property(
        "target_output_id",
        serde_json::json!({ "type": "string", "description": "目标图片输出 ID（snake_case 兼容，可选）。" }),
    );
    insert_property(
        "targetOutputRefId",
        serde_json::json!({ "type": "string", "description": "目标图片引用 ID（可选）。" }),
    );
    insert_property(
        "target_output_ref_id",
        serde_json::json!({ "type": "string", "description": "目标图片引用 ID（snake_case 兼容，可选）。" }),
    );
    insert_property("referenceImages", reference_images_schema.clone());
    insert_property("reference_images", reference_images_schema);
    insert_property("storyboardSlots", storyboard_slots_schema.clone());
    insert_property("storyboard_slots", storyboard_slots_schema);
    insert_property(
        "skillInputImages",
        ignored_skill_input_images_schema.clone(),
    );
    insert_property("skill_input_images", ignored_skill_input_images_schema);
    insert_property(
        "output_path",
        serde_json::json!({ "type": "string", "description": "可选输出路径（snake_case 兼容字段，运行时会忽略）。" }),
    );

    serde_json::json!({
        "type": "object",
        "properties": properties,
        "required": ["prompt"],
        "additionalProperties": false,
        "x-lime": {
            "always_visible": true,
            "tags": ["image", "task", "generation"],
            "allowed_callers": ["assistant", "skill"]
        }
    })
}

fn build_image_generation_task_request(
    context: &ToolContext,
    input: ImageTaskInput,
) -> CreateImageGenerationTaskArtifactRequest {
    let ImageTaskInput {
        prompt,
        title,
        title_generation_result,
        mode,
        raw_text,
        layout_hint,
        style,
        size,
        aspect_ratio,
        count,
        usage,
        provider_id,
        model,
        session_id,
        project_id,
        content_id,
        entry_source,
        modality_contract_key,
        modality,
        required_capabilities,
        routing_slot,
        runtime_contract,
        requested_target,
        slot_id,
        anchor_hint,
        anchor_section_title,
        anchor_text,
        target_output_id,
        target_output_ref_id,
        reference_images,
        storyboard_slots,
        output_path,
    } = input;
    let _compat_ignored_output_path = output_path;
    let session_id = session_id.or_else(|| {
        let value = context.session_id.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    });
    let project_id = project_id.or_else(|| {
        PROJECT_ID_ENV_KEYS.iter().find_map(|key| {
            context
                .environment
                .get(*key)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    });
    let content_id = content_id.or_else(|| {
        CONTENT_ID_ENV_KEYS.iter().find_map(|key| {
            context
                .environment
                .get(*key)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    });
    let entry_source = entry_source.or_else(|| Some(IMAGE_TASK_DEFAULT_ENTRY_SOURCE.to_string()));
    let modality_contract_key =
        modality_contract_key.or_else(|| Some(IMAGE_GENERATION_CONTRACT_KEY.to_string()));
    let modality = modality.or_else(|| Some(IMAGE_GENERATION_MODALITY.to_string()));
    let _provided_required_capabilities = required_capabilities;
    let required_capabilities = image_generation_required_capabilities();
    let routing_slot = routing_slot.or_else(|| Some(IMAGE_GENERATION_ROUTING_SLOT.to_string()));

    CreateImageGenerationTaskArtifactRequest {
        project_root_path: context.working_directory.to_string_lossy().to_string(),
        prompt,
        title,
        title_generation_result,
        mode,
        raw_text,
        layout_hint,
        size,
        aspect_ratio,
        count,
        usage,
        style,
        provider_id,
        model,
        session_id,
        project_id,
        content_id,
        entry_source,
        modality_contract_key,
        modality,
        required_capabilities,
        routing_slot,
        runtime_contract,
        requested_target,
        slot_id,
        anchor_hint,
        anchor_section_title,
        anchor_text,
        target_output_id,
        target_output_ref_id,
        reference_images,
        storyboard_slots,
    }
}

fn submit_image_generation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    input: ImageTaskInput,
) -> Result<ToolResult, ToolError> {
    let request = build_image_generation_task_request(context, input);
    let project_root_path = request.project_root_path.trim().to_string();
    let output = create_image_generation_task_artifact_inner(request)
        .map_err(|error| ToolError::execution_failed(format!("创建图片任务失败: {error}")))?;

    finalize_image_generation_task_creation(Some(app_handle), project_root_path.as_str(), &output);

    let serialized = serde_json::to_string_pretty(&output)
        .unwrap_or_else(|_| serde_json::json!(&output).to_string());
    Ok(media_cli_bridge::attach_media_task_metadata(
        ToolResult::success(serialized),
        &output,
    ))
}

#[async_trait]
impl Tool for LimeCreateImageTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_IMAGE_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建图片生成任务（image_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        image_task_input_schema()
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params =
            normalize_flat_image_task_tool_params(normalize_image_task_tool_params(params)?)?;
        let input: ImageTaskInput = serde_json::from_value(normalized_params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.prompt.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "prompt 不能为空字符串".to_string(),
            ));
        }
        submit_image_generation_task_record(&self.app_handle, context, input)
    }
}

#[derive(Clone)]
struct LimeCreateAudioTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateAudioTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

fn audio_task_input_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "sourceText": { "type": "string", "description": "需要生成配音的正文。" },
            "source_text": { "type": "string", "description": "需要生成配音的正文（snake_case 兼容）。" },
            "prompt": { "type": "string", "description": "兼容字段，等价于 sourceText。" },
            "title": { "type": "string", "description": "任务标题（可选）。" },
            "rawText": { "type": "string", "description": "原始用户输入（可选）。" },
            "raw_text": { "type": "string", "description": "原始用户输入（snake_case 兼容，可选）。" },
            "voice": { "type": "string", "description": "音色或 voice preset（可选）。" },
            "voiceStyle": { "type": "string", "description": "配音风格（可选）。" },
            "voice_style": { "type": "string", "description": "配音风格（snake_case 兼容，可选）。" },
            "targetLanguage": { "type": "string", "description": "目标语言（可选）。" },
            "target_language": { "type": "string", "description": "目标语言（snake_case 兼容，可选）。" },
            "mimeType": { "type": "string", "description": "音频 MIME 类型（可选，默认 audio/mpeg）。" },
            "mime_type": { "type": "string", "description": "音频 MIME 类型（snake_case 兼容，可选）。" },
            "audioPath": { "type": "string", "description": "已生成音频路径（可选；未生成时留空）。" },
            "audio_path": { "type": "string", "description": "已生成音频路径（snake_case 兼容，可选）。" },
            "durationMs": { "type": "integer", "minimum": 0, "description": "音频时长毫秒（可选）。" },
            "duration_ms": { "type": "integer", "minimum": 0, "description": "音频时长毫秒（snake_case 兼容，可选）。" },
            "providerId": { "type": "string", "description": "Provider 标识（可选）。" },
            "provider_id": { "type": "string", "description": "Provider 标识（snake_case 兼容，可选）。" },
            "model": { "type": "string", "description": "模型名（可选）。" },
            "sessionId": { "type": "string", "description": "会话 ID（可选）。" },
            "session_id": { "type": "string", "description": "会话 ID（snake_case 兼容，可选）。" },
            "projectId": { "type": "string", "description": "项目 ID（可选）。" },
            "project_id": { "type": "string", "description": "项目 ID（snake_case 兼容，可选）。" },
            "contentId": { "type": "string", "description": "内容 ID（可选）。" },
            "content_id": { "type": "string", "description": "内容 ID（snake_case 兼容，可选）。" },
            "entrySource": { "type": "string", "description": "入口来源（可选，默认 at_voice_command）。" },
            "entry_source": { "type": "string", "description": "入口来源（snake_case 兼容，可选）。" },
            "modalityContractKey": { "type": "string", "description": "兼容字段，默认 voice_generation。" },
            "modality_contract_key": { "type": "string", "description": "兼容字段，默认 voice_generation。" },
            "modality": { "type": "string", "description": "兼容字段，默认 audio。" },
            "requiredCapabilities": { "type": "array", "items": { "type": "string" }, "description": "兼容字段，运行时会规范化为 voice_generation 所需能力。" },
            "required_capabilities": { "type": "array", "items": { "type": "string" }, "description": "兼容字段，运行时会规范化为 voice_generation 所需能力。" },
            "routingSlot": { "type": "string", "description": "兼容字段，默认 voice_generation_model。" },
            "routing_slot": { "type": "string", "description": "兼容字段，默认 voice_generation_model。" },
            "runtimeContract": { "type": "object", "description": "运行合同快照（可选）。", "additionalProperties": true },
            "runtime_contract": { "type": "object", "description": "运行合同快照（可选）。", "additionalProperties": true },
            "requestedTarget": { "type": "string", "description": "请求目标（可选，默认 voice）。" },
            "requested_target": { "type": "string", "description": "请求目标（snake_case 兼容，可选）。" },
            "outputPath": { "type": "string", "description": "可选 task JSON 输出路径。" },
            "output_path": { "type": "string", "description": "可选 task JSON 输出路径（snake_case 兼容）。" }
        },
        "additionalProperties": false,
        "x-lime": {
            "always_visible": true,
            "tags": ["audio", "voice", "task", "generation"],
            "allowed_callers": ["assistant", "skill"]
        }
    })
}

fn resolve_context_session_id(context: &ToolContext, requested: Option<String>) -> Option<String> {
    requested.or_else(|| {
        let value = context.session_id.trim();
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn resolve_context_environment_id(
    context: &ToolContext,
    requested: Option<String>,
    env_keys: &[&str],
) -> Option<String> {
    requested.or_else(|| {
        env_keys.iter().find_map(|key| {
            context
                .environment
                .get(*key)
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
    })
}

fn build_audio_generation_task_request(
    context: &ToolContext,
    input: AudioTaskInput,
) -> CreateAudioGenerationTaskArtifactRequest {
    CreateAudioGenerationTaskArtifactRequest {
        project_root_path: context.working_directory.to_string_lossy().to_string(),
        source_text: input.source_text,
        title: input.title,
        raw_text: input.raw_text,
        voice: input.voice,
        voice_style: input.voice_style,
        target_language: input.target_language,
        mime_type: input.mime_type,
        audio_path: input.audio_path,
        duration_ms: input.duration_ms,
        provider_id: input.provider_id,
        model: input.model,
        session_id: resolve_context_session_id(context, input.session_id),
        project_id: resolve_context_environment_id(context, input.project_id, PROJECT_ID_ENV_KEYS),
        content_id: resolve_context_environment_id(context, input.content_id, CONTENT_ID_ENV_KEYS),
        entry_source: input
            .entry_source
            .or_else(|| Some(AUDIO_TASK_DEFAULT_ENTRY_SOURCE.to_string())),
        modality_contract_key: input
            .modality_contract_key
            .or_else(|| Some(VOICE_GENERATION_CONTRACT_KEY.to_string())),
        modality: input
            .modality
            .or_else(|| Some(VOICE_GENERATION_MODALITY.to_string())),
        required_capabilities: if input.required_capabilities.is_empty() {
            vec![
                "text_generation".to_string(),
                "voice_generation".to_string(),
            ]
        } else {
            input.required_capabilities
        },
        routing_slot: input
            .routing_slot
            .or_else(|| Some(VOICE_GENERATION_ROUTING_SLOT.to_string())),
        runtime_contract: input.runtime_contract,
        requested_target: input.requested_target.or_else(|| Some("voice".to_string())),
        output_path: input.output_path,
    }
}

fn submit_audio_generation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    input: AudioTaskInput,
) -> Result<ToolResult, ToolError> {
    let request = build_audio_generation_task_request(context, input);
    let output = create_audio_generation_task_artifact_inner(request)
        .map_err(|error| ToolError::execution_failed(format!("创建音频任务失败: {error}")))?;

    finalize_audio_generation_task_creation(Some(app_handle), &output);

    let serialized = serde_json::to_string_pretty(&output)
        .unwrap_or_else(|_| serde_json::json!(&output).to_string());
    Ok(media_cli_bridge::attach_media_task_metadata(
        ToolResult::success(serialized),
        &output,
    ))
}

#[async_trait]
impl Tool for LimeCreateAudioTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_AUDIO_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建配音生成任务（audio_generate），只写入标准 audio_task/audio_output artifact。"
    }

    fn input_schema(&self) -> serde_json::Value {
        audio_task_input_schema()
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: AudioTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.source_text.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "sourceText 不能为空字符串".to_string(),
            ));
        }
        submit_audio_generation_task_record(&self.app_handle, context, input)
    }
}

#[derive(Clone)]
struct LimeCreateTranscriptionTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateTranscriptionTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateTranscriptionTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建转写任务（transcription_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "转写目标说明（可选）。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "rawText": { "type": "string", "description": "原始用户输入（可选）。" },
                "sourceUrl": { "type": "string", "description": "音频或视频 URL（可选）。" },
                "sourcePath": { "type": "string", "description": "音频或视频本地路径（可选）。" },
                "language": { "type": "string", "description": "目标语言（可选）。" },
                "outputFormat": { "type": "string", "description": "输出格式，例如 txt/srt/vtt/markdown（可选）。" },
                "speakerLabels": { "type": "boolean", "description": "是否区分说话人（可选）。" },
                "timestamps": { "type": "boolean", "description": "是否带时间戳（可选）。" },
                "providerId": { "type": "string", "description": "Provider 标识（可选）。" },
                "model": { "type": "string", "description": "模型名（可选）。" },
                "sessionId": { "type": "string", "description": "会话 ID（可选）。" },
                "projectId": { "type": "string", "description": "项目 ID（可选）。" },
                "contentId": { "type": "string", "description": "内容 ID（可选）。" },
                "entrySource": { "type": "string", "description": "入口来源（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["audio", "transcription", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TranscriptionTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        let source_url = input
            .source_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let source_path = input
            .source_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if source_url.is_none() && source_path.is_none() {
            return Err(ToolError::invalid_params(
                "sourceUrl 或 sourcePath 至少需要提供一个".to_string(),
            ));
        }

        let payload = serde_json::json!({
            "prompt": input.prompt,
            "raw_text": input.raw_text,
            "source_url": source_url,
            "source_path": source_path,
            "language": input.language,
            "output_format": input.output_format,
            "speaker_labels": input.speaker_labels,
            "timestamps": input.timestamps,
            "provider_id": input.provider_id,
            "model": input.model,
            "session_id": input.session_id,
            "project_id": input.project_id,
            "content_id": input.content_id,
            "entry_source": input.entry_source
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            TaskType::TranscriptionGenerate,
            input.title,
            payload,
            None,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlParseTaskInput {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    raw_text: Option<String>,
    #[serde(default)]
    key_points: Option<Vec<String>>,
    #[serde(default)]
    extract_status: Option<String>,
    #[serde(default)]
    extract_goal: Option<String>,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    content_id: Option<String>,
    #[serde(default)]
    entry_source: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateUrlParseTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateUrlParseTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateUrlParseTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_URL_PARSE_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建链接解析任务（url_parse）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "目标 URL。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "summary": { "type": "string", "description": "摘要（可选）。" },
                "prompt": { "type": "string", "description": "解析目标说明（可选）。" },
                "rawText": { "type": "string", "description": "原始用户输入（可选）。" },
                "keyPoints": { "type": "array", "items": { "type": "string" }, "description": "关键要点（可选）。" },
                "extractStatus": { "type": "string", "description": "提取状态（可选）。" },
                "extractGoal": { "type": "string", "description": "抽取目标，如 summary / key_points / full_text（可选）。" },
                "sessionId": { "type": "string", "description": "会话 ID（可选）。" },
                "projectId": { "type": "string", "description": "项目 ID（可选）。" },
                "contentId": { "type": "string", "description": "内容 ID（可选）。" },
                "entrySource": { "type": "string", "description": "入口来源（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["url"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["url", "parse", "task"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: UrlParseTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.url.trim().is_empty() {
            return Err(ToolError::invalid_params("url 不能为空字符串".to_string()));
        }
        let summary = input
            .summary
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let extract_status = if summary.is_none()
            && input.extract_status.as_deref().unwrap_or("ready").trim() == "ready"
        {
            Some("pending_extract".to_string())
        } else {
            input.extract_status
        };
        let payload = serde_json::json!({
            "url": input.url,
            "summary": summary,
            "prompt": input.prompt,
            "raw_text": input.raw_text,
            "keyPoints": input.key_points,
            "extractStatus": extract_status,
            "extractGoal": input.extract_goal,
            "session_id": input.session_id,
            "project_id": input.project_id,
            "content_id": input.content_id,
            "entry_source": input.entry_source
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            TaskType::UrlParse,
            input.title,
            payload,
            None,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypesettingTaskInput {
    content: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    target_platform: Option<String>,
    #[serde(default)]
    rules: Option<serde_json::Value>,
    #[serde(default)]
    output_path: Option<String>,
}

#[derive(Clone)]
struct LimeCreateTypesettingTaskTool {
    app_handle: AppHandle,
}

impl LimeCreateTypesettingTaskTool {
    fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }
}

#[async_trait]
impl Tool for LimeCreateTypesettingTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_TYPESETTING_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建排版优化任务（typesetting）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "content": { "type": "string", "description": "待排版内容。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "targetPlatform": { "type": "string", "description": "目标平台（可选）。" },
                "rules": { "type": "object", "description": "排版规则（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["content"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["typesetting", "task", "text"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: TypesettingTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.content.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "content 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "content": input.content,
            "targetPlatform": input.target_platform,
            "rules": input.rules
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            TaskType::Typesetting,
            input.title,
            payload,
            None,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Clone)]
struct LimeCreateVideoGenerationTaskTool {
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
    app_handle: AppHandle,
}

impl LimeCreateVideoGenerationTaskTool {
    fn new(
        db: DbConnection,
        api_key_provider_service: Arc<ApiKeyProviderService>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            db,
            api_key_provider_service,
            app_handle,
        }
    }
}

#[async_trait]
impl Tool for LimeCreateVideoGenerationTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_VIDEO_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "调用 Lime 视频任务服务，创建真实的视频生成任务。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "projectId": { "type": "string", "description": "项目 ID。" },
                "providerId": { "type": "string", "description": "视频服务 Provider ID。" },
                "model": { "type": "string", "description": "模型名。" },
                "prompt": { "type": "string", "description": "视频生成提示词。" },
                "aspectRatio": { "type": "string", "description": "画幅比例，例如 16:9、9:16。" },
                "resolution": { "type": "string", "description": "分辨率，例如 720p。" },
                "duration": { "type": "integer", "description": "时长（秒）。" },
                "imageUrl": { "type": "string", "description": "首帧图 URL（可选）。" },
                "endImageUrl": { "type": "string", "description": "末帧图 URL（可选）。" },
                "seed": { "type": "integer", "description": "随机种子（可选）。" },
                "generateAudio": { "type": "boolean", "description": "是否生成音频（可选）。" },
                "cameraFixed": { "type": "boolean", "description": "是否固定镜头（可选）。" }
            },
            "required": ["projectId", "providerId", "model", "prompt"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["video", "task", "generation"],
                "allowed_callers": ["assistant", "skill"],
                "input_examples": [
                    {
                        "projectId": "project-demo",
                        "providerId": "volcengine",
                        "model": "doubao-seedance-1-0-pro-250528",
                        "prompt": "未来城市清晨，镜头缓慢推进，电影感",
                        "aspectRatio": "16:9",
                        "duration": 5
                    }
                ]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let request: CreateVideoGenerationRequest = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if request.project_id.trim().is_empty()
            || request.provider_id.trim().is_empty()
            || request.model.trim().is_empty()
            || request.prompt.trim().is_empty()
        {
            return Err(ToolError::invalid_params(
                "projectId/providerId/model/prompt 均不能为空".to_string(),
            ));
        }

        let service = VideoGenerationService::new();
        let created = service
            .create_task(&self.db, self.api_key_provider_service.as_ref(), request)
            .await
            .map_err(|error| ToolError::execution_failed(format!("创建视频任务失败: {error}")))?;

        let task_json = serde_json::to_value(&created).unwrap_or_else(|_| serde_json::json!({}));
        let artifact_output = write_task_artifact(
            context.working_directory.as_path(),
            MediaTaskType::VideoGenerate,
            Some(created.prompt.clone()),
            serde_json::json!({
                "projectId": created.project_id.clone(),
                "providerId": created.provider_id.clone(),
                "model": created.model.clone(),
                "prompt": created.prompt.clone(),
                "status": created.status.to_string(),
                "task": task_json.clone(),
            }),
            TaskWriteOptions {
                status: Some(created.status.to_string()),
                output_path: None,
                artifact_dir: None,
                idempotency_key: None,
                relationships: TaskRelationships::default(),
            },
        )
        .map_err(media_cli_bridge::tool_error_from_media_runtime)?;

        media_cli_bridge::emit_media_creation_task_event(&self.app_handle, &artifact_output);
        let payload = serde_json::json!({
            "success": true,
            "task_id": artifact_output.task_id,
            "task_type": artifact_output.task_type,
            "status": artifact_output.status,
            "path": artifact_output.path,
            "absolute_path": artifact_output.absolute_path,
            "artifact_path": artifact_output.artifact_path,
            "absolute_artifact_path": artifact_output.absolute_artifact_path,
            "task": created,
            "record": artifact_output.record
        });
        let output = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        Ok(media_cli_bridge::attach_media_task_metadata(
            ToolResult::success(output),
            &artifact_output,
        ))
    }
}

pub(super) fn register_creation_task_tools_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
    app_handle: AppHandle,
) {
    if !registry.contains(LIME_CREATE_VIDEO_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateVideoGenerationTaskTool::new(
            db.clone(),
            api_key_provider_service.clone(),
            app_handle.clone(),
        )));
    }
    if !registry.contains(LIME_CREATE_AUDIO_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateAudioTaskTool::new(app_handle.clone())));
    }
    if !registry.contains(LIME_CREATE_TRANSCRIPTION_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateTranscriptionTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(LIME_CREATE_BROADCAST_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateBroadcastTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(LIME_CREATE_COVER_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateCoverTaskTool::new(app_handle.clone())));
    }
    if !registry.contains(LIME_CREATE_RESOURCE_SEARCH_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateResourceSearchTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(LIME_CREATE_IMAGE_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateImageTaskTool::new(app_handle.clone())));
    }
    if !registry.contains(LIME_CREATE_URL_PARSE_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateUrlParseTaskTool::new(
            app_handle.clone(),
        )));
    }
    if !registry.contains(LIME_CREATE_TYPESETTING_TASK_TOOL_NAME) {
        registry.register(Box::new(LimeCreateTypesettingTaskTool::new(app_handle)));
    }
}

pub(crate) async fn ensure_creation_task_tools_registered(
    state: &AsterAgentState,
    db: &DbConnection,
    api_key_provider_service: &ApiKeyProviderServiceState,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let (registry_arc, _) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    register_creation_task_tools_to_registry(
        &mut registry,
        db.clone(),
        api_key_provider_service.0.clone(),
        app_handle.clone(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::tempdir;

    #[test]
    fn image_task_input_schema_should_expose_model_and_hide_output_path() {
        let schema = image_task_input_schema();
        let properties = schema
            .get("properties")
            .and_then(Value::as_object)
            .expect("schema properties");

        assert!(properties.contains_key("model"));
        assert!(properties.contains_key("modality_contract_key"));
        assert!(properties.contains_key("required_capabilities"));
        assert!(!properties.contains_key("outputPath"));
    }

    #[test]
    fn build_image_generation_task_request_should_ignore_output_path_and_keep_standard_artifact() {
        let temp_dir = tempdir().expect("create temp dir");
        let context = ToolContext::new(temp_dir.path().to_path_buf())
            .with_session_id("session-image-compat-1")
            .with_environment(std::collections::HashMap::from([
                (
                    "LIME_PROJECT_ID".to_string(),
                    "project-image-compat-1".to_string(),
                ),
                (
                    "LIME_CONTENT_ID".to_string(),
                    "content-image-compat-1".to_string(),
                ),
            ]));
        let request = build_image_generation_task_request(
            &context,
            ImageTaskInput {
                prompt: "未来感青柠实验室".to_string(),
                title: Some("青柠主视觉".to_string()),
                title_generation_result: Some(serde_json::json!({
                    "title": "青柠主视觉",
                    "sessionId": "title-session-1",
                    "executionRuntime": {
                        "route": "auxiliary.generate_title"
                    },
                    "usedFallback": false
                })),
                mode: Some("generate".to_string()),
                raw_text: Some("@配图 未来感青柠实验室".to_string()),
                layout_hint: None,
                style: Some("cinematic".to_string()),
                size: Some("1024x1024".to_string()),
                aspect_ratio: Some("1:1".to_string()),
                count: Some(2),
                usage: Some("document-inline".to_string()),
                provider_id: Some("fal".to_string()),
                model: Some("fal-ai/nano-banana-pro".to_string()),
                session_id: None,
                project_id: None,
                content_id: None,
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: Some("generate".to_string()),
                slot_id: Some("slot-1".to_string()),
                anchor_hint: Some("section_end".to_string()),
                anchor_section_title: Some("技术亮点".to_string()),
                anchor_text: Some("这里需要一张未来实验室配图".to_string()),
                target_output_id: Some("task-a:output:1".to_string()),
                target_output_ref_id: Some("img-1".to_string()),
                reference_images: vec!["https://example.com/reference.png".to_string()],
                storyboard_slots: Vec::new(),
                output_path: Some("output/image_generation_task.md".to_string()),
            },
        );

        assert_eq!(
            request.project_root_path,
            temp_dir.path().to_string_lossy().to_string()
        );
        assert_eq!(request.model.as_deref(), Some("fal-ai/nano-banana-pro"));
        assert_eq!(
            request.session_id.as_deref(),
            Some("session-image-compat-1")
        );
        assert_eq!(
            request.project_id.as_deref(),
            Some("project-image-compat-1")
        );
        assert_eq!(
            request.content_id.as_deref(),
            Some("content-image-compat-1")
        );
        assert_eq!(request.entry_source.as_deref(), Some("at_image_command"));
        assert_eq!(
            request.modality_contract_key.as_deref(),
            Some("image_generation")
        );
        assert_eq!(request.modality.as_deref(), Some("image"));
        assert_eq!(
            request.required_capabilities,
            vec![
                "text_generation".to_string(),
                "image_generation".to_string(),
                "vision_input".to_string()
            ]
        );
        assert_eq!(
            request.routing_slot.as_deref(),
            Some("image_generation_model")
        );
        assert_eq!(
            request.title_generation_result,
            Some(serde_json::json!({
                "title": "青柠主视觉",
                "sessionId": "title-session-1",
                "executionRuntime": {
                    "route": "auxiliary.generate_title"
                },
                "usedFallback": false
            }))
        );

        let output =
            create_image_generation_task_artifact_inner(request).expect("create image artifact");

        assert!(output.path.contains("image_generate"));
        assert!(output.path.ends_with(".json"));
        assert!(!output.path.ends_with(".md"));
        assert!(output.absolute_path.ends_with(".json"));
        assert_eq!(
            output
                .record
                .payload
                .get("session_id")
                .and_then(Value::as_str),
            Some("session-image-compat-1")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("project_id")
                .and_then(Value::as_str),
            Some("project-image-compat-1")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("content_id")
                .and_then(Value::as_str),
            Some("content-image-compat-1")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("modality_contract_key")
                .and_then(Value::as_str),
            Some("image_generation")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("runtime_contract")
                .and_then(Value::as_object)
                .and_then(|contract| contract.get("contract_key"))
                .and_then(Value::as_str),
            Some("image_generation")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("entry_source")
                .and_then(Value::as_str),
            Some("at_image_command")
        );
        assert_eq!(
            output
                .record
                .payload
                .get("layout_hint")
                .and_then(Value::as_str),
            None
        );
        assert_eq!(
            output.record.payload.get("model").and_then(Value::as_str),
            Some("fal-ai/nano-banana-pro")
        );
    }

    #[test]
    fn build_audio_generation_task_request_should_keep_voice_contract_artifact() {
        let temp_dir = tempdir().expect("create temp dir");
        let context = ToolContext::new(temp_dir.path().to_path_buf())
            .with_session_id("session-audio-1")
            .with_environment(std::collections::HashMap::from([
                ("LIME_PROJECT_ID".to_string(), "project-audio-1".to_string()),
                ("LIME_CONTENT_ID".to_string(), "content-audio-1".to_string()),
            ]));
        let request = build_audio_generation_task_request(
            &context,
            AudioTaskInput {
                source_text: "请为这段新品发布文案生成温暖旁白".to_string(),
                title: Some("新品发布旁白".to_string()),
                raw_text: Some("@配音 请为这段新品发布文案生成温暖旁白".to_string()),
                voice: Some("warm_narrator".to_string()),
                voice_style: Some("温暖".to_string()),
                target_language: Some("zh-CN".to_string()),
                mime_type: None,
                audio_path: None,
                duration_ms: None,
                provider_id: Some("limecore".to_string()),
                model: Some("voice-pro".to_string()),
                session_id: None,
                project_id: None,
                content_id: None,
                entry_source: None,
                modality_contract_key: None,
                modality: None,
                required_capabilities: Vec::new(),
                routing_slot: None,
                runtime_contract: None,
                requested_target: None,
                output_path: None,
            },
        );

        assert_eq!(
            request.project_root_path,
            temp_dir.path().to_string_lossy().to_string()
        );
        assert_eq!(request.session_id.as_deref(), Some("session-audio-1"));
        assert_eq!(request.project_id.as_deref(), Some("project-audio-1"));
        assert_eq!(request.content_id.as_deref(), Some("content-audio-1"));
        assert_eq!(request.entry_source.as_deref(), Some("at_voice_command"));
        assert_eq!(
            request.modality_contract_key.as_deref(),
            Some("voice_generation")
        );
        assert_eq!(request.modality.as_deref(), Some("audio"));
        assert_eq!(
            request.required_capabilities,
            vec![
                "text_generation".to_string(),
                "voice_generation".to_string()
            ]
        );
        assert_eq!(
            request.routing_slot.as_deref(),
            Some("voice_generation_model")
        );

        let output =
            create_audio_generation_task_artifact_inner(request).expect("create audio artifact");

        assert!(output.path.contains("audio_generate"));
        assert_eq!(
            output
                .record
                .payload
                .get("modality_contract_key")
                .and_then(Value::as_str),
            Some("voice_generation")
        );
        assert_eq!(
            output
                .record
                .payload
                .pointer("/audio_output/kind")
                .and_then(Value::as_str),
            Some("audio_output")
        );
    }

    #[test]
    fn image_task_input_should_accept_snake_case_fields_from_skill_context() {
        let input: ImageTaskInput = serde_json::from_value(serde_json::json!({
            "prompt": "未来感青柠实验室",
            "title_generation_result": {
                "title": "未来感青柠实验室",
                "session_id": "title-session-2"
            },
            "raw_text": "@配图 未来感青柠实验室",
            "layout_hint": "storyboard_3x3",
            "aspect_ratio": "1:1",
            "count": "9",
            "provider_id": "custom-provider",
            "model": "gpt-images-2",
            "session_id": "session-image-compat-2",
            "project_id": "project-image-compat-2",
            "content_id": "content-image-compat-2",
            "entry_source": "at_image_command",
            "requested_target": "generate",
            "slot_id": "slot-2",
            "anchor_hint": "section_end",
            "anchor_section_title": "产品亮点",
            "anchor_text": "这里需要一张青柠实验室插图",
            "target_output_id": "task-a:output:1",
            "target_output_ref_id": "img-1",
            "reference_images": ["https://example.com/reference.png"]
        }))
        .expect("parse snake_case image task input");

        assert_eq!(input.raw_text.as_deref(), Some("@配图 未来感青柠实验室"));
        assert_eq!(
            input.title_generation_result,
            Some(serde_json::json!({
                "title": "未来感青柠实验室",
                "session_id": "title-session-2"
            }))
        );
        assert_eq!(input.layout_hint.as_deref(), Some("storyboard_3x3"));
        assert_eq!(input.aspect_ratio.as_deref(), Some("1:1"));
        assert_eq!(input.count, Some(9));
        assert_eq!(input.provider_id.as_deref(), Some("custom-provider"));
        assert_eq!(input.model.as_deref(), Some("gpt-images-2"));
        assert_eq!(input.session_id.as_deref(), Some("session-image-compat-2"));
        assert_eq!(input.project_id.as_deref(), Some("project-image-compat-2"));
        assert_eq!(input.content_id.as_deref(), Some("content-image-compat-2"));
        assert_eq!(input.entry_source.as_deref(), Some("at_image_command"));
        assert_eq!(input.requested_target.as_deref(), Some("generate"));
        assert_eq!(input.slot_id.as_deref(), Some("slot-2"));
        assert_eq!(input.anchor_hint.as_deref(), Some("section_end"));
        assert_eq!(input.anchor_section_title.as_deref(), Some("产品亮点"));
        assert_eq!(
            input.anchor_text.as_deref(),
            Some("这里需要一张青柠实验室插图")
        );
        assert_eq!(input.target_output_id.as_deref(), Some("task-a:output:1"));
        assert_eq!(input.target_output_ref_id.as_deref(), Some("img-1"));
        assert_eq!(
            input.reference_images,
            vec!["https://example.com/reference.png".to_string()]
        );
    }

    #[test]
    fn normalize_image_task_tool_params_should_accept_wrapped_object() {
        let normalized = normalize_image_task_tool_params(serde_json::json!({
            "image_task": {
                "prompt": "三国主要人物",
                "layout_hint": "storyboard_3x3",
                "count": 9,
                "provider_id": "custom-provider",
                "model": "gpt-images-2"
            }
        }))
        .expect("normalize wrapped object");

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse normalized wrapped object");
        assert_eq!(input.prompt, "三国主要人物");
        assert_eq!(input.layout_hint.as_deref(), Some("storyboard_3x3"));
        assert_eq!(input.count, Some(9));
        assert_eq!(input.provider_id.as_deref(), Some("custom-provider"));
        assert_eq!(input.model.as_deref(), Some("gpt-images-2"));
    }

    #[test]
    fn normalize_image_task_tool_params_should_accept_wrapped_json_string() {
        let normalized = normalize_image_task_tool_params(serde_json::json!({
            "image_task": "{\"prompt\":\"三国主要人物\",\"layout_hint\":\"storyboard_3x3\",\"count\":9,\"provider_id\":\"custom-provider\",\"model\":\"gpt-images-2\"}"
        }))
        .expect("normalize wrapped json string");

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse normalized wrapped string");
        assert_eq!(input.prompt, "三国主要人物");
        assert_eq!(input.layout_hint.as_deref(), Some("storyboard_3x3"));
        assert_eq!(input.count, Some(9));
        assert_eq!(input.provider_id.as_deref(), Some("custom-provider"));
        assert_eq!(input.model.as_deref(), Some("gpt-images-2"));
    }

    #[test]
    fn normalize_flat_image_task_tool_params_should_parse_array_strings_and_drop_skill_inputs() {
        let normalized = normalize_flat_image_task_tool_params(serde_json::json!({
            "prompt": "三国主要人物",
            "count": "9",
            "reference_images": "[]",
            "skill_input_images": "[]"
        }))
        .expect("normalize flat image task params");

        let record = normalized.as_object().expect("normalized object");
        assert_eq!(record.get("reference_images"), Some(&serde_json::json!([])));
        assert!(!record.contains_key("skill_input_images"));

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse normalized flat object");
        assert_eq!(input.prompt, "三国主要人物");
        assert_eq!(input.count, Some(9));
        assert!(input.reference_images.is_empty());
    }

    #[test]
    fn normalize_flat_image_task_tool_params_should_canonicalize_duplicate_alias_fields() {
        let normalized = normalize_flat_image_task_tool_params(serde_json::json!({
            "prompt": "三国主要人物",
            "count": "9",
            "titleGenerationResult": { "title": "三国主要人物", "sessionId": "title-camel" },
            "title_generation_result": { "title": "三国主要人物", "sessionId": "title-snake" },
            "providerId": "custom-provider-camel",
            "provider_id": "custom-provider-snake",
            "model": "gpt-images-2",
            "projectId": "project-camel",
            "project_id": "project-snake",
            "anchorHint": "section_end",
            "anchor_hint": "section-top",
            "referenceImages": "[]",
            "skillInputImages": "[]"
        }))
        .expect("normalize duplicate alias fields");

        let record = normalized.as_object().expect("normalized object");
        assert_eq!(
            record.get("provider_id"),
            Some(&serde_json::json!("custom-provider-snake"))
        );
        assert_eq!(
            record.get("project_id"),
            Some(&serde_json::json!("project-snake"))
        );
        assert_eq!(
            record.get("anchor_hint"),
            Some(&serde_json::json!("section-top"))
        );
        assert_eq!(
            record.get("title_generation_result"),
            Some(&serde_json::json!({ "title": "三国主要人物", "sessionId": "title-snake" }))
        );
        assert!(!record.contains_key("providerId"));
        assert!(!record.contains_key("projectId"));
        assert!(!record.contains_key("anchorHint"));
        assert!(!record.contains_key("titleGenerationResult"));
        assert!(!record.contains_key("referenceImages"));
        assert!(!record.contains_key("skillInputImages"));

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse canonicalized image task");
        assert_eq!(input.provider_id.as_deref(), Some("custom-provider-snake"));
        assert_eq!(input.project_id.as_deref(), Some("project-snake"));
        assert_eq!(input.anchor_hint.as_deref(), Some("section-top"));
        assert_eq!(
            input.title_generation_result,
            Some(serde_json::json!({ "title": "三国主要人物", "sessionId": "title-snake" }))
        );
        assert!(input.reference_images.is_empty());
    }

    #[test]
    fn image_task_input_schema_should_accept_runtime_compat_fields() {
        let schema = image_task_input_schema();
        let properties = schema["properties"]
            .as_object()
            .expect("image task schema properties");

        for field in [
            "raw_text",
            "title_generation_result",
            "layout_hint",
            "aspect_ratio",
            "provider_id",
            "session_id",
            "project_id",
            "content_id",
            "entry_source",
            "requested_target",
            "slot_id",
            "anchor_hint",
            "anchor_section_title",
            "anchor_text",
            "target_output_id",
            "target_output_ref_id",
            "reference_images",
            "storyboard_slots",
            "skill_input_images",
            "output_path",
        ] {
            assert!(
                properties.contains_key(field),
                "schema 应显式接受 compat 字段 {field}"
            );
        }

        assert!(properties["count"].get("oneOf").is_some());
        assert!(properties["reference_images"].get("oneOf").is_some());
        assert!(properties["storyboard_slots"].get("oneOf").is_some());
        assert!(properties["skill_input_images"].get("oneOf").is_some());
    }

    #[test]
    fn normalize_flat_image_task_tool_params_should_parse_storyboard_slots_array_string() {
        let normalized = normalize_flat_image_task_tool_params(serde_json::json!({
            "prompt": "三国主要人物",
            "layout_hint": "storyboard_3x3",
            "storyboard_slots": "[{\"slot_id\":\"storyboard-slot-1\",\"label\":\"刘备亮相\",\"prompt\":\"第1格，刘备中景亮相\",\"shot_type\":\"medium\"}]"
        }))
        .expect("normalize storyboard slot string");

        let record = normalized.as_object().expect("normalized object");
        assert_eq!(
            record.get("storyboard_slots"),
            Some(&serde_json::json!([
                {
                    "slot_id": "storyboard-slot-1",
                    "label": "刘备亮相",
                    "prompt": "第1格，刘备中景亮相",
                    "shot_type": "medium"
                }
            ]))
        );

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse storyboard slots");
        assert_eq!(input.storyboard_slots.len(), 1);
        assert_eq!(
            input.storyboard_slots[0].slot_id.as_deref(),
            Some("storyboard-slot-1")
        );
        assert_eq!(input.storyboard_slots[0].label.as_deref(), Some("刘备亮相"));
    }

    #[test]
    fn normalize_image_task_tool_params_should_preserve_storyboard_slots_from_wrapped_inputs() {
        let normalized = normalize_image_task_tool_params(serde_json::json!({
            "image_task": {
                "prompt": "三国主要人物",
                "layout_hint": "storyboard_3x3",
                "count": 2,
                "storyboardSlots": [
                    {
                        "slotId": "storyboard-slot-1",
                        "label": "刘备亮相",
                        "prompt": "第1格，刘备中景亮相",
                        "shotType": "medium"
                    },
                    {
                        "slot_id": "storyboard-slot-2",
                        "label": "曹操压迫感",
                        "prompt": "第2格，曹操近景特写",
                        "shot_type": "close_up"
                    }
                ]
            }
        }))
        .expect("normalize wrapped storyboard slots");

        let input: ImageTaskInput =
            serde_json::from_value(normalized).expect("parse wrapped storyboard slots");
        assert_eq!(input.storyboard_slots.len(), 2);
        assert_eq!(
            input.storyboard_slots[0].slot_id.as_deref(),
            Some("storyboard-slot-1")
        );
        assert_eq!(
            input.storyboard_slots[0].shot_type.as_deref(),
            Some("medium")
        );
        assert_eq!(
            input.storyboard_slots[1].slot_id.as_deref(),
            Some("storyboard-slot-2")
        );
        assert_eq!(
            input.storyboard_slots[1].shot_type.as_deref(),
            Some("close_up")
        );
    }
}
