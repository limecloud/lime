//! 项目上下文构建器
//!
//! 提供项目上下文的构建功能，包括：
//! - 加载项目配置（人设、素材）
//! - 构建 AI System Prompt
//! - 条件性包含各个 section
//!
//! ## 相关需求
//! - Requirements 10.1: 加载项目上下文
//! - Requirements 10.2: 构建 system_prompt
//! - Requirements 10.3: 通过 SessionConfig 传递
//! - Requirements 10.4: 无人设时省略 persona section
//! - Requirements 10.5: 无素材时省略 materials section

use std::path::PathBuf;

use chrono::Utc;
use rusqlite::Connection;
use tracing::{debug, warn};

use crate::material_service::MaterialService;
use crate::persona_service::PersonaService;
use lime_core::errors::project_error::ProjectError;
use lime_core::models::project_model::{Material, Persona, ProjectContext};
use lime_core::workspace::{Workspace, WorkspaceSettings, WorkspaceType};

// ============================================================================
// 项目上下文构建器
// ============================================================================

/// 项目上下文构建器
///
/// 负责加载项目的完整上下文（人设、素材），
/// 并将其转换为 AI 可理解的 System Prompt。
pub struct ProjectContextBuilder;

impl ProjectContextBuilder {
    // ------------------------------------------------------------------------
    // 构建项目上下文
    // ------------------------------------------------------------------------

    /// 构建完整的项目上下文
    ///
    /// 加载项目的所有配置信息，包括：
    /// - 项目基本信息
    /// - 默认人设（如果有）
    /// - 素材列表
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `project_id`: 项目 ID
    ///
    /// # 返回
    /// - 成功返回 ProjectContext
    /// - 失败返回 ProjectError
    ///
    /// # 示例
    /// ```ignore
    /// let context = ProjectContextBuilder::build_context(&conn, "project-1")?;
    /// let prompt = ProjectContextBuilder::build_system_prompt(&context);
    /// ```
    pub fn build_context(
        conn: &Connection,
        project_id: &str,
    ) -> Result<ProjectContext, ProjectError> {
        debug!(project_id = %project_id, "开始构建项目上下文");

        // 1. 加载项目基本信息
        let project = Self::load_project(conn, project_id)?;

        // 2. 加载默认人设（可选）
        let persona = Self::load_default_persona(conn, project_id);

        // 3. 加载素材列表
        let materials = Self::load_materials(conn, project_id);

        debug!(
            project_id = %project_id,
            has_persona = persona.is_some(),
            material_count = materials.len(),
            "项目上下文构建完成"
        );

        Ok(ProjectContext {
            project,
            persona,
            materials,
        })
    }

    // ------------------------------------------------------------------------
    // 构建 System Prompt
    // ------------------------------------------------------------------------

    /// 将项目上下文转换为 System Prompt
    ///
    /// 根据项目配置构建结构化的 AI 提示词，包含：
    /// - 人设信息（如果有）
    /// - 素材引用（如果有）
    ///
    /// # 参数
    /// - `context`: 项目上下文
    ///
    /// # 返回
    /// - 构建好的 System Prompt 字符串
    ///
    /// # 注意
    /// 各 section 根据数据是否存在条件性包含，
    /// 避免生成空的或无意义的提示词部分。
    pub fn build_system_prompt(context: &ProjectContext) -> String {
        let mut sections: Vec<String> = Vec::new();

        // 添加项目基本信息
        sections.push(Self::format_project_header(&context.project));

        // 条件性添加人设 section
        if let Some(ref persona) = context.persona {
            sections.push(Self::format_persona(persona));
        }

        // 条件性添加素材 section
        if !context.materials.is_empty() {
            sections.push(Self::format_materials(&context.materials));
        }

        sections.join("\n\n")
    }

    /// 基于已持有的数据库连接直接构建项目 System Prompt
    ///
    /// 适用于调用方已经拿到 `rusqlite::Connection` 的场景，
    /// 可以避免再次通过高层 `DbConnection` 包装重复获取数据库锁。
    pub fn build_system_prompt_for_project(
        conn: &Connection,
        project_id: &str,
    ) -> Result<String, ProjectError> {
        let context = Self::build_context(conn, project_id)?;
        Ok(Self::build_system_prompt(&context))
    }

    // ------------------------------------------------------------------------
    // 辅助方法 - 数据加载
    // ------------------------------------------------------------------------

    /// 加载项目基本信息
    fn load_project(conn: &Connection, project_id: &str) -> Result<Workspace, ProjectError> {
        let result = conn.query_row(
            "SELECT id, name, workspace_type, root_path, is_default, settings_json, 
                    created_at, updated_at, icon, color, is_favorite, is_archived, tags_json
             FROM workspaces WHERE id = ?",
            rusqlite::params![project_id],
            Self::row_to_workspace,
        );

        match result {
            Ok(workspace) => Ok(workspace),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(ProjectError::NotFound(project_id.to_string()))
            }
            Err(e) => Err(ProjectError::DatabaseError(e)),
        }
    }

    /// 从数据库行解析 Workspace
    fn row_to_workspace(row: &rusqlite::Row) -> Result<Workspace, rusqlite::Error> {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let workspace_type_str: String = row.get(2)?;
        let root_path_str: String = row.get(3)?;
        let is_default: bool = row.get(4)?;
        let settings_json: String = row.get(5)?;
        let created_at_ms: i64 = row.get(6)?;
        let updated_at_ms: i64 = row.get(7)?;
        let icon: Option<String> = row.get(8)?;
        let color: Option<String> = row.get(9)?;
        let is_favorite: bool = row.get::<_, Option<bool>>(10)?.unwrap_or(false);
        let is_archived: bool = row.get::<_, Option<bool>>(11)?.unwrap_or(false);
        let tags_json: Option<String> = row.get(12)?;

        let settings: WorkspaceSettings = serde_json::from_str(&settings_json).unwrap_or_default();
        let tags: Vec<String> = tags_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Ok(Workspace {
            id,
            name,
            workspace_type: WorkspaceType::parse(&workspace_type_str),
            root_path: PathBuf::from(root_path_str),
            is_default,
            created_at: chrono::DateTime::from_timestamp_millis(created_at_ms)
                .unwrap_or_else(Utc::now),
            updated_at: chrono::DateTime::from_timestamp_millis(updated_at_ms)
                .unwrap_or_else(Utc::now),
            settings,
            icon,
            color,
            is_favorite,
            is_archived,
            tags,
            stats: None,
        })
    }

    /// 加载默认人设
    fn load_default_persona(conn: &Connection, project_id: &str) -> Option<Persona> {
        match PersonaService::get_default_persona(conn, project_id) {
            Ok(persona) => persona,
            Err(e) => {
                warn!(
                    project_id = %project_id,
                    error = %e,
                    "加载默认人设失败"
                );
                None
            }
        }
    }

    /// 加载素材列表
    fn load_materials(conn: &Connection, project_id: &str) -> Vec<Material> {
        match MaterialService::list_materials(conn, project_id, None) {
            Ok(materials) => materials,
            Err(e) => {
                warn!(
                    project_id = %project_id,
                    error = %e,
                    "加载素材列表失败"
                );
                Vec::new()
            }
        }
    }

    // ------------------------------------------------------------------------
    // 辅助方法 - 格式化
    // ------------------------------------------------------------------------

    /// 格式化项目头部信息
    fn format_project_header(project: &Workspace) -> String {
        format!(
            "# 项目: {}\n\n你正在为「{}」项目创作内容。",
            project.name, project.name
        )
    }

    /// 格式化人设信息
    ///
    /// 将人设配置转换为 AI 可理解的提示词格式。
    fn format_persona(persona: &Persona) -> String {
        let mut lines = vec![
            "## 你的身份".to_string(),
            String::new(),
            format!("你是「{}」。", persona.name),
        ];

        // 添加描述
        if let Some(ref desc) = persona.description {
            lines.push(format!("描述: {desc}"));
        }

        // 添加写作风格
        lines.push(format!("写作风格: {}", persona.style));

        // 添加语气
        if let Some(ref tone) = persona.tone {
            lines.push(format!("语气: {tone}"));
        }

        // 添加目标读者
        if let Some(ref audience) = persona.target_audience {
            lines.push(format!("目标读者: {audience}"));
        }

        // 添加禁用词
        if !persona.forbidden_words.is_empty() {
            lines.push(format!(
                "禁止使用的词汇: {}",
                persona.forbidden_words.join("、")
            ));
        }

        // 添加偏好词
        if !persona.preferred_words.is_empty() {
            lines.push(format!(
                "推荐使用的词汇: {}",
                persona.preferred_words.join("、")
            ));
        }

        // 添加示例
        if let Some(ref examples) = persona.examples {
            lines.push(String::new());
            lines.push("### 写作示例".to_string());
            lines.push(examples.clone());
        }

        lines.join("\n")
    }

    /// 格式化素材摘要
    ///
    /// 将素材列表转换为 AI 可引用的格式。
    /// 对于文本类素材，包含内容摘要；
    /// 对于其他类型，包含描述信息。
    fn format_materials(materials: &[Material]) -> String {
        let mut lines = vec![
            "## 可引用素材".to_string(),
            String::new(),
            "以下是项目中的参考素材，你可以在创作时引用：".to_string(),
            String::new(),
        ];

        for (i, material) in materials.iter().enumerate() {
            lines.push(format!("### {}. {}", i + 1, material.name));

            // 添加类型
            lines.push(format!(
                "类型: {}",
                Self::format_material_type(&material.material_type)
            ));

            // 添加描述
            if let Some(ref desc) = material.description {
                lines.push(format!("描述: {desc}"));
            }

            // 添加标签
            if !material.tags.is_empty() {
                lines.push(format!("标签: {}", material.tags.join("、")));
            }

            // 添加内容摘要（仅文本类型）
            if let Some(ref content) = material.content {
                let summary = Self::truncate_content(content, 500);
                lines.push(format!("内容:\n{summary}"));
            }

            lines.push(String::new());
        }

        lines.join("\n")
    }

    /// 格式化素材类型显示名称
    fn format_material_type(material_type: &str) -> &'static str {
        match material_type {
            "document" => "文档",
            "image" => "图片",
            "audio" => "语音",
            "video" => "视频",
            "text" => "文本",
            "data" => "数据",
            "link" => "链接",
            _ => "其他",
        }
    }

    /// 截断内容到指定长度
    fn truncate_content(content: &str, max_len: usize) -> String {
        if content.chars().count() <= max_len {
            content.to_string()
        } else {
            let truncated: String = content.chars().take(max_len).collect();
            format!("{truncated}...")
        }
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::schema::create_tables;
    use lime_core::models::project_model::CreatePersonaRequest;

    /// 创建测试数据库连接
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    /// 创建测试项目
    fn create_test_project(conn: &Connection, id: &str, name: &str) {
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![id, name, "persistent", format!("/test/{}", id), now, now],
        )
        .unwrap();
    }

    #[test]
    fn test_build_context_project_not_found() {
        let conn = setup_test_db();
        let result = ProjectContextBuilder::build_context(&conn, "nonexistent");
        assert!(result.is_err());

        match result.unwrap_err() {
            ProjectError::NotFound(id) => assert_eq!(id, "nonexistent"),
            _ => panic!("期望 NotFound 错误"),
        }
    }

    #[test]
    fn test_build_context_empty_project() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();

        assert_eq!(context.project.name, "测试项目");
        assert!(context.persona.is_none());
        assert!(context.materials.is_empty());
    }

    #[test]
    fn test_build_context_with_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        // 创建人设并设为默认
        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "专业写手".to_string(),
            description: Some("专业技术文章写手".to_string()),
            style: "专业严谨".to_string(),
            tone: Some("正式".to_string()),
            target_audience: Some("技术人员".to_string()),
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };
        let persona = PersonaService::create_persona(&conn, req).unwrap();
        PersonaService::set_default_persona(&conn, "project-1", &persona.id).unwrap();

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();

        assert!(context.persona.is_some());
        let p = context.persona.unwrap();
        assert_eq!(p.name, "专业写手");
        assert_eq!(p.style, "专业严谨");
    }

    #[test]
    fn test_build_system_prompt_empty() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();
        let prompt = ProjectContextBuilder::build_system_prompt(&context);

        // 应该只包含项目头部
        assert!(prompt.contains("# 项目: 测试项目"));
        assert!(!prompt.contains("## 你的身份"));
        assert!(!prompt.contains("## 可引用素材"));
        assert!(!prompt.contains("## 排版规则"));
    }

    #[test]
    fn test_build_system_prompt_for_project_matches_composed_builders() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();
        let expected = ProjectContextBuilder::build_system_prompt(&context);
        let prompt =
            ProjectContextBuilder::build_system_prompt_for_project(&conn, "project-1").unwrap();

        assert_eq!(prompt, expected);
    }

    #[test]
    fn test_build_system_prompt_with_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        // 创建人设
        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "生活博主".to_string(),
            description: Some("分享生活日常".to_string()),
            style: "轻松活泼".to_string(),
            tone: Some("亲切".to_string()),
            target_audience: Some("年轻女性".to_string()),
            forbidden_words: Some(vec!["禁词1".to_string(), "禁词2".to_string()]),
            preferred_words: Some(vec!["推荐词".to_string()]),
            examples: Some("这是一个示例文本".to_string()),
            platforms: None,
        };
        let persona = PersonaService::create_persona(&conn, req).unwrap();
        PersonaService::set_default_persona(&conn, "project-1", &persona.id).unwrap();

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();
        let prompt = ProjectContextBuilder::build_system_prompt(&context);

        // 验证人设 section
        assert!(prompt.contains("## 你的身份"));
        assert!(prompt.contains("你是「生活博主」"));
        assert!(prompt.contains("写作风格: 轻松活泼"));
        assert!(prompt.contains("语气: 亲切"));
        assert!(prompt.contains("目标读者: 年轻女性"));
        assert!(prompt.contains("禁止使用的词汇: 禁词1、禁词2"));
        assert!(prompt.contains("推荐使用的词汇: 推荐词"));
        assert!(prompt.contains("### 写作示例"));
    }

    #[test]
    fn test_build_system_prompt_with_materials() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "测试项目");

        // 创建素材
        use lime_core::models::project_model::UploadMaterialRequest;
        let req = UploadMaterialRequest {
            project_id: "project-1".to_string(),
            name: "参考文档".to_string(),
            material_type: "text".to_string(),
            file_path: None,
            content: Some("这是参考文档的内容".to_string()),
            tags: Some(vec!["参考".to_string(), "重要".to_string()]),
            description: Some("重要的参考资料".to_string()),
        };
        MaterialService::upload_material(&conn, req).unwrap();

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();
        let prompt = ProjectContextBuilder::build_system_prompt(&context);

        // 验证素材 section
        assert!(prompt.contains("## 可引用素材"));
        assert!(prompt.contains("### 1. 参考文档"));
        assert!(prompt.contains("类型: 文本"));
        assert!(prompt.contains("描述: 重要的参考资料"));
        assert!(prompt.contains("标签: 参考、重要"));
        assert!(prompt.contains("这是参考文档的内容"));
    }

    #[test]
    fn test_build_system_prompt_full_context() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1", "完整项目");

        // 创建人设
        let persona_req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "测试人设".to_string(),
            description: None,
            style: "专业".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };
        let persona = PersonaService::create_persona(&conn, persona_req).unwrap();
        PersonaService::set_default_persona(&conn, "project-1", &persona.id).unwrap();

        // 创建素材
        use lime_core::models::project_model::UploadMaterialRequest;
        let material_req = UploadMaterialRequest {
            project_id: "project-1".to_string(),
            name: "素材1".to_string(),
            material_type: "text".to_string(),
            file_path: None,
            content: Some("素材内容".to_string()),
            tags: None,
            description: None,
        };
        MaterialService::upload_material(&conn, material_req).unwrap();

        let context = ProjectContextBuilder::build_context(&conn, "project-1").unwrap();
        let prompt = ProjectContextBuilder::build_system_prompt(&context);

        // 验证所有 section 都存在
        assert!(prompt.contains("# 项目: 完整项目"));
        assert!(prompt.contains("## 你的身份"));
        assert!(prompt.contains("## 可引用素材"));
    }

    #[test]
    fn test_truncate_content() {
        // 短内容不截断
        let short = "短内容";
        assert_eq!(
            ProjectContextBuilder::truncate_content(short, 100),
            "短内容"
        );

        // 长内容截断
        let long = "这是一段很长的内容，需要被截断处理";
        let truncated = ProjectContextBuilder::truncate_content(long, 10);
        assert!(truncated.ends_with("..."));
        assert!(truncated.chars().count() <= 13); // 10 + "..."
    }

    #[test]
    fn test_format_material_type() {
        assert_eq!(
            ProjectContextBuilder::format_material_type("document"),
            "文档"
        );
        assert_eq!(ProjectContextBuilder::format_material_type("image"), "图片");
        assert_eq!(ProjectContextBuilder::format_material_type("audio"), "语音");
        assert_eq!(ProjectContextBuilder::format_material_type("video"), "视频");
        assert_eq!(ProjectContextBuilder::format_material_type("text"), "文本");
        assert_eq!(ProjectContextBuilder::format_material_type("data"), "数据");
        assert_eq!(ProjectContextBuilder::format_material_type("link"), "链接");
        assert_eq!(
            ProjectContextBuilder::format_material_type("unknown"),
            "其他"
        );
    }
}
