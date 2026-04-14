// =============================================================================
// Plan Mode Tools
// =============================================================================
//
// 计划模式工具，基于当前工具面的 plan mode 语义实现
// 提供 EnterPlanModeTool 和 ExitPlanModeTool 功能
//
// 功能特性：
// - 进入计划模式进行复杂任务规划
// - 只读模式，禁止文件修改（除计划文件外）
// - 计划持久化存储
// - 用户权限确认机制

use crate::session::{resolve_team_context, SessionManager, SessionType};
use crate::tools::{
    base::{PermissionCheckResult, Tool},
    context::{ToolContext, ToolOptions, ToolResult},
    error::ToolError,
};
use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::agent_control::{SendInputCallback, SendInputRequest};

// =============================================================================
// 计划模式状态管理
// =============================================================================

/// 计划模式状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanModeState {
    pub active: bool,
    pub plan_file: String,
    pub plan_id: String,
}

/// 工具权限上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPermissionContext {
    pub mode: String, // "normal", "plan", "delegate"
}

/// 应用状态（简化版本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub tool_permission_context: ToolPermissionContext,
    pub plan_mode: Option<PlanModeState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            tool_permission_context: ToolPermissionContext {
                mode: "normal".to_string(),
            },
            plan_mode: None,
        }
    }
}

/// 全局状态管理器
pub struct GlobalStateManager {
    state: Arc<Mutex<AppState>>,
}

impl GlobalStateManager {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(AppState::default())),
        }
    }
}

impl Default for GlobalStateManager {
    fn default() -> Self {
        Self::new()
    }
}

impl GlobalStateManager {
    pub fn get_state(&self) -> AppState {
        self.state.lock().unwrap().clone()
    }

    pub fn update_state<F>(&self, updater: F)
    where
        F: FnOnce(&mut AppState),
    {
        let mut state = self.state.lock().unwrap();
        updater(&mut state);
    }

    pub fn is_plan_mode_active(&self) -> bool {
        let state = self.state.lock().unwrap();
        state.tool_permission_context.mode == "plan"
    }

    pub fn get_plan_file(&self) -> Option<String> {
        let state = self.state.lock().unwrap();
        state.plan_mode.as_ref().map(|pm| pm.plan_file.clone())
    }

    pub fn get_current_plan_id(&self) -> Option<String> {
        let state = self.state.lock().unwrap();
        state.plan_mode.as_ref().map(|pm| pm.plan_id.clone())
    }

    pub fn set_plan_mode(&self, active: bool, plan_file: Option<String>, plan_id: Option<String>) {
        self.update_state(|state| {
            if active {
                let plan_file = plan_file.unwrap_or_else(|| {
                    std::env::current_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                        .join("PLAN.md")
                        .to_string_lossy()
                        .to_string()
                });
                let plan_id = plan_id.unwrap_or_else(|| Uuid::new_v4().to_string());

                state.tool_permission_context.mode = "plan".to_string();
                state.plan_mode = Some(PlanModeState {
                    active: true,
                    plan_file,
                    plan_id,
                });
            } else {
                state.tool_permission_context.mode = "normal".to_string();
                state.plan_mode = None;
            }
        });
    }
}

// 全局状态管理器实例
lazy_static::lazy_static! {
    static ref GLOBAL_STATE: GlobalStateManager = GlobalStateManager::new();
}

pub(crate) fn current_plan_mode_active() -> bool {
    GLOBAL_STATE.is_plan_mode_active()
}

async fn session_is_subagent_context(context: &ToolContext) -> bool {
    let session_id = context.session_id.trim();
    if session_id.is_empty() {
        return false;
    }

    SessionManager::get_session(session_id, false)
        .await
        .map(|session| matches!(session.session_type, SessionType::SubAgent))
        .unwrap_or(false)
}

// =============================================================================
// 计划持久化管理
// =============================================================================

/// 保存的计划结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPlan {
    pub metadata: PlanMetadata,
    pub summary: String,
    pub requirements_analysis: RequirementsAnalysis,
    pub architectural_decisions: Vec<ArchitecturalDecision>,
    pub steps: Vec<PlanStep>,
    pub critical_files: Vec<CriticalFile>,
    pub risks: Vec<Risk>,
    pub alternatives: Vec<Alternative>,
    pub estimated_complexity: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMetadata {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: String, // "draft", "pending", "approved", "rejected"
    pub created_at: u64,
    pub updated_at: u64,
    pub working_directory: String,
    pub version: u32,
    pub priority: String, // "low", "medium", "high"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequirementsAnalysis {
    pub functional_requirements: Vec<String>,
    pub non_functional_requirements: Vec<String>,
    pub technical_constraints: Vec<String>,
    pub success_criteria: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchitecturalDecision {
    pub title: String,
    pub description: String,
    pub rationale: String,
    pub alternatives: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub step: u32,
    pub description: String,
    pub files: Vec<String>,
    pub complexity: String, // "low", "medium", "high"
    pub dependencies: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalFile {
    pub path: String,
    pub reason: String,
    pub importance: u32, // 1-5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Risk {
    pub category: String, // "technical", "business", "security"
    pub level: String,    // "low", "medium", "high"
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alternative {
    pub title: String,
    pub description: String,
    pub pros: Vec<String>,
    pub cons: Vec<String>,
}

/// 计划持久化管理器
pub struct PlanPersistenceManager;

impl PlanPersistenceManager {
    /// 生成计划 ID
    pub fn generate_plan_id() -> String {
        Uuid::new_v4().to_string()
    }

    /// 获取计划存储目录
    pub fn get_plans_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".aster").join("plans")
    }

    /// 保存计划到持久化存储
    pub fn save_plan(plan: &SavedPlan) -> Result<bool, ToolError> {
        let plans_dir = Self::get_plans_dir();
        if let Err(e) = fs::create_dir_all(&plans_dir) {
            return Err(ToolError::ExecutionFailed(format!(
                "Failed to create plans directory: {}",
                e
            )));
        }

        let plan_file = plans_dir.join(format!("{}.json", plan.metadata.id));
        let plan_json = serde_json::to_string_pretty(plan)
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to serialize plan: {}", e)))?;

        fs::write(&plan_file, plan_json)
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to write plan file: {}", e)))?;

        Ok(true)
    }

    /// 从持久化存储加载计划
    pub fn load_plan(plan_id: &str) -> Result<SavedPlan, ToolError> {
        let plans_dir = Self::get_plans_dir();
        let plan_file = plans_dir.join(format!("{}.json", plan_id));

        if !plan_file.exists() {
            return Err(ToolError::NotFound(format!("Plan not found: {}", plan_id)));
        }

        let plan_json = fs::read_to_string(&plan_file)
            .map_err(|e| ToolError::ExecutionFailed(format!("Failed to read plan file: {}", e)))?;

        let plan: SavedPlan = serde_json::from_str(&plan_json).map_err(|e| {
            ToolError::ExecutionFailed(format!("Failed to deserialize plan: {}", e))
        })?;

        Ok(plan)
    }
}

// =============================================================================
// EnterPlanModeTool 实现
// =============================================================================

/// 进入计划模式工具
///
/// 对齐当前工具面的 EnterPlanModeTool 语义
/// 用于复杂任务的规划和探索阶段
pub struct EnterPlanModeTool;

impl EnterPlanModeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EnterPlanModeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for EnterPlanModeTool {
    fn name(&self) -> &str {
        "EnterPlanMode"
    }

    fn description(&self) -> &str {
        r#"Use this tool when you encounter a complex task that requires careful planning and exploration before implementation.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would otherwise need to use `AskUserQuestion` to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks where you only need to read files, grep code, or understand existing behavior

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use `AskUserQuestion` if you need to clarify implementation choices with the user
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase"#
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": false
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_base_timeout(Duration::from_secs(30))
            .with_max_retries(0)
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        if session_is_subagent_context(context).await {
            return PermissionCheckResult::deny(
                "EnterPlanMode tool cannot be used in agent contexts",
            );
        }
        PermissionCheckResult::ask("Enter plan mode?")
    }

    async fn execute(
        &self,
        _params: Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        if session_is_subagent_context(context).await {
            return Err(ToolError::execution_failed(
                "EnterPlanMode tool cannot be used in agent contexts",
            ));
        }

        // 检查是否已经在计划模式中
        if GLOBAL_STATE.is_plan_mode_active() {
            return Ok(ToolResult::error(
                "Already in plan mode. Use ExitPlanMode to exit first.",
            ));
        }

        // 生成计划 ID 和文件路径
        let plan_id = PlanPersistenceManager::generate_plan_id();
        let current_dir = if context.working_directory.as_os_str().is_empty() {
            std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
        } else {
            context.working_directory.clone()
        };
        let plan_path = current_dir.join("PLAN.md");
        let plan_file_guidance = if plan_path.exists() {
            format!(
                "A plan file already exists at {}. Read it first, then update it with the latest plan content using the write/edit tools.",
                plan_path.display()
            )
        } else {
            format!(
                "No plan file exists yet. You should create your plan at {} using the write tool.",
                plan_path.display()
            )
        };

        // 创建初始计划到持久化存储
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let initial_plan = SavedPlan {
            metadata: PlanMetadata {
                id: plan_id.clone(),
                title: "Untitled Plan".to_string(),
                description: "Plan created in plan mode".to_string(),
                status: "draft".to_string(),
                created_at: now,
                updated_at: now,
                working_directory: current_dir.to_string_lossy().to_string(),
                version: 1,
                priority: "medium".to_string(),
            },
            summary: "Plan in progress".to_string(),
            requirements_analysis: RequirementsAnalysis {
                functional_requirements: vec![],
                non_functional_requirements: vec![],
                technical_constraints: vec![],
                success_criteria: vec![],
            },
            architectural_decisions: vec![],
            steps: vec![],
            critical_files: vec![],
            risks: vec![],
            alternatives: vec![],
            estimated_complexity: "moderate".to_string(),
            content: "# Implementation Plan\n\n(Building plan...)".to_string(),
        };

        // 保存到持久化存储
        PlanPersistenceManager::save_plan(&initial_plan)?;

        // 更新全局状态：设置计划模式
        GLOBAL_STATE.set_plan_mode(
            true,
            Some(plan_path.to_string_lossy().to_string()),
            Some(plan_id.clone()),
        );

        let output = format!(
            r#"Entered plan mode.

Plan ID: {}

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind) EXCEPT the plan file
- Modifying existing files (no Edit operations) EXCEPT the plan file
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.

## Plan File Info:
{}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

The plan will be automatically saved to the persistent storage (~/.aster/plans/{}.json) when you exit plan mode.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use `AskUserQuestion` if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Focus on understanding the problem before proposing solutions."#,
            plan_id, plan_file_guidance, plan_id
        );

        Ok(ToolResult::success(output)
            .with_metadata("plan_id", json!(plan_id))
            .with_metadata("plan_file", json!(plan_path.to_string_lossy()))
            .with_metadata("mode", json!("plan")))
    }
}

// =============================================================================
// ExitPlanModeTool 实现
// =============================================================================

/// 退出计划模式工具输入
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExitPlanModeInput {
    #[serde(default)]
    pub allowed_prompts: Option<Vec<AllowedPrompt>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowedPrompt {
    pub tool: String,
    pub prompt: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExitPlanModeOutput {
    plan: Option<String>,
    is_agent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    has_task_tool: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plan_was_edited: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    awaiting_leader_approval: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

/// 退出计划模式工具
///
/// 对齐当前工具面的 ExitPlanModeTool 语义
/// 用于完成计划并等待用户批准
#[derive(Clone)]
pub struct ExitPlanModeTool {
    send_input_callback: Option<SendInputCallback>,
}

impl ExitPlanModeTool {
    pub fn new() -> Self {
        Self {
            send_input_callback: None,
        }
    }

    pub fn with_send_input_callback(mut self, callback: SendInputCallback) -> Self {
        self.send_input_callback = Some(callback);
        self
    }

    /// 解析计划内容为 SavedPlan 结构
    fn parse_plan_content(
        &self,
        plan_id: &str,
        content: &str,
        working_directory: &Path,
    ) -> SavedPlan {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // 从第一个标题提取标题
        let title = content
            .lines()
            .find(|line| line.starts_with("# "))
            .map(|line| line.trim_start_matches("# ").trim())
            .unwrap_or("Untitled Plan")
            .to_string();

        SavedPlan {
            metadata: PlanMetadata {
                id: plan_id.to_string(),
                title: title.clone(),
                description: title,
                status: "pending".to_string(),
                created_at: now,
                updated_at: now,
                working_directory: working_directory.to_string_lossy().to_string(),
                version: 1,
                priority: "medium".to_string(),
            },
            summary: self.extract_summary(content),
            requirements_analysis: RequirementsAnalysis {
                functional_requirements: self
                    .extract_requirements(content, "Functional Requirements"),
                non_functional_requirements: self
                    .extract_requirements(content, "Non-Functional Requirements"),
                technical_constraints: self.extract_requirements(content, "Technical Constraints"),
                success_criteria: self.extract_requirements(content, "Success Criteria"),
            },
            architectural_decisions: vec![],
            steps: self.extract_steps(content),
            critical_files: self.extract_critical_files(content),
            risks: self.extract_risks(content),
            alternatives: vec![],
            estimated_complexity: "moderate".to_string(),
            content: content.to_string(),
        }
    }

    fn extract_summary(&self, content: &str) -> String {
        // 查找 ## Summary 部分
        if let Some(start) = content.find("## Summary") {
            let after_header = content.get(start..).unwrap_or("");
            if let Some(content_start) = after_header.find('\n') {
                let content_part = after_header.get(content_start + 1..).unwrap_or("");
                if let Some(end) = content_part.find("\n##") {
                    return content_part.get(..end).unwrap_or("").trim().to_string();
                } else {
                    return content_part.trim().to_string();
                }
            }
        }
        "No summary provided".to_string()
    }

    fn extract_requirements(&self, content: &str, section: &str) -> Vec<String> {
        let section_header = format!("### {}", section);
        if let Some(start) = content.find(&section_header) {
            let after_header = content.get(start..).unwrap_or("");
            if let Some(content_start) = after_header.find('\n') {
                let content_part = after_header.get(content_start + 1..).unwrap_or("");
                let end = content_part
                    .find("\n###")
                    .or_else(|| content_part.find("\n##"))
                    .unwrap_or(content_part.len());
                let section_content = content_part.get(..end).unwrap_or("");

                return section_content
                    .lines()
                    .filter_map(|line| {
                        let trimmed = line.trim();
                        trimmed
                            .strip_prefix("- ")
                            .map(|stripped| stripped.trim().to_string())
                    })
                    .filter(|line| !line.is_empty())
                    .collect();
            }
        }
        vec![]
    }

    fn extract_steps(&self, content: &str) -> Vec<PlanStep> {
        let mut steps = vec![];

        // 使用简单的字符串匹配而不是正则表达式
        for line in content.lines() {
            if line.starts_with("### Step ") {
                if let Some(colon_pos) = line.find(": ") {
                    let step_part = line.get(9..colon_pos).unwrap_or(""); // "### Step ".len() = 9
                    if let Ok(step_number) = step_part.parse::<u32>() {
                        let description = line.get(colon_pos + 2..).unwrap_or("");
                        steps.push(PlanStep {
                            step: step_number,
                            description: description.to_string(),
                            files: vec![],
                            complexity: "medium".to_string(),
                            dependencies: vec![],
                        });
                    }
                }
            }
        }

        steps
    }

    fn extract_critical_files(&self, content: &str) -> Vec<CriticalFile> {
        let mut files = vec![];

        if let Some(start) = content.find("### Critical Files") {
            let after_header = content.get(start..).unwrap_or("");
            if let Some(content_start) = after_header.find('\n') {
                let content_part = after_header.get(content_start + 1..).unwrap_or("");
                let end = content_part.find("\n##").unwrap_or(content_part.len());
                let section_content = content_part.get(..end).unwrap_or("");

                for line in section_content.lines() {
                    let trimmed = line.trim();
                    if let Some(content_line) = trimmed.strip_prefix("- ") {
                        if let Some(dash_pos) = content_line.find(" - ") {
                            let path = content_line.get(..dash_pos).unwrap_or("").trim();
                            let reason = content_line.get(dash_pos + 3..).unwrap_or("").trim();
                            files.push(CriticalFile {
                                path: path.to_string(),
                                reason: reason.to_string(),
                                importance: 3,
                            });
                        }
                    }
                }
            }
        }

        files
    }

    fn extract_risks(&self, content: &str) -> Vec<Risk> {
        let mut risks = vec![];

        if let Some(start) = content.find("## Risks") {
            let after_header = content.get(start..).unwrap_or("");
            if let Some(content_start) = after_header.find('\n') {
                let content_part = after_header.get(content_start + 1..).unwrap_or("");
                // 寻找下一个 ## 标题，如果没有找到就读取到末尾
                let end = content_part.find("\n## ").unwrap_or(content_part.len());
                let section_content = content_part.get(..end).unwrap_or("");

                // 按 ### 分割风险块
                let risk_blocks: Vec<&str> = section_content.split("### ").collect();
                for block in risk_blocks {
                    if block.trim().is_empty() {
                        continue;
                    }

                    let lines: Vec<&str> = block.lines().collect();
                    if let Some(first_line) = lines.first() {
                        let description = first_line.trim();
                        if !description.is_empty() {
                            // 移除数字前缀（如 "1. Performance Risk" -> "Performance Risk"）
                            let clean_description = if let Some(dot_pos) = description.find(". ") {
                                description.get(dot_pos + 2..).unwrap_or(description)
                            } else {
                                description
                            };

                            risks.push(Risk {
                                category: "technical".to_string(),
                                level: "medium".to_string(),
                                description: clean_description.to_string(),
                            });
                        }
                    }
                }
            }
        }

        risks
    }
}

impl Default for ExitPlanModeTool {
    fn default() -> Self {
        Self::new()
    }
}

fn generate_plan_approval_request_id() -> String {
    let short = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(12)
        .collect::<String>();
    format!("plan_approval-{short}")
}

#[async_trait]
impl Tool for ExitPlanModeTool {
    fn name(&self) -> &str {
        "ExitPlanMode"
    }

    fn description(&self) -> &str {
        r#"Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Handling Ambiguity in Plans
Before using this tool, ensure your plan is clear and unambiguous. If there are multiple valid approaches or unclear requirements:
1. Use the `AskUserQuestion` tool to clarify with the user
2. Ask about specific implementation choices (e.g., architectural patterns, which library to use)
3. Clarify any assumptions that could affect the implementation
4. Edit your plan file to incorporate user feedback
5. Only proceed with ExitPlanMode after resolving ambiguities and updating the plan file

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use `AskUserQuestion` first, then use exit plan mode tool after clarifying the approach."#
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "allowedPrompts": {
                    "type": "array",
                    "description": "计划阶段推导出的语义权限提示，当前 runtime 会保留到 metadata 供后续实现阶段参考。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool": { "type": "string" },
                            "prompt": { "type": "string" }
                        },
                        "required": ["tool", "prompt"],
                        "additionalProperties": false
                    }
                }
            },
            "required": [],
            "additionalProperties": true
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_base_timeout(Duration::from_secs(30))
            .with_max_retries(0)
    }

    async fn check_permissions(
        &self,
        _params: &Value,
        context: &ToolContext,
    ) -> PermissionCheckResult {
        if !GLOBAL_STATE.is_plan_mode_active() {
            return PermissionCheckResult::deny(
                "You are not in plan mode. This tool is only for exiting plan mode after writing a plan.",
            );
        }

        if session_is_subagent_context(context).await {
            return PermissionCheckResult::allow();
        }

        let teammate_requires_lead_approval = resolve_team_context(&context.session_id)
            .await
            .ok()
            .flatten()
            .is_some_and(|team_context| !team_context.is_lead);
        if teammate_requires_lead_approval {
            return PermissionCheckResult::allow();
        }

        PermissionCheckResult::ask("Exit plan mode?")
    }

    async fn execute(&self, params: Value, context: &ToolContext) -> Result<ToolResult, ToolError> {
        let input: ExitPlanModeInput = serde_json::from_value(params).map_err(|error| {
            ToolError::invalid_params(format!("ExitPlanMode 参数无效: {error}"))
        })?;
        // 检查是否在计划模式中
        if !GLOBAL_STATE.is_plan_mode_active() {
            return Ok(ToolResult::error(
                "Not in plan mode. Use EnterPlanMode first.",
            ));
        }

        // 获取计划文件信息
        let plan_file = GLOBAL_STATE.get_plan_file();
        let plan_id = GLOBAL_STATE.get_current_plan_id();

        let mut plan_content = String::new();
        if let Some(ref plan_file_path) = plan_file {
            if Path::new(plan_file_path).exists() {
                plan_content = fs::read_to_string(plan_file_path).unwrap_or_default();
            }
        }

        // 解析并保存计划到持久化存储
        let mut saved_plan_path: Option<String> = None;
        if let (Some(plan_id), false) = (&plan_id, plan_content.is_empty()) {
            let working_directory = plan_file
                .as_ref()
                .and_then(|path| Path::new(path).parent())
                .unwrap_or_else(|| Path::new("."));
            let plan = self.parse_plan_content(plan_id, &plan_content, working_directory);
            match PlanPersistenceManager::save_plan(&plan) {
                Ok(_) => {
                    saved_plan_path = Some(format!("~/.aster/plans/{}.json", plan_id));
                }
                Err(e) => {
                    eprintln!("Failed to save plan to persistence: {}", e);
                }
            }
        }

        let is_agent = session_is_subagent_context(context).await;
        let team_context = resolve_team_context(&context.session_id)
            .await
            .map_err(|error| ToolError::execution_failed(format!("读取 team 状态失败: {error}")))?;

        let mut awaiting_leader_approval = None;
        let mut request_id = None;
        let mut approval_delivery = None;
        let mut approval_request = None;

        if let Some(team_context) = team_context
            .as_ref()
            .filter(|team_context| !team_context.is_lead)
        {
            let file_path = plan_file.clone().ok_or_else(|| {
                ToolError::execution_failed(
                    "No plan file found for ExitPlanMode approval request. Please write your plan before requesting leader approval.",
                )
            })?;
            if plan_content.trim().is_empty() {
                return Err(ToolError::execution_failed(format!(
                    "No plan file found at {file_path}. Please write your plan before requesting leader approval."
                )));
            }

            let callback = self.send_input_callback.clone().ok_or_else(|| {
                ToolError::execution_failed(
                    "当前 runtime 未配置计划审批消息路由，无法把计划提交给 team lead",
                )
            })?;
            let generated_request_id = generate_plan_approval_request_id();
            let payload = json!({
                "type": "plan_approval_request",
                "from": team_context.current_member_name.clone(),
                "timestamp": Utc::now().to_rfc3339(),
                "planFilePath": file_path,
                "planContent": plan_content.clone(),
                "requestId": generated_request_id,
            });
            let request_message = serde_json::to_string(&payload).map_err(|error| {
                ToolError::execution_failed(format!("序列化计划审批请求失败: {error}"))
            })?;
            let response = (callback)(SendInputRequest {
                id: team_context.lead_session_id.clone(),
                message: request_message,
                interrupt: false,
            })
            .await
            .map_err(|error| {
                ToolError::execution_failed(format!("发送计划审批请求失败: {error}"))
            })?;

            awaiting_leader_approval = Some(true);
            request_id = Some(generated_request_id.clone());
            approval_request = Some(payload);
            approval_delivery = Some(json!({
                "target": team_context.lead_session_id.clone(),
                "submissionId": response.submission_id,
                "extra": response.extra,
            }));
        }

        // 更新全局状态：退出计划模式
        GLOBAL_STATE.set_plan_mode(false, None, None);
        let output = ExitPlanModeOutput {
            plan: if plan_content.is_empty() {
                None
            } else {
                Some(plan_content.clone())
            },
            is_agent,
            file_path: plan_file.clone(),
            has_task_tool: None,
            plan_was_edited: None,
            awaiting_leader_approval,
            request_id,
        };

        let mut result =
            ToolResult::success(serde_json::to_string_pretty(&output).map_err(|error| {
                ToolError::execution_failed(format!("序列化 ExitPlanMode 结果失败: {error}"))
            })?)
            .with_metadata("plan_id", json!(plan_id))
            .with_metadata("plan_file", json!(plan_file))
            .with_metadata("saved_plan_path", json!(saved_plan_path))
            .with_metadata("allowed_prompts", json!(input.allowed_prompts))
            .with_metadata("mode", json!("normal"));

        if let Some(approval_request) = approval_request {
            result = result.with_metadata("plan_approval_request", approval_request);
        }
        if let Some(approval_delivery) = approval_delivery {
            result = result.with_metadata("plan_approval_delivery", approval_delivery);
        }
        if let Some(request_id) = output.request_id.clone() {
            result = result.with_metadata("pending_request_id", json!(request_id));
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{
        save_team_membership, save_team_state, SessionManager, SessionType, TeamMember,
        TeamMembershipState, TeamSessionState,
    };
    use crate::tools::{context::ToolContext, PermissionBehavior, SendInputResponse};
    use serde_json::{json, Value};
    use serial_test::serial;
    use std::collections::{BTreeMap, HashMap};
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;
    use tokio;
    use uuid::Uuid;

    fn create_test_context() -> ToolContext {
        ToolContext {
            working_directory: std::env::current_dir().unwrap(),
            session_id: "test-session".to_string(),
            user: Some("test-user".to_string()),
            environment: HashMap::new(),
            cancellation_token: None,
            provider: None,
        }
    }

    async fn create_session_context(session_type: SessionType) -> anyhow::Result<ToolContext> {
        let working_directory = std::env::current_dir().unwrap();
        let session = SessionManager::create_session(
            working_directory.clone(),
            format!("plan-mode-test-{}", Uuid::new_v4()),
            session_type,
        )
        .await?;

        Ok(ToolContext::new(working_directory).with_session_id(session.id))
    }

    async fn create_teammate_context(teammate_name: &str) -> anyhow::Result<(String, ToolContext)> {
        let working_directory = std::env::current_dir().unwrap();
        let lead = SessionManager::create_session(
            working_directory.clone(),
            format!("plan-mode-lead-{}", Uuid::new_v4()),
            SessionType::Hidden,
        )
        .await?;
        let teammate = SessionManager::create_session(
            working_directory.clone(),
            format!("plan-mode-teammate-{}", Uuid::new_v4()),
            SessionType::SubAgent,
        )
        .await?;
        let team_name = format!("team-{}", Uuid::new_v4().simple());

        save_team_state(
            &lead.id,
            Some(TeamSessionState {
                team_name: team_name.clone(),
                description: Some("测试 team".to_string()),
                lead_session_id: lead.id.clone(),
                members: vec![
                    TeamMember::lead(lead.id.clone(), Some("lead".to_string())),
                    TeamMember::teammate(
                        teammate.id.clone(),
                        teammate_name.to_string(),
                        Some("worker".to_string()),
                    ),
                ],
            }),
        )
        .await?;
        save_team_membership(
            &teammate.id,
            Some(TeamMembershipState {
                team_name,
                lead_session_id: lead.id.clone(),
                agent_id: teammate.id.clone(),
                name: teammate_name.to_string(),
                agent_type: Some("worker".to_string()),
            }),
        )
        .await?;

        Ok((
            lead.id,
            ToolContext::new(working_directory).with_session_id(teammate.id),
        ))
    }

    #[test]
    fn test_enter_plan_mode_tool_creation() {
        let tool = EnterPlanModeTool::new();
        assert_eq!(tool.name(), "EnterPlanMode");
        assert!(tool.description().contains("complex task"));
    }

    #[test]
    fn test_exit_plan_mode_tool_creation() {
        let tool = ExitPlanModeTool::new();
        assert_eq!(tool.name(), "ExitPlanMode");
        assert!(tool.description().contains("finished writing your plan"));
    }

    #[test]
    fn test_global_state_manager() {
        let manager = GlobalStateManager::new();

        // 初始状态
        assert!(!manager.is_plan_mode_active());
        assert!(manager.get_plan_file().is_none());
        assert!(manager.get_current_plan_id().is_none());

        // 设置计划模式
        manager.set_plan_mode(
            true,
            Some("test.md".to_string()),
            Some("test-id".to_string()),
        );
        assert!(manager.is_plan_mode_active());
        assert_eq!(manager.get_plan_file(), Some("test.md".to_string()));
        assert_eq!(manager.get_current_plan_id(), Some("test-id".to_string()));

        // 退出计划模式
        manager.set_plan_mode(false, None, None);
        assert!(!manager.is_plan_mode_active());
        assert!(manager.get_plan_file().is_none());
        assert!(manager.get_current_plan_id().is_none());
    }

    #[test]
    fn test_plan_persistence_manager() {
        let _temp_dir = TempDir::new().unwrap();
        let _plans_dir = _temp_dir.path().join("plans");

        // 创建测试计划
        let plan_id = "test-plan-id";
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let _plan = SavedPlan {
            metadata: PlanMetadata {
                id: plan_id.to_string(),
                title: "Test Plan".to_string(),
                description: "A test plan".to_string(),
                status: "draft".to_string(),
                created_at: now,
                updated_at: now,
                working_directory: "/tmp".to_string(),
                version: 1,
                priority: "medium".to_string(),
            },
            summary: "Test summary".to_string(),
            requirements_analysis: RequirementsAnalysis {
                functional_requirements: vec!["Req 1".to_string()],
                non_functional_requirements: vec![],
                technical_constraints: vec![],
                success_criteria: vec![],
            },
            architectural_decisions: vec![],
            steps: vec![],
            critical_files: vec![],
            risks: vec![],
            alternatives: vec![],
            estimated_complexity: "low".to_string(),
            content: "# Test Plan\n\nThis is a test plan.".to_string(),
        };

        // 注意：这个测试需要修改 PlanPersistenceManager 来支持自定义目录
        // 或者我们可以测试 ID 生成功能
        let generated_id = PlanPersistenceManager::generate_plan_id();
        assert!(!generated_id.is_empty());
        assert!(generated_id.len() > 10); // UUID 应该比较长
    }

    #[tokio::test]
    async fn test_enter_plan_mode_permissions() {
        let tool = EnterPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        let result = tool.check_permissions(&input, &context).await;
        assert!(matches!(result.behavior, PermissionBehavior::Ask));
        assert_eq!(result.message, Some("Enter plan mode?".to_string()));
    }

    #[tokio::test]
    async fn test_enter_plan_mode_permissions_reject_subagent_context() -> anyhow::Result<()> {
        let tool = EnterPlanModeTool::new();
        let context = create_session_context(SessionType::SubAgent).await?;
        let input = json!({});

        let result = tool.check_permissions(&input, &context).await;
        assert!(matches!(result.behavior, PermissionBehavior::Deny));
        assert_eq!(
            result.message,
            Some("EnterPlanMode tool cannot be used in agent contexts".to_string())
        );

        let _ = SessionManager::delete_session(&context.session_id).await;
        Ok(())
    }

    #[tokio::test]
    async fn test_exit_plan_mode_permissions() {
        let tool = ExitPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        GLOBAL_STATE.set_plan_mode(true, None, None);
        let result = tool.check_permissions(&input, &context).await;
        assert!(matches!(result.behavior, PermissionBehavior::Ask));
        assert_eq!(result.message, Some("Exit plan mode?".to_string()));
        GLOBAL_STATE.set_plan_mode(false, None, None);
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_permissions_reject_when_not_in_plan_mode() {
        let tool = ExitPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        GLOBAL_STATE.set_plan_mode(false, None, None);

        let result = tool.check_permissions(&input, &context).await;
        assert!(matches!(result.behavior, PermissionBehavior::Deny));
        assert_eq!(
            result.message,
            Some(
                "You are not in plan mode. This tool is only for exiting plan mode after writing a plan."
                    .to_string()
            )
        );
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_permissions_allow_subagent_context() -> anyhow::Result<()> {
        let tool = ExitPlanModeTool::new();
        let context = create_session_context(SessionType::SubAgent).await?;
        let input = json!({});

        GLOBAL_STATE.set_plan_mode(true, None, None);

        let result = tool.check_permissions(&input, &context).await;
        assert!(matches!(result.behavior, PermissionBehavior::Allow));

        GLOBAL_STATE.set_plan_mode(false, None, None);
        let _ = SessionManager::delete_session(&context.session_id).await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_enter_plan_mode_execution() {
        let tool = EnterPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        // 确保不在计划模式中
        GLOBAL_STATE.set_plan_mode(false, None, None);

        let result = tool.execute(input, &context).await.unwrap();
        assert!(result.success);
        assert!(result.output.is_some());
        assert!(result
            .output
            .as_ref()
            .unwrap()
            .contains("Entered plan mode"));
        assert!(!result.metadata.is_empty());

        // 验证状态已更新
        assert!(GLOBAL_STATE.is_plan_mode_active());

        // 清理全局状态，避免影响并发测试
        GLOBAL_STATE.set_plan_mode(false, None, None);
    }

    #[tokio::test]
    #[serial]
    async fn test_enter_plan_mode_execution_rejects_subagent_context() -> anyhow::Result<()> {
        let tool = EnterPlanModeTool::new();
        let context = create_session_context(SessionType::SubAgent).await?;

        GLOBAL_STATE.set_plan_mode(false, None, None);

        let error = tool
            .execute(json!({}), &context)
            .await
            .expect_err("subagent context should be rejected");
        assert!(error
            .to_string()
            .contains("EnterPlanMode tool cannot be used in agent contexts"));

        let _ = SessionManager::delete_session(&context.session_id).await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_execution_not_in_plan_mode() {
        let tool = ExitPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        // 确保不在计划模式中
        GLOBAL_STATE.set_plan_mode(false, None, None);

        let result = tool.execute(input, &context).await.unwrap();
        assert!(!result.success);
        assert!(result.error.is_some());
        assert!(result.error.as_ref().unwrap().contains("Not in plan mode"));
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_execution_in_plan_mode() {
        let tool = ExitPlanModeTool::new();
        let context = create_test_context();
        let input = json!({});

        // 设置计划模式
        GLOBAL_STATE.set_plan_mode(
            true,
            Some("test.md".to_string()),
            Some("test-id".to_string()),
        );

        let result = tool.execute(input, &context).await.unwrap();
        assert!(result.success);
        assert!(result.output.is_some());
        let output: serde_json::Value =
            serde_json::from_str(result.output.as_ref().unwrap()).expect("valid exit plan output");
        assert_eq!(output["isAgent"], json!(false));

        // 验证状态已更新
        assert!(!GLOBAL_STATE.is_plan_mode_active());
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_marks_subagent_context_as_agent() -> anyhow::Result<()> {
        let tool = ExitPlanModeTool::new();
        let context = create_session_context(SessionType::SubAgent).await?;

        GLOBAL_STATE.set_plan_mode(
            true,
            Some("test-subagent.md".to_string()),
            Some("test-subagent-id".to_string()),
        );

        let result = tool.execute(json!({}), &context).await?;
        let output: serde_json::Value =
            serde_json::from_str(result.output.as_ref().unwrap()).expect("valid exit plan output");
        assert_eq!(output["isAgent"], json!(true));

        let _ = SessionManager::delete_session(&context.session_id).await;
        Ok(())
    }

    #[tokio::test]
    #[serial]
    async fn test_exit_plan_mode_teammate_submits_plan_approval_request() -> anyhow::Result<()> {
        let temp_dir = TempDir::new()?;
        let plan_path = temp_dir.path().join("PLAN.md");
        let plan_content = r#"# 审批计划

## Summary

等待 team lead 审批后再进入实现阶段。
"#;
        fs::write(&plan_path, plan_content)?;

        let (lead_session_id, context) = create_teammate_context("researcher").await?;
        let captured_request = Arc::new(Mutex::new(None::<SendInputRequest>));
        let captured_request_handle = Arc::clone(&captured_request);
        let tool = ExitPlanModeTool::new().with_send_input_callback(Arc::new(move |request| {
            let captured_request = Arc::clone(&captured_request_handle);
            Box::pin(async move {
                *captured_request.lock().unwrap() = Some(request.clone());
                Ok(SendInputResponse {
                    submission_id: "submission-plan-approval-1".to_string(),
                    extra: BTreeMap::new(),
                })
            })
        }));

        GLOBAL_STATE.set_plan_mode(
            true,
            Some(plan_path.to_string_lossy().to_string()),
            Some("plan-approval-id".to_string()),
        );

        let result = tool.execute(json!({}), &context).await?;
        let output: Value =
            serde_json::from_str(result.output.as_deref().unwrap()).expect("valid output json");
        let request_id = output["requestId"]
            .as_str()
            .expect("requestId should be present")
            .to_string();

        assert_eq!(output["awaitingLeaderApproval"], json!(true));
        assert_eq!(output["isAgent"], json!(true));
        assert_eq!(
            output["filePath"],
            json!(plan_path.to_string_lossy().to_string())
        );
        assert!(request_id.starts_with("plan_approval-"));
        assert!(!GLOBAL_STATE.is_plan_mode_active());

        let sent_request = captured_request
            .lock()
            .unwrap()
            .clone()
            .expect("approval request should be sent");
        assert_eq!(sent_request.id, lead_session_id);
        assert!(!sent_request.interrupt);

        let payload: Value =
            serde_json::from_str(&sent_request.message).expect("valid approval request json");
        assert_eq!(payload["type"], json!("plan_approval_request"));
        assert_eq!(payload["from"], json!("researcher"));
        assert_eq!(
            payload["planFilePath"],
            json!(plan_path.to_string_lossy().to_string())
        );
        assert_eq!(payload["planContent"], json!(plan_content));
        assert_eq!(payload["requestId"], json!(request_id));

        assert_eq!(
            result.metadata["plan_approval_delivery"]["submissionId"],
            json!("submission-plan-approval-1")
        );
        assert_eq!(result.metadata["pending_request_id"], json!(request_id));

        let _ = SessionManager::delete_session(&context.session_id).await;
        let _ = SessionManager::delete_session(&lead_session_id).await;
        Ok(())
    }

    #[test]
    fn test_plan_content_parsing() {
        let tool = ExitPlanModeTool::new();
        let content = r#"# Test Implementation Plan

## Summary

This is a test plan for implementing a new feature.

### Functional Requirements

- Requirement 1
- Requirement 2

### Technical Constraints

- Constraint 1

### Step 1: Initial Setup

Set up the basic structure.

### Step 2: Implementation

Implement the core functionality.

### Critical Files

- src/main.rs - Main entry point
- src/lib.rs - Core library

## Risks

### 1. Performance Risk

The implementation might be slow.

### 2. Security Risk

Need to validate inputs properly.
"#;

        let working_directory = Path::new("/tmp/aster-plan-test");
        let plan = tool.parse_plan_content("test-id", content, working_directory);

        assert_eq!(plan.metadata.title, "Test Implementation Plan");
        assert_eq!(
            plan.summary,
            "This is a test plan for implementing a new feature."
        );
        assert_eq!(plan.requirements_analysis.functional_requirements.len(), 2);
        assert_eq!(plan.requirements_analysis.technical_constraints.len(), 1);
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.critical_files.len(), 2);
        assert_eq!(plan.risks.len(), 2);
        assert_eq!(plan.content, content);
        assert_eq!(
            plan.metadata.working_directory,
            working_directory.to_string_lossy()
        );
    }

    #[test]
    fn test_tool_definitions() {
        let enter_tool = EnterPlanModeTool::new();
        let exit_tool = ExitPlanModeTool::new();

        let enter_def = enter_tool.get_definition();
        let exit_def = exit_tool.get_definition();

        assert_eq!(enter_def.name, "EnterPlanMode");
        assert_eq!(exit_def.name, "ExitPlanMode");

        // 验证输入模式
        assert!(enter_def.input_schema.get("type").is_some());
        assert!(exit_def.input_schema.get("type").is_some());
    }

    #[test]
    fn test_tool_options() {
        let enter_tool = EnterPlanModeTool::new();
        let exit_tool = ExitPlanModeTool::new();

        let enter_options = enter_tool.options();
        let exit_options = exit_tool.options();

        assert_eq!(enter_options.base_timeout, Duration::from_secs(30));
        assert_eq!(enter_options.max_retries, 0);
        assert_eq!(exit_options.base_timeout, Duration::from_secs(30));
        assert_eq!(exit_options.max_retries, 0);
    }
}
