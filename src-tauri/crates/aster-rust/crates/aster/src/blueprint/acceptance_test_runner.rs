//! 验收测试运行器
//!
//! 用于在代码修改后自动运行相关的验收测试。
//! 这是验证层的核心组件，集成到 PostToolUse hook 中。
//!
//! 特点：
//! 1. 根据修改的文件找到相关的验收测试
//! 2. 异步执行，不阻塞对话
//! 3. 记录测试结果到任务树
//! 4. 支持多种测试框架

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;
use tokio::process::Command;
use tokio::sync::RwLock;

use super::blueprint_manager::BlueprintManager;
use super::task_tree_manager::TaskTreeManager;
use super::types::{AcceptanceTest, TaskNode};

// ============================================================================
// 类型定义
// ============================================================================

/// 测试运行结果
#[derive(Debug, Clone)]
pub struct AcceptanceTestRunResult {
    /// 测试 ID
    pub test_id: String,
    /// 测试名称
    pub test_name: String,
    /// 是否通过
    pub passed: bool,
    /// 输出内容
    pub output: String,
    /// 执行时长（毫秒）
    pub duration: u64,
    /// 错误信息
    pub error_message: Option<String>,
}

/// 运行器配置
#[derive(Debug, Clone)]
pub struct AcceptanceTestRunnerConfig {
    /// 项目根目录
    pub project_root: PathBuf,
    /// 测试超时时间（毫秒）
    pub test_timeout: u64,
    /// 是否启用调试日志
    pub debug: bool,
    /// 并行运行测试数量
    pub parallel_count: usize,
}

impl Default for AcceptanceTestRunnerConfig {
    fn default() -> Self {
        Self {
            project_root: std::env::current_dir().unwrap_or_default(),
            test_timeout: 60000,
            debug: false,
            parallel_count: 1,
        }
    }
}

// ============================================================================
// 验收测试运行器
// ============================================================================

/// 验收测试运行器
pub struct AcceptanceTestRunner {
    config: AcceptanceTestRunnerConfig,
    task_tree_manager: Arc<RwLock<TaskTreeManager>>,
    blueprint_manager: Arc<RwLock<BlueprintManager>>,
}

impl AcceptanceTestRunner {
    /// 创建新的运行器
    pub fn new(
        config: AcceptanceTestRunnerConfig,
        task_tree_manager: Arc<RwLock<TaskTreeManager>>,
        blueprint_manager: Arc<RwLock<BlueprintManager>>,
    ) -> Self {
        Self {
            config,
            task_tree_manager,
            blueprint_manager,
        }
    }

    /// 运行与修改文件相关的验收测试
    pub async fn run_tests_for_file(&self, file_path: &str) -> Vec<AcceptanceTestRunResult> {
        let tree_manager = self.task_tree_manager.read().await;

        // 获取当前任务树
        let tree = match tree_manager.get_current_task_tree().await {
            Some(t) => t,
            None => {
                self.log("[AcceptanceTestRunner] 没有活跃的任务树");
                return vec![];
            }
        };

        // 找到相关的验收测试
        let relevant_tests = self.find_relevant_tests(file_path, &tree.root).await;
        if relevant_tests.is_empty() {
            self.log(&format!(
                "[AcceptanceTestRunner] 没有找到与 {} 相关的验收测试",
                file_path
            ));
            return vec![];
        }

        self.log(&format!(
            "[AcceptanceTestRunner] 找到 {} 个相关测试",
            relevant_tests.len()
        ));

        let mut results = Vec::new();

        // 串行或并行执行测试
        if self.config.parallel_count > 1 {
            // 并行执行
            let batches = self.create_batches(&relevant_tests, self.config.parallel_count);
            for batch in batches {
                let mut handles = Vec::new();
                for test in batch {
                    let test_clone = test.clone();
                    let config = self.config.clone();
                    handles.push(tokio::spawn(async move {
                        Self::run_single_test_static(&config, &test_clone).await
                    }));
                }
                for handle in handles {
                    if let Ok(result) = handle.await {
                        results.push(result);
                    }
                }
            }
        } else {
            // 串行执行
            for test in &relevant_tests {
                let result = self.run_single_test(test).await;
                results.push(result);
            }
        }

        // 记录测试结果到任务树
        drop(tree_manager);
        self.record_results(&tree.id, &results).await;

        // 输出汇总
        self.print_summary(&results);

        results
    }

    /// 运行指定的验收测试
    pub async fn run_acceptance_test(&self, test: &AcceptanceTest) -> AcceptanceTestRunResult {
        self.run_single_test(test).await
    }

    /// 运行单个测试
    async fn run_single_test(&self, test: &AcceptanceTest) -> AcceptanceTestRunResult {
        Self::run_single_test_static(&self.config, test).await
    }

    /// 静态方法：运行单个测试（用于并行执行）
    async fn run_single_test_static(
        config: &AcceptanceTestRunnerConfig,
        test: &AcceptanceTest,
    ) -> AcceptanceTestRunResult {
        let start_time = Instant::now();

        if config.debug {
            println!("[AcceptanceTestRunner] 运行测试: {}", test.name);
        }

        match Self::execute_test_command(config, &test.test_command, Some(&test.test_file_path))
            .await
        {
            Ok(output) => {
                let duration = start_time.elapsed().as_millis() as u64;
                let passed = Self::parse_test_success(&output);

                let result = AcceptanceTestRunResult {
                    test_id: test.id.clone(),
                    test_name: test.name.clone(),
                    passed,
                    output: output.clone(),
                    duration,
                    error_message: if passed {
                        None
                    } else {
                        Some(Self::extract_error_message(&output))
                    },
                };

                if passed {
                    println!("✅ 验收测试通过: {} ({}ms)", test.name, duration);
                } else {
                    eprintln!("❌ 验收测试失败: {}", test.name);
                    if let Some(ref err) = result.error_message {
                        if let Some(first_line) = err.lines().next() {
                            eprintln!("   错误: {}", first_line);
                        }
                    }
                }

                result
            }
            Err(e) => {
                let duration = start_time.elapsed().as_millis() as u64;
                eprintln!("❌ 验收测试执行失败: {}", test.name);
                eprintln!("   {}", e);

                AcceptanceTestRunResult {
                    test_id: test.id.clone(),
                    test_name: test.name.clone(),
                    passed: false,
                    output: String::new(),
                    duration,
                    error_message: Some(e),
                }
            }
        }
    }

    /// 找到与修改文件相关的验收测试
    async fn find_relevant_tests(
        &self,
        file_path: &str,
        root_task: &TaskNode,
    ) -> Vec<AcceptanceTest> {
        let mut tests = Vec::new();
        let normalized_path = Path::new(file_path).to_string_lossy().to_lowercase();

        self.traverse_for_tests(root_task, &normalized_path, &mut tests)
            .await;
        tests
    }

    /// 递归遍历任务树查找相关测试
    async fn traverse_for_tests(
        &self,
        task: &TaskNode,
        normalized_file_path: &str,
        tests: &mut Vec<AcceptanceTest>,
    ) {
        for test in &task.acceptance_tests {
            if self
                .is_test_relevant(test, normalized_file_path, task)
                .await
            {
                tests.push(test.clone());
            }
        }

        for child in &task.children {
            Box::pin(self.traverse_for_tests(child, normalized_file_path, tests)).await;
        }
    }

    /// 判断测试是否与修改文件相关
    async fn is_test_relevant(
        &self,
        _test: &AcceptanceTest,
        normalized_file_path: &str,
        task: &TaskNode,
    ) -> bool {
        // 1. 检查任务的代码产出物是否包含该文件
        for artifact in &task.code_artifacts {
            if let Some(ref artifact_path) = artifact.file_path {
                let artifact_normalized = artifact_path.to_lowercase();
                if normalized_file_path.contains(&artifact_normalized)
                    || artifact_normalized.contains(normalized_file_path)
                {
                    return true;
                }
            }
        }

        // 2. 检查任务所属模块是否包含该文件
        if let Some(ref module_id) = task.blueprint_module_id {
            let bp_manager = self.blueprint_manager.read().await;
            if let Some(blueprint) = bp_manager.get_current_blueprint().await {
                if let Some(module) = blueprint.modules.iter().find(|m| &m.id == module_id) {
                    let default_path = format!("src/{}", module.name.to_lowercase());
                    let module_path = module.root_path.as_deref().unwrap_or(&default_path);
                    if normalized_file_path.contains(&module_path.to_lowercase()) {
                        return true;
                    }
                }
            }
        }

        // 3. 基于文件名匹配（简单启发式）
        let file_name = Path::new(normalized_file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let task_name_lower = task.name.to_lowercase();

        // 如果文件名包含任务名的一部分，可能相关
        let file_base_name = file_name
            .trim_end_matches(".ts")
            .trim_end_matches(".tsx")
            .trim_end_matches(".js")
            .trim_end_matches(".jsx")
            .trim_end_matches(".rs");

        if task_name_lower.contains(file_base_name)
            || file_base_name.contains(&task_name_lower.replace(' ', "-"))
        {
            return true;
        }

        false
    }

    /// 执行测试命令
    async fn execute_test_command(
        config: &AcceptanceTestRunnerConfig,
        command: &str,
        test_file_path: Option<&str>,
    ) -> Result<String, String> {
        // 构建完整命令
        let full_command = if let Some(path) = test_file_path {
            if !command.contains(path) {
                format!("{} {}", command, path)
            } else {
                command.to_string()
            }
        } else {
            command.to_string()
        };

        if config.debug {
            println!("[AcceptanceTestRunner] 执行命令: {}", full_command);
        }

        let parts: Vec<&str> = full_command.split_whitespace().collect();
        if parts.is_empty() {
            return Err("空命令".to_string());
        }

        let cmd = parts[0];
        let args = &parts[1..];

        let output = Command::new(cmd)
            .args(args)
            .current_dir(&config.project_root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("执行命令失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}{}", stdout, stderr);

        if output.status.success() {
            Ok(combined)
        } else {
            Err(format!(
                "测试命令退出码: {:?}\n{}",
                output.status.code(),
                combined
            ))
        }
    }

    /// 解析测试是否成功
    fn parse_test_success(output: &str) -> bool {
        // vitest 成功标识
        if output.contains("Test Files") && output.contains("passed") {
            return !output.contains("failed");
        }

        // jest 成功标识
        if output.contains("Tests:") && output.contains("passed") {
            return !output.contains("failed");
        }

        // mocha 成功标识
        if output.contains("passing") {
            return !output.contains("failing");
        }

        // pytest 成功标识
        if output.contains("passed") || output.contains("PASSED") {
            return !output.contains("failed") && !output.contains("FAILED");
        }

        // cargo test 成功标识
        if output.contains("test result: ok") {
            return true;
        }
        if output.contains("test result: FAILED") {
            return false;
        }

        // 默认：假设成功（因为没有异常退出）
        true
    }

    /// 提取错误信息
    fn extract_error_message(output: &str) -> String {
        let mut error_lines = Vec::new();
        let mut in_error = false;

        for line in output.lines() {
            if line.contains("Error:")
                || line.contains("FAIL")
                || line.contains("✖")
                || line.contains("AssertionError")
                || line.contains("panicked")
            {
                in_error = true;
            }

            if in_error {
                error_lines.push(line);
                if error_lines.len() >= 15 {
                    break;
                }
            }
        }

        if !error_lines.is_empty() {
            error_lines.join("\n")
        } else {
            output.chars().take(500).collect()
        }
    }

    /// 记录测试结果到任务树
    async fn record_results(&self, _tree_id: &str, results: &[AcceptanceTestRunResult]) {
        // 注意：TaskTreeManager 目前没有 record_acceptance_test_result 方法
        // 这里只打印日志，实际记录逻辑需要在 TaskTreeManager 中实现
        for result in results {
            if result.passed {
                tracing::info!("验收测试通过: {} ({}ms)", result.test_name, result.duration);
            } else {
                tracing::warn!(
                    "验收测试失败: {} - {:?}",
                    result.test_name,
                    result.error_message
                );
            }
        }
    }

    /// 从任务树中找到测试对应的任务 ID
    #[allow(dead_code)]
    fn find_task_id_for_test(root_task: &TaskNode, test_id: &str) -> Option<String> {
        for test in &root_task.acceptance_tests {
            if test.id == test_id {
                return Some(root_task.id.clone());
            }
        }

        for child in &root_task.children {
            if let Some(found) = Self::find_task_id_for_test(child, test_id) {
                return Some(found);
            }
        }

        None
    }

    /// 打印汇总
    fn print_summary(&self, results: &[AcceptanceTestRunResult]) {
        if results.is_empty() {
            return;
        }

        let passed = results.iter().filter(|r| r.passed).count();
        let failed = results.len() - passed;
        let total_duration: u64 = results.iter().map(|r| r.duration).sum();

        println!("\n📊 验收测试汇总:");
        println!(
            "   通过: {}, 失败: {}, 总耗时: {}ms",
            passed, failed, total_duration
        );

        if failed > 0 {
            println!("\n⚠️ 失败的测试:");
            for result in results.iter().filter(|r| !r.passed) {
                println!("   - {}", result.test_name);
            }
        }
    }

    /// 创建批次（用于并行执行）
    fn create_batches<T: Clone>(&self, items: &[T], batch_size: usize) -> Vec<Vec<T>> {
        items.chunks(batch_size).map(|c| c.to_vec()).collect()
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

    /// 设置项目根目录
    pub fn set_project_root(&mut self, project_root: PathBuf) {
        self.config.project_root = project_root;
    }

    /// 设置测试超时时间
    pub fn set_test_timeout(&mut self, timeout: u64) {
        self.config.test_timeout = timeout;
    }

    /// 设置调试模式
    pub fn set_debug(&mut self, debug: bool) {
        self.config.debug = debug;
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建验收测试运行器实例
pub fn create_acceptance_test_runner(
    config: AcceptanceTestRunnerConfig,
    task_tree_manager: Arc<RwLock<TaskTreeManager>>,
    blueprint_manager: Arc<RwLock<BlueprintManager>>,
) -> AcceptanceTestRunner {
    AcceptanceTestRunner::new(config, task_tree_manager, blueprint_manager)
}
