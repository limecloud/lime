//! 验收测试生成器
//!
//! 由主 Agent（Queen）调用，在任务分配给子 Agent（Worker）之前生成验收测试。
//! 验收测试一旦生成，子 Agent 不能修改，只能编写代码使其通过。
//!

use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use uuid::Uuid;

use super::types::{
    AcceptanceCheckType, AcceptanceCriterion, AcceptanceTest, Blueprint, SystemModule, TaskNode,
};

// ============================================================================
// 配置类型
// ============================================================================

/// 验收测试生成配置
#[derive(Debug, Clone)]
pub struct AcceptanceTestGeneratorConfig {
    /// 使用的模型
    pub model: String,
    /// 项目根目录
    pub project_root: PathBuf,
    /// 测试框架
    pub test_framework: String,
    /// 测试目录
    pub test_directory: String,
}

impl Default for AcceptanceTestGeneratorConfig {
    fn default() -> Self {
        Self {
            model: "claude-3-sonnet".to_string(),
            project_root: std::env::current_dir().unwrap_or_default(),
            test_framework: "cargo".to_string(),
            test_directory: "tests".to_string(),
        }
    }
}

// ============================================================================
// 生成上下文
// ============================================================================

/// 生成验收测试的上下文
#[derive(Debug, Clone)]
pub struct AcceptanceTestContext {
    /// 任务信息
    pub task: TaskNode,
    /// 所属蓝图
    pub blueprint: Blueprint,
    /// 关联的模块
    pub module: Option<SystemModule>,
    /// 父任务的验收测试（用于参考）
    pub parent_acceptance_tests: Vec<AcceptanceTest>,
    /// 相关代码文件内容
    pub related_code: HashMap<String, String>,
}

impl AcceptanceTestContext {
    /// 创建新的上下文
    pub fn new(task: TaskNode, blueprint: Blueprint) -> Self {
        Self {
            task,
            blueprint,
            module: None,
            parent_acceptance_tests: Vec::new(),
            related_code: HashMap::new(),
        }
    }

    /// 设置关联模块
    pub fn with_module(mut self, module: SystemModule) -> Self {
        self.module = Some(module);
        self
    }

    /// 添加父任务验收测试
    pub fn with_parent_tests(mut self, tests: Vec<AcceptanceTest>) -> Self {
        self.parent_acceptance_tests = tests;
        self
    }

    /// 添加相关代码
    pub fn with_related_code(mut self, code: HashMap<String, String>) -> Self {
        self.related_code = code;
        self
    }
}

// ============================================================================
// 生成结果
// ============================================================================

/// 验收测试生成结果
#[derive(Debug, Clone)]
pub struct AcceptanceTestResult {
    pub success: bool,
    pub tests: Vec<AcceptanceTest>,
    pub error: Option<String>,
}

impl AcceptanceTestResult {
    /// 创建成功结果
    pub fn success(tests: Vec<AcceptanceTest>) -> Self {
        Self {
            success: true,
            tests,
            error: None,
        }
    }

    /// 创建失败结果
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            tests: Vec::new(),
            error: Some(error.into()),
        }
    }
}

// ============================================================================
// 验收测试生成器
// ============================================================================

/// 验收测试生成器
pub struct AcceptanceTestGenerator {
    config: AcceptanceTestGeneratorConfig,
}

impl AcceptanceTestGenerator {
    /// 创建新的生成器
    pub fn new(config: AcceptanceTestGeneratorConfig) -> Self {
        Self { config }
    }

    /// 为任务生成验收测试
    pub async fn generate_acceptance_tests(
        &self,
        context: &AcceptanceTestContext,
    ) -> AcceptanceTestResult {
        let _prompt = self.build_prompt(context);

        // TODO: 调用 LLM API 生成测试
        // 这里返回模拟结果
        let tests = self.generate_mock_tests(context);

        AcceptanceTestResult::success(tests)
    }

    /// 构建生成验收测试的 prompt
    fn build_prompt(&self, context: &AcceptanceTestContext) -> String {
        let task = &context.task;
        let blueprint = &context.blueprint;

        let mut prompt = format!(
            r#"你是一个专业的软件测试专家，负责为任务生成验收测试。

## 任务信息
- **任务名称**: {}
- **任务描述**: {}
- **优先级**: {}

## 项目蓝图
- **项目名称**: {}
- **项目描述**: {}
"#,
            task.name, task.description, task.priority, blueprint.name, blueprint.description
        );

        if let Some(ref module) = context.module {
            prompt.push_str(&format!(
                r#"
## 相关模块
- **模块名称**: {}
- **模块类型**: {:?}
- **模块职责**: {}
"#,
                module.name,
                module.module_type,
                module.responsibilities.join(", ")
            ));
        }

        if !context.parent_acceptance_tests.is_empty() {
            prompt.push_str("\n## 父任务的验收测试（参考）\n");
            for test in &context.parent_acceptance_tests {
                prompt.push_str(&format!("- {}: {}\n", test.name, test.description));
            }
        }

        if !context.related_code.is_empty() {
            prompt.push_str("\n## 相关代码\n");
            for (file_path, content) in &context.related_code {
                let truncated = if content.len() > 2000 {
                    // Find safe UTF-8 boundary for truncation
                    let truncate_at = content
                        .char_indices()
                        .take_while(|(i, _)| *i < 2000)
                        .last()
                        .map(|(i, c)| i + c.len_utf8())
                        .unwrap_or(0);
                    format!(
                        "{}... (truncated)",
                        content.get(..truncate_at).unwrap_or(content)
                    )
                } else {
                    content.clone()
                };
                prompt.push_str(&format!("\n### {}\n```\n{}\n```\n", file_path, truncated));
            }
        }

        prompt.push_str(&format!(
            r#"
## 要求
1. 使用 {} 测试框架
2. 测试文件应放在 {} 目录下
3. 生成的测试应该是**验收测试**，关注功能的正确性和完整性
4. 每个验收测试应该有明确的验收标准
5. 测试应该是可执行的，子 Agent 编写代码后可以直接运行

## 输出格式
请以 JSON 格式输出验收测试。
"#,
            self.config.test_framework, self.config.test_directory
        ));

        prompt
    }

    /// 生成模拟测试（用于开发阶段）
    fn generate_mock_tests(&self, context: &AcceptanceTestContext) -> Vec<AcceptanceTest> {
        let task = &context.task;
        let test_file_path = format!(
            "{}/acceptance/{}_acceptance_test.rs",
            self.config.test_directory,
            task.id.replace('-', "_")
        );

        vec![AcceptanceTest {
            id: Uuid::new_v4().to_string(),
            task_id: task.id.clone(),
            name: format!("{} 验收测试", task.name),
            description: format!("验证 {} 功能的正确性", task.name),
            test_code: self.generate_mock_test_code(task),
            test_file_path: test_file_path.clone(),
            test_command: format!("cargo test --test {}", task.id.replace('-', "_")),
            criteria: vec![
                AcceptanceCriterion {
                    id: Uuid::new_v4().to_string(),
                    description: format!("功能 {} 正确实现", task.name),
                    check_type: AcceptanceCheckType::Behavior,
                    expected_result: "测试通过".to_string(),
                    passed: None,
                },
                AcceptanceCriterion {
                    id: Uuid::new_v4().to_string(),
                    description: "无错误输出".to_string(),
                    check_type: AcceptanceCheckType::Output,
                    expected_result: "无 panic 或错误".to_string(),
                    passed: None,
                },
            ],
            generated_by: "queen".to_string(),
            generated_at: Utc::now(),
            last_result: None,
            run_history: Vec::new(),
        }]
    }

    /// 生成模拟测试代码
    fn generate_mock_test_code(&self, task: &TaskNode) -> String {
        format!(
            r#"//! 验收测试: {}
//! 描述: {}
//! 生成时间: {}

#[cfg(test)]
mod acceptance_tests {{
    use super::*;

    #[test]
    fn test_{}_acceptance() {{
        // 验收标准 1: 功能正确实现
        // TODO: 实现具体的验收测试逻辑
        assert!(true, "功能应该正确实现");
    }}

    #[test]
    fn test_{}_no_errors() {{
        // 验收标准 2: 无错误输出
        // TODO: 验证无 panic 或错误
        assert!(true, "不应该有错误输出");
    }}
}}
"#,
            task.name,
            task.description,
            Utc::now().format("%Y-%m-%d %H:%M:%S"),
            task.id.replace('-', "_"),
            task.id.replace('-', "_")
        )
    }

    /// 写入验收测试文件到磁盘
    pub fn write_test_files(&self, tests: &[AcceptanceTest]) -> HashMap<String, bool> {
        let mut results = HashMap::new();

        for test in tests {
            if test.test_file_path.is_empty() || test.test_code.is_empty() {
                results.insert(test.id.clone(), false);
                continue;
            }

            let full_path = self.config.project_root.join(&test.test_file_path);

            // 确保目录存在
            if let Some(parent) = full_path.parent() {
                if std::fs::create_dir_all(parent).is_err() {
                    results.insert(test.id.clone(), false);
                    continue;
                }
            }

            // 写入测试文件
            match std::fs::write(&full_path, &test.test_code) {
                Ok(_) => results.insert(test.id.clone(), true),
                Err(_) => results.insert(test.id.clone(), false),
            };
        }

        results
    }

    /// 获取配置
    pub fn config(&self) -> &AcceptanceTestGeneratorConfig {
        &self.config
    }
}

impl Default for AcceptanceTestGenerator {
    fn default() -> Self {
        Self::new(AcceptanceTestGeneratorConfig::default())
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建验收测试生成器
pub fn create_acceptance_test_generator(
    config: AcceptanceTestGeneratorConfig,
) -> AcceptanceTestGenerator {
    AcceptanceTestGenerator::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = AcceptanceTestGeneratorConfig::default();
        assert_eq!(config.test_framework, "cargo");
        assert_eq!(config.test_directory, "tests");
    }

    #[test]
    fn test_context_builder() {
        let task = TaskNode::new("测试任务".to_string(), "描述".to_string(), 0);
        let blueprint = Blueprint::new("测试项目".to_string(), "项目描述".to_string());

        let context =
            AcceptanceTestContext::new(task.clone(), blueprint).with_related_code(HashMap::from([
                ("src/lib.rs".to_string(), "// code".to_string()),
            ]));

        assert_eq!(context.task.name, "测试任务");
        assert!(context.related_code.contains_key("src/lib.rs"));
    }

    #[test]
    fn test_result_success() {
        let result = AcceptanceTestResult::success(vec![]);
        assert!(result.success);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_result_failure() {
        let result = AcceptanceTestResult::failure("测试错误");
        assert!(!result.success);
        assert_eq!(result.error, Some("测试错误".to_string()));
    }

    #[tokio::test]
    async fn test_generate_mock_tests() {
        let generator = AcceptanceTestGenerator::default();
        let task = TaskNode::new("测试任务".to_string(), "描述".to_string(), 0);
        let blueprint = Blueprint::new("测试项目".to_string(), "项目描述".to_string());
        let context = AcceptanceTestContext::new(task, blueprint);

        let result = generator.generate_acceptance_tests(&context).await;

        assert!(result.success);
        assert!(!result.tests.is_empty());
        assert!(result.tests[0].test_code.contains("acceptance_tests"));
    }
}
