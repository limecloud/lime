//! Skill Execution Engine
//!
//! 定义 LLM Provider trait、执行回调接口和 Skill 执行器，用于 Skills 系统的执行引擎。
//!
//! # 概述
//!
//! 本模块提供了 Skills 执行引擎的核心抽象：
//! - `LlmProvider`: LLM 调用接口，由应用层实现
//! - `ExecutionCallback`: 执行进度回调接口，用于 UI 进度展示
//! - `NoopCallback`: 空回调实现，用于无 UI 场景
//! - `SkillExecutor`: Skill 执行器，根据执行模式分发到不同执行方法
//!
//! # 设计原则
//!
//! - **解耦设计**：框架层通过 trait 定义接口，应用层实现具体 LLM 调用
//! - **可扩展性**：支持流式和非流式两种调用方式
//! - **可测试性**：通过 trait 抽象便于 Mock 测试
//!
//! # 示例
//!
//! ```rust,ignore
//! use aster::skills::executor::{LlmProvider, ExecutionCallback, NoopCallback, SkillExecutor};
//! use aster::skills::error::SkillError;
//! use async_trait::async_trait;
//!
//! // 实现 LlmProvider
//! struct MyProvider;
//!
//! #[async_trait]
//! impl LlmProvider for MyProvider {
//!     async fn chat(
//!         &self,
//!         system_prompt: &str,
//!         user_message: &str,
//!         model: Option<&str>,
//!     ) -> Result<String, SkillError> {
//!         // 调用实际的 LLM API
//!         Ok("LLM 响应".to_string())
//!     }
//! }
//!
//! // 创建执行器并执行 Skill
//! let provider = MyProvider;
//! let executor = SkillExecutor::new(provider);
//! // let result = executor.execute(&skill, "用户输入", None).await;
//!
//! // 使用 NoopCallback
//! let callback = NoopCallback;
//! callback.on_step_start("step1", "分析步骤", 3);
//! ```

use async_trait::async_trait;

use super::error::SkillError;
use super::types::{SkillDefinition, SkillExecutionMode, SkillExecutionResult};

/// LLM Provider trait（应用层实现）
///
/// 定义 LLM 调用的抽象接口，由应用层（如 ProxyCast）实现具体的 API 调用逻辑。
///
/// # 设计说明
///
/// - `chat`: 必须实现的同步聊天方法
/// - `chat_stream`: 可选的流式聊天方法，默认回退到非流式实现
///
/// # 线程安全
///
/// 实现必须是 `Send + Sync`，以支持在异步上下文中使用。
///
/// # 示例
///
/// ```rust,ignore
/// use aster::skills::executor::LlmProvider;
/// use aster::skills::error::SkillError;
/// use async_trait::async_trait;
///
/// struct OpenAIProvider {
///     api_key: String,
/// }
///
/// #[async_trait]
/// impl LlmProvider for OpenAIProvider {
///     async fn chat(
///         &self,
///         system_prompt: &str,
///         user_message: &str,
///         model: Option<&str>,
///     ) -> Result<String, SkillError> {
///         let model = model.unwrap_or("gpt-4");
///         // 调用 OpenAI API...
///         Ok("响应内容".to_string())
///     }
/// }
/// ```
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// 发送聊天请求
    ///
    /// # Arguments
    ///
    /// * `system_prompt` - 系统提示词，定义 LLM 的行为和角色
    /// * `user_message` - 用户消息，实际的输入内容
    /// * `model` - 可选的模型名称，如 "gpt-4"、"claude-3-opus" 等
    ///
    /// # Returns
    ///
    /// 成功时返回 LLM 响应文本，失败时返回 `SkillError`
    ///
    /// # Errors
    ///
    /// - `SkillError::ProviderError`: API 调用失败（网络错误、认证失败等）
    /// - `SkillError::ExecutionFailed`: 响应处理失败
    async fn chat(
        &self,
        system_prompt: &str,
        user_message: &str,
        model: Option<&str>,
    ) -> Result<String, SkillError>;

    /// 流式聊天（可选实现）
    ///
    /// 支持流式响应的 LLM 调用，通过回调函数实时返回生成的内容片段。
    ///
    /// # Arguments
    ///
    /// * `system_prompt` - 系统提示词
    /// * `user_message` - 用户消息
    /// * `model` - 可选的模型名称
    /// * `callback` - 流式回调函数，每次收到新内容时调用
    ///
    /// # Returns
    ///
    /// 成功时返回完整的 LLM 响应文本，失败时返回 `SkillError`
    ///
    /// # Default Implementation
    ///
    /// 默认实现回退到非流式 `chat` 方法，忽略 callback 参数。
    /// 如果需要真正的流式支持，应用层应覆盖此方法。
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let callback = Box::new(|chunk: &str| {
    ///     print!("{}", chunk);
    /// });
    /// let result = provider.chat_stream(
    ///     "你是一个助手",
    ///     "你好",
    ///     Some("gpt-4"),
    ///     callback,
    /// ).await?;
    /// ```
    async fn chat_stream(
        &self,
        system_prompt: &str,
        user_message: &str,
        model: Option<&str>,
        _callback: Box<dyn Fn(&str) + Send>,
    ) -> Result<String, SkillError> {
        // 默认实现：回退到非流式
        self.chat(system_prompt, user_message, model).await
    }
}

/// 执行回调 trait（应用层实现，用于 UI 进度展示）
///
/// 定义执行过程中的进度回调接口，应用层可实现此 trait 来展示执行进度。
///
/// # 回调时机
///
/// - `on_step_start`: 步骤开始执行时调用
/// - `on_step_complete`: 步骤成功完成时调用
/// - `on_step_error`: 步骤执行失败时调用
/// - `on_complete`: 整体执行完成时调用
///
/// # 线程安全
///
/// 实现必须是 `Send + Sync`，以支持在异步上下文中使用。
///
/// # 示例
///
/// ```rust
/// use aster::skills::executor::ExecutionCallback;
///
/// struct ConsoleCallback;
///
/// impl ExecutionCallback for ConsoleCallback {
///     fn on_step_start(&self, step_id: &str, step_name: &str, total_steps: usize) {
///         println!("[{}/{}] 开始: {}", step_id, total_steps, step_name);
///     }
///
///     fn on_step_complete(&self, step_id: &str, output: &str) {
///         println!("[{}] 完成: {}...", step_id, &output[..50.min(output.len())]);
///     }
///
///     fn on_step_error(&self, step_id: &str, error: &str, will_retry: bool) {
///         if will_retry {
///             println!("[{}] 失败，将重试: {}", step_id, error);
///         } else {
///             println!("[{}] 失败: {}", step_id, error);
///         }
///     }
///
///     fn on_complete(&self, success: bool, final_output: Option<&str>) {
///         if success {
///             println!("执行成功！");
///         } else {
///             println!("执行失败");
///         }
///     }
/// }
/// ```
pub trait ExecutionCallback: Send + Sync {
    /// 步骤开始
    ///
    /// # Arguments
    ///
    /// * `step_id` - 步骤唯一标识符
    /// * `step_name` - 步骤显示名称
    /// * `total_steps` - 总步骤数
    fn on_step_start(&self, step_id: &str, step_name: &str, total_steps: usize);

    /// 步骤完成
    ///
    /// # Arguments
    ///
    /// * `step_id` - 步骤唯一标识符
    /// * `output` - 步骤输出内容
    fn on_step_complete(&self, step_id: &str, output: &str);

    /// 步骤失败
    ///
    /// # Arguments
    ///
    /// * `step_id` - 步骤唯一标识符
    /// * `error` - 错误信息
    /// * `will_retry` - 是否将进行重试
    fn on_step_error(&self, step_id: &str, error: &str, will_retry: bool);

    /// 整体完成
    ///
    /// # Arguments
    ///
    /// * `success` - 是否执行成功
    /// * `final_output` - 最终输出内容（成功时有值）
    fn on_complete(&self, success: bool, final_output: Option<&str>);
}

/// 空回调实现（用于无 UI 场景）
///
/// 当不需要进度回调时使用此实现，所有方法都是空操作。
///
/// # 示例
///
/// ```rust
/// use aster::skills::executor::{ExecutionCallback, NoopCallback};
///
/// let callback = NoopCallback;
/// callback.on_step_start("step1", "测试步骤", 1);
/// // 不会产生任何输出
/// ```
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopCallback;

impl ExecutionCallback for NoopCallback {
    fn on_step_start(&self, _step_id: &str, _step_name: &str, _total_steps: usize) {}

    fn on_step_complete(&self, _step_id: &str, _output: &str) {}

    fn on_step_error(&self, _step_id: &str, _error: &str, _will_retry: bool) {}

    fn on_complete(&self, _success: bool, _final_output: Option<&str>) {}
}

// ==================== SkillExecutor ====================

/// Skill 执行器
///
/// 根据 Skill 的执行模式分发到不同的执行方法。
///
/// # 类型参数
///
/// * `P` - 实现 `LlmProvider` trait 的类型，用于 LLM API 调用
///
/// # 执行模式
///
/// - `Prompt`: 单次对话，注入 System Prompt
/// - `Workflow`: 多步骤工作流
/// - `Agent`: 多轮迭代探索（未实现）
///
/// # 示例
///
/// ```rust,ignore
/// use aster::skills::executor::{SkillExecutor, LlmProvider, NoopCallback};
/// use aster::skills::error::SkillError;
/// use async_trait::async_trait;
///
/// struct MyProvider;
///
/// #[async_trait]
/// impl LlmProvider for MyProvider {
///     async fn chat(
///         &self,
///         system_prompt: &str,
///         user_message: &str,
///         model: Option<&str>,
///     ) -> Result<String, SkillError> {
///         Ok("响应".to_string())
///     }
/// }
///
/// let executor = SkillExecutor::new(MyProvider);
/// // let result = executor.execute(&skill, "输入", None).await;
/// ```
pub struct SkillExecutor<P: LlmProvider> {
    provider: P,
}

impl<P: LlmProvider> SkillExecutor<P> {
    /// 创建新的执行器
    ///
    /// # Arguments
    ///
    /// * `provider` - 实现 `LlmProvider` trait 的 LLM 提供者
    ///
    /// # Returns
    ///
    /// 新的 `SkillExecutor` 实例
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let executor = SkillExecutor::new(my_provider);
    /// ```
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    /// 获取 Provider 的引用
    ///
    /// # Returns
    ///
    /// Provider 的不可变引用
    pub fn provider(&self) -> &P {
        &self.provider
    }

    /// 执行 Skill
    ///
    /// 根据 Skill 的执行模式分发到不同的执行方法：
    /// - `Prompt` 模式：调用 `execute_prompt_mode`
    /// - `Workflow` 模式：调用 `execute_workflow_mode`
    /// - `Agent` 模式：返回 `NotImplemented` 错误
    ///
    /// # Arguments
    ///
    /// * `skill` - Skill 定义
    /// * `input` - 用户输入
    /// * `callback` - 可选的执行回调，用于进度通知
    ///
    /// # Returns
    ///
    /// 执行结果或错误
    ///
    /// # Errors
    ///
    /// - `SkillError::NotImplemented`: Agent 模式尚未实现
    /// - `SkillError::InvalidConfig`: Workflow 模式缺少 workflow 定义
    /// - `SkillError::ProviderError`: LLM API 调用失败
    /// - `SkillError::ExecutionFailed`: 执行过程中发生错误
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let result = executor.execute(&skill, "分析这段代码", None).await?;
    /// if result.success {
    ///     println!("输出: {}", result.output.unwrap_or_default());
    /// }
    /// ```
    pub async fn execute(
        &self,
        skill: &SkillDefinition,
        input: &str,
        callback: Option<&dyn ExecutionCallback>,
    ) -> Result<SkillExecutionResult, SkillError> {
        // 使用 NoopCallback 作为默认回调
        let noop = NoopCallback;
        let callback = callback.unwrap_or(&noop);

        // 根据执行模式分发
        match skill.execution_mode {
            SkillExecutionMode::Prompt => self.execute_prompt_mode(skill, input, callback).await,
            SkillExecutionMode::Workflow => {
                self.execute_workflow_mode(skill, input, callback).await
            }
            SkillExecutionMode::Agent => Err(SkillError::not_implemented(
                "Agent 模式尚未实现，请使用 Prompt 或 Workflow 模式",
            )),
        }
    }

    /// 执行 Prompt 模式
    ///
    /// 将 Skill 的 markdown_content 作为 system_prompt，用户输入作为 user_message，
    /// 调用 LLM Provider 进行对话。
    ///
    /// # Arguments
    ///
    /// * `skill` - Skill 定义
    /// * `input` - 用户输入
    /// * `callback` - 执行回调
    ///
    /// # Returns
    ///
    /// 执行结果或错误
    ///
    /// # 实现说明
    ///
    /// 此方法将在 Task 5.4 中完整实现。当前为占位实现。
    pub(crate) async fn execute_prompt_mode(
        &self,
        skill: &SkillDefinition,
        input: &str,
        callback: &dyn ExecutionCallback,
    ) -> Result<SkillExecutionResult, SkillError> {
        // 通知步骤开始
        callback.on_step_start("prompt", &skill.display_name, 1);

        // 调用 LLM Provider
        let model = skill.model.as_deref();
        let result = self
            .provider
            .chat(&skill.markdown_content, input, model)
            .await;

        match result {
            Ok(output) => {
                // 通知步骤完成
                callback.on_step_complete("prompt", &output);
                callback.on_complete(true, Some(&output));

                Ok(SkillExecutionResult {
                    success: true,
                    output: Some(output),
                    error: None,
                    steps_completed: vec![],
                    command_name: Some(skill.skill_name.clone()),
                    allowed_tools: skill.allowed_tools.clone(),
                    model: skill.model.clone(),
                    forwarded_tool_name: None,
                    forwarded_tool_metadata: None,
                })
            }
            Err(e) => {
                // 通知步骤失败
                let error_msg = e.to_string();
                callback.on_step_error("prompt", &error_msg, false);
                callback.on_complete(false, None);

                Ok(SkillExecutionResult {
                    success: false,
                    output: None,
                    error: Some(error_msg),
                    steps_completed: vec![],
                    command_name: Some(skill.skill_name.clone()),
                    allowed_tools: skill.allowed_tools.clone(),
                    model: skill.model.clone(),
                    forwarded_tool_name: None,
                    forwarded_tool_metadata: None,
                })
            }
        }
    }

    /// 执行 Workflow 模式
    ///
    /// 执行多步骤工作流，按依赖顺序执行各步骤，支持变量插值和重试机制。
    ///
    /// # Arguments
    ///
    /// * `skill` - Skill 定义（必须包含 workflow 字段）
    /// * `input` - 用户输入
    /// * `callback` - 执行回调
    ///
    /// # Returns
    ///
    /// 执行结果或错误
    ///
    /// # Errors
    ///
    /// - `SkillError::InvalidConfig`: 缺少 workflow 定义
    /// - `SkillError::CyclicDependency`: 工作流存在循环依赖
    /// - `SkillError::MissingDependency`: 步骤引用不存在的依赖
    ///
    /// # Requirements
    ///
    /// - **5.1**: 验证 workflow 定义存在
    /// - **5.2**: 执行拓扑排序
    /// - **5.3**: 按依赖顺序执行步骤
    /// - **5.4**: 执行变量插值
    /// - **5.5**: 将步骤输出存储到上下文
    /// - **5.6**: 返回最后一个步骤的输出作为结果
    /// - **8.3**: 重试耗尽且 continue_on_failure 为 false 时中止
    /// - **8.4**: 重试耗尽且 continue_on_failure 为 true 时继续
    pub(crate) async fn execute_workflow_mode(
        &self,
        skill: &SkillDefinition,
        input: &str,
        callback: &dyn ExecutionCallback,
    ) -> Result<SkillExecutionResult, SkillError> {
        use super::types::StepResult;
        use super::workflow::{interpolate_variables, topological_sort};
        use std::collections::HashMap;
        use tracing::{debug, error, info, warn};

        // 1. 验证 workflow 定义存在 (Requirement 5.1)
        let workflow = skill.workflow.as_ref().ok_or_else(|| {
            callback.on_complete(false, None);
            SkillError::invalid_config("Workflow 模式需要定义 workflow 字段")
        })?;

        info!(
            skill_name = %skill.skill_name,
            steps_count = workflow.steps.len(),
            max_retries = workflow.max_retries,
            continue_on_failure = workflow.continue_on_failure,
            "开始执行 Workflow 模式"
        );

        // 2. 拓扑排序步骤 (Requirement 5.2)
        let sorted_steps = topological_sort(&workflow.steps).inspect_err(|_| {
            callback.on_complete(false, None);
        })?;

        let total_steps = sorted_steps.len();
        debug!(total_steps = total_steps, "拓扑排序完成");

        // 3. 初始化上下文，添加 user_input
        let mut context: HashMap<String, String> = HashMap::new();
        context.insert("user_input".to_string(), input.to_string());

        // 4. 记录已完成的步骤结果
        let mut steps_completed: Vec<StepResult> = Vec::with_capacity(total_steps);
        let mut final_output: Option<String> = None;
        let mut had_failure = false;

        // 5. 循环执行步骤 (Requirement 5.3)
        for step in sorted_steps {
            // 5.1 执行变量插值 (Requirement 5.4)
            let interpolated_prompt = interpolate_variables(&step.prompt, &context);
            debug!(step_id = %step.id, "执行步骤，变量插值完成");

            // 5.2 执行步骤（带重试机制）
            match self
                .execute_step_with_retry(
                    step,
                    &interpolated_prompt,
                    workflow.max_retries,
                    total_steps,
                    callback,
                )
                .await
            {
                Ok(output) => {
                    info!(step_id = %step.id, output_len = output.len(), "步骤执行成功");
                    // 5.3 将输出存储到上下文 (Requirement 5.5)
                    context.insert(step.output.clone(), output.clone());
                    context.insert(format!("{}.output", step.id), output.clone());
                    callback.on_step_complete(&step.id, &output);
                    steps_completed.push(StepResult::success(&step.id, &step.name, &output));
                    final_output = Some(output);
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    error!(step_id = %step.id, error = %error_msg, "步骤执行失败");
                    had_failure = true;
                    steps_completed.push(StepResult::failure(&step.id, &step.name, &error_msg));

                    if workflow.continue_on_failure {
                        warn!(step_id = %step.id, "continue_on_failure=true，继续执行");
                        context.insert(step.output.clone(), String::new());
                        context.insert(format!("{}.output", step.id), String::new());
                    } else {
                        callback.on_complete(false, None);
                        return Ok(SkillExecutionResult {
                            success: false,
                            output: None,
                            error: Some(format!("步骤 '{}' 执行失败: {}", step.id, error_msg)),
                            steps_completed,
                            command_name: Some(skill.skill_name.clone()),
                            allowed_tools: skill.allowed_tools.clone(),
                            model: skill.model.clone(),
                            forwarded_tool_name: None,
                            forwarded_tool_metadata: None,
                        });
                    }
                }
            }
        }

        // 6. 所有步骤执行完成，返回结果 (Requirement 5.6)
        let success = !had_failure;
        info!(
            success = success,
            steps_completed = steps_completed.len(),
            "Workflow 执行完成"
        );

        callback.on_complete(success, final_output.as_deref());

        Ok(SkillExecutionResult {
            success,
            output: final_output,
            error: if had_failure {
                Some("部分步骤执行失败".to_string())
            } else {
                None
            },
            steps_completed,
            command_name: Some(skill.skill_name.clone()),
            allowed_tools: skill.allowed_tools.clone(),
            model: skill.model.clone(),
            forwarded_tool_name: None,
            forwarded_tool_metadata: None,
        })
    }

    /// 执行单个步骤（带重试机制）
    ///
    /// 执行工作流中的单个步骤，支持指数退避重试。当步骤执行失败时，
    /// 会按照指数退避策略进行重试，直到成功或达到最大重试次数。
    ///
    /// # 重试策略
    ///
    /// - 基础延迟：100ms
    /// - 指数退避：100ms * 2^attempt（attempt 从 0 开始）
    /// - 第 0 次重试：100ms
    /// - 第 1 次重试：200ms
    /// - 第 2 次重试：400ms
    /// - 以此类推...
    ///
    /// # Arguments
    ///
    /// * `step` - 要执行的工作流步骤
    /// * `interpolated_prompt` - 已完成变量插值的提示词
    /// * `max_retries` - 最大重试次数
    /// * `total_steps` - 工作流总步骤数（用于回调通知）
    /// * `callback` - 执行回调，用于通知重试状态
    ///
    /// # Returns
    ///
    /// 成功时返回 LLM 响应文本，失败时返回最后一次错误
    ///
    /// # 回调通知
    ///
    /// - 每次重试前调用 `on_step_error` 并设置 `will_retry=true`
    /// - 最后一次失败时调用 `on_step_error` 并设置 `will_retry=false`
    ///
    /// # 示例
    ///
    /// ```rust,ignore
    /// let result = executor.execute_step_with_retry(
    ///     &step,
    ///     "处理用户输入：Hello",
    ///     2,  // 最多重试 2 次
    ///     3,  // 总共 3 个步骤
    ///     &callback,
    /// ).await;
    /// ```
    ///
    /// # Requirements
    ///
    /// - **8.1**: 步骤失败时重试最多 max_retries 次
    /// - **8.2**: 使用指数退避（100ms * 2^attempt）
    /// - **8.5**: 通过 ExecutionCallback 通知每次重试尝试
    pub(crate) async fn execute_step_with_retry(
        &self,
        step: &super::types::WorkflowStep,
        interpolated_prompt: &str,
        max_retries: u32,
        total_steps: usize,
        callback: &dyn ExecutionCallback,
    ) -> Result<String, SkillError> {
        use std::time::Duration;
        use tokio::time::sleep;
        use tracing::{info, warn};

        // 基础延迟：100ms
        const BASE_DELAY_MS: u64 = 100;

        // 通知步骤开始
        callback.on_step_start(&step.id, &step.name, total_steps);

        let mut last_error: Option<SkillError> = None;

        // 尝试执行，包括初始执行 + 重试
        // attempt = 0 是初始执行，attempt = 1..=max_retries 是重试
        for attempt in 0..=max_retries {
            // 如果不是第一次尝试，先等待（指数退避）
            if attempt > 0 {
                let delay_ms = BASE_DELAY_MS * (1 << (attempt - 1)); // 100ms * 2^(attempt-1)
                let delay = Duration::from_millis(delay_ms);

                warn!(
                    step_id = %step.id,
                    attempt = attempt,
                    max_retries = max_retries,
                    delay_ms = delay_ms,
                    "步骤执行失败，等待后重试"
                );

                sleep(delay).await;
            }

            info!(
                step_id = %step.id,
                step_name = %step.name,
                attempt = attempt,
                "执行步骤"
            );

            // 调用 LLM Provider 执行步骤
            // 注意：工作流步骤使用空的 system_prompt，prompt 作为 user_message
            match self.provider.chat("", interpolated_prompt, None).await {
                Ok(output) => {
                    // 执行成功
                    info!(
                        step_id = %step.id,
                        attempt = attempt,
                        "步骤执行成功"
                    );
                    return Ok(output);
                }
                Err(e) => {
                    // 执行失败
                    let error_msg = e.to_string();
                    last_error = Some(e);

                    // 判断是否还有重试机会
                    let will_retry = attempt < max_retries;

                    // 通知回调
                    callback.on_step_error(&step.id, &error_msg, will_retry);

                    if will_retry {
                        warn!(
                            step_id = %step.id,
                            attempt = attempt,
                            max_retries = max_retries,
                            error = %error_msg,
                            "步骤执行失败，将进行重试"
                        );
                    } else {
                        warn!(
                            step_id = %step.id,
                            attempt = attempt,
                            max_retries = max_retries,
                            error = %error_msg,
                            "步骤执行失败，重试次数已耗尽"
                        );
                    }
                }
            }
        }

        // 所有重试都失败了，返回最后一次错误
        Err(last_error.unwrap_or_else(|| {
            SkillError::execution_failed(format!("步骤 '{}' 执行失败", step.id))
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    // ==================== Mock Provider 实现 ====================

    /// 测试用 Mock Provider
    struct MockProvider {
        response: String,
        should_fail: bool,
    }

    impl MockProvider {
        fn new(response: &str) -> Self {
            Self {
                response: response.to_string(),
                should_fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                response: String::new(),
                should_fail: true,
            }
        }
    }

    #[async_trait]
    impl LlmProvider for MockProvider {
        async fn chat(
            &self,
            _system_prompt: &str,
            _user_message: &str,
            _model: Option<&str>,
        ) -> Result<String, SkillError> {
            if self.should_fail {
                Err(SkillError::provider_error("Mock provider error"))
            } else {
                Ok(self.response.clone())
            }
        }
    }

    // ==================== Mock Callback 实现 ====================

    /// 测试用 Mock Callback，记录调用次数
    struct MockCallback {
        step_start_count: AtomicUsize,
        step_complete_count: AtomicUsize,
        step_error_count: AtomicUsize,
        complete_count: AtomicUsize,
    }

    impl MockCallback {
        fn new() -> Self {
            Self {
                step_start_count: AtomicUsize::new(0),
                step_complete_count: AtomicUsize::new(0),
                step_error_count: AtomicUsize::new(0),
                complete_count: AtomicUsize::new(0),
            }
        }
    }

    impl ExecutionCallback for MockCallback {
        fn on_step_start(&self, _step_id: &str, _step_name: &str, _total_steps: usize) {
            self.step_start_count.fetch_add(1, Ordering::SeqCst);
        }

        fn on_step_complete(&self, _step_id: &str, _output: &str) {
            self.step_complete_count.fetch_add(1, Ordering::SeqCst);
        }

        fn on_step_error(&self, _step_id: &str, _error: &str, _will_retry: bool) {
            self.step_error_count.fetch_add(1, Ordering::SeqCst);
        }

        fn on_complete(&self, _success: bool, _final_output: Option<&str>) {
            self.complete_count.fetch_add(1, Ordering::SeqCst);
        }
    }

    // ==================== LlmProvider trait 测试 ====================

    #[tokio::test]
    async fn test_mock_provider_chat_success() {
        let provider = MockProvider::new("Hello, world!");
        let result = provider
            .chat("System prompt", "User message", Some("gpt-4"))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Hello, world!");
    }

    #[tokio::test]
    async fn test_mock_provider_chat_failure() {
        let provider = MockProvider::failing();
        let result = provider.chat("System prompt", "User message", None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_provider_error());
    }

    #[tokio::test]
    async fn test_chat_stream_default_implementation() {
        let provider = MockProvider::new("Streamed response");
        let callback = Box::new(|_chunk: &str| {
            // 默认实现不会调用 callback
        });

        let result = provider
            .chat_stream("System prompt", "User message", Some("gpt-4"), callback)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "Streamed response");
    }

    #[tokio::test]
    async fn test_chat_with_none_model() {
        let provider = MockProvider::new("Response");
        let result = provider.chat("System", "User", None).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_chat_with_empty_prompts() {
        let provider = MockProvider::new("Response");
        let result = provider.chat("", "", None).await;

        assert!(result.is_ok());
    }

    // ==================== ExecutionCallback trait 测试 ====================

    #[test]
    fn test_mock_callback_step_start() {
        let callback = MockCallback::new();
        callback.on_step_start("step1", "Test Step", 3);

        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_mock_callback_step_complete() {
        let callback = MockCallback::new();
        callback.on_step_complete("step1", "Output content");

        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_mock_callback_step_error() {
        let callback = MockCallback::new();
        callback.on_step_error("step1", "Error message", true);

        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_mock_callback_complete() {
        let callback = MockCallback::new();
        callback.on_complete(true, Some("Final output"));

        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_mock_callback_multiple_calls() {
        let callback = MockCallback::new();

        callback.on_step_start("step1", "Step 1", 3);
        callback.on_step_complete("step1", "Output 1");
        callback.on_step_start("step2", "Step 2", 3);
        callback.on_step_error("step2", "Error", true);
        callback.on_step_start("step2", "Step 2 retry", 3);
        callback.on_step_complete("step2", "Output 2");
        callback.on_complete(true, Some("Final"));

        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 3);
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 2);
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
    }

    // ==================== NoopCallback 测试 ====================

    #[test]
    fn test_noop_callback_step_start() {
        let callback = NoopCallback;
        // 应该不会 panic
        callback.on_step_start("step1", "Test Step", 3);
    }

    #[test]
    fn test_noop_callback_step_complete() {
        let callback = NoopCallback;
        callback.on_step_complete("step1", "Output content");
    }

    #[test]
    fn test_noop_callback_step_error() {
        let callback = NoopCallback;
        callback.on_step_error("step1", "Error message", true);
    }

    #[test]
    fn test_noop_callback_complete() {
        let callback = NoopCallback;
        callback.on_complete(true, Some("Final output"));
    }

    #[test]
    fn test_noop_callback_complete_with_none() {
        let callback = NoopCallback;
        callback.on_complete(false, None);
    }

    #[test]
    fn test_noop_callback_is_default() {
        let callback = NoopCallback;
        callback.on_step_start("step1", "Test", 1);
    }

    #[test]
    fn test_noop_callback_is_clone() {
        let callback = NoopCallback;
        let cloned = callback;
        cloned.on_step_start("step1", "Test", 1);
    }

    #[test]
    fn test_noop_callback_debug() {
        let callback = NoopCallback;
        let debug_str = format!("{:?}", callback);
        assert!(debug_str.contains("NoopCallback"));
    }

    // ==================== Send + Sync 测试 ====================

    #[test]
    fn test_mock_provider_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MockProvider>();
    }

    #[test]
    fn test_mock_callback_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MockCallback>();
    }

    #[test]
    fn test_noop_callback_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<NoopCallback>();
    }

    // ==================== Arc 包装测试 ====================

    #[test]
    fn test_callback_with_arc() {
        let callback = Arc::new(MockCallback::new());
        let callback_clone = Arc::clone(&callback);

        callback.on_step_start("step1", "Test", 1);
        callback_clone.on_step_complete("step1", "Output");

        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 1);
    }

    // ==================== 边界情况测试 ====================

    #[tokio::test]
    async fn test_chat_with_unicode_content() {
        let provider = MockProvider::new("你好，世界！🌍");
        let result = provider
            .chat("系统提示词", "用户消息 🎉", Some("gpt-4"))
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "你好，世界！🌍");
    }

    #[tokio::test]
    async fn test_chat_with_long_content() {
        let long_response = "a".repeat(10000);
        let provider = MockProvider::new(&long_response);
        let result = provider.chat("System", "User", None).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 10000);
    }

    #[test]
    fn test_callback_with_empty_strings() {
        let callback = MockCallback::new();
        callback.on_step_start("", "", 0);
        callback.on_step_complete("", "");
        callback.on_step_error("", "", false);
        callback.on_complete(false, Some(""));

        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
    }

    // ==================== SkillExecutor 测试 ====================

    use super::super::types::{SkillSource, WorkflowDefinition, WorkflowStep};
    use std::path::PathBuf;

    /// 创建测试用 SkillDefinition
    fn create_test_skill(mode: SkillExecutionMode) -> SkillDefinition {
        SkillDefinition {
            skill_name: "test:test-skill".to_string(),
            display_name: "Test Skill".to_string(),
            description: "A test skill".to_string(),
            has_user_specified_description: true,
            markdown_content: "You are a helpful assistant.".to_string(),
            allowed_tools: Some(vec!["tool1".to_string(), "tool2".to_string()]),
            argument_hint: Some("input".to_string()),
            when_to_use: Some("When testing".to_string()),
            version: Some("1.0.0".to_string()),
            model: Some("gpt-4".to_string()),
            disable_model_invocation: false,
            user_invocable: true,
            source: SkillSource::User,
            base_dir: PathBuf::from("/test"),
            file_path: PathBuf::from("/test/SKILL.md"),
            supporting_files: vec![],
            execution_mode: mode,
            provider: None,
            workflow: None,
            hooks: None,
        }
    }

    /// 创建带 Workflow 的测试 SkillDefinition
    fn create_workflow_skill() -> SkillDefinition {
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![
            WorkflowStep::new("step1", "步骤一", "处理 ${user_input}", "result1"),
            WorkflowStep::new("step2", "步骤二", "继续 ${result1}", "result2")
                .with_dependency("step1"),
        ]));
        skill
    }

    // -------------------- SkillExecutor 创建测试 --------------------

    #[test]
    fn test_skill_executor_new() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);

        // 验证 executor 创建成功，provider 可以访问
        let _provider_ref = executor.provider();
    }

    #[test]
    fn test_skill_executor_provider_ref() {
        let provider = MockProvider::new("test response");
        let executor = SkillExecutor::new(provider);

        // 验证可以获取 provider 引用
        let _provider_ref = executor.provider();
    }

    // -------------------- execute 方法分发测试 --------------------

    #[tokio::test]
    async fn test_execute_dispatches_to_prompt_mode() {
        let provider = MockProvider::new("Prompt mode response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "test input", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some("Prompt mode response".to_string()));
    }

    #[tokio::test]
    async fn test_execute_dispatches_to_workflow_mode_without_workflow() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Workflow);

        let result = executor.execute(&skill, "test input", None).await;

        // 应该返回 InvalidConfig 错误，因为没有 workflow 定义
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_invalid_config());
        assert!(err.message().contains("workflow"));
    }

    #[tokio::test]
    async fn test_execute_dispatches_to_workflow_mode_with_workflow() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_workflow_skill();

        let result = executor.execute(&skill, "test input", None).await;

        // Workflow 模式应该成功执行
        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        // 应该有两个步骤完成
        assert_eq!(result.steps_completed.len(), 2);
        // 最终输出应该是最后一个步骤的输出
        assert!(result.output.is_some());
    }

    #[tokio::test]
    async fn test_execute_returns_not_implemented_for_agent_mode() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Agent);

        let result = executor.execute(&skill, "test input", None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_not_implemented());
        assert!(err.message().contains("Agent"));
    }

    // -------------------- Prompt 模式执行测试 --------------------

    #[tokio::test]
    async fn test_prompt_mode_success() {
        let provider = MockProvider::new("LLM response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "user input", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some("LLM response".to_string()));
        assert!(result.error.is_none());
        assert_eq!(result.command_name, Some("test:test-skill".to_string()));
        assert_eq!(result.model, Some("gpt-4".to_string()));
    }

    #[tokio::test]
    async fn test_prompt_mode_failure() {
        let provider = MockProvider::failing();
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "user input", None).await;

        assert!(result.is_ok()); // execute 返回 Ok，但 result.success 为 false
        let result = result.unwrap();
        assert!(!result.success);
        assert!(result.output.is_none());
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("Provider"));
    }

    #[tokio::test]
    async fn test_prompt_mode_with_callback() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);
        let callback = MockCallback::new();

        let result = executor.execute(&skill, "input", Some(&callback)).await;

        assert!(result.is_ok());
        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_prompt_mode_failure_with_callback() {
        let provider = MockProvider::failing();
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);
        let callback = MockCallback::new();

        let result = executor.execute(&skill, "input", Some(&callback)).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(!result.success);
        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_prompt_mode_without_callback() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        // 传入 None 作为 callback，应该使用 NoopCallback
        let result = executor.execute(&skill, "input", None).await;

        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    #[tokio::test]
    async fn test_prompt_mode_preserves_skill_metadata() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "input", None).await.unwrap();

        assert_eq!(result.command_name, Some("test:test-skill".to_string()));
        assert_eq!(
            result.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
        assert_eq!(result.model, Some("gpt-4".to_string()));
    }

    // -------------------- Workflow 模式验证测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_validates_workflow_definition() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = None; // 确保没有 workflow 定义

        let result = executor.execute(&skill, "input", None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_invalid_config());
    }

    // -------------------- 边界情况测试 --------------------

    #[tokio::test]
    async fn test_execute_with_empty_input() {
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "", None).await;

        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    #[tokio::test]
    async fn test_execute_with_unicode_input() {
        let provider = MockProvider::new("你好，世界！");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, "中文输入 🎉", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some("你好，世界！".to_string()));
    }

    #[tokio::test]
    async fn test_execute_with_long_input() {
        let long_input = "a".repeat(10000);
        let provider = MockProvider::new("response");
        let executor = SkillExecutor::new(provider);
        let skill = create_test_skill(SkillExecutionMode::Prompt);

        let result = executor.execute(&skill, &long_input, None).await;

        assert!(result.is_ok());
        assert!(result.unwrap().success);
    }

    // -------------------- SkillExecutor Send + Sync 测试 --------------------

    #[test]
    fn test_skill_executor_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<SkillExecutor<MockProvider>>();
    }

    // ==================== execute_step_with_retry 测试 ====================

    /// 可配置失败次数的 Mock Provider
    /// 用于测试重试机制
    struct RetryMockProvider {
        /// 失败次数计数器
        fail_count: std::sync::atomic::AtomicU32,
        /// 在成功前应该失败的次数
        fail_until: u32,
        /// 成功时返回的响应
        success_response: String,
    }

    impl RetryMockProvider {
        /// 创建一个在指定次数失败后成功的 Provider
        fn fail_then_succeed(fail_count: u32, response: &str) -> Self {
            Self {
                fail_count: std::sync::atomic::AtomicU32::new(0),
                fail_until: fail_count,
                success_response: response.to_string(),
            }
        }

        /// 创建一个始终失败的 Provider
        fn always_fail() -> Self {
            Self {
                fail_count: std::sync::atomic::AtomicU32::new(0),
                fail_until: u32::MAX,
                success_response: String::new(),
            }
        }

        /// 获取当前调用次数
        fn call_count(&self) -> u32 {
            self.fail_count.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl LlmProvider for RetryMockProvider {
        async fn chat(
            &self,
            _system_prompt: &str,
            _user_message: &str,
            _model: Option<&str>,
        ) -> Result<String, SkillError> {
            let current = self.fail_count.fetch_add(1, Ordering::SeqCst);
            if current < self.fail_until {
                Err(SkillError::provider_error(format!(
                    "模拟失败 (第 {} 次调用)",
                    current + 1
                )))
            } else {
                Ok(self.success_response.clone())
            }
        }
    }

    /// 记录重试详情的 Mock Callback
    struct RetryTrackingCallback {
        step_start_count: AtomicUsize,
        step_complete_count: AtomicUsize,
        step_error_count: AtomicUsize,
        /// 记录每次 on_step_error 的 will_retry 值
        will_retry_values: std::sync::Mutex<Vec<bool>>,
    }

    impl RetryTrackingCallback {
        fn new() -> Self {
            Self {
                step_start_count: AtomicUsize::new(0),
                step_complete_count: AtomicUsize::new(0),
                step_error_count: AtomicUsize::new(0),
                will_retry_values: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn get_will_retry_values(&self) -> Vec<bool> {
            self.will_retry_values.lock().unwrap().clone()
        }
    }

    impl ExecutionCallback for RetryTrackingCallback {
        fn on_step_start(&self, _step_id: &str, _step_name: &str, _total_steps: usize) {
            self.step_start_count.fetch_add(1, Ordering::SeqCst);
        }

        fn on_step_complete(&self, _step_id: &str, _output: &str) {
            self.step_complete_count.fetch_add(1, Ordering::SeqCst);
        }

        fn on_step_error(&self, _step_id: &str, _error: &str, will_retry: bool) {
            self.step_error_count.fetch_add(1, Ordering::SeqCst);
            self.will_retry_values.lock().unwrap().push(will_retry);
        }

        fn on_complete(&self, _success: bool, _final_output: Option<&str>) {}
    }

    // -------------------- 基本重试功能测试 --------------------

    #[tokio::test]
    async fn test_execute_step_with_retry_success_first_try() {
        let provider = MockProvider::new("成功响应");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 2, 1, &callback)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "成功响应");
        // 应该调用一次 on_step_start，没有错误
        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_success_after_one_retry() {
        // 第一次失败，第二次成功
        let provider = RetryMockProvider::fail_then_succeed(1, "重试后成功");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 2, 1, &callback)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "重试后成功");
        // 应该有一次错误回调，will_retry=true
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
        let will_retry_values = callback.get_will_retry_values();
        assert_eq!(will_retry_values, vec![true]);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_success_after_two_retries() {
        // 前两次失败，第三次成功
        let provider = RetryMockProvider::fail_then_succeed(2, "两次重试后成功");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 2, 1, &callback)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "两次重试后成功");
        // 应该有两次错误回调，都是 will_retry=true
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 2);
        let will_retry_values = callback.get_will_retry_values();
        assert_eq!(will_retry_values, vec![true, true]);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_all_retries_exhausted() {
        // 始终失败
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 2, 1, &callback)
            .await;

        assert!(result.is_err());
        // 应该有 3 次错误回调（初始 + 2 次重试）
        // will_retry: [true, true, false]
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 3);
        let will_retry_values = callback.get_will_retry_values();
        assert_eq!(will_retry_values, vec![true, true, false]);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_zero_retries() {
        // max_retries = 0，只尝试一次
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 0, 1, &callback)
            .await;

        assert!(result.is_err());
        // 只有一次错误回调，will_retry=false
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 1);
        let will_retry_values = callback.get_will_retry_values();
        assert_eq!(will_retry_values, vec![false]);
    }

    // -------------------- 回调通知测试 --------------------

    #[tokio::test]
    async fn test_execute_step_with_retry_calls_on_step_start() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let _ = executor
            .execute_step_with_retry(&step, "测试提示", 2, 5, &callback)
            .await;

        // 应该只调用一次 on_step_start（不是每次重试都调用）
        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_will_retry_flag_correct() {
        // 测试 will_retry 标志的正确性
        // max_retries = 3，始终失败
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = RetryTrackingCallback::new();

        let _ = executor
            .execute_step_with_retry(&step, "测试提示", 3, 1, &callback)
            .await;

        // 4 次尝试（初始 + 3 次重试）
        // will_retry: [true, true, true, false]
        let will_retry_values = callback.get_will_retry_values();
        assert_eq!(will_retry_values, vec![true, true, true, false]);
    }

    // -------------------- Provider 调用次数测试 --------------------

    #[tokio::test]
    async fn test_execute_step_with_retry_provider_call_count() {
        // 验证 Provider 被调用的次数
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = NoopCallback;

        let _ = executor
            .execute_step_with_retry(&step, "测试提示", 2, 1, &callback)
            .await;

        // 应该调用 3 次（初始 + 2 次重试）
        assert_eq!(executor.provider().call_count(), 3);
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_stops_on_success() {
        // 第二次成功，不应该继续重试
        let provider = RetryMockProvider::fail_then_succeed(1, "成功");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = NoopCallback;

        let _ = executor
            .execute_step_with_retry(&step, "测试提示", 5, 1, &callback)
            .await;

        // 应该只调用 2 次（第一次失败，第二次成功）
        assert_eq!(executor.provider().call_count(), 2);
    }

    // -------------------- 错误类型测试 --------------------

    #[tokio::test]
    async fn test_execute_step_with_retry_returns_last_error() {
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = NoopCallback;

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 1, 1, &callback)
            .await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        // 应该是 ProviderError
        assert!(err.is_provider_error());
    }

    // -------------------- 边界情况测试 --------------------

    #[tokio::test]
    async fn test_execute_step_with_retry_empty_prompt() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "", "output");
        let callback = NoopCallback;

        let result = executor
            .execute_step_with_retry(&step, "", 2, 1, &callback)
            .await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_unicode_content() {
        let provider = MockProvider::new("中文响应 🎉");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("步骤1", "中文步骤名", "中文提示", "输出");
        let callback = NoopCallback;

        let result = executor
            .execute_step_with_retry(&step, "中文提示 🚀", 2, 1, &callback)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "中文响应 🎉");
    }

    #[tokio::test]
    async fn test_execute_step_with_retry_large_max_retries() {
        // 测试大的 max_retries 值
        let provider = RetryMockProvider::fail_then_succeed(5, "成功");
        let executor = SkillExecutor::new(provider);
        let step = WorkflowStep::new("step1", "测试步骤", "测试提示", "output");
        let callback = NoopCallback;

        let result = executor
            .execute_step_with_retry(&step, "测试提示", 10, 1, &callback)
            .await;

        assert!(result.is_ok());
        // 应该调用 6 次（5 次失败 + 1 次成功）
        assert_eq!(executor.provider().call_count(), 6);
    }

    // ==================== Workflow 模式执行测试 ====================

    // -------------------- 基本功能测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_single_step_success() {
        let provider = MockProvider::new("步骤输出");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![WorkflowStep::new(
            "step1",
            "唯一步骤",
            "处理 ${user_input}",
            "result",
        )]));

        let result = executor.execute(&skill, "用户输入", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some("步骤输出".to_string()));
        assert_eq!(result.steps_completed.len(), 1);
        assert_eq!(result.steps_completed[0].step_id, "step1");
        assert!(result.steps_completed[0].success);
    }

    #[tokio::test]
    async fn test_workflow_mode_multiple_steps_success() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let skill = create_workflow_skill();

        let result = executor.execute(&skill, "测试输入", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.steps_completed.len(), 2);
        // 验证步骤顺序（step1 应该在 step2 之前）
        assert_eq!(result.steps_completed[0].step_id, "step1");
        assert_eq!(result.steps_completed[1].step_id, "step2");
    }

    #[tokio::test]
    async fn test_workflow_mode_with_callback() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let skill = create_workflow_skill();
        let callback = MockCallback::new();

        let result = executor.execute(&skill, "输入", Some(&callback)).await;

        assert!(result.is_ok());
        // 应该有 2 次 step_start（每个步骤一次）
        assert_eq!(callback.step_start_count.load(Ordering::SeqCst), 2);
        // 应该有 2 次 step_complete
        assert_eq!(callback.step_complete_count.load(Ordering::SeqCst), 2);
        // 应该有 1 次 complete
        assert_eq!(callback.complete_count.load(Ordering::SeqCst), 1);
        // 没有错误
        assert_eq!(callback.step_error_count.load(Ordering::SeqCst), 0);
    }

    // -------------------- 变量插值测试 --------------------

    /// 记录接收到的提示词的 Mock Provider
    struct PromptRecordingProvider {
        prompts: std::sync::Mutex<Vec<String>>,
        response: String,
    }

    impl PromptRecordingProvider {
        fn new(response: &str) -> Self {
            Self {
                prompts: std::sync::Mutex::new(Vec::new()),
                response: response.to_string(),
            }
        }

        fn get_prompts(&self) -> Vec<String> {
            self.prompts.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl LlmProvider for PromptRecordingProvider {
        async fn chat(
            &self,
            _system_prompt: &str,
            user_message: &str,
            _model: Option<&str>,
        ) -> Result<String, SkillError> {
            self.prompts.lock().unwrap().push(user_message.to_string());
            Ok(self.response.clone())
        }
    }

    #[tokio::test]
    async fn test_workflow_mode_variable_interpolation_user_input() {
        let provider = PromptRecordingProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![WorkflowStep::new(
            "step1",
            "步骤一",
            "处理用户输入: ${user_input}",
            "result",
        )]));

        let _ = executor.execute(&skill, "Hello World", None).await;

        let prompts = executor.provider().get_prompts();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0], "处理用户输入: Hello World");
    }

    #[tokio::test]
    async fn test_workflow_mode_variable_interpolation_step_output() {
        let provider = PromptRecordingProvider::new("步骤输出");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![
            WorkflowStep::new("step1", "步骤一", "第一步", "result1"),
            WorkflowStep::new("step2", "步骤二", "基于 ${result1} 继续", "result2")
                .with_dependency("step1"),
        ]));

        let _ = executor.execute(&skill, "输入", None).await;

        let prompts = executor.provider().get_prompts();
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0], "第一步");
        // 第二步应该使用第一步的输出进行插值
        assert_eq!(prompts[1], "基于 步骤输出 继续");
    }

    // -------------------- continue_on_failure 测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_continue_on_failure_false_aborts() {
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        let mut workflow = WorkflowDefinition::new(vec![
            WorkflowStep::new("step1", "步骤一", "第一步", "result1"),
            WorkflowStep::new("step2", "步骤二", "第二步", "result2").with_dependency("step1"),
        ]);
        workflow.continue_on_failure = false;
        workflow.max_retries = 0; // 不重试，立即失败
        skill.workflow = Some(workflow);

        let result = executor.execute(&skill, "输入", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(!result.success);
        // 只有第一个步骤被执行（失败）
        assert_eq!(result.steps_completed.len(), 1);
        assert!(!result.steps_completed[0].success);
        // 错误信息应该包含步骤 ID
        assert!(result.error.unwrap().contains("step1"));
    }

    #[tokio::test]
    async fn test_workflow_mode_continue_on_failure_true_continues() {
        let provider = RetryMockProvider::always_fail();
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        let mut workflow = WorkflowDefinition::new(vec![
            WorkflowStep::new("step1", "步骤一", "第一步", "result1"),
            WorkflowStep::new("step2", "步骤二", "第二步", "result2"),
        ]);
        workflow.continue_on_failure = true;
        workflow.max_retries = 0; // 不重试
        skill.workflow = Some(workflow);

        let result = executor.execute(&skill, "输入", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        // 虽然有失败，但因为 continue_on_failure=true，所以继续执行
        assert!(!result.success); // 整体失败
                                  // 两个步骤都被执行了
        assert_eq!(result.steps_completed.len(), 2);
        assert!(!result.steps_completed[0].success);
        assert!(!result.steps_completed[1].success);
    }

    // -------------------- 拓扑排序错误测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_cyclic_dependency_error() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![
            WorkflowStep::new("step1", "步骤一", "第一步", "result1").with_dependency("step2"),
            WorkflowStep::new("step2", "步骤二", "第二步", "result2").with_dependency("step1"),
        ]));

        let result = executor.execute(&skill, "输入", None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_cyclic_dependency());
    }

    #[tokio::test]
    async fn test_workflow_mode_missing_dependency_error() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![WorkflowStep::new(
            "step1",
            "步骤一",
            "第一步",
            "result1",
        )
        .with_dependency("nonexistent")]));

        let result = executor.execute(&skill, "输入", None).await;

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.is_missing_dependency());
    }

    // -------------------- 空工作流测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_empty_steps() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let mut skill = create_test_skill(SkillExecutionMode::Workflow);
        skill.workflow = Some(WorkflowDefinition::new(vec![]));

        let result = executor.execute(&skill, "输入", None).await;

        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.success);
        assert_eq!(result.steps_completed.len(), 0);
        assert!(result.output.is_none()); // 没有步骤，没有输出
    }

    // -------------------- 元数据保留测试 --------------------

    #[tokio::test]
    async fn test_workflow_mode_preserves_skill_metadata() {
        let provider = MockProvider::new("响应");
        let executor = SkillExecutor::new(provider);
        let skill = create_workflow_skill();

        let result = executor.execute(&skill, "输入", None).await.unwrap();

        assert_eq!(result.command_name, Some("test:test-skill".to_string()));
        assert_eq!(
            result.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
        assert_eq!(result.model, Some("gpt-4".to_string()));
    }
}
