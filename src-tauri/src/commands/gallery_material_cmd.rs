//! 图库素材相关的 Tauri 命令
//!
//! 提供图库素材元数据（GalleryMaterialMetadata）管理的前端 API，包括：
//! - 创建、获取、更新、删除图库素材元数据
//! - 按分类筛选素材

use tauri::State;

use crate::database::dao::gallery_material_dao::GalleryMaterialDao;
use crate::database::DbConnection;
use crate::models::project_model::{
    CreateGalleryMaterialMetadataRequest, GalleryMaterial, GalleryMaterialMetadata,
};

// ============================================================================
// Tauri 命令
// ============================================================================

/// 创建图库素材元数据
///
/// 为已存在的素材创建图库专用元数据。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `req`: 创建请求
///
/// # 返回
/// - 成功返回创建的元数据
/// - 失败返回错误信息
#[tauri::command]
pub async fn create_gallery_material_metadata(
    db: State<'_, DbConnection>,
    req: CreateGalleryMaterialMetadataRequest,
) -> Result<GalleryMaterialMetadata, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::create(&conn, &req).map_err(|e| e.to_string())
}

/// 获取图库素材元数据
///
/// 根据素材 ID 获取图库元数据。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `material_id`: 素材 ID
///
/// # 返回
/// - 成功返回 Option<GalleryMaterialMetadata>
/// - 失败返回错误信息
#[tauri::command]
pub async fn get_gallery_material_metadata(
    db: State<'_, DbConnection>,
    material_id: String,
) -> Result<Option<GalleryMaterialMetadata>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::get(&conn, &material_id).map_err(|e| e.to_string())
}

/// 获取完整的图库素材
///
/// 获取包含基础素材和元数据的完整图库素材。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `material_id`: 素材 ID
///
/// # 返回
/// - 成功返回 Option<GalleryMaterial>
/// - 失败返回错误信息
#[tauri::command]
pub async fn get_gallery_material(
    db: State<'_, DbConnection>,
    material_id: String,
) -> Result<Option<GalleryMaterial>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::get_gallery_material(&conn, &material_id).map_err(|e| e.to_string())
}

/// 按图片分类获取素材列表
///
/// 获取指定项目下的图片素材，可按分类筛选。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `project_id`: 项目 ID
/// - `category`: 可选的图片分类
///
/// # 返回
/// - 成功返回图库素材列表
/// - 失败返回错误信息
#[tauri::command]
pub async fn list_gallery_materials_by_image_category(
    db: State<'_, DbConnection>,
    project_id: String,
    category: Option<String>,
) -> Result<Vec<GalleryMaterial>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::list_gallery_materials_by_image_category(
        &conn,
        &project_id,
        category.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// 按布局分类获取素材列表
///
/// 获取指定项目下的布局素材，可按分类筛选。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `project_id`: 项目 ID
/// - `category`: 可选的布局分类
///
/// # 返回
/// - 成功返回图库素材列表
/// - 失败返回错误信息
#[tauri::command]
pub async fn list_gallery_materials_by_layout_category(
    db: State<'_, DbConnection>,
    project_id: String,
    category: Option<String>,
) -> Result<Vec<GalleryMaterial>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::list_gallery_materials_by_layout_category(
        &conn,
        &project_id,
        category.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// 按配色氛围获取素材列表
///
/// 获取指定项目下的配色素材，可按氛围筛选。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `project_id`: 项目 ID
/// - `mood`: 可选的配色氛围
///
/// # 返回
/// - 成功返回图库素材列表
/// - 失败返回错误信息
#[tauri::command]
pub async fn list_gallery_materials_by_mood(
    db: State<'_, DbConnection>,
    project_id: String,
    mood: Option<String>,
) -> Result<Vec<GalleryMaterial>, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::list_gallery_materials_by_mood(&conn, &project_id, mood.as_deref())
        .map_err(|e| e.to_string())
}

/// 更新图库素材元数据
///
/// 更新指定素材的图库元数据。如果元数据不存在，则创建新的。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `material_id`: 素材 ID
/// - `req`: 更新请求
///
/// # 返回
/// - 成功返回更新后的元数据
/// - 失败返回错误信息
#[tauri::command]
pub async fn update_gallery_material_metadata(
    db: State<'_, DbConnection>,
    material_id: String,
    req: CreateGalleryMaterialMetadataRequest,
) -> Result<GalleryMaterialMetadata, String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::update(&conn, &material_id, &req).map_err(|e| e.to_string())
}

/// 删除图库素材元数据
///
/// 删除指定素材的图库元数据。
/// 注意：这只删除元数据，不删除基础素材。
///
/// # 参数
/// - `db`: 数据库连接状态
/// - `material_id`: 素材 ID
///
/// # 返回
/// - 成功返回 ()
/// - 失败返回错误信息
#[tauri::command]
pub async fn delete_gallery_material_metadata(
    db: State<'_, DbConnection>,
    material_id: String,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| format!("数据库锁定失败: {e}"))?;
    GalleryMaterialDao::delete(&conn, &material_id).map_err(|e| e.to_string())
}
