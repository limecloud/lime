//! 图库素材元数据数据访问层
//!
//! 提供图库素材元数据（GalleryMaterialMetadata）的 CRUD 操作，包括：
//! - 创建、获取、更新、删除图库素材元数据
//! - 按分类筛选素材

use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::errors::project_error::MaterialError;
use crate::models::project_model::{
    CreateGalleryMaterialMetadataRequest, GalleryMaterial, GalleryMaterialMetadata,
};

use super::material_dao::MaterialDao;

// ============================================================================
// 数据访问对象
// ============================================================================

/// 图库素材元数据 DAO
///
/// 提供图库素材元数据的数据库操作方法。
pub struct GalleryMaterialDao;

impl GalleryMaterialDao {
    // ------------------------------------------------------------------------
    // 创建元数据
    // ------------------------------------------------------------------------

    /// 创建图库素材元数据
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `req`: 创建请求
    ///
    /// # 返回
    /// - 成功返回创建的元数据
    /// - 失败返回 MaterialError
    pub fn create(
        conn: &Connection,
        req: &CreateGalleryMaterialMetadataRequest,
    ) -> Result<GalleryMaterialMetadata, MaterialError> {
        // 验证素材存在
        MaterialDao::get(conn, &req.material_id)?
            .ok_or_else(|| MaterialError::NotFound(req.material_id.clone()))?;

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();

        // 序列化 colors
        let colors_json = serde_json::to_string(&req.colors.clone().unwrap_or_default())
            .unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO gallery_material_metadata (
                id, material_id, image_category, width, height, thumbnail,
                colors_json, icon_style, icon_category, color_scheme_json,
                mood, layout_category, element_count, preview, fabric_json,
                created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                id,
                req.material_id,
                req.image_category,
                req.width,
                req.height,
                req.thumbnail,
                colors_json,
                req.icon_style,
                req.icon_category,
                req.color_scheme_json,
                req.mood,
                req.layout_category,
                req.element_count,
                req.preview,
                req.fabric_json,
                now,
                now,
            ],
        )?;

        Ok(GalleryMaterialMetadata {
            material_id: req.material_id.clone(),
            image_category: req.image_category.clone(),
            width: req.width,
            height: req.height,
            thumbnail: req.thumbnail.clone(),
            colors: req.colors.clone().unwrap_or_default(),
            icon_style: req.icon_style.clone(),
            icon_category: req.icon_category.clone(),
            color_scheme_json: req.color_scheme_json.clone(),
            mood: req.mood.clone(),
            layout_category: req.layout_category.clone(),
            element_count: req.element_count,
            preview: req.preview.clone(),
            fabric_json: req.fabric_json.clone(),
            created_at: now,
            updated_at: now,
        })
    }

    // ------------------------------------------------------------------------
    // 获取元数据
    // ------------------------------------------------------------------------

    /// 获取图库素材元数据
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `material_id`: 素材 ID
    ///
    /// # 返回
    /// - 成功返回 Option<GalleryMaterialMetadata>
    /// - 失败返回 MaterialError
    pub fn get(
        conn: &Connection,
        material_id: &str,
    ) -> Result<Option<GalleryMaterialMetadata>, MaterialError> {
        let mut stmt = conn.prepare(
            "SELECT material_id, image_category, width, height, thumbnail,
                    colors_json, icon_style, icon_category, color_scheme_json,
                    mood, layout_category, element_count, preview, fabric_json,
                    created_at, updated_at
             FROM gallery_material_metadata WHERE material_id = ?",
        )?;

        let mut rows = stmt.query([material_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(Self::map_row(row)?))
        } else {
            Ok(None)
        }
    }

    /// 获取完整的图库素材（基础素材 + 元数据）
    ///
    /// # 参数
    /// - `conn`: 数据库连接
    /// - `material_id`: 素材 ID
    ///
    /// # 返回
    /// - 成功返回 Option<GalleryMaterial>
    /// - 失败返回 MaterialError
    pub fn get_gallery_material(
        conn: &Connection,
        material_id: &str,
    ) -> Result<Option<GalleryMaterial>, MaterialError> {
        // 获取基础素材
        let base = match MaterialDao::get(conn, material_id)? {
            Some(m) => m,
            None => return Ok(None),
        };

        // 获取元数据
        let metadata = Self::get(conn, material_id)?;

        Ok(Some(GalleryMaterial { base, metadata }))
    }

    // ------------------------------------------------------------------------
    // 列表查询
    // ------------------------------------------------------------------------

    /// 按图片分类获取素材列表
    pub fn list_gallery_materials_by_image_category(
        conn: &Connection,
        project_id: &str,
        category: Option<&str>,
    ) -> Result<Vec<GalleryMaterial>, MaterialError> {
        let sql = if category.is_some() {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'image' AND pm.image_category = ?2
             ORDER BY m.created_at DESC"
        } else {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'image'
             ORDER BY m.created_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;

        let results: Vec<GalleryMaterial> = if let Some(cat) = category {
            stmt.query_map(params![project_id, cat], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([project_id], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(results)
    }

    /// 按布局分类获取素材列表
    pub fn list_gallery_materials_by_layout_category(
        conn: &Connection,
        project_id: &str,
        category: Option<&str>,
    ) -> Result<Vec<GalleryMaterial>, MaterialError> {
        let sql = if category.is_some() {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'layout' AND pm.layout_category = ?2
             ORDER BY m.created_at DESC"
        } else {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'layout'
             ORDER BY m.created_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;

        let results: Vec<GalleryMaterial> = if let Some(cat) = category {
            stmt.query_map(params![project_id, cat], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([project_id], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(results)
    }

    /// 按配色氛围获取素材列表
    pub fn list_gallery_materials_by_mood(
        conn: &Connection,
        project_id: &str,
        mood: Option<&str>,
    ) -> Result<Vec<GalleryMaterial>, MaterialError> {
        let sql = if mood.is_some() {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'color' AND pm.mood = ?2
             ORDER BY m.created_at DESC"
        } else {
            "SELECT m.id, m.project_id, m.name, m.material_type, m.file_path,
                    m.file_size, m.mime_type, m.content, m.tags_json, m.description, m.created_at,
                    pm.material_id, pm.image_category, pm.width, pm.height, pm.thumbnail,
                    pm.colors_json, pm.icon_style, pm.icon_category, pm.color_scheme_json,
                    pm.mood, pm.layout_category, pm.element_count, pm.preview, pm.fabric_json,
                    pm.created_at as pm_created_at, pm.updated_at as pm_updated_at
             FROM materials m
             LEFT JOIN gallery_material_metadata pm ON m.id = pm.material_id
             WHERE m.project_id = ?1 AND m.material_type = 'color'
             ORDER BY m.created_at DESC"
        };

        let mut stmt = conn.prepare(sql)?;

        let results: Vec<GalleryMaterial> = if let Some(m) = mood {
            stmt.query_map(params![project_id, m], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([project_id], Self::map_joined_row)?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(results)
    }

    // ------------------------------------------------------------------------
    // 更新元数据
    // ------------------------------------------------------------------------

    /// 更新图库素材元数据
    ///
    /// 如果元数据不存在，则创建新的元数据。
    pub fn update(
        conn: &Connection,
        material_id: &str,
        req: &CreateGalleryMaterialMetadataRequest,
    ) -> Result<GalleryMaterialMetadata, MaterialError> {
        // 检查元数据是否存在
        let existing = Self::get(conn, material_id)?;

        if existing.is_none() {
            // 创建新元数据
            return Self::create(conn, req);
        }

        let existing = existing.unwrap();
        let now = chrono::Utc::now().timestamp();

        // 构建更新后的值
        let image_category = req.image_category.clone().or(existing.image_category);
        let width = req.width.or(existing.width);
        let height = req.height.or(existing.height);
        let thumbnail = req.thumbnail.clone().or(existing.thumbnail);
        let colors = req.colors.clone().unwrap_or(existing.colors);
        let icon_style = req.icon_style.clone().or(existing.icon_style);
        let icon_category = req.icon_category.clone().or(existing.icon_category);
        let color_scheme_json = req.color_scheme_json.clone().or(existing.color_scheme_json);
        let mood = req.mood.clone().or(existing.mood);
        let layout_category = req.layout_category.clone().or(existing.layout_category);
        let element_count = req.element_count.or(existing.element_count);
        let preview = req.preview.clone().or(existing.preview);
        let fabric_json = req.fabric_json.clone().or(existing.fabric_json);

        let colors_json = serde_json::to_string(&colors).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "UPDATE gallery_material_metadata SET
                image_category = ?1, width = ?2, height = ?3, thumbnail = ?4,
                colors_json = ?5, icon_style = ?6, icon_category = ?7,
                color_scheme_json = ?8, mood = ?9, layout_category = ?10,
                element_count = ?11, preview = ?12, fabric_json = ?13, updated_at = ?14
             WHERE material_id = ?15",
            params![
                image_category,
                width,
                height,
                thumbnail,
                colors_json,
                icon_style,
                icon_category,
                color_scheme_json,
                mood,
                layout_category,
                element_count,
                preview,
                fabric_json,
                now,
                material_id,
            ],
        )?;

        Ok(GalleryMaterialMetadata {
            material_id: material_id.to_string(),
            image_category,
            width,
            height,
            thumbnail,
            colors,
            icon_style,
            icon_category,
            color_scheme_json,
            mood,
            layout_category,
            element_count,
            preview,
            fabric_json,
            created_at: existing.created_at,
            updated_at: now,
        })
    }

    // ------------------------------------------------------------------------
    // 删除元数据
    // ------------------------------------------------------------------------

    /// 删除图库素材元数据
    pub fn delete(conn: &Connection, material_id: &str) -> Result<(), MaterialError> {
        conn.execute(
            "DELETE FROM gallery_material_metadata WHERE material_id = ?",
            [material_id],
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------------
    // 辅助方法
    // ------------------------------------------------------------------------

    /// 映射数据库行到 GalleryMaterialMetadata 结构体
    fn map_row(row: &rusqlite::Row) -> Result<GalleryMaterialMetadata, rusqlite::Error> {
        let colors_json: String = row.get(5)?;
        let colors: Vec<String> = serde_json::from_str(&colors_json).unwrap_or_default();

        Ok(GalleryMaterialMetadata {
            material_id: row.get(0)?,
            image_category: row.get(1)?,
            width: row.get(2)?,
            height: row.get(3)?,
            thumbnail: row.get(4)?,
            colors,
            icon_style: row.get(6)?,
            icon_category: row.get(7)?,
            color_scheme_json: row.get(8)?,
            mood: row.get(9)?,
            layout_category: row.get(10)?,
            element_count: row.get(11)?,
            preview: row.get(12)?,
            fabric_json: row.get(13)?,
            created_at: row.get(14)?,
            updated_at: row.get(15)?,
        })
    }

    /// 映射联合查询的数据库行到 GalleryMaterial 结构体
    fn map_joined_row(row: &rusqlite::Row) -> Result<GalleryMaterial, rusqlite::Error> {
        use crate::models::project_model::Material;

        // 解析基础素材
        let tags_json: String = row.get(8)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

        let base = Material {
            id: row.get(0)?,
            project_id: row.get(1)?,
            name: row.get(2)?,
            material_type: row.get(3)?,
            file_path: row.get(4)?,
            file_size: row.get(5)?,
            mime_type: row.get(6)?,
            content: row.get(7)?,
            tags,
            description: row.get(9)?,
            created_at: row.get(10)?,
        };

        // 解析元数据（可能为空）
        let metadata_material_id: Option<String> = row.get(11)?;
        let metadata = if let Some(material_id) = metadata_material_id {
            let colors_json: String = row.get(16)?;
            let colors: Vec<String> = serde_json::from_str(&colors_json).unwrap_or_default();

            Some(GalleryMaterialMetadata {
                material_id,
                image_category: row.get(12)?,
                width: row.get(13)?,
                height: row.get(14)?,
                thumbnail: row.get(15)?,
                colors,
                icon_style: row.get(17)?,
                icon_category: row.get(18)?,
                color_scheme_json: row.get(19)?,
                mood: row.get(20)?,
                layout_category: row.get(21)?,
                element_count: row.get(22)?,
                preview: row.get(23)?,
                fabric_json: row.get(24)?,
                created_at: row.get(25)?,
                updated_at: row.get(26)?,
            })
        } else {
            None
        };

        Ok(GalleryMaterial { base, metadata })
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::schema::create_tables;
    use crate::models::project_model::UploadMaterialRequest;

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
            params![
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

    /// 创建测试素材
    fn create_test_material(
        conn: &Connection,
        project_id: &str,
        material_type: &str,
    ) -> crate::models::project_model::Material {
        let req = UploadMaterialRequest {
            project_id: project_id.to_string(),
            name: "测试素材".to_string(),
            material_type: material_type.to_string(),
            file_path: None,
            content: Some("test content".to_string()),
            tags: None,
            description: None,
        };
        MaterialDao::create(conn, &req).unwrap()
    }

    #[test]
    fn test_create_gallery_material_metadata() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");
        let material = create_test_material(&conn, "project-1", "image");

        let req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("background".to_string()),
            width: Some(1920),
            height: Some(1080),
            thumbnail: Some("thumb.jpg".to_string()),
            colors: Some(vec!["#FF0000".to_string(), "#00FF00".to_string()]),
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };

        let metadata = GalleryMaterialDao::create(&conn, &req).unwrap();

        assert_eq!(metadata.material_id, material.id);
        assert_eq!(metadata.image_category, Some("background".to_string()));
        assert_eq!(metadata.width, Some(1920));
        assert_eq!(metadata.height, Some(1080));
        assert_eq!(metadata.colors.len(), 2);
    }

    #[test]
    fn test_get_gallery_material_metadata() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");
        let material = create_test_material(&conn, "project-1", "image");

        let req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("product".to_string()),
            width: Some(800),
            height: Some(600),
            thumbnail: None,
            colors: None,
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };

        GalleryMaterialDao::create(&conn, &req).unwrap();

        let metadata = GalleryMaterialDao::get(&conn, &material.id).unwrap();
        assert!(metadata.is_some());
        let metadata = metadata.unwrap();
        assert_eq!(metadata.image_category, Some("product".to_string()));
    }

    #[test]
    fn test_get_gallery_material() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");
        let material = create_test_material(&conn, "project-1", "image");

        let req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("decoration".to_string()),
            width: Some(500),
            height: Some(500),
            thumbnail: None,
            colors: Some(vec!["#0000FF".to_string()]),
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };

        GalleryMaterialDao::create(&conn, &req).unwrap();

        let gallery_material =
            GalleryMaterialDao::get_gallery_material(&conn, &material.id).unwrap();
        assert!(gallery_material.is_some());
        let gallery_material = gallery_material.unwrap();

        assert_eq!(gallery_material.base.id, material.id);
        assert!(gallery_material.metadata.is_some());
        assert_eq!(
            gallery_material.metadata.unwrap().image_category,
            Some("decoration".to_string())
        );
    }

    #[test]
    fn test_update_gallery_material_metadata() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");
        let material = create_test_material(&conn, "project-1", "image");

        // 创建初始元数据
        let req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("background".to_string()),
            width: Some(1920),
            height: Some(1080),
            thumbnail: None,
            colors: None,
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };
        GalleryMaterialDao::create(&conn, &req).unwrap();

        // 更新元数据
        let update_req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("product".to_string()),
            width: None,
            height: None,
            thumbnail: Some("new_thumb.jpg".to_string()),
            colors: Some(vec!["#FFFFFF".to_string()]),
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };

        let updated = GalleryMaterialDao::update(&conn, &material.id, &update_req).unwrap();

        assert_eq!(updated.image_category, Some("product".to_string()));
        assert_eq!(updated.width, Some(1920)); // 保留原值
        assert_eq!(updated.thumbnail, Some("new_thumb.jpg".to_string()));
        assert_eq!(updated.colors, vec!["#FFFFFF".to_string()]);
    }

    #[test]
    fn test_delete_gallery_material_metadata() {
        let conn = setup_test_db();
        create_test_project(&conn, "project-1");
        let material = create_test_material(&conn, "project-1", "image");

        let req = CreateGalleryMaterialMetadataRequest {
            material_id: material.id.clone(),
            image_category: Some("texture".to_string()),
            width: None,
            height: None,
            thumbnail: None,
            colors: None,
            icon_style: None,
            icon_category: None,
            color_scheme_json: None,
            mood: None,
            layout_category: None,
            element_count: None,
            preview: None,
            fabric_json: None,
        };
        GalleryMaterialDao::create(&conn, &req).unwrap();

        // 验证存在
        assert!(GalleryMaterialDao::get(&conn, &material.id)
            .unwrap()
            .is_some());

        // 删除
        GalleryMaterialDao::delete(&conn, &material.id).unwrap();

        // 验证已删除
        assert!(GalleryMaterialDao::get(&conn, &material.id)
            .unwrap()
            .is_none());
    }
}
