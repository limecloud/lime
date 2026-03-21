use super::*;

fn is_safe_relative_path(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    !path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    })
}

fn resolve_output_relative_path(
    task_type: &str,
    output_path: Option<&str>,
) -> Result<PathBuf, ToolError> {
    if let Some(raw) = output_path {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ToolError::invalid_params(
                "outputPath 不能为空字符串".to_string(),
            ));
        }
        let candidate = PathBuf::from(trimmed);
        if !is_safe_relative_path(&candidate) {
            return Err(ToolError::invalid_params(
                "outputPath 必须是安全的相对路径，且不能包含 '..'".to_string(),
            ));
        }
        return Ok(candidate);
    }

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    Ok(PathBuf::from(".lime")
        .join("tasks")
        .join(task_type)
        .join(format!("{timestamp}-{suffix}.json")))
}

fn submit_creation_task_record(
    app_handle: &AppHandle,
    context: &ToolContext,
    task_type: &str,
    title: Option<String>,
    payload: serde_json::Value,
    output_path: Option<&str>,
) -> Result<ToolResult, ToolError> {
    let output_rel_path = resolve_output_relative_path(task_type, output_path)?;
    let output_abs_path = context.working_directory.join(&output_rel_path);

    let parent = output_abs_path
        .parent()
        .ok_or_else(|| ToolError::execution_failed("无法解析任务文件父目录".to_string()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| ToolError::execution_failed(format!("创建任务目录失败: {error}")))?;

    let task_id = uuid::Uuid::new_v4().to_string();
    let task_record = serde_json::json!({
        "task_id": task_id,
        "task_type": task_type,
        "title": title,
        "payload": payload,
        "status": "pending_submit",
        "created_at": chrono::Utc::now().to_rfc3339()
    });
    let task_content =
        serde_json::to_string_pretty(&task_record).unwrap_or_else(|_| task_record.to_string());

    std::fs::write(&output_abs_path, task_content.as_bytes())
        .map_err(|error| ToolError::execution_failed(format!("写入任务文件失败: {error}")))?;

    let emitted_payload = serde_json::json!({
        "task_id": task_id,
        "task_type": task_type,
        "path": output_rel_path.to_string_lossy().to_string(),
        "absolute_path": output_abs_path.to_string_lossy().to_string()
    });
    if let Err(error) = app_handle.emit("lime://creation_task_submitted", &emitted_payload) {
        tracing::warn!(
            "[AsterAgent] creation_task_submitted 事件发送失败: {}",
            error
        );
    }

    let output_payload = serde_json::json!({
        "success": true,
        "task_id": task_id,
        "task_type": task_type,
        "path": output_rel_path.to_string_lossy().to_string(),
        "absolute_path": output_abs_path.to_string_lossy().to_string(),
        "record": task_record
    });
    let output = serde_json::to_string_pretty(&output_payload)
        .unwrap_or_else(|_| output_payload.to_string());
    Ok(ToolResult::success(output)
        .with_metadata("task_id", serde_json::json!(task_id))
        .with_metadata("task_type", serde_json::json!(task_type))
        .with_metadata("path", serde_json::json!(output_abs_path.to_string_lossy())))
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
            "broadcast_generate",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CoverTaskInput {
    prompt: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    platform: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    image_url: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    remark: Option<String>,
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
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "platform": { "type": "string", "description": "目标平台（可选）。" },
                "size": { "type": "string", "description": "尺寸（可选）。" },
                "imageUrl": { "type": "string", "description": "生成后的封面 URL（可选）。" },
                "status": { "type": "string", "description": "状态（成功/失败，可选）。" },
                "remark": { "type": "string", "description": "备注（可选）。" },
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
            "platform": input.platform,
            "size": input.size,
            "imageUrl": input.image_url,
            "status": input.status,
            "remark": input.remark
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "cover_generate",
            input.title,
            payload,
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
            "modal_resource_search",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageTaskInput {
    prompt: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    count: Option<u32>,
    #[serde(default)]
    usage: Option<String>,
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

#[async_trait]
impl Tool for LimeCreateImageTaskTool {
    fn name(&self) -> &str {
        LIME_CREATE_IMAGE_TASK_TOOL_NAME
    }

    fn description(&self) -> &str {
        "创建图片生成任务（image_generate）。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "图像提示词。" },
                "title": { "type": "string", "description": "任务标题（可选）。" },
                "style": { "type": "string", "description": "风格（可选）。" },
                "size": { "type": "string", "description": "尺寸（可选）。" },
                "count": { "type": "integer", "minimum": 1, "maximum": 20, "description": "生成数量（可选）。" },
                "usage": { "type": "string", "description": "用途（可选）。" },
                "outputPath": { "type": "string", "description": "可选输出路径（相对工作目录）。" }
            },
            "required": ["prompt"],
            "additionalProperties": false,
            "x-lime": {
                "always_visible": true,
                "tags": ["image", "task", "generation"],
                "allowed_callers": ["assistant", "skill"]
            }
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input: ImageTaskInput = serde_json::from_value(params)
            .map_err(|error| ToolError::invalid_params(format!("参数解析失败: {error}")))?;
        if input.prompt.trim().is_empty() {
            return Err(ToolError::invalid_params(
                "prompt 不能为空字符串".to_string(),
            ));
        }
        let payload = serde_json::json!({
            "prompt": input.prompt,
            "style": input.style,
            "size": input.size,
            "count": input.count,
            "usage": input.usage
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "image_generate",
            input.title,
            payload,
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
    key_points: Option<Vec<String>>,
    #[serde(default)]
    extract_status: Option<String>,
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
                "keyPoints": { "type": "array", "items": { "type": "string" }, "description": "关键要点（可选）。" },
                "extractStatus": { "type": "string", "description": "提取状态（可选）。" },
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
        let payload = serde_json::json!({
            "url": input.url,
            "summary": input.summary,
            "keyPoints": input.key_points,
            "extractStatus": input.extract_status
        });
        submit_creation_task_record(
            &self.app_handle,
            context,
            "url_parse",
            input.title,
            payload,
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
            "typesetting",
            input.title,
            payload,
            input.output_path.as_deref(),
        )
    }
}

#[derive(Clone)]
struct LimeCreateVideoGenerationTaskTool {
    db: DbConnection,
    api_key_provider_service: Arc<ApiKeyProviderService>,
}

impl LimeCreateVideoGenerationTaskTool {
    fn new(db: DbConnection, api_key_provider_service: Arc<ApiKeyProviderService>) -> Self {
        Self {
            db,
            api_key_provider_service,
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
        _context: &ToolContext,
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

        let payload = serde_json::json!({
            "success": true,
            "task": created
        });
        let output = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        Ok(ToolResult::success(output))
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
