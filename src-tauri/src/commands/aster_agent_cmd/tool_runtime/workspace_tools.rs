use super::*;

pub(super) struct WorkspaceSandboxedBashTool {
    delegate: BashTool,
    app_handle: AppHandle,
    sandbox_type_name: String,
    base_sandbox_config: ProcessSandboxConfig,
    auto_approve_warnings: bool,
}

impl WorkspaceSandboxedBashTool {
    pub(super) fn new(
        workspace_root: &str,
        auto_approve_warnings: bool,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        let workspace_root = workspace_root.trim();
        if workspace_root.is_empty() {
            return Err("workspace 根目录为空".to_string());
        }

        let sandbox_type = detect_best_sandbox();
        let sandbox_type_name = format!("{sandbox_type:?}");
        if sandbox_type_name == "None" {
            return Err(format!(
                "未检测到可用本地 sandbox 执行器。{}",
                workspace_sandbox_platform_hint()
            ));
        }

        let workspace_path = PathBuf::from(workspace_root);
        let mut read_only_paths = vec![
            PathBuf::from("/usr"),
            PathBuf::from("/bin"),
            PathBuf::from("/sbin"),
            PathBuf::from("/etc"),
            PathBuf::from("/System"),
            PathBuf::from("/Library"),
            workspace_path.clone(),
        ];
        read_only_paths.sort();
        read_only_paths.dedup();

        let mut writable_paths = vec![workspace_path.clone(), PathBuf::from("/tmp")];
        if cfg!(target_os = "macos") {
            writable_paths.push(PathBuf::from("/private/tmp"));
        }
        writable_paths.sort();
        writable_paths.dedup();

        let base_sandbox_config = ProcessSandboxConfig {
            enabled: true,
            sandbox_type,
            allowed_paths: vec![workspace_path],
            denied_paths: Vec::new(),
            network_access: false,
            environment_variables: HashMap::new(),
            read_only_paths,
            writable_paths,
            allow_dev_access: false,
            allow_proc_access: false,
            allow_sys_access: false,
            env_whitelist: Vec::new(),
            tmpfs_size: "64M".to_string(),
            unshare_all: true,
            die_with_parent: true,
            new_session: true,
            docker: None,
            custom_args: Vec::new(),
            audit_logging: None,
            resource_limits: None,
        };

        Ok(Self {
            delegate: BashTool::new(),
            app_handle,
            sandbox_type_name,
            base_sandbox_config,
            auto_approve_warnings,
        })
    }

    pub(super) fn sandbox_type(&self) -> &str {
        &self.sandbox_type_name
    }

    fn build_sandbox_config(
        &self,
        context: &ToolContext,
        timeout_secs: u64,
    ) -> ProcessSandboxConfig {
        let mut config = self.base_sandbox_config.clone();

        let mut environment_variables = HashMap::new();
        environment_variables.insert("ASTER_TERMINAL".to_string(), "1".to_string());
        for (key, value) in &context.environment {
            environment_variables.insert(key.clone(), value.clone());
        }
        if let Ok(path_env) = std::env::var("PATH") {
            environment_variables
                .entry("PATH".to_string())
                .or_insert(path_env);
        }

        config.environment_variables = environment_variables;
        config.resource_limits = Some(ResourceLimits {
            max_memory: Some(1024 * 1024 * 1024),
            max_cpu: Some(70),
            max_processes: Some(32),
            max_file_size: Some(50 * 1024 * 1024),
            max_execution_time: Some(timeout_secs.saturating_mul(1000)),
            max_file_descriptors: Some(256),
        });
        config
    }

    #[cfg(not(target_os = "windows"))]
    fn quote_shell(value: &str) -> String {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }

    fn build_shell_command(&self, command: &str, _context: &ToolContext) -> (String, Vec<String>) {
        let command =
            lime_cli_runtime::prefix_shell_command_with_lime_cli(command, Some(&self.app_handle));

        #[cfg(target_os = "windows")]
        {
            return (
                "powershell".to_string(),
                vec![
                    "-NoProfile".to_string(),
                    "-NonInteractive".to_string(),
                    "-Command".to_string(),
                    command.to_string(),
                ],
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            let working_dir = _context.working_directory.to_string_lossy().to_string();
            let wrapped_command = format!("cd {} && {}", Self::quote_shell(&working_dir), command);
            ("sh".to_string(), vec!["-lc".to_string(), wrapped_command])
        }
    }

    fn format_output(stdout: &str, stderr: &str, exit_code: i32) -> String {
        let mut output = String::new();

        if !stdout.is_empty() {
            output.push_str(stdout);
        }

        if !stderr.is_empty() {
            if !output.is_empty() && !output.ends_with('\n') {
                output.push('\n');
            }
            if !stdout.is_empty() {
                output.push_str("--- stderr ---\n");
            }
            output.push_str(stderr);
        }

        if exit_code != 0 && output.is_empty() {
            output = format!("Command exited with code {exit_code}");
        }

        if output.len() <= MAX_OUTPUT_LENGTH {
            return output;
        }

        let bytes = output.as_bytes();
        let truncated = String::from_utf8_lossy(&bytes[..MAX_OUTPUT_LENGTH]).to_string();
        format!(
            "{}\n\n[output truncated: {} bytes total]",
            truncated,
            output.len()
        )
    }
}

pub(crate) fn normalize_shell_command_params(params: &serde_json::Value) -> serde_json::Value {
    let mut normalized = params.clone();
    if let Some(object) = normalized.as_object_mut() {
        let has_command = object
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

        if !has_command {
            if let Some(cmd_value) = object.get("cmd").cloned() {
                if cmd_value
                    .as_str()
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
                {
                    object.insert("command".to_string(), cmd_value);
                }
            }
        }
    }
    normalized
}

pub(crate) fn normalize_workspace_tool_permission_behavior(
    permission: PermissionCheckResult,
    auto_approve_warnings: bool,
) -> PermissionCheckResult {
    if permission.behavior != PermissionBehavior::Ask {
        return permission;
    }

    let warning = permission
        .message
        .unwrap_or_else(|| "命令包含潜在风险操作".to_string());

    if auto_approve_warnings {
        tracing::warn!("[AsterAgent] Auto 模式自动通过 bash 风险提示: {}", warning);
        return PermissionCheckResult {
            behavior: PermissionBehavior::Allow,
            message: None,
            updated_params: permission.updated_params,
        };
    }

    PermissionCheckResult {
        behavior: PermissionBehavior::Deny,
        message: Some(format!(
            "{warning}。当前模式不支持交互确认，请切换到 Auto 模式或调整命令。"
        )),
        updated_params: permission.updated_params,
    }
}

fn append_workspace_bash_summary(
    mut output: String,
    exit_code: i32,
    stdout_length: usize,
    stderr_length: usize,
    sandboxed: bool,
    sandbox_type: &str,
) -> String {
    if !output.is_empty() && !output.ends_with('\n') {
        output.push('\n');
    }

    let output_truncated = output.contains("[output truncated:");
    output.push_str("\n[Lime 执行摘要]\n");
    output.push_str(&format!("exit_code: {exit_code}\n"));
    output.push_str(&format!("stdout_length: {stdout_length}\n"));
    output.push_str(&format!("stderr_length: {stderr_length}\n"));
    output.push_str(&format!("sandboxed: {sandboxed}\n"));
    output.push_str(&format!("sandbox_type: {sandbox_type}\n"));
    output.push_str(&format!("output_truncated: {output_truncated}"));
    output
}

fn output_contains_lime_metadata_block(output: &str) -> bool {
    output.contains(LIME_TOOL_METADATA_BEGIN) && output.contains(LIME_TOOL_METADATA_END)
}

fn append_lime_tool_metadata_block(
    mut content: String,
    metadata: &serde_json::Map<String, serde_json::Value>,
) -> String {
    if output_contains_lime_metadata_block(&content) {
        return content;
    }

    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    if !content.is_empty() {
        content.push('\n');
    }

    let metadata_json = serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string());
    content.push_str(LIME_TOOL_METADATA_BEGIN);
    content.push('\n');
    content.push_str(&metadata_json);
    content.push('\n');
    content.push_str(LIME_TOOL_METADATA_END);
    content
}

pub(crate) fn encode_tool_result_for_harness_observability(result: ToolResult) -> ToolResult {
    let mut metadata = result.metadata.clone();
    let base_content = if result.success {
        result.output.unwrap_or_default()
    } else {
        metadata
            .entry("reported_success".to_string())
            .or_insert_with(|| serde_json::json!(false));
        result
            .error
            .unwrap_or_else(|| "工具执行失败，但未返回错误详情".to_string())
    };

    if result.success && metadata.is_empty() {
        return ToolResult::success(base_content);
    }

    let encoded_output =
        if metadata.is_empty() || output_contains_lime_metadata_block(&base_content) {
            base_content
        } else {
            let metadata_object = metadata
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect::<serde_json::Map<String, serde_json::Value>>();
            append_lime_tool_metadata_block(base_content, &metadata_object)
        };

    ToolResult::success(encoded_output).with_metadata_map(metadata)
}

fn remap_virtual_memory_path_param(
    params: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<bool, ToolError> {
    let Some(raw_path) = params.get(key).and_then(|value| value.as_str()) else {
        return Ok(false);
    };

    let Some(mapped_path) =
        resolve_virtual_memory_path(raw_path).map_err(ToolError::invalid_params)?
    else {
        return Ok(false);
    };

    params.insert(
        key.to_string(),
        serde_json::Value::String(mapped_path.to_string_lossy().to_string()),
    );
    Ok(true)
}

fn remap_virtual_memory_glob_pattern(
    params: &mut serde_json::Map<String, serde_json::Value>,
) -> Result<bool, ToolError> {
    let Some(pattern) = params.get("pattern").and_then(|value| value.as_str()) else {
        return Ok(false);
    };
    if !is_virtual_memory_path(pattern) {
        return Ok(false);
    }

    let relative_pattern = virtual_memory_relative_path(pattern).unwrap_or_default();
    if relative_pattern.split('/').any(|segment| segment == "..") {
        return Err(ToolError::invalid_params(
            "glob.pattern 中的 `/memories/` 路径不允许包含 `..`".to_string(),
        ));
    }

    let root_path = resolve_virtual_memory_path(DURABLE_MEMORY_VIRTUAL_ROOT)
        .map_err(ToolError::invalid_params)?
        .ok_or_else(|| ToolError::invalid_params("无法解析 durable memory 根目录".to_string()))?;

    let normalized_pattern = relative_pattern.trim_start_matches('/');
    let normalized_pattern = if normalized_pattern.is_empty() {
        "**/*".to_string()
    } else {
        normalized_pattern.to_string()
    };

    params.insert(
        "path".to_string(),
        serde_json::Value::String(root_path.to_string_lossy().to_string()),
    );
    params.insert(
        "pattern".to_string(),
        serde_json::Value::String(normalized_pattern),
    );
    Ok(true)
}

pub(crate) fn normalize_params_for_durable_memory_support(
    tool_name: &str,
    params: &serde_json::Value,
) -> Result<serde_json::Value, ToolError> {
    let Some(map) = params.as_object() else {
        return Ok(params.clone());
    };

    let mut normalized = map.clone();
    let mut changed = false;

    match tool_name {
        "Read" | "Write" | "Edit" | "Grep" | "read" | "write" | "edit" | "grep" => {
            changed |= remap_virtual_memory_path_param(&mut normalized, "path")?;
        }
        "Glob" | "glob" => {
            changed |= remap_virtual_memory_path_param(&mut normalized, "path")?;
            changed |= remap_virtual_memory_glob_pattern(&mut normalized)?;
        }
        _ => {}
    }

    if changed {
        Ok(serde_json::Value::Object(normalized))
    } else {
        Ok(params.clone())
    }
}

struct DurableMemoryMappedTool {
    delegate: Box<dyn Tool>,
}

impl DurableMemoryMappedTool {
    fn new(delegate: Box<dyn Tool>) -> Self {
        Self { delegate }
    }
}

#[async_trait]
impl Tool for DurableMemoryMappedTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn dynamic_description(&self) -> Option<String> {
        self.delegate.dynamic_description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params =
            match normalize_params_for_durable_memory_support(self.name(), params) {
                Ok(value) => value,
                Err(error) => {
                    return PermissionCheckResult::deny(format!(
                        "durable memory 参数无效: {error}"
                    ));
                }
            };

        let mut result = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;

        if result.updated_params.is_none() && normalized_params != *params {
            result.updated_params = Some(normalized_params);
        }
        result
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_params_for_durable_memory_support(self.name(), &params)?;
        self.delegate.execute(normalized_params, context).await
    }
}

struct HarnessObservedTool {
    delegate: Box<dyn Tool>,
}

impl HarnessObservedTool {
    fn new(delegate: Box<dyn Tool>) -> Self {
        Self { delegate }
    }
}

#[async_trait]
impl Tool for HarnessObservedTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn dynamic_description(&self) -> Option<String> {
        self.delegate.dynamic_description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        self.delegate.check_permissions(params, context).await
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        self.delegate
            .execute(params, context)
            .await
            .map(encode_tool_result_for_harness_observability)
    }
}

fn wrap_registry_native_tools_for_harness_observability(registry: &mut aster::tools::ToolRegistry) {
    let tool_names = registry
        .native_tool_names()
        .into_iter()
        .map(|name| name.to_string())
        .collect::<Vec<_>>();

    for tool_name in tool_names {
        let Some(tool) = registry.unregister(&tool_name) else {
            continue;
        };
        registry.register(Box::new(HarnessObservedTool::new(tool)));
    }
}

fn wrap_registry_native_tools_for_durable_memory_fs(registry: &mut aster::tools::ToolRegistry) {
    for tool_name in ["Read", "Write", "Edit", "Glob", "Grep"] {
        let Some(tool) = registry.unregister(tool_name) else {
            continue;
        };
        registry.register(Box::new(DurableMemoryMappedTool::new(tool)));
    }
}

#[async_trait]
impl Tool for WorkspaceSandboxedBashTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let normalized_params = normalize_shell_command_params(&params);

        if context.is_cancelled() {
            return Err(ToolError::Cancelled);
        }

        let permission = self.check_permissions(&normalized_params, context).await;
        match permission.behavior {
            PermissionBehavior::Allow => {}
            PermissionBehavior::Deny => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令被安全策略拒绝".to_string());
                return Err(ToolError::permission_denied(message));
            }
            PermissionBehavior::Ask => {
                let message = permission
                    .message
                    .unwrap_or_else(|| "命令需要人工确认".to_string());
                return Err(ToolError::permission_denied(message));
            }
        }

        let command = normalized_params
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::invalid_params("Missing required parameter: command"))?;

        let background = normalized_params
            .get("background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if background {
            return Err(ToolError::invalid_params(
                "本地 sandbox 模式不支持 background=true",
            ));
        }

        let timeout_secs = normalized_params
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_BASH_TIMEOUT_SECS)
            .min(MAX_BASH_TIMEOUT_SECS);

        let sandbox_config = self.build_sandbox_config(context, timeout_secs);
        let (entry, args) = self.build_shell_command(command, context);

        let execution = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            execute_in_sandbox(&entry, &args, &sandbox_config),
        )
        .await
        .map_err(|_| ToolError::timeout(Duration::from_secs(timeout_secs)))?
        .map_err(|e| ToolError::execution_failed(format!("sandbox 执行失败: {e}")))?;

        let output = append_workspace_bash_summary(
            Self::format_output(&execution.stdout, &execution.stderr, execution.exit_code),
            execution.exit_code,
            execution.stdout.len(),
            execution.stderr.len(),
            execution.sandboxed,
            &format!("{:?}", execution.sandbox_type),
        );
        if execution.exit_code == 0 {
            let result = ToolResult::success(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                );
            Ok(media_cli_bridge::enrich_tool_result_from_media_cli_output(
                result,
                &execution.stdout,
                Some(&self.app_handle),
            ))
        } else {
            let result = ToolResult::success(output)
                .with_metadata("exit_code", serde_json::json!(execution.exit_code))
                .with_metadata("stdout_length", serde_json::json!(execution.stdout.len()))
                .with_metadata("stderr_length", serde_json::json!(execution.stderr.len()))
                .with_metadata("sandboxed", serde_json::json!(execution.sandboxed))
                .with_metadata(
                    "sandbox_type",
                    serde_json::json!(format!("{:?}", execution.sandbox_type)),
                )
                .with_metadata("reported_success", serde_json::json!(false));
            Ok(media_cli_bridge::enrich_tool_result_from_media_cli_output(
                result,
                &execution.stdout,
                Some(&self.app_handle),
            ))
        }
    }
}

/// 统一处理 bash 工具的风险提示与共享任务管理器
struct WorkspaceBashTool {
    delegate: BashTool,
    app_handle: AppHandle,
    auto_approve_warnings: bool,
}

impl WorkspaceBashTool {
    fn new(
        auto_approve_warnings: bool,
        task_manager: Arc<TaskManager>,
        app_handle: AppHandle,
    ) -> Self {
        Self {
            delegate: BashTool::with_task_manager(task_manager),
            app_handle,
            auto_approve_warnings,
        }
    }
}

#[async_trait]
impl Tool for WorkspaceBashTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        let normalized_params = normalize_shell_command_params(params);
        let permission = self
            .delegate
            .check_permissions(&normalized_params, context)
            .await;
        normalize_workspace_tool_permission_behavior(permission, self.auto_approve_warnings)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let mut normalized_params = normalize_shell_command_params(&params);
        if let Some(object) = normalized_params.as_object_mut() {
            if let Some(command) = object.get("command").and_then(|value| value.as_str()) {
                object.insert(
                    "command".to_string(),
                    serde_json::Value::String(
                        lime_cli_runtime::prefix_shell_command_with_lime_cli(
                            command,
                            Some(&self.app_handle),
                        ),
                    ),
                );
            }
        }
        let result = self.delegate.execute(normalized_params, context).await?;
        let raw_output = result.output.as_deref().unwrap_or_default().to_string();
        Ok(media_cli_bridge::enrich_tool_result_from_media_cli_output(
            result,
            &raw_output,
            Some(&self.app_handle),
        ))
    }
}

struct WorkspaceTaskOutputTool {
    delegate: TaskOutputTool,
    task_manager: Arc<TaskManager>,
}

impl WorkspaceTaskOutputTool {
    fn new(task_manager: Arc<TaskManager>) -> Self {
        Self {
            delegate: TaskOutputTool::with_manager(task_manager.clone()),
            task_manager,
        }
    }
}

#[async_trait]
impl Tool for WorkspaceTaskOutputTool {
    fn name(&self) -> &str {
        self.delegate.name()
    }

    fn description(&self) -> &str {
        self.delegate.description()
    }

    fn input_schema(&self) -> serde_json::Value {
        self.delegate.input_schema()
    }

    fn options(&self) -> ToolOptions {
        self.delegate.options()
    }

    async fn check_permissions(
        &self,
        params: &serde_json::Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        self.delegate.check_permissions(params, context).await
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let input = serde_json::from_value::<TaskOutputInput>(params.clone()).ok();
        let mut result = self.delegate.execute(params, context).await?;

        let Some(task_id) = input.map(|value| value.task_id) else {
            return Ok(result);
        };

        let Some(state) = self.task_manager.get_status(&task_id).await else {
            return Ok(result);
        };

        result = result
            .with_metadata(
                "output_file",
                serde_json::json!(state.output_file.to_string_lossy().to_string()),
            )
            .with_metadata(
                "working_directory",
                serde_json::json!(state.working_directory.to_string_lossy().to_string()),
            )
            .with_metadata("session_id", serde_json::json!(state.session_id))
            .with_metadata("status", serde_json::json!(state.status.to_string()));

        if let Some(exit_code) = state.exit_code {
            result = result.with_metadata("exit_code", serde_json::json!(exit_code));
        }

        Ok(result)
    }
}

pub(super) fn register_workspace_runtime_tools(
    registry: &mut aster::tools::ToolRegistry,
    task_manager: Arc<TaskManager>,
    auto_approve_warnings: bool,
    app_handle: AppHandle,
    sandboxed_bash_tool: Option<WorkspaceSandboxedBashTool>,
) {
    registry.register(Box::new(WorkspaceBashTool::new(
        auto_approve_warnings,
        task_manager.clone(),
        app_handle,
    )));
    registry.register(Box::new(WorkspaceTaskOutputTool::new(task_manager.clone())));
    registry.register(Box::new(TaskStopTool::with_task_manager(task_manager)));

    if let Some(workspace_bash_tool) = sandboxed_bash_tool {
        registry.register(Box::new(workspace_bash_tool));
    }
}

pub(super) fn wrap_registry_native_tools_for_workspace_runtime(
    registry: &mut aster::tools::ToolRegistry,
) {
    wrap_registry_native_tools_for_durable_memory_fs(registry);
    wrap_registry_native_tools_for_harness_observability(registry);
}
