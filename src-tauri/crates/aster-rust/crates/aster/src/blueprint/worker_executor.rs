//! Worker 执行器
//!
//! Worker Agent 的实际执行逻辑：
//! 1. 执行 TDD 各阶段（测试编写、代码实现、重构）
//! 2. 与 LLM API 交互生成代码
//! 3. 运行测试并解析结果
//!

use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use super::boundary_checker::{create_boundary_checker, BoundaryChecker};
use super::types::{AcceptanceTest, ArtifactType, Blueprint, TaskNode, TddPhase, TestResult};

// ============================================================================
// 配置类型
// ============================================================================

/// 测试框架类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TestFramework {
    /// Rust cargo test
    #[default]
    Cargo,
    /// Vitest (TypeScript)
    Vitest,
    /// Jest (TypeScript)
    Jest,
    /// Mocha (TypeScript)
    Mocha,
    /// Pytest (Python)
    Pytest,
}

impl TestFramework {
    /// 获取测试命令
    pub fn get_test_command(&self, test_file: &str) -> String {
        match self {
            Self::Cargo => format!("cargo test --lib -- {}", test_file),
            Self::Vitest => format!("npx vitest run {}", test_file),
            Self::Jest => format!("npx jest {}", test_file),
            Self::Mocha => format!("npx mocha {}", test_file),
            Self::Pytest => format!("pytest {}", test_file),
        }
    }
}

/// Worker 执行器配置
#[derive(Debug, Clone)]
pub struct WorkerExecutorConfig {
    /// 使用的模型
    pub model: String,
    /// 最大 tokens
    pub max_tokens: u32,
    /// 温度参数（控制创造性）
    pub temperature: f32,
    /// 项目根目录
    pub project_root: PathBuf,
    /// 测试框架
    pub test_framework: TestFramework,
    /// 测试超时时间（毫秒）
    pub test_timeout: u64,
    /// 是否启用调试日志
    pub debug: bool,
}

impl Default for WorkerExecutorConfig {
    fn default() -> Self {
        Self {
            model: "claude-3-haiku".to_string(),
            max_tokens: 8000,
            temperature: 0.3,
            project_root: std::env::current_dir().unwrap_or_default(),
            test_framework: TestFramework::default(),
            test_timeout: 60000,
            debug: false,
        }
    }
}

// ============================================================================
// 执行上下文
// ============================================================================

/// 代码片段
#[derive(Debug, Clone)]
pub struct CodeSnippet {
    pub file_path: String,
    pub content: String,
}

/// 执行上下文
#[derive(Debug, Clone)]
pub struct ExecutionContext {
    /// 任务节点
    pub task: TaskNode,
    /// 项目上下文信息
    pub project_context: Option<String>,
    /// 相关代码片段
    pub code_snippets: Vec<CodeSnippet>,
    /// 上次错误（如果有）
    pub last_error: Option<String>,
    /// 测试代码（write_code 阶段需要）
    pub test_code: Option<String>,
    /// 验收测试（如果有）
    pub acceptance_tests: Vec<AcceptanceTest>,
}

impl ExecutionContext {
    /// 创建新的执行上下文
    pub fn new(task: TaskNode) -> Self {
        Self {
            task,
            project_context: None,
            code_snippets: Vec::new(),
            last_error: None,
            test_code: None,
            acceptance_tests: Vec::new(),
        }
    }
}

// ============================================================================
// 阶段执行结果
// ============================================================================

/// 代码产出物
#[derive(Debug, Clone)]
pub struct CodeArtifactOutput {
    pub file_path: String,
    pub content: String,
}

/// 阶段执行结果
#[derive(Debug, Clone)]
pub struct PhaseResult {
    /// 是否成功
    pub success: bool,
    /// 输出数据
    pub data: HashMap<String, serde_json::Value>,
    /// 错误信息
    pub error: Option<String>,
    /// 生成的代码文件
    pub artifacts: Vec<CodeArtifactOutput>,
    /// 测试结果（如果执行了测试）
    pub test_result: Option<TestResult>,
}

impl PhaseResult {
    /// 创建成功结果
    pub fn success() -> Self {
        Self {
            success: true,
            data: HashMap::new(),
            error: None,
            artifacts: Vec::new(),
            test_result: None,
        }
    }

    /// 创建失败结果
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            data: HashMap::new(),
            error: Some(error.into()),
            artifacts: Vec::new(),
            test_result: None,
        }
    }

    /// 添加数据
    pub fn with_data(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.data.insert(key.into(), value);
        self
    }

    /// 添加产出物
    pub fn with_artifact(mut self, file_path: String, content: String) -> Self {
        self.artifacts
            .push(CodeArtifactOutput { file_path, content });
        self
    }

    /// 添加测试结果
    pub fn with_test_result(mut self, result: TestResult) -> Self {
        self.test_result = Some(result);
        self
    }
}

// ============================================================================
// Worker 执行器
// ============================================================================

/// Worker 执行器
///
/// 负责执行 TDD 各阶段的具体逻辑
pub struct WorkerExecutor {
    config: WorkerExecutorConfig,
    boundary_checker: Option<BoundaryChecker>,
    current_task_module_id: Option<String>,
}

impl WorkerExecutor {
    /// 创建新的 Worker 执行器
    pub fn new(config: WorkerExecutorConfig) -> Self {
        Self {
            config,
            boundary_checker: None,
            current_task_module_id: None,
        }
    }

    /// 设置蓝图（启用边界检查）
    pub fn set_blueprint(&mut self, blueprint: &Blueprint) {
        self.boundary_checker = Some(create_boundary_checker(blueprint.clone(), None));
    }

    /// 设置当前任务的模块 ID
    pub fn set_current_task_module(&mut self, module_id: Option<String>) {
        self.current_task_module_id = module_id;
    }

    // --------------------------------------------------------------------------
    // 执行 TDD 阶段
    // --------------------------------------------------------------------------

    /// 执行单个 TDD 阶段
    pub async fn execute_phase(&self, phase: TddPhase, context: &ExecutionContext) -> PhaseResult {
        self.log(&format!("[Worker] 执行阶段: {:?}", phase));

        match phase {
            TddPhase::WriteTest => self.execute_write_test(context).await,
            TddPhase::RunTestRed => self.execute_run_test_red(context).await,
            TddPhase::WriteCode => self.execute_write_code(context).await,
            TddPhase::RunTestGreen => self.execute_run_test_green(context).await,
            TddPhase::Refactor => self.execute_refactor(context).await,
            TddPhase::Done => PhaseResult::success()
                .with_data("message".to_string(), serde_json::json!("TDD 循环完成")),
        }
    }

    // --------------------------------------------------------------------------
    // write_test 阶段：生成测试代码
    // --------------------------------------------------------------------------

    async fn execute_write_test(&self, context: &ExecutionContext) -> PhaseResult {
        let task = &context.task;

        // 如果任务已经有验收测试（由蜂王生成），跳过测试编写
        if !task.acceptance_tests.is_empty() {
            self.log("[Worker] 任务已有验收测试，跳过测试编写阶段");
            return PhaseResult::success()
                .with_data(
                    "message".to_string(),
                    serde_json::json!("任务已有验收测试，无需编写额外测试"),
                )
                .with_data(
                    "acceptance_test_count".to_string(),
                    serde_json::json!(task.acceptance_tests.len()),
                );
        }

        // 生成测试代码（这里需要调用 LLM）
        let test_code = self.generate_test(task).await;

        // 确定测试文件路径
        let test_file_path = self.determine_test_file_path(task);

        // 保存测试文件
        if let Err(e) = self.save_file(&test_file_path, &test_code).await {
            return PhaseResult::failure(format!("保存测试文件失败: {}", e));
        }

        let test_command = self.config.test_framework.get_test_command(&test_file_path);

        PhaseResult::success()
            .with_data("test_code".to_string(), serde_json::json!(test_code))
            .with_data(
                "test_file_path".to_string(),
                serde_json::json!(test_file_path),
            )
            .with_data("test_command".to_string(), serde_json::json!(test_command))
            .with_artifact(test_file_path, test_code)
    }

    /// 生成测试代码
    async fn generate_test(&self, task: &TaskNode) -> String {
        let _prompt = self.build_test_prompt(task);

        // TODO: 调用 LLM API 生成测试代码
        // 这里返回占位符
        format!(
            r#"// 自动生成的测试代码
// 任务: {}
// 描述: {}

#[cfg(test)]
mod tests {{
    use super::*;

    #[test]
    fn test_placeholder() {{
        // TODO: 实现测试
        assert!(true);
    }}
}}
"#,
            task.name, task.description
        )
    }

    // --------------------------------------------------------------------------
    // run_test_red 阶段：运行测试（期望失败）
    // --------------------------------------------------------------------------

    async fn execute_run_test_red(&self, context: &ExecutionContext) -> PhaseResult {
        let task = &context.task;

        // 如果有验收测试，运行验收测试
        if !context.acceptance_tests.is_empty() {
            let mut results = Vec::new();

            for test in &context.acceptance_tests {
                let result = self.run_test(&test.test_file_path).await;
                results.push(result);
            }

            // 红灯阶段，测试应该失败
            let all_failed = results.iter().all(|r| !r.passed);

            return PhaseResult::success()
                .with_data("expected_to_fail".to_string(), serde_json::json!(true))
                .with_data("actually_failed".to_string(), serde_json::json!(all_failed))
                .with_test_result(results.into_iter().next().unwrap_or_else(|| TestResult {
                    id: Uuid::new_v4().to_string(),
                    timestamp: Utc::now(),
                    passed: false,
                    duration: 0,
                    output: String::new(),
                    error_message: None,
                    coverage: None,
                    details: None,
                }));
        }

        // 如果有 Worker 的测试规格，运行单元测试
        if let Some(ref test_spec) = task.test_spec {
            if let Some(ref test_file_path) = test_spec.test_file_path {
                let result = self.run_test(test_file_path).await;

                return PhaseResult::success()
                    .with_data("expected_to_fail".to_string(), serde_json::json!(true))
                    .with_data(
                        "actually_failed".to_string(),
                        serde_json::json!(!result.passed),
                    )
                    .with_test_result(result);
            }
        }

        PhaseResult::failure("没有找到可运行的测试")
    }

    // --------------------------------------------------------------------------
    // write_code 阶段：生成实现代码
    // --------------------------------------------------------------------------

    async fn execute_write_code(&self, context: &ExecutionContext) -> PhaseResult {
        let task = &context.task;
        let test_code = context.test_code.as_deref().unwrap_or("");
        let last_error = context.last_error.as_deref();

        // 生成实现代码
        let code_artifacts = self.generate_code(task, test_code, last_error).await;

        // 保存代码文件
        let mut result = PhaseResult::success().with_data(
            "file_count".to_string(),
            serde_json::json!(code_artifacts.len()),
        );

        for artifact in code_artifacts {
            if let Err(e) = self.save_file(&artifact.file_path, &artifact.content).await {
                return PhaseResult::failure(format!("保存代码文件失败: {}", e));
            }
            result = result.with_artifact(artifact.file_path, artifact.content);
        }

        result
    }

    /// 生成实现代码
    async fn generate_code(
        &self,
        task: &TaskNode,
        test_code: &str,
        last_error: Option<&str>,
    ) -> Vec<CodeArtifactOutput> {
        let _prompt = self.build_code_prompt(task, test_code, last_error);

        // TODO: 调用 LLM API 生成代码
        // 这里返回占位符
        vec![CodeArtifactOutput {
            file_path: format!("src/{}.rs", task.id),
            content: format!(
                r#"//! 自动生成的实现代码
//! 任务: {}
//! 描述: {}

pub fn placeholder() {{
    // TODO: 实现功能
}}
"#,
                task.name, task.description
            ),
        }]
    }

    // --------------------------------------------------------------------------
    // run_test_green 阶段：运行测试（期望通过）
    // --------------------------------------------------------------------------

    async fn execute_run_test_green(&self, context: &ExecutionContext) -> PhaseResult {
        let task = &context.task;

        // 如果有验收测试，运行所有验收测试
        if !context.acceptance_tests.is_empty() {
            let mut results = Vec::new();
            let mut total_duration = 0u64;
            let mut all_output = String::new();

            for test in &context.acceptance_tests {
                let result = self.run_test(&test.test_file_path).await;
                total_duration += result.duration;
                all_output.push_str(&result.output);
                all_output.push_str("\n\n");
                results.push(result);
            }

            let all_passed = results.iter().all(|r| r.passed);
            let error_message = if all_passed {
                None
            } else {
                Some(
                    results
                        .iter()
                        .filter(|r| !r.passed)
                        .filter_map(|r| r.error_message.clone())
                        .collect::<Vec<_>>()
                        .join("\n"),
                )
            };

            return PhaseResult::success()
                .with_data("expected_to_pass".to_string(), serde_json::json!(true))
                .with_data("actually_passed".to_string(), serde_json::json!(all_passed))
                .with_test_result(TestResult {
                    id: Uuid::new_v4().to_string(),
                    timestamp: Utc::now(),
                    passed: all_passed,
                    duration: total_duration,
                    output: all_output,
                    error_message,
                    coverage: None,
                    details: None,
                });
        }

        // 运行 Worker 的单元测试
        if let Some(ref test_spec) = task.test_spec {
            if let Some(ref test_file_path) = test_spec.test_file_path {
                let result = self.run_test(test_file_path).await;

                return PhaseResult::success()
                    .with_data("expected_to_pass".to_string(), serde_json::json!(true))
                    .with_data(
                        "actually_passed".to_string(),
                        serde_json::json!(result.passed),
                    )
                    .with_test_result(result);
            }
        }

        PhaseResult::failure("没有找到可运行的测试")
    }

    // --------------------------------------------------------------------------
    // refactor 阶段：重构代码
    // --------------------------------------------------------------------------

    async fn execute_refactor(&self, context: &ExecutionContext) -> PhaseResult {
        let task = &context.task;

        // 读取当前实现代码
        let current_code = self.read_task_code(task);

        if current_code.is_empty() {
            return PhaseResult::success().with_data(
                "message".to_string(),
                serde_json::json!("没有需要重构的代码"),
            );
        }

        // 生成重构后的代码
        let refactored_artifacts = self.refactor_code(task, &current_code).await;

        // 保存重构后的代码
        let mut result = PhaseResult::success().with_data(
            "file_count".to_string(),
            serde_json::json!(refactored_artifacts.len()),
        );

        for artifact in refactored_artifacts {
            if let Err(e) = self.save_file(&artifact.file_path, &artifact.content).await {
                return PhaseResult::failure(format!("保存重构代码失败: {}", e));
            }
            result = result.with_artifact(artifact.file_path, artifact.content);
        }

        result
    }

    /// 重构代码
    async fn refactor_code(
        &self,
        task: &TaskNode,
        current_code: &[CodeArtifactOutput],
    ) -> Vec<CodeArtifactOutput> {
        let _prompt = self.build_refactor_prompt(task, current_code);

        // TODO: 调用 LLM API 重构代码
        // 这里返回原代码（不做修改）
        current_code.to_vec()
    }

    // --------------------------------------------------------------------------
    // 运行测试
    // --------------------------------------------------------------------------

    /// 运行测试文件
    async fn run_test(&self, test_file_path: &str) -> TestResult {
        let start_time = std::time::Instant::now();
        let command = self.config.test_framework.get_test_command(test_file_path);

        // TODO: 实际执行命令
        // 这里返回模拟结果
        let duration = start_time.elapsed().as_millis() as u64;

        TestResult {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            passed: true, // 模拟通过
            duration,
            output: format!("运行测试: {}\n测试通过", command),
            error_message: None,
            coverage: None,
            details: None,
        }
    }

    // --------------------------------------------------------------------------
    // Prompt 构建
    // --------------------------------------------------------------------------

    /// 构建测试生成 Prompt
    fn build_test_prompt(&self, task: &TaskNode) -> String {
        format!(
            r#"# 任务：编写测试用例

## 任务描述
{}

{}

## 要求
1. 使用 {:?} 测试框架
2. 测试应该覆盖主要功能和边界情况
3. 测试应该失败（因为还没有实现代码）
4. 使用清晰的测试描述和断言

## 输出格式
请输出完整的测试代码，使用代码块包裹。
只输出测试代码，不要包含其他说明文字。"#,
            task.name, task.description, self.config.test_framework
        )
    }

    /// 构建代码生成 Prompt
    fn build_code_prompt(
        &self,
        task: &TaskNode,
        test_code: &str,
        last_error: Option<&str>,
    ) -> String {
        let mut prompt = format!(
            r#"# 任务：编写实现代码

## 任务描述
{}

{}

## 测试代码
```
{}
```
"#,
            task.name, task.description, test_code
        );

        if let Some(error) = last_error {
            prompt.push_str(&format!(
                r#"
## 上次测试错误
```
{}
```

请修复上述错误。
"#,
                error
            ));
        }

        prompt.push_str(
            r#"
## 要求
1. 编写最小可行代码使测试通过
2. 不要过度设计
3. 专注于当前测试
4. 遵循项目代码风格

## 输出格式
请为每个文件输出代码，使用如下格式：

### 文件：src/example.rs
```rust
// 代码内容
```

只输出代码文件，不要包含其他说明文字。"#,
        );

        prompt
    }

    /// 构建重构 Prompt
    fn build_refactor_prompt(
        &self,
        task: &TaskNode,
        current_code: &[CodeArtifactOutput],
    ) -> String {
        let mut prompt = format!(
            r#"# 任务：重构代码

## 任务描述
{}

## 当前代码
"#,
            task.name
        );

        for file in current_code {
            prompt.push_str(&format!(
                r#"
### 文件：{}
```rust
{}
```
"#,
                file.file_path, file.content
            ));
        }

        prompt.push_str(
            r#"
## 重构建议
1. 消除重复代码
2. 改善命名
3. 简化逻辑
4. 提高可读性
5. 确保测试仍然通过

## 输出格式
请为每个需要修改的文件输出重构后的代码。
如果某个文件不需要重构，不用输出。
只输出代码文件，不要包含其他说明文字。"#,
        );

        prompt
    }

    // --------------------------------------------------------------------------
    // 辅助方法
    // --------------------------------------------------------------------------

    /// 确定测试文件路径
    fn determine_test_file_path(&self, task: &TaskNode) -> String {
        // 如果任务已经指定了测试文件路径
        if let Some(ref test_spec) = task.test_spec {
            if let Some(ref path) = test_spec.test_file_path {
                return path.clone();
            }
        }

        // 生成默认测试文件路径
        match self.config.test_framework {
            TestFramework::Cargo => format!("tests/{}_test.rs", task.id),
            TestFramework::Vitest | TestFramework::Jest => {
                format!("__tests__/{}.test.ts", task.id)
            }
            TestFramework::Mocha => format!("test/{}.test.js", task.id),
            TestFramework::Pytest => format!("tests/test_{}.py", task.id),
        }
    }

    /// 读取任务的代码
    fn read_task_code(&self, task: &TaskNode) -> Vec<CodeArtifactOutput> {
        task.code_artifacts
            .iter()
            .filter_map(|artifact| {
                if artifact.artifact_type == ArtifactType::File {
                    Some(CodeArtifactOutput {
                        file_path: artifact.file_path.clone().unwrap_or_default(),
                        content: artifact.content.clone().unwrap_or_default(),
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    /// 保存文件
    async fn save_file(&self, file_path: &str, content: &str) -> Result<(), String> {
        let full_path = if Path::new(file_path).is_absolute() {
            PathBuf::from(file_path)
        } else {
            self.config.project_root.join(file_path)
        };

        // 边界检查
        if let Some(ref checker) = self.boundary_checker {
            let result = checker.check_task_boundary(
                self.current_task_module_id.as_deref(),
                full_path.to_str().unwrap_or(""),
            );
            if !result.allowed {
                return Err(format!(
                    "[边界检查失败] {}",
                    result.reason.unwrap_or_default()
                ));
            }
        }

        // 确保目录存在
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }

        // 写入文件
        std::fs::write(&full_path, content).map_err(|e| format!("写入文件失败: {}", e))?;

        self.log(&format!("[Worker] 保存文件: {}", file_path));
        Ok(())
    }

    /// 日志输出
    fn log(&self, message: &str) {
        if self.config.debug {
            println!("{}", message);
        }
    }

    // --------------------------------------------------------------------------
    // 配置管理
    // --------------------------------------------------------------------------

    /// 设置模型
    pub fn set_model(&mut self, model: impl Into<String>) {
        self.config.model = model.into();
    }

    /// 设置项目根目录
    pub fn set_project_root(&mut self, project_root: PathBuf) {
        self.config.project_root = project_root;
    }

    /// 设置测试框架
    pub fn set_test_framework(&mut self, framework: TestFramework) {
        self.config.test_framework = framework;
    }

    /// 获取配置
    pub fn config(&self) -> &WorkerExecutorConfig {
        &self.config
    }
}

impl Default for WorkerExecutor {
    fn default() -> Self {
        Self::new(WorkerExecutorConfig::default())
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建 Worker 执行器
pub fn create_worker_executor(config: WorkerExecutorConfig) -> WorkerExecutor {
    WorkerExecutor::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_executor_config_default() {
        let config = WorkerExecutorConfig::default();
        assert_eq!(config.model, "claude-3-haiku");
        assert_eq!(config.max_tokens, 8000);
        assert_eq!(config.test_framework, TestFramework::Cargo);
    }

    #[test]
    fn test_test_framework_command() {
        assert!(TestFramework::Cargo
            .get_test_command("test_file")
            .contains("cargo test"));
        assert!(TestFramework::Vitest
            .get_test_command("test_file")
            .contains("vitest"));
    }

    #[test]
    fn test_phase_result_builder() {
        let result = PhaseResult::success()
            .with_data("key".to_string(), serde_json::json!("value"))
            .with_artifact("file.rs".to_string(), "content".to_string());

        assert!(result.success);
        assert_eq!(result.artifacts.len(), 1);
        assert!(result.data.contains_key("key"));
    }
}
