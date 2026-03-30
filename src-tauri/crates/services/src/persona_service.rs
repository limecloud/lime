//! 人设服务层
//!
//! 提供人设（Persona）的业务逻辑，包括：
//! - 创建、获取、列表、更新、删除人设
//! - 设置项目默认人设
//! - 获取人设模板列表
//!
//! ## 相关需求
//! - Requirements 6.1: 人设列表显示
//! - Requirements 6.2: 创建人设按钮
//! - Requirements 6.3: 人设创建表单
//! - Requirements 6.4: 设置默认人设
//! - Requirements 6.5: 人设模板
//! - Requirements 6.6: 人设删除确认

use rusqlite::Connection;

use lime_core::database::dao::persona_dao::PersonaDao;
use lime_core::errors::project_error::PersonaError;
use lime_core::models::project_model::{
    CreatePersonaRequest, Persona, PersonaTemplate, PersonaUpdate,
};

// ============================================================================
// 人设服务
// ============================================================================

/// 人设服务
///
/// 封装人设的业务逻辑，调用 PersonaDao 进行数据操作。
pub struct PersonaService;

impl PersonaService {
    // ------------------------------------------------------------------------
    // 创建人设
    // ------------------------------------------------------------------------

    /// 创建新人设
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `req`: 创建人设请求
    ///
    /// # 返回
    /// - 成功返回创建的人设
    /// - 失败返回 PersonaError
    ///
    /// # 示例
    /// ```ignore
    /// let req = CreatePersonaRequest {
    ///     project_id: "project-1".to_string(),
    ///     name: "专业写手".to_string(),
    ///     style: "专业".to_string(),
    ///     ..Default::default()
    /// };
    /// let persona = PersonaService::create_persona(&conn, req)?;
    /// ```
    pub fn create_persona(
        conn: &Connection,
        req: CreatePersonaRequest,
    ) -> Result<Persona, PersonaError> {
        // 验证项目存在
        Self::validate_project_exists(conn, &req.project_id)?;

        // 调用 DAO 创建人设
        PersonaDao::create(conn, &req)
    }

    // ------------------------------------------------------------------------
    // 获取人设列表
    // ------------------------------------------------------------------------

    /// 获取项目的人设列表
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `project_id`: 项目 ID
    ///
    /// # 返回
    /// - 成功返回人设列表
    /// - 失败返回 PersonaError
    pub fn list_personas(
        conn: &Connection,
        project_id: &str,
    ) -> Result<Vec<Persona>, PersonaError> {
        PersonaDao::list(conn, project_id)
    }

    // ------------------------------------------------------------------------
    // 获取单个人设
    // ------------------------------------------------------------------------

    /// 获取单个人设
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `id`: 人设 ID
    ///
    /// # 返回
    /// - 成功返回 Option<Persona>
    /// - 失败返回 PersonaError
    pub fn get_persona(conn: &Connection, id: &str) -> Result<Option<Persona>, PersonaError> {
        PersonaDao::get(conn, id)
    }

    // ------------------------------------------------------------------------
    // 更新人设
    // ------------------------------------------------------------------------

    /// 更新人设
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `id`: 人设 ID
    /// - `update`: 更新内容
    ///
    /// # 返回
    /// - 成功返回更新后的人设
    /// - 失败返回 PersonaError
    pub fn update_persona(
        conn: &Connection,
        id: &str,
        update: PersonaUpdate,
    ) -> Result<Persona, PersonaError> {
        PersonaDao::update(conn, id, &update)
    }

    // ------------------------------------------------------------------------
    // 删除人设
    // ------------------------------------------------------------------------

    /// 删除人设
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `id`: 人设 ID
    ///
    /// # 返回
    /// - 成功返回 ()
    /// - 失败返回 PersonaError
    pub fn delete_persona(conn: &Connection, id: &str) -> Result<(), PersonaError> {
        PersonaDao::delete(conn, id)
    }

    // ------------------------------------------------------------------------
    // 设置默认人设
    // ------------------------------------------------------------------------

    /// 设置项目的默认人设
    ///
    /// 将指定人设设为默认，同时取消该项目其他人设的默认状态。
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `project_id`: 项目 ID
    /// - `persona_id`: 要设为默认的人设 ID
    ///
    /// # 返回
    /// - 成功返回 ()
    /// - 失败返回 PersonaError
    pub fn set_default_persona(
        conn: &Connection,
        project_id: &str,
        persona_id: &str,
    ) -> Result<(), PersonaError> {
        PersonaDao::set_default(conn, project_id, persona_id)
    }

    // ------------------------------------------------------------------------
    // 获取默认人设
    // ------------------------------------------------------------------------

    /// 获取项目的默认人设
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `project_id`: 项目 ID
    ///
    /// # 返回
    /// - 成功返回 Option<Persona>
    /// - 失败返回 PersonaError
    pub fn get_default_persona(
        conn: &Connection,
        project_id: &str,
    ) -> Result<Option<Persona>, PersonaError> {
        PersonaDao::get_default(conn, project_id)
    }

    // ------------------------------------------------------------------------
    // 人设模板
    // ------------------------------------------------------------------------

    /// 获取人设模板列表
    ///
    /// 返回预定义的人设模板，用于快速创建人设。
    /// 模板包含常见的写作风格配置。
    ///
    /// # 返回
    /// - 人设模板列表
    pub fn list_persona_templates() -> Vec<PersonaTemplate> {
        vec![
            PersonaTemplate {
                id: "professional-writer".to_string(),
                name: "专业写手".to_string(),
                description: "适合撰写专业技术文章、行业分析报告".to_string(),
                style: "专业严谨".to_string(),
                tone: "正式".to_string(),
                target_audience: "专业人士、行业从业者".to_string(),
                platforms: vec!["zhihu".to_string(), "wechat".to_string()],
            },
            PersonaTemplate {
                id: "lifestyle-blogger".to_string(),
                name: "生活博主".to_string(),
                description: "适合分享生活日常、好物推荐、美食探店".to_string(),
                style: "轻松活泼".to_string(),
                tone: "亲切".to_string(),
                target_audience: "年轻女性、生活爱好者".to_string(),
                platforms: vec!["xiaohongshu".to_string(), "douyin".to_string()],
            },
            PersonaTemplate {
                id: "tech-enthusiast".to_string(),
                name: "科技达人".to_string(),
                description: "适合数码产品评测、科技资讯分享".to_string(),
                style: "客观理性".to_string(),
                tone: "专业但易懂".to_string(),
                target_audience: "科技爱好者、数码发烧友".to_string(),
                platforms: vec!["zhihu".to_string(), "weibo".to_string()],
            },
            PersonaTemplate {
                id: "emotional-writer".to_string(),
                name: "情感作者".to_string(),
                description: "适合情感故事、心灵鸡汤、人生感悟".to_string(),
                style: "温暖细腻".to_string(),
                tone: "感性".to_string(),
                target_audience: "追求情感共鸣的读者".to_string(),
                platforms: vec!["wechat".to_string(), "xiaohongshu".to_string()],
            },
            PersonaTemplate {
                id: "humor-creator".to_string(),
                name: "幽默段子手".to_string(),
                description: "适合搞笑内容、段子创作、娱乐吐槽".to_string(),
                style: "幽默诙谐".to_string(),
                tone: "轻松搞笑".to_string(),
                target_audience: "追求娱乐放松的用户".to_string(),
                platforms: vec!["weibo".to_string(), "douyin".to_string()],
            },
            PersonaTemplate {
                id: "knowledge-sharer".to_string(),
                name: "知识分享者".to_string(),
                description: "适合知识科普、学习方法、技能教程".to_string(),
                style: "清晰易懂".to_string(),
                tone: "耐心友好".to_string(),
                target_audience: "学习者、求知者".to_string(),
                platforms: vec![
                    "zhihu".to_string(),
                    "wechat".to_string(),
                    "douyin".to_string(),
                ],
            },
        ]
    }

    // ------------------------------------------------------------------------
    // 辅助方法
    // ------------------------------------------------------------------------

    /// 验证项目是否存在
    fn validate_project_exists(conn: &Connection, project_id: &str) -> Result<(), PersonaError> {
        let mut stmt = conn
            .prepare("SELECT 1 FROM workspaces WHERE id = ?")
            .map_err(PersonaError::DatabaseError)?;

        let exists = stmt
            .exists([project_id])
            .map_err(PersonaError::DatabaseError)?;

        if !exists {
            return Err(PersonaError::ProjectNotFound(project_id.to_string()));
        }

        Ok(())
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::schema::create_tables;

    /// 创建测试数据库连接
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    /// 创建测试项目
    fn create_test_project(conn: &Connection, id: &str) {
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO workspaces (id, name, workspace_type, root_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                id,
                "测试项目",
                "persistent",
                format!("/test/{}", id),
                now,
                now
            ],
        )
        .unwrap();
    }

    #[test]
    fn test_create_persona_success() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "测试人设".to_string(),
            description: Some("测试描述".to_string()),
            style: "专业".to_string(),
            tone: Some("正式".to_string()),
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };

        let persona = PersonaService::create_persona(&conn, req).unwrap();

        assert!(!persona.id.is_empty());
        assert_eq!(persona.project_id, "project-1");
        assert_eq!(persona.name, "测试人设");
        assert_eq!(persona.style, "专业");
    }

    #[test]
    fn test_create_persona_project_not_found() {
        let conn = setup_test_db();

        let req = CreatePersonaRequest {
            project_id: "nonexistent".to_string(),
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

        let result = PersonaService::create_persona(&conn, req);
        assert!(result.is_err());

        match result.unwrap_err() {
            PersonaError::ProjectNotFound(id) => assert_eq!(id, "nonexistent"),
            _ => panic!("期望 ProjectNotFound 错误"),
        }
    }

    #[test]
    fn test_list_personas() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        // 创建两个人设
        for i in 1..=2 {
            let req = CreatePersonaRequest {
                project_id: "project-1".to_string(),
                name: format!("人设{i}"),
                description: None,
                style: "测试".to_string(),
                tone: None,
                target_audience: None,
                forbidden_words: None,
                preferred_words: None,
                examples: None,
                platforms: None,
            };
            PersonaService::create_persona(&conn, req).unwrap();
        }

        let personas = PersonaService::list_personas(&conn, "project-1").unwrap();
        assert_eq!(personas.len(), 2);
    }

    #[test]
    fn test_get_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "测试人设".to_string(),
            description: None,
            style: "测试".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };

        let created = PersonaService::create_persona(&conn, req).unwrap();
        let fetched = PersonaService::get_persona(&conn, &created.id).unwrap();

        assert!(fetched.is_some());
        assert_eq!(fetched.unwrap().id, created.id);
    }

    #[test]
    fn test_update_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "原始名称".to_string(),
            description: None,
            style: "原始风格".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };

        let created = PersonaService::create_persona(&conn, req).unwrap();

        let update = PersonaUpdate {
            name: Some("更新后名称".to_string()),
            style: Some("更新后风格".to_string()),
            ..Default::default()
        };

        let updated = PersonaService::update_persona(&conn, &created.id, update).unwrap();

        assert_eq!(updated.name, "更新后名称");
        assert_eq!(updated.style, "更新后风格");
    }

    #[test]
    fn test_delete_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        let req = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "待删除人设".to_string(),
            description: None,
            style: "测试".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };

        let created = PersonaService::create_persona(&conn, req).unwrap();

        // 验证人设存在
        assert!(PersonaService::get_persona(&conn, &created.id)
            .unwrap()
            .is_some());

        // 删除人设
        PersonaService::delete_persona(&conn, &created.id).unwrap();

        // 验证人设已删除
        assert!(PersonaService::get_persona(&conn, &created.id)
            .unwrap()
            .is_none());
    }

    #[test]
    fn test_set_default_persona() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        // 创建两个人设
        let req1 = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "人设1".to_string(),
            description: None,
            style: "测试".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };
        let persona1 = PersonaService::create_persona(&conn, req1).unwrap();

        let req2 = CreatePersonaRequest {
            project_id: "project-1".to_string(),
            name: "人设2".to_string(),
            description: None,
            style: "测试".to_string(),
            tone: None,
            target_audience: None,
            forbidden_words: None,
            preferred_words: None,
            examples: None,
            platforms: None,
        };
        let persona2 = PersonaService::create_persona(&conn, req2).unwrap();

        // 设置人设1为默认
        PersonaService::set_default_persona(&conn, "project-1", &persona1.id).unwrap();

        let default = PersonaService::get_default_persona(&conn, "project-1").unwrap();
        assert!(default.is_some());
        assert_eq!(default.unwrap().id, persona1.id);

        // 设置人设2为默认，人设1应该不再是默认
        PersonaService::set_default_persona(&conn, "project-1", &persona2.id).unwrap();

        let default = PersonaService::get_default_persona(&conn, "project-1").unwrap();
        assert!(default.is_some());
        assert_eq!(default.unwrap().id, persona2.id);

        // 验证只有一个默认人设
        let personas = PersonaService::list_personas(&conn, "project-1").unwrap();
        let default_count = personas.iter().filter(|p| p.is_default).count();
        assert_eq!(default_count, 1);
    }

    #[test]
    fn test_list_persona_templates() {
        let templates = PersonaService::list_persona_templates();

        // 验证模板数量
        assert!(!templates.is_empty());
        assert!(templates.len() >= 6);

        // 验证模板内容
        let professional = templates.iter().find(|t| t.id == "professional-writer");
        assert!(professional.is_some());
        let professional = professional.unwrap();
        assert_eq!(professional.name, "专业写手");
        assert!(!professional.platforms.is_empty());

        // 验证所有模板都有必要字段
        for template in &templates {
            assert!(!template.id.is_empty());
            assert!(!template.name.is_empty());
            assert!(!template.description.is_empty());
            assert!(!template.style.is_empty());
            assert!(!template.tone.is_empty());
            assert!(!template.target_audience.is_empty());
        }
    }

    #[test]
    fn test_get_default_persona_none() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");

        // 没有设置默认人设时应返回 None
        let default = PersonaService::get_default_persona(&conn, "project-1").unwrap();
        assert!(default.is_none());
    }
}
