use crate::commands::provider_pool_cmd::check_playwright_available;
use crate::database::DbConnection;
use lime_services::api_key_provider_service::ApiKeyProviderService;
use lime_services::model_service::ModelService;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClawSolutionReadiness {
    Ready,
    NeedsSetup,
    NeedsCapability,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClawSolutionActionType {
    FillInput,
    NavigateTheme,
    LaunchBrowserAssist,
    EnableTeamMode,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClawSolutionReasonCode {
    MissingModel,
    MissingBrowserCapability,
    MissingSkillDependency,
    TeamRecommended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawSolutionSummary {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub output_hint: String,
    pub recommended_capabilities: Vec<String>,
    pub readiness: ClawSolutionReadiness,
    pub readiness_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ClawSolutionReasonCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawSolutionDetail {
    #[serde(flatten)]
    pub summary: ClawSolutionSummary,
    pub starter_prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followup_mode: Option<String>,
    pub capability_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawSolutionReadinessResult {
    pub solution_id: String,
    pub readiness: ClawSolutionReadiness,
    pub readiness_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ClawSolutionReasonCode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClawSolutionContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_input: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClawSolutionPreparation {
    pub solution_id: String,
    pub action_type: ClawSolutionActionType,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme_target: Option<String>,
    pub should_launch_browser_assist: bool,
    pub should_enable_team_mode: bool,
    pub readiness: ClawSolutionReadiness,
    pub readiness_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ClawSolutionReasonCode>,
}

#[derive(Debug, Clone, Copy)]
struct ClawSolutionDefinition {
    id: &'static str,
    title: &'static str,
    summary: &'static str,
    output_hint: &'static str,
    starter_prompt: &'static str,
    theme_target: Option<&'static str>,
    followup_mode: Option<&'static str>,
    capability_tags: &'static [&'static str],
    recommended_capabilities: &'static [&'static str],
    action_type: ClawSolutionActionType,
    needs_browser_capability: bool,
    should_enable_team_mode: bool,
}

#[derive(Debug, Clone, Copy)]
struct CapabilitySnapshot {
    has_available_models: bool,
    browser_available: bool,
}

const CLAW_SOLUTIONS: [ClawSolutionDefinition; 6] = [
    ClawSolutionDefinition {
        id: "web-research-brief",
        title: "网页研究简报",
        summary: "快速整理调研范围、关键信息与结论框架，适合先把研究任务落成一版结构化简报。",
        output_hint: "研究提纲 + 结论简报",
        starter_prompt: "请围绕这个主题先给我做一版网页研究简报：明确研究目标、关键信息来源、核心发现、风险点，以及接下来最值得继续追踪的问题。",
        theme_target: None,
        followup_mode: Some("iterative"),
        capability_tags: &["research", "brief"],
        recommended_capabilities: &["模型", "研究"],
        action_type: ClawSolutionActionType::FillInput,
        needs_browser_capability: false,
        should_enable_team_mode: false,
    },
    ClawSolutionDefinition {
        id: "social-post-starter",
        title: "社媒主稿生成",
        summary: "先进入社媒专项工作台，再围绕平台语境、结构和表达生成可继续迭代的首稿。",
        output_hint: "社媒首稿 + 平台结构",
        starter_prompt: "请先帮我起草一版社媒内容首稿：明确目标受众、平台语境、标题方向、正文结构和可继续扩写的角度。",
        theme_target: Some("social-media"),
        followup_mode: Some("gui"),
        capability_tags: &["social-media", "draft"],
        recommended_capabilities: &["模型", "社媒主题"],
        action_type: ClawSolutionActionType::NavigateTheme,
        needs_browser_capability: false,
        should_enable_team_mode: false,
    },
    ClawSolutionDefinition {
        id: "frontend-concept",
        title: "前端概念方案",
        summary: "快速产出信息架构、关键模块与页面关系，适合产品概念、后台台架或工作台原型讨论。",
        output_hint: "IA + 模块方案",
        starter_prompt: "请帮我先整理一版前端概念方案：输出信息架构、核心页面、关键模块、交互流程和第一轮组件拆分建议。",
        theme_target: None,
        followup_mode: Some("iterative"),
        capability_tags: &["frontend", "architecture"],
        recommended_capabilities: &["模型", "结构化输出"],
        action_type: ClawSolutionActionType::FillInput,
        needs_browser_capability: false,
        should_enable_team_mode: false,
    },
    ClawSolutionDefinition {
        id: "slide-outline",
        title: "演示提纲草案",
        summary: "先拿到一版可讲述的演示结构，覆盖封面、问题、观点、案例与行动建议。",
        output_hint: "PPT 大纲 + 讲述线",
        starter_prompt: "请基于这个目标先生成一版演示提纲：包含封面定位、目录、核心论点、案例支撑、结论和下一步行动。",
        theme_target: None,
        followup_mode: Some("iterative"),
        capability_tags: &["slides", "outline"],
        recommended_capabilities: &["模型", "结构化输出"],
        action_type: ClawSolutionActionType::FillInput,
        needs_browser_capability: false,
        should_enable_team_mode: false,
    },
    ClawSolutionDefinition {
        id: "browser-assist-task",
        title: "浏览器协助办事",
        summary: "适合登录、表单、网页操作和信息采集任务，进入工作区后直接接管浏览器协助链路。",
        output_hint: "浏览器任务执行",
        starter_prompt: "请协助我完成一个浏览器任务：先明确目标网页、目标动作、约束条件和预期结果，再进入执行。",
        theme_target: None,
        followup_mode: Some("browser_assist"),
        capability_tags: &["browser", "automation"],
        recommended_capabilities: &["模型", "浏览器协助"],
        action_type: ClawSolutionActionType::LaunchBrowserAssist,
        needs_browser_capability: true,
        should_enable_team_mode: false,
    },
    ClawSolutionDefinition {
        id: "team-breakdown",
        title: "多代理拆任务",
        summary: "适合需要并行调研、方案拆解或多角色协作的任务，进入后默认启用 team runtime 偏好。",
        output_hint: "任务拆解 + 分工执行",
        starter_prompt: "请把这个任务按多代理方式拆解：先定义目标和约束，再拆成并行子任务，明确每个子代理的职责、产出和回收方式。",
        theme_target: None,
        followup_mode: Some("team_runtime"),
        capability_tags: &["team", "decomposition"],
        recommended_capabilities: &["模型", "多代理"],
        action_type: ClawSolutionActionType::EnableTeamMode,
        needs_browser_capability: false,
        should_enable_team_mode: true,
    },
];

#[derive(Debug, Default)]
pub struct ClawSolutionService;

impl ClawSolutionService {
    pub async fn list(&self, db: &DbConnection) -> Result<Vec<ClawSolutionSummary>, String> {
        let snapshot = self.build_capability_snapshot(db, true).await?;

        Ok(CLAW_SOLUTIONS
            .iter()
            .map(|definition| self.to_summary(definition, snapshot))
            .collect())
    }

    pub async fn detail(
        &self,
        db: &DbConnection,
        solution_id: &str,
    ) -> Result<ClawSolutionDetail, String> {
        let definition = self.find_definition(solution_id)?;
        let snapshot = self
            .build_capability_snapshot(db, definition.needs_browser_capability)
            .await?;

        Ok(self.to_detail(definition, snapshot))
    }

    pub async fn check_readiness(
        &self,
        db: &DbConnection,
        solution_id: &str,
    ) -> Result<ClawSolutionReadinessResult, String> {
        let definition = self.find_definition(solution_id)?;
        let snapshot = self
            .build_capability_snapshot(db, definition.needs_browser_capability)
            .await?;
        let readiness = self.resolve_readiness(definition, snapshot);

        Ok(ClawSolutionReadinessResult {
            solution_id: definition.id.to_string(),
            readiness: readiness.readiness,
            readiness_message: readiness.message,
            reason_code: readiness.reason_code,
        })
    }

    pub async fn prepare(
        &self,
        db: &DbConnection,
        solution_id: &str,
        context: Option<ClawSolutionContext>,
    ) -> Result<ClawSolutionPreparation, String> {
        let definition = self.find_definition(solution_id)?;
        let snapshot = self
            .build_capability_snapshot(db, definition.needs_browser_capability)
            .await?;
        let readiness = self.resolve_readiness(definition, snapshot);
        let context = context.unwrap_or_default();

        Ok(ClawSolutionPreparation {
            solution_id: definition.id.to_string(),
            action_type: definition.action_type,
            prompt: self.build_prompt(definition, &context),
            theme_target: definition.theme_target.map(str::to_string),
            should_launch_browser_assist: definition.needs_browser_capability,
            should_enable_team_mode: definition.should_enable_team_mode,
            readiness: readiness.readiness,
            readiness_message: readiness.message,
            reason_code: readiness.reason_code,
        })
    }

    async fn build_capability_snapshot(
        &self,
        db: &DbConnection,
        needs_browser_capability: bool,
    ) -> Result<CapabilitySnapshot, String> {
        let has_available_models =
            self.has_current_llm_configuration(db)? || self.has_compat_available_models(db)?;
        let browser_available = if needs_browser_capability {
            check_playwright_available().await?.available
        } else {
            true
        };

        Ok(CapabilitySnapshot {
            has_available_models,
            browser_available,
        })
    }

    fn has_current_llm_configuration(&self, db: &DbConnection) -> Result<bool, String> {
        let providers = ApiKeyProviderService::new().get_all_providers(db)?;

        Ok(providers
            .into_iter()
            .any(|item| item.provider.enabled && item.api_keys.iter().any(|key| key.enabled)))
    }

    fn has_compat_available_models(&self, db: &DbConnection) -> Result<bool, String> {
        Ok(!ModelService::new().get_all_available_models(db)?.is_empty())
    }

    fn find_definition(
        &self,
        solution_id: &str,
    ) -> Result<&'static ClawSolutionDefinition, String> {
        CLAW_SOLUTIONS
            .iter()
            .find(|definition| definition.id == solution_id)
            .ok_or_else(|| format!("未找到 Claw 方案: {solution_id}"))
    }

    fn to_summary(
        &self,
        definition: &ClawSolutionDefinition,
        snapshot: CapabilitySnapshot,
    ) -> ClawSolutionSummary {
        let readiness = self.resolve_readiness(definition, snapshot);
        ClawSolutionSummary {
            id: definition.id.to_string(),
            title: definition.title.to_string(),
            summary: definition.summary.to_string(),
            output_hint: definition.output_hint.to_string(),
            recommended_capabilities: definition
                .recommended_capabilities
                .iter()
                .map(|item| (*item).to_string())
                .collect(),
            readiness: readiness.readiness,
            readiness_message: readiness.message,
            reason_code: readiness.reason_code,
        }
    }

    fn to_detail(
        &self,
        definition: &ClawSolutionDefinition,
        snapshot: CapabilitySnapshot,
    ) -> ClawSolutionDetail {
        ClawSolutionDetail {
            summary: self.to_summary(definition, snapshot),
            starter_prompt: definition.starter_prompt.to_string(),
            theme_target: definition.theme_target.map(str::to_string),
            followup_mode: definition.followup_mode.map(str::to_string),
            capability_tags: definition
                .capability_tags
                .iter()
                .map(|item| (*item).to_string())
                .collect(),
        }
    }

    fn build_prompt(
        &self,
        definition: &ClawSolutionDefinition,
        context: &ClawSolutionContext,
    ) -> String {
        let user_input = context
            .user_input
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        match user_input {
            Some(value) => format!("{}\n\n补充上下文：{}", definition.starter_prompt, value),
            None => definition.starter_prompt.to_string(),
        }
    }

    fn resolve_readiness(
        &self,
        definition: &ClawSolutionDefinition,
        snapshot: CapabilitySnapshot,
    ) -> ResolvedReadiness {
        if !snapshot.has_available_models {
            return ResolvedReadiness::new(
                ClawSolutionReadiness::NeedsSetup,
                "先配置可用模型后再开始",
                Some(ClawSolutionReasonCode::MissingModel),
            );
        }

        if definition.needs_browser_capability && !snapshot.browser_available {
            return ResolvedReadiness::new(
                ClawSolutionReadiness::NeedsCapability,
                "先安装或连接可用浏览器能力",
                Some(ClawSolutionReasonCode::MissingBrowserCapability),
            );
        }

        if definition.should_enable_team_mode {
            return ResolvedReadiness::new(
                ClawSolutionReadiness::Ready,
                "可直接开始，进入后会启用多代理偏好",
                Some(ClawSolutionReasonCode::TeamRecommended),
            );
        }

        ResolvedReadiness::new(ClawSolutionReadiness::Ready, "可直接开始", None)
    }
}

#[derive(Debug, Clone)]
struct ResolvedReadiness {
    readiness: ClawSolutionReadiness,
    message: String,
    reason_code: Option<ClawSolutionReasonCode>,
}

impl ResolvedReadiness {
    fn new(
        readiness: ClawSolutionReadiness,
        message: impl Into<String>,
        reason_code: Option<ClawSolutionReasonCode>,
    ) -> Self {
        Self {
            readiness,
            message: message.into(),
            reason_code,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use lime_core::database::dao::api_key_provider::ApiProviderType;
    use lime_core::database::dao::provider_pool::ProviderPoolDao;
    use lime_core::models::provider_pool_model::{
        CredentialData, PoolProviderType, ProviderCredential,
    };
    use lime_services::api_key_provider_service::ApiKeyProviderService;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().expect("创建内存数据库失败");
        create_tables(&conn).expect("创建数据表失败");
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn list_should_mark_ready_when_api_key_provider_is_configured() {
        let db = setup_db();
        let api_key_service = ApiKeyProviderService::new();
        let provider = api_key_service
            .add_custom_provider(
                &db,
                "测试 Anthropic 兼容 Provider".to_string(),
                ApiProviderType::AnthropicCompatible,
                "https://example.com/v1".to_string(),
                None,
                None,
                None,
                None,
            )
            .expect("创建自定义 Provider 失败");

        api_key_service
            .update_provider(
                &db,
                &provider.id,
                None,
                None,
                None,
                Some(true),
                None,
                None,
                None,
                None,
                None,
                Some(vec!["glm-4.7".to_string()]),
            )
            .expect("更新 Provider 失败");

        api_key_service
            .add_api_key(&db, &provider.id, "sk-test", Some("主 Key".to_string()))
            .expect("添加 API Key 失败");

        let summaries = ClawSolutionService::default()
            .list(&db)
            .await
            .expect("获取 Claw 方案列表失败");

        assert!(
            summaries
                .iter()
                .all(|summary| summary.readiness == ClawSolutionReadiness::Ready),
            "当前 API Key Provider 已配置时，Claw 不应继续提示先配置模型"
        );
    }

    #[tokio::test]
    async fn list_should_keep_legacy_provider_pool_as_compat_fallback() {
        let db = setup_db();
        let mut credential = ProviderCredential::new(
            PoolProviderType::OpenAI,
            CredentialData::OpenAIKey {
                api_key: "sk-test".to_string(),
                base_url: None,
            },
        );
        credential.supported_models = vec!["gpt-4o".to_string()];

        {
            let conn = db.lock().expect("锁定数据库失败");
            ProviderPoolDao::insert(&conn, &credential).expect("插入旧 provider_pool 凭证失败");
        }

        let summaries = ClawSolutionService::default()
            .list(&db)
            .await
            .expect("获取 Claw 方案列表失败");

        assert!(
            summaries
                .iter()
                .all(|summary| summary.readiness == ClawSolutionReadiness::Ready),
            "compat 口径下的 provider_pool 可用模型仍应保持可启动"
        );
    }
}
