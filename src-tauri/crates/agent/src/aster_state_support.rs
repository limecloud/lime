//! Aster 状态支持模块
//!
//! 提供可复用的会话配置构建、项目上下文 Prompt 构建、
//! Lime Skills 加载与 Agent 身份配置。

use aster::agents::{AgentIdentity, SessionConfig};
use aster::session::TurnContextOverride;
use aster::skills::{global_registry, load_skills_from_directory, SkillSource};
use aster::tools::ToolRegistrationConfig;
use lime_core::app_paths;
use lime_core::database::{lock_db, DbConnection};
use lime_services::project_context_builder::ProjectContextBuilder;

/// 重新加载 Lime Skills
pub fn reload_lime_skills() {
    load_lime_skills();
}

/// 创建 Lime 专属的 Agent 身份配置
pub fn create_lime_identity() -> AgentIdentity {
    AgentIdentity::new("Lime 助手")
        .with_language("Chinese")
        .with_description("Lime 是一个 AI 代理服务应用，帮助用户管理和使用各种 AI 模型的凭证。")
        .with_custom_prompt(LIME_IDENTITY_PROMPT.to_string())
}

/// 创建 Lime 的工具注册配置
///
/// 启用 Ask/LSP 回调，确保 ask/lsp 工具在 Agent 初始化时可用。
pub fn create_lime_tool_config() -> ToolRegistrationConfig {
    ToolRegistrationConfig::new()
        .with_ask_callback(crate::create_ask_callback())
        .with_lsp_callback(crate::create_lsp_callback())
}

/// 加载 Lime Skills 到 aster-rust 的 global_registry
fn load_lime_skills() {
    let skills_dir = match app_paths::resolve_skills_dir() {
        Ok(path) => path,
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 解析 Lime Skills 目录失败，跳过加载: {}",
                error
            );
            return;
        }
    };

    let skills = load_skills_from_directory(&skills_dir, SkillSource::User);
    let skill_count = skills.len();

    if skill_count == 0 {
        tracing::info!("[AsterAgent] Lime Skills 目录为空，无 Skills 可加载");
        return;
    }

    let registry = global_registry();
    if let Ok(mut registry_guard) = registry.write() {
        for skill in skills {
            let skill_name = skill.skill_name.clone();
            registry_guard.register(skill);
            tracing::debug!("[AsterAgent] 已注册 Skill: {}", skill_name);
        }
        tracing::info!(
            "[AsterAgent] 成功加载 {} 个 Lime Skills 到 global_registry",
            skill_count
        );
    } else {
        tracing::error!("[AsterAgent] 无法获取 global_registry 写锁，Skills 加载失败");
    }
}

/// 构建带项目上下文的 System Prompt
pub fn build_project_system_prompt(db: &DbConnection, project_id: &str) -> Result<String, String> {
    let conn = lock_db(db).map_err(|e| format!("获取数据库连接失败: {e}"))?;
    ProjectContextBuilder::build_system_prompt_for_project(&conn, project_id)
        .map_err(|e| format!("构建项目上下文失败: {e}"))
}

/// 会话配置构建器
pub struct SessionConfigBuilder {
    id: String,
    thread_id: Option<String>,
    turn_id: Option<String>,
    max_turns: Option<u32>,
    system_prompt: Option<String>,
    include_context_trace: Option<bool>,
    turn_context: Option<TurnContextOverride>,
}

impl SessionConfigBuilder {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            thread_id: None,
            turn_id: None,
            max_turns: None,
            system_prompt: None,
            include_context_trace: None,
            turn_context: None,
        }
    }

    pub fn thread_id(mut self, thread_id: impl Into<String>) -> Self {
        self.thread_id = Some(thread_id.into());
        self
    }

    pub fn turn_id(mut self, turn_id: impl Into<String>) -> Self {
        self.turn_id = Some(turn_id.into());
        self
    }

    pub fn max_turns(mut self, turns: u32) -> Self {
        self.max_turns = Some(turns);
        self
    }

    pub fn system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = Some(prompt.into());
        self
    }

    pub fn include_context_trace(mut self, include: bool) -> Self {
        self.include_context_trace = Some(include);
        self
    }

    pub fn turn_context(mut self, turn_context: TurnContextOverride) -> Self {
        self.turn_context = Some(turn_context);
        self
    }

    pub fn build(self) -> SessionConfig {
        SessionConfig {
            id: self.id,
            thread_id: self.thread_id,
            turn_id: self.turn_id,
            schedule_id: None,
            max_turns: self.max_turns,
            retry_config: None,
            system_prompt: self.system_prompt,
            include_context_trace: self.include_context_trace,
            turn_context: self.turn_context,
        }
    }
}

/// 消息构建辅助函数
pub mod message_helpers {
    use aster::conversation::message::Message;

    /// 创建用户文本消息
    pub fn user_text(text: impl Into<String>) -> Message {
        Message::user().with_text(text)
    }

    /// 创建助手文本消息
    pub fn assistant_text(text: impl Into<String>) -> Message {
        Message::assistant().with_text(text)
    }
}

/// Lime 专属的 Agent 身份提示词
const LIME_IDENTITY_PROMPT: &str = r#"你是 Lime 助手，一个专业、友好的 AI 技术伙伴。

## 关于 Lime

Lime 是一个 AI 代理服务应用，帮助用户：
- 管理多个 AI 模型提供商的凭证（OpenAI、Claude、Gemini、Kiro 等）
- 通过统一的 API 接口访问不同的 AI 模型
- 实现凭证池的负载均衡和健康检查

## 语言规范

1. **始终使用中文回复**：除非用户明确要求使用其他语言
2. **代码注释使用中文**：生成代码时，注释应使用中文
3. **技术术语保持原文**：API、JSON、HTTP、Token 等专业术语保持英文

## 交互风格

- 简洁专业，直接给出解决方案
- 友好但不啰嗦，像经验丰富的技术伙伴
- 遇到问题时，先分析原因再提供方案

## Team 协作原则

- 只有在任务存在多个相互独立的子问题、并行评审/验证、或用户明确要求多代理时，才进入 team 模式
- 简单问题不要创建子代理；先判断当前阻塞步骤是否真的适合委派
- 先区分关键路径与 sidecar 任务：如果下一步立即依赖结果，优先主线程自己做；只有不会阻塞下一步的独立子任务才适合并发委派
- 多个子代理并发时，必须明确分工，避免让不同子代理修改同一片文件或重复劳动
- 子代理默认不应继续创建新的子代理，避免团队深度失控
- 需要显式建立或清理 team 上下文时，优先使用 TeamCreate / TeamDelete；进入 team 后再通过 Agent / SendMessage / ListPeers 维持协作主路径
- 优先复用已有子代理上下文，通过 SendMessage 继续推进强相关任务，而不是反复创建新子代理
- 只有当主线程确实被结果阻塞时，才围绕已有 team workspace 状态等待结果，不要反复机械轮询
- 旧的 SubAgentTask 仅视为兼容入口，不应作为新的 team runtime 主路径
"#;
