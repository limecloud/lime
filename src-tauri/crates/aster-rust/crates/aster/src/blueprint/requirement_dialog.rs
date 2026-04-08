//! 需求对话流程管理器
//!
//! 实现 ERP 式的对话式需求收集，通过多步骤对话引导用户完善项目需求：
//! 1. 项目背景 - 目标用户、要解决的问题
//! 2. 核心流程 - 主要业务流程
//! 3. 系统模块 - 功能模块划分
//! 4. 非功能要求 - 性能、安全、可用性
//! 5. 确认汇总 - 生成蓝图草案供用户确认

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use tokio::sync::mpsc;

use super::blueprint_manager::BlueprintManager;
use super::types::{
    Blueprint, BusinessProcess, ModuleType, MoscowPriority, NfrCategory, NonFunctionalRequirement,
    ProcessStep, ProcessType, SystemModule,
};

// ============================================================================
// 类型定义
// ============================================================================

/// 对话阶段
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DialogPhase {
    #[default]
    Welcome,
    ProjectBackground,
    BusinessProcess,
    SystemModule,
    NFR,
    Summary,
    Complete,
}

/// 对话状态
#[derive(Debug, Clone)]
pub struct DialogState {
    pub id: String,
    pub phase: DialogPhase,
    pub project_name: String,
    pub project_description: String,
    pub target_users: Vec<String>,
    pub problems_to_solve: Vec<String>,
    pub business_processes: Vec<BusinessProcessDraft>,
    pub modules: Vec<SystemModuleDraft>,
    pub nfrs: Vec<NFRDraft>,
    pub history: Vec<DialogMessage>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Default for DialogState {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            phase: DialogPhase::Welcome,
            project_name: String::new(),
            project_description: String::new(),
            target_users: vec![],
            problems_to_solve: vec![],
            business_processes: vec![],
            modules: vec![],
            nfrs: vec![],
            history: vec![],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}

/// 对话消息
#[derive(Debug, Clone)]
pub struct DialogMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub phase: DialogPhase,
}

/// 消息角色
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageRole {
    Assistant,
    User,
}

/// 业务流程草稿
#[derive(Debug, Clone)]
pub struct BusinessProcessDraft {
    pub name: String,
    pub description: String,
    pub process_type: ProcessDraftType,
    pub steps: Vec<String>,
}

/// 流程草稿类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessDraftType {
    Core,
    Support,
    Management,
}

/// 系统模块草稿
#[derive(Debug, Clone)]
pub struct SystemModuleDraft {
    pub name: String,
    pub description: String,
    pub module_type: ModuleDraftType,
    pub responsibilities: Vec<String>,
    pub tech_stack: Vec<String>,
    pub dependencies: Vec<String>,
}

/// 模块草稿类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleDraftType {
    Frontend,
    Backend,
    Database,
    Service,
    Infrastructure,
}

impl From<ModuleDraftType> for ModuleType {
    fn from(t: ModuleDraftType) -> Self {
        match t {
            ModuleDraftType::Frontend => ModuleType::Frontend,
            ModuleDraftType::Backend => ModuleType::Backend,
            ModuleDraftType::Database => ModuleType::Database,
            ModuleDraftType::Service => ModuleType::Service,
            ModuleDraftType::Infrastructure => ModuleType::Infrastructure,
        }
    }
}

/// 非功能要求草稿
#[derive(Debug, Clone)]
pub struct NFRDraft {
    pub category: NFRDraftCategory,
    pub name: String,
    pub description: String,
    pub priority: NFRDraftPriority,
    pub metrics: Option<String>,
}

/// NFR 草稿类别
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NFRDraftCategory {
    Performance,
    Security,
    Availability,
    Scalability,
    Usability,
    Maintainability,
    Other,
}

impl From<NFRDraftCategory> for NfrCategory {
    fn from(c: NFRDraftCategory) -> Self {
        match c {
            NFRDraftCategory::Performance => NfrCategory::Performance,
            NFRDraftCategory::Security => NfrCategory::Security,
            NFRDraftCategory::Availability => NfrCategory::Availability,
            NFRDraftCategory::Scalability => NfrCategory::Scalability,
            NFRDraftCategory::Usability => NfrCategory::Usability,
            NFRDraftCategory::Maintainability => NfrCategory::Maintainability,
            NFRDraftCategory::Other => NfrCategory::Other,
        }
    }
}

/// NFR 草稿优先级
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NFRDraftPriority {
    Must,
    Should,
    Could,
}

impl From<NFRDraftPriority> for MoscowPriority {
    fn from(p: NFRDraftPriority) -> Self {
        match p {
            NFRDraftPriority::Must => MoscowPriority::Must,
            NFRDraftPriority::Should => MoscowPriority::Should,
            NFRDraftPriority::Could => MoscowPriority::Could,
        }
    }
}

/// 对话事件
#[derive(Debug, Clone)]
pub enum DialogEvent {
    Started {
        session_id: String,
    },
    Message {
        session_id: String,
        message: DialogMessage,
    },
    PhaseChanged {
        session_id: String,
        phase: DialogPhase,
    },
    Ended {
        session_id: String,
    },
}

// ============================================================================
// 对话提示词
// ============================================================================

/// 获取阶段提示词
fn get_phase_prompt(phase: DialogPhase) -> &'static str {
    match phase {
        DialogPhase::Welcome => {
            r#"你好！我是你的项目需求分析助手。

在开始构建项目蓝图之前，我需要了解一些关于你项目的信息。这个过程分为几个步骤：

1. **项目背景** - 了解你的目标用户和要解决的问题
2. **核心流程** - 梳理主要的业务流程
3. **系统模块** - 确定需要的功能模块
4. **非功能要求** - 讨论性能、安全等要求
5. **确认汇总** - 生成蓝图草案供你确认

让我们开始吧！首先，请告诉我：

**你的项目叫什么名字？想要解决什么问题？**"#
        }

        DialogPhase::ProjectBackground => {
            r#"很好！现在让我更深入地了解你的项目背景。

请回答以下问题：

1. **目标用户是谁？** （例如：企业员工、普通消费者、开发者...）
2. **他们目前面临什么痛点？**
3. **你的解决方案有什么独特之处？**
4. **项目的预期规模是怎样的？** （用户量、数据量等）

你可以一次回答所有问题，也可以逐个回答。"#
        }

        DialogPhase::BusinessProcess => {
            r#"太棒了！现在让我们来梳理业务流程。

一个好的业务流程设计能帮助我们更清晰地理解系统需求。请思考：

1. **核心业务流程** - 用户完成主要任务的步骤
2. **支撑流程** - 支持核心业务的辅助流程
3. **管理流程** - 后台管理相关的流程

请描述你项目的主要业务流程，包括：
- 流程名称
- 流程类型（核心/支撑/管理）
- 主要步骤"#
        }

        DialogPhase::SystemModule => {
            r#"非常好！现在让我们来划分系统模块。

每个模块需要包含：
- 模块名称
- 模块类型（前端/后端/数据库/服务/基础设施）
- 主要职责
- 技术栈建议
- 依赖关系

请告诉我：
1. 你认为需要哪些模块？
2. 你对技术栈有什么偏好？"#
        }

        DialogPhase::NFR => {
            r#"模块设计很清晰！现在让我们讨论非功能性要求。

非功能性要求包括：

1. **性能** - 响应时间、吞吐量、并发数
2. **安全** - 认证、授权、数据加密
3. **可用性** - 系统可用时间、故障恢复
4. **可扩展性** - 水平扩展、垂直扩展
5. **可维护性** - 代码质量、文档、监控

请告诉我你对这些方面的要求。"#
        }

        DialogPhase::Summary => {
            r#"太棒了！我已经收集了所有需求信息。

请仔细检查并确认蓝图草案。

你可以：
1. **确认** - 蓝图没问题，可以进入下一步
2. **修改** - 告诉我需要修改的内容
3. **重来** - 重新开始需求收集

请输入"确认"、"修改 [内容]"或"重来"。"#
        }

        DialogPhase::Complete => {
            r#"蓝图已创建完成！

你可以：
1. 查看完整蓝图
2. 提交审核
3. 确认签字后开始执行

祝你的项目顺利！"#
        }
    }
}

// ============================================================================
// 需求对话管理器
// ============================================================================

/// 需求对话管理器
pub struct RequirementDialogManager {
    sessions: HashMap<String, DialogState>,
    event_sender: Option<mpsc::Sender<DialogEvent>>,
}

impl Default for RequirementDialogManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RequirementDialogManager {
    /// 创建新的管理器
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            event_sender: None,
        }
    }

    /// 设置事件发送器
    #[allow(dead_code)]
    pub fn with_event_sender(mut self, sender: mpsc::Sender<DialogEvent>) -> Self {
        self.event_sender = Some(sender);
        self
    }

    /// 发送事件
    async fn emit(&self, event: DialogEvent) {
        if let Some(ref sender) = self.event_sender {
            let _ = sender.send(event).await;
        }
    }

    /// 开始新的对话
    pub async fn start_dialog(&mut self) -> DialogState {
        let mut state = DialogState::default();

        // 添加欢迎消息
        state.history.push(DialogMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content: get_phase_prompt(DialogPhase::Welcome).to_string(),
            timestamp: Utc::now(),
            phase: DialogPhase::Welcome,
        });

        self.sessions.insert(state.id.clone(), state.clone());
        self.emit(DialogEvent::Started {
            session_id: state.id.clone(),
        })
        .await;

        state
    }

    /// 处理用户输入
    pub async fn process_user_input(
        &mut self,
        session_id: &str,
        input: &str,
    ) -> Result<DialogMessage, String> {
        // 先获取状态的副本和当前阶段
        let (current_phase, mut state_clone) = {
            let state = self
                .sessions
                .get(session_id)
                .ok_or_else(|| format!("对话会话 {} 不存在", session_id))?;
            (state.phase, state.clone())
        };

        // 记录用户消息
        let user_message = DialogMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::User,
            content: input.to_string(),
            timestamp: Utc::now(),
            phase: current_phase,
        };
        state_clone.history.push(user_message.clone());
        state_clone.updated_at = Utc::now();

        // 根据当前阶段处理输入（使用静态方法避免借用冲突）
        let (response, next_phase) = match current_phase {
            DialogPhase::Welcome => {
                Self::process_welcome_input_static(&mut state_clone, input);
                (
                    Self::format_welcome_response_static(&state_clone),
                    DialogPhase::ProjectBackground,
                )
            }
            DialogPhase::ProjectBackground => {
                Self::process_background_input_static(&mut state_clone, input);
                (
                    Self::format_background_response_static(&state_clone),
                    DialogPhase::BusinessProcess,
                )
            }
            DialogPhase::BusinessProcess => {
                Self::process_business_process_input_static(&mut state_clone, input);
                (
                    Self::format_business_process_response_static(&state_clone),
                    DialogPhase::SystemModule,
                )
            }
            DialogPhase::SystemModule => {
                Self::process_module_input_static(&mut state_clone, input);
                (
                    Self::format_module_response_static(&state_clone),
                    DialogPhase::NFR,
                )
            }
            DialogPhase::NFR => {
                Self::process_nfr_input_static(&mut state_clone, input);
                let summary = Self::generate_summary_static(&state_clone);
                (
                    format!("{}\n\n{}", summary, get_phase_prompt(DialogPhase::Summary)),
                    DialogPhase::Summary,
                )
            }
            DialogPhase::Summary => Self::process_summary_input_static(&mut state_clone, input),
            DialogPhase::Complete => ("对话已完成。".to_string(), DialogPhase::Complete),
        };

        // 更新阶段
        state_clone.phase = next_phase;

        // 记录助手回复
        let assistant_message = DialogMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content: response,
            timestamp: Utc::now(),
            phase: state_clone.phase,
        };
        state_clone.history.push(assistant_message.clone());

        // 更新会话状态
        self.sessions.insert(session_id.to_string(), state_clone);

        self.emit(DialogEvent::Message {
            session_id: session_id.to_string(),
            message: assistant_message.clone(),
        })
        .await;

        Ok(assistant_message)
    }

    /// 处理欢迎阶段输入（静态版本）
    fn process_welcome_input_static(state: &mut DialogState, input: &str) {
        let first_line = input.lines().next().unwrap_or(input);
        state.project_name = first_line.chars().take(50).collect();
        state.project_description = input.to_string();
    }

    /// 格式化欢迎响应（静态版本）
    fn format_welcome_response_static(state: &DialogState) -> String {
        format!(
            "很好！我了解了：\n\n**项目名称**：{}\n**项目目标**：{}\n\n{}",
            state.project_name,
            state
                .project_description
                .chars()
                .take(200)
                .collect::<String>(),
            get_phase_prompt(DialogPhase::ProjectBackground)
        )
    }

    /// 处理项目背景阶段输入（静态版本）
    fn process_background_input_static(state: &mut DialogState, input: &str) {
        for line in input.lines() {
            let line_lower = line.to_lowercase();
            if line_lower.contains("用户") || line_lower.contains("user") {
                state.target_users.push(line.to_string());
            }
            if line_lower.contains("问题") || line_lower.contains("痛点") {
                state.problems_to_solve.push(line.to_string());
            }
        }
        if state.target_users.is_empty() && state.problems_to_solve.is_empty() {
            state.project_description.push('\n');
            state.project_description.push_str(input);
        }
    }

    /// 格式化背景响应（静态版本）
    fn format_background_response_static(state: &DialogState) -> String {
        format!(
            "太棒了！我已经记录了这些背景信息：\n\n**目标用户**：{}\n**要解决的问题**：\n{}\n\n{}",
            if state.target_users.is_empty() {
                "待确定".to_string()
            } else {
                state.target_users.join("、")
            },
            if state.problems_to_solve.is_empty() {
                "- 待确定".to_string()
            } else {
                state
                    .problems_to_solve
                    .iter()
                    .map(|p| format!("- {}", p))
                    .collect::<Vec<_>>()
                    .join("\n")
            },
            get_phase_prompt(DialogPhase::BusinessProcess)
        )
    }

    /// 处理业务流程阶段输入（静态版本）
    fn process_business_process_input_static(state: &mut DialogState, input: &str) {
        let mut current_process: Option<BusinessProcessDraft> = None;

        for line in input.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let process_type = if line.contains("核心") {
                Some(ProcessDraftType::Core)
            } else if line.contains("支撑") {
                Some(ProcessDraftType::Support)
            } else if line.contains("管理") {
                Some(ProcessDraftType::Management)
            } else {
                None
            };

            if let Some(pt) = process_type {
                if let Some(p) = current_process.take() {
                    state.business_processes.push(p);
                }
                current_process = Some(BusinessProcessDraft {
                    name: line.to_string(),
                    description: String::new(),
                    process_type: pt,
                    steps: vec![],
                });
            } else if let Some(ref mut p) = current_process {
                if line.starts_with('-') || line.starts_with('•') || line.starts_with("步骤") {
                    p.steps
                        .push(line.trim_start_matches(['-', '•', ' ']).to_string());
                } else {
                    p.description.push_str(line);
                    p.description.push(' ');
                }
            }
        }

        if let Some(p) = current_process {
            state.business_processes.push(p);
        }

        if state.business_processes.is_empty() {
            state.business_processes.push(BusinessProcessDraft {
                name: "主要业务流程".to_string(),
                description: input.to_string(),
                process_type: ProcessDraftType::Core,
                steps: input
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.to_string())
                    .collect(),
            });
        }
    }

    /// 格式化业务流程响应（静态版本）
    fn format_business_process_response_static(state: &DialogState) -> String {
        let processes_str = state
            .business_processes
            .iter()
            .map(|p| {
                format!(
                    "- **{}** ({:?}): {} 个步骤",
                    p.name,
                    p.process_type,
                    p.steps.len()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            "我已记录以下业务流程：\n\n{}\n\n{}",
            processes_str,
            get_phase_prompt(DialogPhase::SystemModule)
        )
    }

    /// 处理模块阶段输入（静态版本）
    fn process_module_input_static(state: &mut DialogState, input: &str) {
        let mut current_module: Option<SystemModuleDraft> = None;

        for line in input.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let module_type = if line.contains("前端")
                || line.contains("frontend")
                || line.contains("UI")
            {
                Some(ModuleDraftType::Frontend)
            } else if line.contains("后端") || line.contains("backend") || line.contains("API") {
                Some(ModuleDraftType::Backend)
            } else if line.contains("数据") || line.contains("database") || line.contains("存储")
            {
                Some(ModuleDraftType::Database)
            } else if line.contains("服务") || line.contains("service") {
                Some(ModuleDraftType::Service)
            } else {
                None
            };

            if let Some(mt) = module_type {
                if let Some(m) = current_module.take() {
                    state.modules.push(m);
                }
                current_module = Some(SystemModuleDraft {
                    name: line.to_string(),
                    description: String::new(),
                    module_type: mt,
                    responsibilities: vec![],
                    tech_stack: vec![],
                    dependencies: vec![],
                });
            } else if let Some(ref mut m) = current_module {
                if line.starts_with('-') || line.starts_with('•') {
                    m.responsibilities
                        .push(line.trim_start_matches(['-', '•', ' ']).to_string());
                } else {
                    m.description.push_str(line);
                    m.description.push(' ');
                }
            }
        }

        if let Some(m) = current_module {
            state.modules.push(m);
        }

        if state.modules.is_empty() {
            state.modules.push(SystemModuleDraft {
                name: "主模块".to_string(),
                description: input.to_string(),
                module_type: ModuleDraftType::Backend,
                responsibilities: input
                    .lines()
                    .filter(|l| !l.trim().is_empty())
                    .map(|l| l.to_string())
                    .collect(),
                tech_stack: vec![],
                dependencies: vec![],
            });
        }
    }

    /// 格式化模块响应（静态版本）
    fn format_module_response_static(state: &DialogState) -> String {
        let modules_str = state
            .modules
            .iter()
            .map(|m| {
                format!(
                    "- **{}** ({:?}): {} 项职责",
                    m.name,
                    m.module_type,
                    m.responsibilities.len()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            "我已记录以下系统模块：\n\n{}\n\n{}",
            modules_str,
            get_phase_prompt(DialogPhase::NFR)
        )
    }

    /// 处理 NFR 阶段输入（静态版本）
    fn process_nfr_input_static(state: &mut DialogState, input: &str) {
        for line in input.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let category = if line.contains("性能") || line.contains("performance") {
                NFRDraftCategory::Performance
            } else if line.contains("安全") || line.contains("security") {
                NFRDraftCategory::Security
            } else if line.contains("可用") || line.contains("availability") {
                NFRDraftCategory::Availability
            } else if line.contains("可维护") || line.contains("maintainability") {
                NFRDraftCategory::Maintainability
            } else {
                NFRDraftCategory::Other
            };

            state.nfrs.push(NFRDraft {
                name: line.to_string(),
                description: line.to_string(),
                category,
                priority: NFRDraftPriority::Should,
                metrics: None,
            });
        }

        if state.nfrs.is_empty() {
            state.nfrs.push(NFRDraft {
                name: "基本可用性".to_string(),
                description: "系统应保持基本可用".to_string(),
                category: NFRDraftCategory::Availability,
                priority: NFRDraftPriority::Must,
                metrics: None,
            });
        }
    }

    /// 生成摘要（静态版本）
    fn generate_summary_static(state: &DialogState) -> String {
        let mut summary = String::new();
        summary.push_str(&format!("# 蓝图摘要：{}\n\n", state.project_name));
        summary.push_str(&format!("## 项目描述\n{}\n\n", state.project_description));

        summary.push_str("## 业务流程\n");
        for p in &state.business_processes {
            summary.push_str(&format!("- **{}** ({:?})\n", p.name, p.process_type));
            for step in &p.steps {
                summary.push_str(&format!("  - {}\n", step));
            }
        }
        summary.push('\n');

        summary.push_str("## 系统模块\n");
        for m in &state.modules {
            summary.push_str(&format!("- **{}** ({:?})\n", m.name, m.module_type));
            for r in &m.responsibilities {
                summary.push_str(&format!("  - {}\n", r));
            }
        }
        summary.push('\n');

        summary.push_str("## 非功能性要求\n");
        for n in &state.nfrs {
            summary.push_str(&format!(
                "- **{}** ({:?}, {:?})\n",
                n.name, n.category, n.priority
            ));
        }

        summary
    }

    /// 处理摘要阶段输入（静态版本）
    fn process_summary_input_static(
        _state: &mut DialogState,
        input: &str,
    ) -> (String, DialogPhase) {
        let input_lower = input.to_lowercase();
        if input_lower.contains("确认")
            || input_lower.contains("ok")
            || input_lower.contains("好")
            || input_lower.contains("yes")
        {
            (
                "太好了！蓝图已确认。现在可以生成正式蓝图了。".to_string(),
                DialogPhase::Complete,
            )
        } else if input_lower.contains("修改") || input_lower.contains("改") {
            (
                "好的，请告诉我需要修改的内容。".to_string(),
                DialogPhase::Summary,
            )
        } else {
            (
                "请确认蓝图内容是否正确，或告诉我需要修改的地方。".to_string(),
                DialogPhase::Summary,
            )
        }
    }

    /// 处理欢迎阶段输入
    #[allow(dead_code)]
    fn process_welcome_input(&self, state: &mut DialogState, input: &str) {
        Self::process_welcome_input_static(state, input);
    }

    /// 格式化欢迎响应
    #[allow(dead_code)]
    fn format_welcome_response(&self, state: &DialogState) -> String {
        Self::format_welcome_response_static(state)
    }

    /// 处理项目背景阶段输入
    #[allow(dead_code)]
    fn process_background_input(&self, state: &mut DialogState, input: &str) {
        Self::process_background_input_static(state, input);
    }

    /// 格式化背景响应
    #[allow(dead_code)]
    fn format_background_response(&self, state: &DialogState) -> String {
        Self::format_background_response_static(state)
    }

    /// 处理业务流程阶段输入
    #[allow(dead_code)]
    fn process_business_process_input(&self, state: &mut DialogState, input: &str) {
        Self::process_business_process_input_static(state, input);
    }

    /// 格式化业务流程响应
    #[allow(dead_code)]
    fn format_business_process_response(&self, state: &DialogState) -> String {
        Self::format_business_process_response_static(state)
    }

    /// 处理系统模块阶段输入
    #[allow(dead_code)]
    fn process_module_input(&self, state: &mut DialogState, input: &str) {
        // 如果还没有模块，先生成建议模块
        if state.modules.is_empty() {
            state.modules = self.suggest_modules(state);
        }
        Self::process_module_input_static(state, input);
    }

    /// 格式化模块响应
    #[allow(dead_code)]
    fn format_module_response(&self, state: &DialogState) -> String {
        Self::format_module_response_static(state)
    }

    /// 建议系统模块
    #[allow(dead_code)]
    fn suggest_modules(&self, state: &DialogState) -> Vec<SystemModuleDraft> {
        let mut modules = Vec::new();

        // 根据业务流程推断需要的模块
        let has_user_flow = state
            .business_processes
            .iter()
            .any(|p| p.name.contains("用户") || p.name.contains("登录") || p.name.contains("注册"));

        // 前端模块
        modules.push(SystemModuleDraft {
            name: "前端应用".to_string(),
            description: "用户界面".to_string(),
            module_type: ModuleDraftType::Frontend,
            responsibilities: vec!["用户界面渲染".to_string(), "用户交互处理".to_string()],
            tech_stack: vec!["React".to_string(), "TypeScript".to_string()],
            dependencies: vec!["后端服务".to_string()],
        });

        // 后端模块
        modules.push(SystemModuleDraft {
            name: "后端服务".to_string(),
            description: "业务逻辑处理".to_string(),
            module_type: ModuleDraftType::Backend,
            responsibilities: vec!["API 接口".to_string(), "业务逻辑".to_string()],
            tech_stack: vec!["Node.js".to_string(), "Express".to_string()],
            dependencies: vec!["数据库".to_string()],
        });

        // 数据库模块
        modules.push(SystemModuleDraft {
            name: "数据库".to_string(),
            description: "数据持久化".to_string(),
            module_type: ModuleDraftType::Database,
            responsibilities: vec!["数据存储".to_string(), "数据查询".to_string()],
            tech_stack: vec!["PostgreSQL".to_string()],
            dependencies: vec![],
        });

        // 如果有用户相关流程，添加认证模块
        if has_user_flow {
            modules.push(SystemModuleDraft {
                name: "认证服务".to_string(),
                description: "用户认证和授权".to_string(),
                module_type: ModuleDraftType::Service,
                responsibilities: vec!["用户认证".to_string(), "权限管理".to_string()],
                tech_stack: vec!["JWT".to_string()],
                dependencies: vec!["数据库".to_string()],
            });
        }

        modules
    }

    /// 处理非功能要求阶段输入
    #[allow(dead_code)]
    fn process_nfr_input(&self, state: &mut DialogState, input: &str) {
        // 解析用户输入的 NFR
        let input_lower = input.to_lowercase();

        // 性能要求
        if input_lower.contains("性能")
            || input_lower.contains("响应")
            || input_lower.contains("ms")
        {
            state.nfrs.push(NFRDraft {
                category: NFRDraftCategory::Performance,
                name: "API 响应时间".to_string(),
                description: "API 平均响应时间应控制在合理范围内".to_string(),
                priority: NFRDraftPriority::Should,
                metrics: Some("< 500ms".to_string()),
            });
        }

        // 安全要求
        if input_lower.contains("安全")
            || input_lower.contains("认证")
            || input_lower.contains("加密")
        {
            state.nfrs.push(NFRDraft {
                category: NFRDraftCategory::Security,
                name: "用户认证".to_string(),
                description: "实现安全的用户认证机制".to_string(),
                priority: NFRDraftPriority::Must,
                metrics: None,
            });
        }

        // 可用性要求
        if input_lower.contains("可用") || input_lower.contains("99") {
            state.nfrs.push(NFRDraft {
                category: NFRDraftCategory::Availability,
                name: "系统可用性".to_string(),
                description: "系统应保持高可用性".to_string(),
                priority: NFRDraftPriority::Should,
                metrics: Some("99.9%".to_string()),
            });
        }

        // 如果没有解析到 NFR，添加默认值
        if state.nfrs.is_empty() {
            state.nfrs = self.get_default_nfrs();
        }
    }

    /// 获取默认 NFR
    #[allow(dead_code)]
    fn get_default_nfrs(&self) -> Vec<NFRDraft> {
        vec![
            NFRDraft {
                category: NFRDraftCategory::Performance,
                name: "API 响应时间".to_string(),
                description: "API 平均响应时间应控制在合理范围内".to_string(),
                priority: NFRDraftPriority::Should,
                metrics: Some("< 500ms".to_string()),
            },
            NFRDraft {
                category: NFRDraftCategory::Security,
                name: "用户认证".to_string(),
                description: "实现安全的用户认证机制".to_string(),
                priority: NFRDraftPriority::Must,
                metrics: None,
            },
            NFRDraft {
                category: NFRDraftCategory::Availability,
                name: "系统可用性".to_string(),
                description: "系统应保持高可用性".to_string(),
                priority: NFRDraftPriority::Should,
                metrics: Some("99.9%".to_string()),
            },
        ]
    }

    /// 生成摘要
    #[allow(dead_code)]
    fn generate_summary(&self, state: &DialogState) -> String {
        let processes_str = state
            .business_processes
            .iter()
            .map(|p| {
                let type_str = match p.process_type {
                    ProcessDraftType::Core => "核心",
                    ProcessDraftType::Support => "支撑",
                    ProcessDraftType::Management => "管理",
                };
                format!("- **{}**（{}）：{}", p.name, type_str, p.steps.join(" → "))
            })
            .collect::<Vec<_>>()
            .join("\n");

        let modules_str = state
            .modules
            .iter()
            .map(|m| {
                let type_str = match m.module_type {
                    ModuleDraftType::Frontend => "前端",
                    ModuleDraftType::Backend => "后端",
                    ModuleDraftType::Database => "数据库",
                    ModuleDraftType::Service => "服务",
                    ModuleDraftType::Infrastructure => "基础设施",
                };
                format!(
                    "- **{}**（{}）：{}",
                    m.name,
                    type_str,
                    m.responsibilities.join("、")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let nfrs_str = state
            .nfrs
            .iter()
            .map(|n| {
                let priority_str = match n.priority {
                    NFRDraftPriority::Must => "MUST",
                    NFRDraftPriority::Should => "SHOULD",
                    NFRDraftPriority::Could => "COULD",
                };
                let metrics_str = n
                    .metrics
                    .as_ref()
                    .map(|m| format!("（{}）", m))
                    .unwrap_or_default();
                format!(
                    "- [{}] {}：{}{}",
                    priority_str, n.name, n.description, metrics_str
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            r#"# 蓝图草案：{}

## 项目概述
{}

**目标用户**：{}

## 业务流程（{} 个）
{}

## 系统模块（{} 个）
{}

## 非功能要求（{} 项）
{}

---"#,
            state.project_name,
            state.project_description,
            if state.target_users.is_empty() {
                "待定".to_string()
            } else {
                state.target_users.join("、")
            },
            state.business_processes.len(),
            processes_str,
            state.modules.len(),
            modules_str,
            state.nfrs.len(),
            nfrs_str
        )
    }

    /// 处理汇总确认阶段输入
    #[allow(dead_code)]
    fn process_summary_input(&self, state: &mut DialogState, input: &str) -> (String, DialogPhase) {
        let normalized = input.trim().to_lowercase();

        if normalized == "确认" || normalized == "confirm" || normalized == "yes" {
            // 确认，进入完成阶段
            (
                get_phase_prompt(DialogPhase::Complete).to_string(),
                DialogPhase::Complete,
            )
        } else if normalized == "重来" || normalized == "restart" {
            // 重置状态
            state.phase = DialogPhase::Welcome;
            state.project_name.clear();
            state.project_description.clear();
            state.target_users.clear();
            state.problems_to_solve.clear();
            state.business_processes.clear();
            state.modules.clear();
            state.nfrs.clear();
            (
                format!(
                    "好的，让我们重新开始。\n\n{}",
                    get_phase_prompt(DialogPhase::Welcome)
                ),
                DialogPhase::Welcome,
            )
        } else {
            // 当作修改请求处理
            let summary = self.generate_summary(state);
            (format!("已记录您的修改意见。\n\n{}\n\n请确认修改后的内容。输入「确认」、「修改 [内容]」或「重来」。", summary), DialogPhase::Summary)
        }
    }

    /// 从状态创建蓝图
    pub async fn create_blueprint_from_state(
        &self,
        state: &DialogState,
        blueprint_manager: &mut BlueprintManager,
    ) -> Result<Blueprint, String> {
        // 创建蓝图
        let blueprint = blueprint_manager
            .create_blueprint(
                state.project_name.clone(),
                state.project_description.clone(),
            )
            .await
            .map_err(|e| e.to_string())?;

        // 添加业务流程
        for process in &state.business_processes {
            let bp = BusinessProcess {
                id: uuid::Uuid::new_v4().to_string(),
                name: process.name.clone(),
                description: process.description.clone(),
                process_type: ProcessType::ToBe,
                steps: process
                    .steps
                    .iter()
                    .enumerate()
                    .map(|(i, step)| ProcessStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        order: i as u32 + 1,
                        name: step.clone(),
                        description: step.clone(),
                        actor: "user".to_string(),
                        system_action: None,
                        user_action: Some(step.clone()),
                        conditions: vec![],
                        outcomes: vec![],
                    })
                    .collect(),
                actors: vec!["user".to_string()],
                inputs: vec![],
                outputs: vec![],
            };
            blueprint_manager
                .add_business_process(&blueprint.id, bp)
                .await
                .map_err(|e| e.to_string())?;
        }

        // 添加系统模块
        let mut module_id_map: HashMap<String, String> = HashMap::new();

        for module in &state.modules {
            let sys_module = SystemModule {
                id: uuid::Uuid::new_v4().to_string(),
                name: module.name.clone(),
                description: module.description.clone(),
                module_type: module.module_type.into(),
                responsibilities: module.responsibilities.clone(),
                dependencies: vec![],
                interfaces: vec![],
                tech_stack: Some(module.tech_stack.clone()),
                root_path: None,
            };
            module_id_map.insert(module.name.clone(), sys_module.id.clone());
            blueprint_manager
                .add_module(&blueprint.id, sys_module)
                .await
                .map_err(|e| e.to_string())?;
        }

        // 添加非功能要求
        for nfr in &state.nfrs {
            let requirement = NonFunctionalRequirement {
                id: uuid::Uuid::new_v4().to_string(),
                category: nfr.category.into(),
                name: nfr.name.clone(),
                description: nfr.description.clone(),
                priority: nfr.priority.into(),
                metric: nfr.metrics.clone(),
            };
            blueprint_manager
                .add_nfr(&blueprint.id, requirement)
                .await
                .map_err(|e| e.to_string())?;
        }

        // 获取更新后的蓝图
        let blueprint = blueprint_manager
            .get_blueprint(&blueprint.id)
            .await
            .ok_or_else(|| "无法获取创建的蓝图".to_string())?;

        Ok(blueprint)
    }

    /// 获取对话状态
    pub fn get_dialog_state(&self, session_id: &str) -> Option<&DialogState> {
        self.sessions.get(session_id)
    }

    /// 获取当前阶段的提示
    pub fn get_current_phase_prompt(&self, session_id: &str) -> String {
        self.sessions
            .get(session_id)
            .map(|s| get_phase_prompt(s.phase).to_string())
            .unwrap_or_default()
    }

    /// 结束对话
    pub async fn end_dialog(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
        self.emit(DialogEvent::Ended {
            session_id: session_id.to_string(),
        })
        .await;
    }
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建需求对话管理器
pub fn create_requirement_dialog_manager() -> RequirementDialogManager {
    RequirementDialogManager::new()
}
