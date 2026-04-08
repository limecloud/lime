//! Skill Types
//!
//! Core types for the skills system.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Skill 执行模式
///
/// 定义 Skill 的执行策略：
/// - `Prompt`: 单次对话，注入 System Prompt（默认）
/// - `Workflow`: 多步骤工作流
/// - `Agent`: 多轮迭代探索（未来）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillExecutionMode {
    /// 单次对话，注入 System Prompt
    #[default]
    Prompt,
    /// 多步骤工作流
    Workflow,
    /// 多轮迭代探索（未来）
    Agent,
}

impl SkillExecutionMode {
    /// 从字符串解析执行模式
    ///
    /// # Arguments
    /// * `s` - 执行模式字符串（不区分大小写）
    ///
    /// # Returns
    /// 对应的执行模式，未知字符串返回 `Prompt`（默认值）
    ///
    /// # Examples
    /// ```
    /// use aster::skills::SkillExecutionMode;
    ///
    /// assert_eq!(SkillExecutionMode::parse("workflow"), SkillExecutionMode::Workflow);
    /// assert_eq!(SkillExecutionMode::parse("AGENT"), SkillExecutionMode::Agent);
    /// assert_eq!(SkillExecutionMode::parse("unknown"), SkillExecutionMode::Prompt);
    /// ```
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "workflow" => Self::Workflow,
            "agent" => Self::Agent,
            _ => Self::Prompt,
        }
    }
}

impl std::str::FromStr for SkillExecutionMode {
    type Err = std::convert::Infallible;

    /// 从字符串解析执行模式（实现 FromStr trait）
    ///
    /// 此实现永不失败，未知字符串返回 `Prompt`（默认值）
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self::parse(s))
    }
}

impl std::fmt::Display for SkillExecutionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillExecutionMode::Prompt => write!(f, "prompt"),
            SkillExecutionMode::Workflow => write!(f, "workflow"),
            SkillExecutionMode::Agent => write!(f, "agent"),
        }
    }
}

// ==================== Workflow 相关类型 ====================

/// 工作流步骤
///
/// 定义工作流中的单个执行步骤，包含提示词模板、输入输出变量和依赖关系。
///
/// # 字段说明
/// - `id`: 步骤唯一标识，用于依赖引用
/// - `name`: 步骤显示名称，用于 UI 展示
/// - `prompt`: 提示词模板，支持 `${var_name}` 变量插值
/// - `input`: 可选的输入变量引用
/// - `output`: 输出变量名，步骤结果将存储到此变量
/// - `dependencies`: 依赖的步骤 ID 列表，这些步骤必须先执行
/// - `parallel`: 是否可并行执行（预留字段，当前未实现）
///
/// # 示例
/// ```yaml
/// - id: analyze
///   name: 分析代码
///   prompt: "分析以下代码：${user_input}"
///   output: analysis_result
///   dependencies: []
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    /// 步骤 ID（唯一标识）
    pub id: String,

    /// 步骤名称（用于显示）
    pub name: String,

    /// 提示词模板，支持变量插值 ${var_name}
    pub prompt: String,

    /// 输入变量引用（可选）
    #[serde(default)]
    pub input: Option<String>,

    /// 输出变量名
    pub output: String,

    /// 依赖的步骤 ID 列表
    #[serde(default)]
    pub dependencies: Vec<String>,

    /// 是否可并行执行（预留字段）
    #[serde(default)]
    pub parallel: bool,
}

/// 工作流定义
///
/// 定义完整的多步骤工作流，包含步骤列表和执行配置。
///
/// # 字段说明
/// - `steps`: 工作流步骤列表
/// - `max_retries`: 步骤失败时的最大重试次数（默认 2）
/// - `continue_on_failure`: 步骤失败时是否继续执行后续步骤（默认 false）
///
/// # 示例
/// ```yaml
/// workflow:
///   steps:
///     - id: step1
///       name: 第一步
///       prompt: "处理输入：${user_input}"
///       output: result1
///     - id: step2
///       name: 第二步
///       prompt: "基于结果继续：${result1}"
///       output: result2
///       dependencies: [step1]
///   max_retries: 3
///   continue_on_failure: false
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    /// 步骤列表
    pub steps: Vec<WorkflowStep>,

    /// 失败重试次数（默认 2）
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,

    /// 失败时是否继续执行后续步骤
    #[serde(default)]
    pub continue_on_failure: bool,
}

/// 默认重试次数
fn default_max_retries() -> u32 {
    2
}

impl WorkflowDefinition {
    /// 创建新的工作流定义
    ///
    /// # Arguments
    /// * `steps` - 工作流步骤列表
    ///
    /// # Returns
    /// 使用默认配置的工作流定义
    pub fn new(steps: Vec<WorkflowStep>) -> Self {
        Self {
            steps,
            max_retries: default_max_retries(),
            continue_on_failure: false,
        }
    }

    /// 获取步骤数量
    pub fn step_count(&self) -> usize {
        self.steps.len()
    }

    /// 根据 ID 查找步骤
    pub fn find_step(&self, id: &str) -> Option<&WorkflowStep> {
        self.steps.iter().find(|s| s.id == id)
    }
}

impl WorkflowStep {
    /// 创建新的工作流步骤
    ///
    /// # Arguments
    /// * `id` - 步骤唯一标识
    /// * `name` - 步骤显示名称
    /// * `prompt` - 提示词模板
    /// * `output` - 输出变量名
    ///
    /// # Returns
    /// 使用默认配置的工作流步骤
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        prompt: impl Into<String>,
        output: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            prompt: prompt.into(),
            input: None,
            output: output.into(),
            dependencies: Vec::new(),
            parallel: false,
        }
    }

    /// 设置输入变量引用
    pub fn with_input(mut self, input: impl Into<String>) -> Self {
        self.input = Some(input.into());
        self
    }

    /// 添加依赖步骤
    pub fn with_dependency(mut self, dep: impl Into<String>) -> Self {
        self.dependencies.push(dep.into());
        self
    }

    /// 设置多个依赖步骤
    pub fn with_dependencies(mut self, deps: Vec<String>) -> Self {
        self.dependencies = deps;
        self
    }

    /// 设置是否可并行执行
    pub fn with_parallel(mut self, parallel: bool) -> Self {
        self.parallel = parallel;
        self
    }
}

/// Skill source type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    /// User-level skill (~/.claude/skills/)
    User,
    /// Project-level skill (.claude/skills/)
    Project,
    /// Plugin-provided skill
    Plugin,
}

impl std::fmt::Display for SkillSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillSource::User => write!(f, "user"),
            SkillSource::Project => write!(f, "project"),
            SkillSource::Plugin => write!(f, "plugin"),
        }
    }
}

/// Skill frontmatter metadata
///
/// SKILL.md 文件的 YAML frontmatter 元数据结构。
/// 包含 Skill 的基本信息、执行配置和工作流定义。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillFrontmatter {
    // === 基本信息字段 ===
    /// Skill 名称（可选，默认使用目录名）
    pub name: Option<String>,
    /// Skill 描述
    pub description: Option<String>,
    /// 允许使用的工具列表（逗号分隔或数组）
    #[serde(rename = "allowed-tools")]
    pub allowed_tools: Option<String>,
    /// 参数提示
    #[serde(rename = "argument-hint")]
    pub argument_hint: Option<String>,
    /// 使用场景说明
    #[serde(rename = "when-to-use", alias = "when_to_use")]
    pub when_to_use: Option<String>,
    /// Skill 版本
    pub version: Option<String>,
    /// 首选模型
    pub model: Option<String>,
    /// 是否允许用户直接调用（默认: true）
    #[serde(rename = "user-invocable")]
    pub user_invocable: Option<String>,
    /// 是否禁用模型调用（默认: false）
    #[serde(rename = "disable-model-invocation")]
    pub disable_model_invocation: Option<String>,

    // === 执行配置字段（新增） ===
    /// 执行模式: prompt | workflow | agent
    ///
    /// - `prompt`: 单次对话，注入 System Prompt（默认）
    /// - `workflow`: 多步骤工作流
    /// - `agent`: 多轮迭代探索（未来）
    #[serde(rename = "execution-mode")]
    pub execution_mode: Option<String>,

    /// Provider 绑定
    ///
    /// 指定此 Skill 使用的 LLM Provider 名称。
    /// 如果未指定，将使用默认 Provider。
    pub provider: Option<String>,

    /// 工作流定义（仅 workflow 模式）
    ///
    /// 当 `execution-mode` 为 `workflow` 时，此字段定义工作流的步骤、
    /// 依赖关系和执行配置。
    pub workflow: Option<WorkflowDefinition>,
}

/// Skill definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDefinition {
    /// Skill name (with namespace, e.g., "user:my-skill")
    pub skill_name: String,
    /// Display name
    pub display_name: String,
    /// Description
    pub description: String,
    /// Whether description was specified in frontmatter
    pub has_user_specified_description: bool,
    /// Markdown content (body after frontmatter)
    pub markdown_content: String,
    /// Allowed tools list
    pub allowed_tools: Option<Vec<String>>,
    /// Argument hint
    pub argument_hint: Option<String>,
    /// When to use hint
    pub when_to_use: Option<String>,
    /// Version
    pub version: Option<String>,
    /// Preferred model
    pub model: Option<String>,
    /// Whether model invocation is disabled
    pub disable_model_invocation: bool,
    /// Whether user can invoke this skill
    pub user_invocable: bool,
    /// Source of the skill
    pub source: SkillSource,
    /// Base directory of the skill
    pub base_dir: PathBuf,
    /// File path of SKILL.md
    pub file_path: PathBuf,
    /// Supporting files in the skill directory
    pub supporting_files: Vec<PathBuf>,

    // === 新增字段 ===
    /// 执行模式
    ///
    /// 定义 Skill 的执行策略：
    /// - `Prompt`: 单次对话，注入 System Prompt（默认）
    /// - `Workflow`: 多步骤工作流
    /// - `Agent`: 多轮迭代探索（未来）
    #[serde(default)]
    pub execution_mode: SkillExecutionMode,

    /// Provider 绑定
    ///
    /// 指定此 Skill 使用的 LLM Provider 名称。
    /// 如果未指定，将使用默认 Provider。
    #[serde(default)]
    pub provider: Option<String>,

    /// 工作流定义（仅 workflow 模式）
    ///
    /// 当 `execution_mode` 为 `Workflow` 时，此字段定义工作流的步骤、
    /// 依赖关系和执行配置。
    #[serde(default)]
    pub workflow: Option<WorkflowDefinition>,
}

impl SkillDefinition {
    /// Get the short name (without namespace)
    pub fn short_name(&self) -> &str {
        self.skill_name
            .rsplit(':')
            .next()
            .unwrap_or(&self.skill_name)
    }

    /// Get the namespace
    pub fn namespace(&self) -> Option<&str> {
        let parts: Vec<&str> = self.skill_name.split(':').collect();
        if parts.len() > 1 {
            Some(parts[0])
        } else {
            None
        }
    }
}

/// Invoked skill record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvokedSkill {
    /// Skill name
    pub skill_name: String,
    /// Skill file path
    pub skill_path: PathBuf,
    /// Skill content that was invoked
    pub content: String,
    /// Timestamp when invoked
    pub invoked_at: u64,
}

/// 步骤执行结果
///
/// 记录工作流中单个步骤的执行结果，包含步骤标识、输出内容和执行状态。
///
/// # 字段说明
/// - `step_id`: 步骤唯一标识
/// - `step_name`: 步骤显示名称
/// - `output`: 步骤输出内容
/// - `success`: 是否执行成功
/// - `error`: 错误信息（仅失败时有值）
///
/// # 示例
/// ```rust
/// use aster::skills::StepResult;
///
/// let result = StepResult {
///     step_id: "analyze".to_string(),
///     step_name: "分析代码".to_string(),
///     output: "分析完成".to_string(),
///     success: true,
///     error: None,
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    /// 步骤 ID
    pub step_id: String,
    /// 步骤名称
    pub step_name: String,
    /// 输出内容
    pub output: String,
    /// 是否成功
    pub success: bool,
    /// 错误信息
    pub error: Option<String>,
}

impl StepResult {
    /// 创建成功的步骤结果
    ///
    /// # Arguments
    /// * `step_id` - 步骤唯一标识
    /// * `step_name` - 步骤显示名称
    /// * `output` - 步骤输出内容
    ///
    /// # Returns
    /// 成功状态的步骤结果
    pub fn success(
        step_id: impl Into<String>,
        step_name: impl Into<String>,
        output: impl Into<String>,
    ) -> Self {
        Self {
            step_id: step_id.into(),
            step_name: step_name.into(),
            output: output.into(),
            success: true,
            error: None,
        }
    }

    /// 创建失败的步骤结果
    ///
    /// # Arguments
    /// * `step_id` - 步骤唯一标识
    /// * `step_name` - 步骤显示名称
    /// * `error` - 错误信息
    ///
    /// # Returns
    /// 失败状态的步骤结果
    pub fn failure(
        step_id: impl Into<String>,
        step_name: impl Into<String>,
        error: impl Into<String>,
    ) -> Self {
        Self {
            step_id: step_id.into(),
            step_name: step_name.into(),
            output: String::new(),
            success: false,
            error: Some(error.into()),
        }
    }
}

/// Skill execution result
///
/// Skill 执行结果，包含执行状态、输出内容和工作流步骤结果。
///
/// # 字段说明
/// - `success`: 是否执行成功
/// - `output`: 输出内容
/// - `error`: 错误信息（仅失败时有值）
/// - `steps_completed`: 已完成的步骤列表（仅 Workflow 模式）
/// - `command_name`: 命令/技能名称
/// - `allowed_tools`: 允许的工具列表
/// - `model`: 使用的模型
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillExecutionResult {
    /// Whether execution was successful
    pub success: bool,
    /// Output message
    pub output: Option<String>,
    /// Error message if failed
    pub error: Option<String>,
    /// 已完成的步骤（仅 Workflow 模式）
    #[serde(default)]
    pub steps_completed: Vec<StepResult>,
    /// Command/skill name
    pub command_name: Option<String>,
    /// Allowed tools for this skill
    pub allowed_tools: Option<Vec<String>>,
    /// Preferred model
    pub model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== SkillExecutionMode Tests ====================

    #[test]
    fn test_execution_mode_parse_prompt() {
        assert_eq!(
            SkillExecutionMode::parse("prompt"),
            SkillExecutionMode::Prompt
        );
        assert_eq!(
            SkillExecutionMode::parse("PROMPT"),
            SkillExecutionMode::Prompt
        );
        assert_eq!(
            SkillExecutionMode::parse("Prompt"),
            SkillExecutionMode::Prompt
        );
    }

    #[test]
    fn test_execution_mode_parse_workflow() {
        assert_eq!(
            SkillExecutionMode::parse("workflow"),
            SkillExecutionMode::Workflow
        );
        assert_eq!(
            SkillExecutionMode::parse("WORKFLOW"),
            SkillExecutionMode::Workflow
        );
        assert_eq!(
            SkillExecutionMode::parse("Workflow"),
            SkillExecutionMode::Workflow
        );
    }

    #[test]
    fn test_execution_mode_parse_agent() {
        assert_eq!(
            SkillExecutionMode::parse("agent"),
            SkillExecutionMode::Agent
        );
        assert_eq!(
            SkillExecutionMode::parse("AGENT"),
            SkillExecutionMode::Agent
        );
        assert_eq!(
            SkillExecutionMode::parse("Agent"),
            SkillExecutionMode::Agent
        );
    }

    #[test]
    fn test_execution_mode_parse_default() {
        // 未知字符串应返回默认值 Prompt
        assert_eq!(
            SkillExecutionMode::parse("unknown"),
            SkillExecutionMode::Prompt
        );
        assert_eq!(SkillExecutionMode::parse(""), SkillExecutionMode::Prompt);
        assert_eq!(
            SkillExecutionMode::parse("invalid"),
            SkillExecutionMode::Prompt
        );
    }

    #[test]
    fn test_execution_mode_from_str_trait() {
        // 测试 FromStr trait 实现
        use std::str::FromStr;

        assert_eq!(
            SkillExecutionMode::from_str("workflow").unwrap(),
            SkillExecutionMode::Workflow
        );
        assert_eq!(
            SkillExecutionMode::from_str("agent").unwrap(),
            SkillExecutionMode::Agent
        );
        assert_eq!(
            SkillExecutionMode::from_str("prompt").unwrap(),
            SkillExecutionMode::Prompt
        );
        assert_eq!(
            SkillExecutionMode::from_str("unknown").unwrap(),
            SkillExecutionMode::Prompt
        );
    }

    #[test]
    fn test_execution_mode_default() {
        // Default trait 应返回 Prompt
        assert_eq!(SkillExecutionMode::default(), SkillExecutionMode::Prompt);
    }

    #[test]
    fn test_execution_mode_display() {
        assert_eq!(SkillExecutionMode::Prompt.to_string(), "prompt");
        assert_eq!(SkillExecutionMode::Workflow.to_string(), "workflow");
        assert_eq!(SkillExecutionMode::Agent.to_string(), "agent");
    }

    #[test]
    fn test_execution_mode_serialization() {
        // 测试 JSON 序列化
        let prompt = SkillExecutionMode::Prompt;
        let json = serde_json::to_string(&prompt).unwrap();
        assert_eq!(json, "\"prompt\"");

        let workflow = SkillExecutionMode::Workflow;
        let json = serde_json::to_string(&workflow).unwrap();
        assert_eq!(json, "\"workflow\"");

        let agent = SkillExecutionMode::Agent;
        let json = serde_json::to_string(&agent).unwrap();
        assert_eq!(json, "\"agent\"");
    }

    #[test]
    fn test_execution_mode_deserialization() {
        // 测试 JSON 反序列化
        let prompt: SkillExecutionMode = serde_json::from_str("\"prompt\"").unwrap();
        assert_eq!(prompt, SkillExecutionMode::Prompt);

        let workflow: SkillExecutionMode = serde_json::from_str("\"workflow\"").unwrap();
        assert_eq!(workflow, SkillExecutionMode::Workflow);

        let agent: SkillExecutionMode = serde_json::from_str("\"agent\"").unwrap();
        assert_eq!(agent, SkillExecutionMode::Agent);
    }

    #[test]
    fn test_execution_mode_roundtrip() {
        // 测试序列化 -> 反序列化 round-trip
        for mode in [
            SkillExecutionMode::Prompt,
            SkillExecutionMode::Workflow,
            SkillExecutionMode::Agent,
        ] {
            let json = serde_json::to_string(&mode).unwrap();
            let parsed: SkillExecutionMode = serde_json::from_str(&json).unwrap();
            assert_eq!(mode, parsed);
        }
    }

    #[test]
    fn test_execution_mode_clone_and_copy() {
        let mode = SkillExecutionMode::Workflow;
        let copied1 = mode;
        let copied2 = mode;
        assert_eq!(mode, copied1);
        assert_eq!(mode, copied2);
    }

    #[test]
    fn test_execution_mode_eq() {
        assert_eq!(SkillExecutionMode::Prompt, SkillExecutionMode::Prompt);
        assert_ne!(SkillExecutionMode::Prompt, SkillExecutionMode::Workflow);
        assert_ne!(SkillExecutionMode::Workflow, SkillExecutionMode::Agent);
    }

    #[test]
    fn test_execution_mode_str_parse() {
        // 测试 str.parse() 语法
        let mode: SkillExecutionMode = "workflow".parse().unwrap();
        assert_eq!(mode, SkillExecutionMode::Workflow);
    }

    // ==================== SkillSource Tests ====================

    #[test]
    fn test_skill_source_display() {
        assert_eq!(SkillSource::User.to_string(), "user");
        assert_eq!(SkillSource::Project.to_string(), "project");
        assert_eq!(SkillSource::Plugin.to_string(), "plugin");
    }

    #[test]
    fn test_skill_definition_short_name() {
        let skill = SkillDefinition {
            skill_name: "user:my-skill".to_string(),
            display_name: "My Skill".to_string(),
            description: "Test".to_string(),
            has_user_specified_description: true,
            markdown_content: "# Content".to_string(),
            allowed_tools: None,
            argument_hint: None,
            when_to_use: None,
            version: None,
            model: None,
            disable_model_invocation: false,
            user_invocable: true,
            source: SkillSource::User,
            base_dir: PathBuf::from("/test"),
            file_path: PathBuf::from("/test/SKILL.md"),
            supporting_files: vec![],
            execution_mode: SkillExecutionMode::default(),
            provider: None,
            workflow: None,
        };

        assert_eq!(skill.short_name(), "my-skill");
        assert_eq!(skill.namespace(), Some("user"));
    }

    #[test]
    fn test_skill_definition_no_namespace() {
        let skill = SkillDefinition {
            skill_name: "simple-skill".to_string(),
            display_name: "Simple".to_string(),
            description: "Test".to_string(),
            has_user_specified_description: false,
            markdown_content: "".to_string(),
            allowed_tools: None,
            argument_hint: None,
            when_to_use: None,
            version: None,
            model: None,
            disable_model_invocation: false,
            user_invocable: true,
            source: SkillSource::Project,
            base_dir: PathBuf::from("/test"),
            file_path: PathBuf::from("/test/SKILL.md"),
            supporting_files: vec![],
            execution_mode: SkillExecutionMode::default(),
            provider: None,
            workflow: None,
        };

        assert_eq!(skill.short_name(), "simple-skill");
        assert_eq!(skill.namespace(), None);
    }

    #[test]
    fn test_skill_source_serialization() {
        let source = SkillSource::User;
        let json = serde_json::to_string(&source).unwrap();
        assert_eq!(json, "\"user\"");

        let deserialized: SkillSource = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, SkillSource::User);
    }

    // ==================== WorkflowStep Tests ====================

    #[test]
    fn test_workflow_step_new() {
        let step = WorkflowStep::new("step1", "第一步", "处理输入", "result");

        assert_eq!(step.id, "step1");
        assert_eq!(step.name, "第一步");
        assert_eq!(step.prompt, "处理输入");
        assert_eq!(step.output, "result");
        assert!(step.input.is_none());
        assert!(step.dependencies.is_empty());
        assert!(!step.parallel);
    }

    #[test]
    fn test_workflow_step_builder_pattern() {
        let step = WorkflowStep::new("step2", "第二步", "继续处理", "result2")
            .with_input("input_var")
            .with_dependency("step1")
            .with_parallel(true);

        assert_eq!(step.id, "step2");
        assert_eq!(step.input, Some("input_var".to_string()));
        assert_eq!(step.dependencies, vec!["step1".to_string()]);
        assert!(step.parallel);
    }

    #[test]
    fn test_workflow_step_with_dependencies() {
        let step = WorkflowStep::new("step3", "第三步", "最终处理", "final")
            .with_dependencies(vec!["step1".to_string(), "step2".to_string()]);

        assert_eq!(step.dependencies.len(), 2);
        assert!(step.dependencies.contains(&"step1".to_string()));
        assert!(step.dependencies.contains(&"step2".to_string()));
    }

    #[test]
    fn test_workflow_step_serialization() {
        let step = WorkflowStep::new("analyze", "分析", "分析代码：${user_input}", "analysis")
            .with_dependency("prepare");

        let json = serde_json::to_string(&step).unwrap();
        let parsed: WorkflowStep = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, step.id);
        assert_eq!(parsed.name, step.name);
        assert_eq!(parsed.prompt, step.prompt);
        assert_eq!(parsed.output, step.output);
        assert_eq!(parsed.dependencies, step.dependencies);
    }

    #[test]
    fn test_workflow_step_deserialization_with_defaults() {
        // 测试反序列化时默认值的处理
        let json = r#"{
            "id": "step1",
            "name": "步骤一",
            "prompt": "执行任务",
            "output": "result"
        }"#;

        let step: WorkflowStep = serde_json::from_str(json).unwrap();

        assert_eq!(step.id, "step1");
        assert!(step.input.is_none());
        assert!(step.dependencies.is_empty());
        assert!(!step.parallel);
    }

    #[test]
    fn test_workflow_step_deserialization_full() {
        let json = r#"{
            "id": "step2",
            "name": "步骤二",
            "prompt": "处理 ${input}",
            "input": "user_data",
            "output": "processed",
            "dependencies": ["step1"],
            "parallel": true
        }"#;

        let step: WorkflowStep = serde_json::from_str(json).unwrap();

        assert_eq!(step.id, "step2");
        assert_eq!(step.input, Some("user_data".to_string()));
        assert_eq!(step.dependencies, vec!["step1"]);
        assert!(step.parallel);
    }

    // ==================== WorkflowDefinition Tests ====================

    #[test]
    fn test_workflow_definition_new() {
        let steps = vec![
            WorkflowStep::new("step1", "步骤一", "提示1", "out1"),
            WorkflowStep::new("step2", "步骤二", "提示2", "out2"),
        ];

        let workflow = WorkflowDefinition::new(steps);

        assert_eq!(workflow.step_count(), 2);
        assert_eq!(workflow.max_retries, 2); // 默认值
        assert!(!workflow.continue_on_failure); // 默认值
    }

    #[test]
    fn test_workflow_definition_find_step() {
        let steps = vec![
            WorkflowStep::new("analyze", "分析", "分析代码", "analysis"),
            WorkflowStep::new("generate", "生成", "生成代码", "code"),
        ];

        let workflow = WorkflowDefinition::new(steps);

        let found = workflow.find_step("analyze");
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "分析");

        let not_found = workflow.find_step("nonexistent");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_workflow_definition_serialization() {
        let steps = vec![WorkflowStep::new("step1", "步骤一", "提示1", "out1")];

        let workflow = WorkflowDefinition {
            steps,
            max_retries: 5,
            continue_on_failure: true,
        };

        let json = serde_json::to_string(&workflow).unwrap();
        let parsed: WorkflowDefinition = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.step_count(), 1);
        assert_eq!(parsed.max_retries, 5);
        assert!(parsed.continue_on_failure);
    }

    #[test]
    fn test_workflow_definition_deserialization_with_defaults() {
        // 测试反序列化时默认值的处理
        let json = r#"{
            "steps": [
                {
                    "id": "step1",
                    "name": "步骤一",
                    "prompt": "执行",
                    "output": "result"
                }
            ]
        }"#;

        let workflow: WorkflowDefinition = serde_json::from_str(json).unwrap();

        assert_eq!(workflow.step_count(), 1);
        assert_eq!(workflow.max_retries, 2); // 默认值
        assert!(!workflow.continue_on_failure); // 默认值
    }

    #[test]
    fn test_workflow_definition_deserialization_full() {
        let json = r#"{
            "steps": [
                {
                    "id": "step1",
                    "name": "步骤一",
                    "prompt": "处理 ${user_input}",
                    "output": "result1"
                },
                {
                    "id": "step2",
                    "name": "步骤二",
                    "prompt": "继续 ${result1}",
                    "output": "result2",
                    "dependencies": ["step1"]
                }
            ],
            "max_retries": 3,
            "continue_on_failure": true
        }"#;

        let workflow: WorkflowDefinition = serde_json::from_str(json).unwrap();

        assert_eq!(workflow.step_count(), 2);
        assert_eq!(workflow.max_retries, 3);
        assert!(workflow.continue_on_failure);

        let step2 = workflow.find_step("step2").unwrap();
        assert_eq!(step2.dependencies, vec!["step1"]);
    }

    #[test]
    fn test_workflow_definition_empty_steps() {
        let workflow = WorkflowDefinition::new(vec![]);

        assert_eq!(workflow.step_count(), 0);
        assert!(workflow.find_step("any").is_none());
    }

    #[test]
    fn test_workflow_step_clone() {
        let step = WorkflowStep::new("step1", "步骤", "提示", "输出").with_dependency("dep1");

        let cloned = step.clone();

        assert_eq!(cloned.id, step.id);
        assert_eq!(cloned.dependencies, step.dependencies);
    }

    #[test]
    fn test_workflow_definition_clone() {
        let workflow = WorkflowDefinition {
            steps: vec![WorkflowStep::new("s1", "n1", "p1", "o1")],
            max_retries: 5,
            continue_on_failure: true,
        };

        let cloned = workflow.clone();

        assert_eq!(cloned.step_count(), workflow.step_count());
        assert_eq!(cloned.max_retries, workflow.max_retries);
        assert_eq!(cloned.continue_on_failure, workflow.continue_on_failure);
    }

    #[test]
    fn test_default_max_retries() {
        // 验证默认重试次数为 2
        assert_eq!(super::default_max_retries(), 2);
    }

    // ==================== SkillFrontmatter Tests ====================

    #[test]
    fn test_skill_frontmatter_default() {
        // 测试默认值
        let frontmatter = SkillFrontmatter::default();

        assert!(frontmatter.name.is_none());
        assert!(frontmatter.description.is_none());
        assert!(frontmatter.execution_mode.is_none());
        assert!(frontmatter.provider.is_none());
        assert!(frontmatter.workflow.is_none());
    }

    #[test]
    fn test_skill_frontmatter_with_new_fields() {
        // 测试新增字段的设置
        let frontmatter = SkillFrontmatter {
            name: Some("test-skill".to_string()),
            execution_mode: Some("workflow".to_string()),
            provider: Some("openai".to_string()),
            workflow: Some(WorkflowDefinition::new(vec![WorkflowStep::new(
                "step1",
                "步骤一",
                "提示",
                "output",
            )])),
            ..Default::default()
        };

        assert_eq!(frontmatter.name, Some("test-skill".to_string()));
        assert_eq!(frontmatter.execution_mode, Some("workflow".to_string()));
        assert_eq!(frontmatter.provider, Some("openai".to_string()));
        assert!(frontmatter.workflow.is_some());
        assert_eq!(frontmatter.workflow.as_ref().unwrap().step_count(), 1);
    }

    #[test]
    fn test_skill_frontmatter_serialization_basic() {
        // 测试基本字段的 JSON 序列化
        let frontmatter = SkillFrontmatter {
            name: Some("my-skill".to_string()),
            description: Some("A test skill".to_string()),
            execution_mode: Some("prompt".to_string()),
            provider: Some("claude".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&frontmatter).unwrap();

        // 验证 execution-mode 使用了正确的 serde rename
        assert!(json.contains("\"execution-mode\""));
        assert!(json.contains("\"prompt\""));
        assert!(json.contains("\"provider\""));
        assert!(json.contains("\"claude\""));
    }

    #[test]
    fn test_skill_frontmatter_deserialization_with_execution_mode() {
        // 测试 execution-mode 字段的反序列化
        let json = r#"{
            "name": "workflow-skill",
            "execution-mode": "workflow",
            "provider": "gemini"
        }"#;

        let frontmatter: SkillFrontmatter = serde_json::from_str(json).unwrap();

        assert_eq!(frontmatter.name, Some("workflow-skill".to_string()));
        assert_eq!(frontmatter.execution_mode, Some("workflow".to_string()));
        assert_eq!(frontmatter.provider, Some("gemini".to_string()));
    }

    #[test]
    fn test_skill_frontmatter_deserialization_with_workflow() {
        // 测试包含 workflow 定义的反序列化
        let json = r#"{
            "name": "complex-skill",
            "execution-mode": "workflow",
            "provider": "openai",
            "workflow": {
                "steps": [
                    {
                        "id": "analyze",
                        "name": "分析",
                        "prompt": "分析输入：${user_input}",
                        "output": "analysis"
                    },
                    {
                        "id": "generate",
                        "name": "生成",
                        "prompt": "基于分析生成：${analysis}",
                        "output": "result",
                        "dependencies": ["analyze"]
                    }
                ],
                "max_retries": 3,
                "continue_on_failure": true
            }
        }"#;

        let frontmatter: SkillFrontmatter = serde_json::from_str(json).unwrap();

        assert_eq!(frontmatter.name, Some("complex-skill".to_string()));
        assert_eq!(frontmatter.execution_mode, Some("workflow".to_string()));
        assert_eq!(frontmatter.provider, Some("openai".to_string()));

        let workflow = frontmatter.workflow.unwrap();
        assert_eq!(workflow.step_count(), 2);
        assert_eq!(workflow.max_retries, 3);
        assert!(workflow.continue_on_failure);

        let step2 = workflow.find_step("generate").unwrap();
        assert_eq!(step2.dependencies, vec!["analyze"]);
    }

    #[test]
    fn test_skill_frontmatter_roundtrip() {
        // 测试序列化 -> 反序列化 round-trip
        let original = SkillFrontmatter {
            name: Some("roundtrip-skill".to_string()),
            description: Some("Test roundtrip".to_string()),
            execution_mode: Some("workflow".to_string()),
            provider: Some("anthropic".to_string()),
            workflow: Some(WorkflowDefinition {
                steps: vec![WorkflowStep::new("s1", "Step 1", "Prompt 1", "out1")],
                max_retries: 5,
                continue_on_failure: true,
            }),
            ..Default::default()
        };

        let json = serde_json::to_string(&original).unwrap();
        let parsed: SkillFrontmatter = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.name, original.name);
        assert_eq!(parsed.description, original.description);
        assert_eq!(parsed.execution_mode, original.execution_mode);
        assert_eq!(parsed.provider, original.provider);
        assert!(parsed.workflow.is_some());

        let parsed_workflow = parsed.workflow.unwrap();
        let original_workflow = original.workflow.unwrap();
        assert_eq!(parsed_workflow.step_count(), original_workflow.step_count());
        assert_eq!(parsed_workflow.max_retries, original_workflow.max_retries);
        assert_eq!(
            parsed_workflow.continue_on_failure,
            original_workflow.continue_on_failure
        );
    }

    #[test]
    fn test_skill_frontmatter_deserialization_without_new_fields() {
        // 测试不包含新字段时的反序列化（向后兼容）
        let json = r#"{
            "name": "legacy-skill",
            "description": "A legacy skill without new fields"
        }"#;

        let frontmatter: SkillFrontmatter = serde_json::from_str(json).unwrap();

        assert_eq!(frontmatter.name, Some("legacy-skill".to_string()));
        assert!(frontmatter.execution_mode.is_none());
        assert!(frontmatter.provider.is_none());
        assert!(frontmatter.workflow.is_none());
    }

    #[test]
    fn test_skill_frontmatter_clone() {
        let frontmatter = SkillFrontmatter {
            name: Some("clone-test".to_string()),
            execution_mode: Some("agent".to_string()),
            provider: Some("test-provider".to_string()),
            workflow: Some(WorkflowDefinition::new(vec![])),
            ..Default::default()
        };

        let cloned = frontmatter.clone();

        assert_eq!(cloned.name, frontmatter.name);
        assert_eq!(cloned.execution_mode, frontmatter.execution_mode);
        assert_eq!(cloned.provider, frontmatter.provider);
        assert!(cloned.workflow.is_some());
    }

    #[test]
    fn test_skill_frontmatter_all_execution_modes() {
        // 测试所有执行模式的反序列化
        for mode in ["prompt", "workflow", "agent"] {
            let json = format!(r#"{{"execution-mode": "{}"}}"#, mode);
            let frontmatter: SkillFrontmatter = serde_json::from_str(&json).unwrap();
            assert_eq!(frontmatter.execution_mode, Some(mode.to_string()));
        }
    }

    // ==================== StepResult Tests ====================

    #[test]
    fn test_step_result_success_constructor() {
        let result = StepResult::success("step1", "步骤一", "输出内容");

        assert_eq!(result.step_id, "step1");
        assert_eq!(result.step_name, "步骤一");
        assert_eq!(result.output, "输出内容");
        assert!(result.success);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_step_result_failure_constructor() {
        let result = StepResult::failure("step2", "步骤二", "执行失败");

        assert_eq!(result.step_id, "step2");
        assert_eq!(result.step_name, "步骤二");
        assert_eq!(result.output, ""); // 失败时输出为空
        assert!(!result.success);
        assert_eq!(result.error, Some("执行失败".to_string()));
    }

    #[test]
    fn test_step_result_serialization() {
        let result = StepResult::success("analyze", "分析代码", "分析完成");

        let json = serde_json::to_string(&result).unwrap();

        assert!(json.contains("\"step_id\":\"analyze\""));
        assert!(json.contains("\"step_name\":\"分析代码\""));
        assert!(json.contains("\"output\":\"分析完成\""));
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_step_result_deserialization() {
        let json = r#"{
            "step_id": "generate",
            "step_name": "生成代码",
            "output": "代码已生成",
            "success": true,
            "error": null
        }"#;

        let result: StepResult = serde_json::from_str(json).unwrap();

        assert_eq!(result.step_id, "generate");
        assert_eq!(result.step_name, "生成代码");
        assert_eq!(result.output, "代码已生成");
        assert!(result.success);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_step_result_deserialization_with_error() {
        let json = r#"{
            "step_id": "failed_step",
            "step_name": "失败步骤",
            "output": "",
            "success": false,
            "error": "Provider 调用失败"
        }"#;

        let result: StepResult = serde_json::from_str(json).unwrap();

        assert_eq!(result.step_id, "failed_step");
        assert!(!result.success);
        assert_eq!(result.error, Some("Provider 调用失败".to_string()));
    }

    #[test]
    fn test_step_result_roundtrip() {
        // 测试序列化 -> 反序列化 round-trip
        let original = StepResult::success("roundtrip", "Round Trip 测试", "测试输出");

        let json = serde_json::to_string(&original).unwrap();
        let parsed: StepResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.step_id, original.step_id);
        assert_eq!(parsed.step_name, original.step_name);
        assert_eq!(parsed.output, original.output);
        assert_eq!(parsed.success, original.success);
        assert_eq!(parsed.error, original.error);
    }

    #[test]
    fn test_step_result_roundtrip_failure() {
        // 测试失败结果的 round-trip
        let original = StepResult::failure("failed", "失败测试", "错误信息");

        let json = serde_json::to_string(&original).unwrap();
        let parsed: StepResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.step_id, original.step_id);
        assert_eq!(parsed.step_name, original.step_name);
        assert_eq!(parsed.output, original.output);
        assert_eq!(parsed.success, original.success);
        assert_eq!(parsed.error, original.error);
    }

    #[test]
    fn test_step_result_clone() {
        let result = StepResult::success("clone_test", "克隆测试", "输出");
        let cloned = result.clone();

        assert_eq!(cloned.step_id, result.step_id);
        assert_eq!(cloned.step_name, result.step_name);
        assert_eq!(cloned.output, result.output);
        assert_eq!(cloned.success, result.success);
    }

    // ==================== SkillExecutionResult Tests (Extended) ====================

    #[test]
    fn test_skill_execution_result_default() {
        let result = SkillExecutionResult::default();

        assert!(!result.success);
        assert!(result.output.is_none());
        assert!(result.error.is_none());
        assert!(result.steps_completed.is_empty());
        assert!(result.command_name.is_none());
        assert!(result.allowed_tools.is_none());
        assert!(result.model.is_none());
    }

    #[test]
    fn test_skill_execution_result_with_steps() {
        let result = SkillExecutionResult {
            success: true,
            output: Some("最终输出".to_string()),
            error: None,
            steps_completed: vec![
                StepResult::success("step1", "步骤一", "输出1"),
                StepResult::success("step2", "步骤二", "输出2"),
            ],
            command_name: Some("workflow-skill".to_string()),
            allowed_tools: None,
            model: Some("gpt-4".to_string()),
        };

        assert!(result.success);
        assert_eq!(result.steps_completed.len(), 2);
        assert_eq!(result.steps_completed[0].step_id, "step1");
        assert_eq!(result.steps_completed[1].step_id, "step2");
    }

    #[test]
    fn test_skill_execution_result_serialization_with_steps() {
        let result = SkillExecutionResult {
            success: true,
            output: Some("完成".to_string()),
            error: None,
            steps_completed: vec![StepResult::success("analyze", "分析", "分析结果")],
            command_name: Some("test-skill".to_string()),
            allowed_tools: Some(vec!["read_file".to_string()]),
            model: Some("claude-3".to_string()),
        };

        let json = serde_json::to_string(&result).unwrap();

        assert!(json.contains("\"steps_completed\""));
        assert!(json.contains("\"step_id\":\"analyze\""));
    }

    #[test]
    fn test_skill_execution_result_deserialization_without_steps() {
        // 测试反序列化时 steps_completed 的默认值（向后兼容）
        let json = r#"{
            "success": true,
            "output": "输出",
            "error": null,
            "command_name": "legacy-skill",
            "allowed_tools": null,
            "model": null
        }"#;

        let result: SkillExecutionResult = serde_json::from_str(json).unwrap();

        assert!(result.success);
        assert!(result.steps_completed.is_empty()); // 默认为空数组
    }

    #[test]
    fn test_skill_execution_result_deserialization_with_steps() {
        let json = r#"{
            "success": true,
            "output": "最终输出",
            "error": null,
            "steps_completed": [
                {
                    "step_id": "step1",
                    "step_name": "步骤一",
                    "output": "输出1",
                    "success": true,
                    "error": null
                },
                {
                    "step_id": "step2",
                    "step_name": "步骤二",
                    "output": "输出2",
                    "success": true,
                    "error": null
                }
            ],
            "command_name": "workflow-skill",
            "allowed_tools": ["tool1", "tool2"],
            "model": "gpt-4"
        }"#;

        let result: SkillExecutionResult = serde_json::from_str(json).unwrap();

        assert!(result.success);
        assert_eq!(result.steps_completed.len(), 2);
        assert_eq!(result.steps_completed[0].step_id, "step1");
        assert_eq!(result.steps_completed[1].step_id, "step2");
        assert_eq!(
            result.allowed_tools,
            Some(vec!["tool1".to_string(), "tool2".to_string()])
        );
    }

    #[test]
    fn test_skill_execution_result_roundtrip_with_steps() {
        let original = SkillExecutionResult {
            success: true,
            output: Some("完成".to_string()),
            error: None,
            steps_completed: vec![
                StepResult::success("s1", "Step 1", "Output 1"),
                StepResult::failure("s2", "Step 2", "Error"),
            ],
            command_name: Some("test".to_string()),
            allowed_tools: Some(vec!["tool".to_string()]),
            model: Some("model".to_string()),
        };

        let json = serde_json::to_string(&original).unwrap();
        let parsed: SkillExecutionResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.success, original.success);
        assert_eq!(parsed.output, original.output);
        assert_eq!(parsed.steps_completed.len(), original.steps_completed.len());
        assert_eq!(
            parsed.steps_completed[0].step_id,
            original.steps_completed[0].step_id
        );
        assert_eq!(
            parsed.steps_completed[1].success,
            original.steps_completed[1].success
        );
    }

    #[test]
    fn test_skill_execution_result_clone_with_steps() {
        let result = SkillExecutionResult {
            success: true,
            output: Some("output".to_string()),
            error: None,
            steps_completed: vec![StepResult::success("s1", "Step", "Out")],
            command_name: None,
            allowed_tools: None,
            model: None,
        };

        let cloned = result.clone();

        assert_eq!(cloned.steps_completed.len(), result.steps_completed.len());
        assert_eq!(
            cloned.steps_completed[0].step_id,
            result.steps_completed[0].step_id
        );
    }
}
