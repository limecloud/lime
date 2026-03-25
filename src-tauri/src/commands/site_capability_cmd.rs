use crate::database::DbConnection;
use crate::services::site_adapter_registry::{
    apply_site_adapter_catalog_bootstrap, clear_site_adapter_catalog_cache,
    get_site_adapter_catalog_status, SiteAdapterCatalogStatus,
};
use crate::services::site_capability_service::{
    get_site_adapter, list_site_adapters, run_site_adapter, run_site_adapter_with_optional_save,
    save_existing_site_result_to_project, search_site_adapters, RunSiteAdapterRequest,
    SaveSiteAdapterResultRequest, SavedSiteAdapterContent, SiteAdapterDefinition,
    SiteAdapterRunResult,
};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct SiteAdapterNameRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct SiteAdapterSearchRequest {
    pub query: String,
}

#[derive(Debug, Deserialize)]
pub struct SiteAdapterCatalogBootstrapRequest {
    pub payload: Value,
}

#[tauri::command]
pub fn site_list_adapters() -> Result<Vec<SiteAdapterDefinition>, String> {
    Ok(list_site_adapters())
}

#[tauri::command]
pub fn site_search_adapters(
    request: SiteAdapterSearchRequest,
) -> Result<Vec<SiteAdapterDefinition>, String> {
    Ok(search_site_adapters(&request.query))
}

#[tauri::command]
pub fn site_get_adapter_info(
    request: SiteAdapterNameRequest,
) -> Result<SiteAdapterDefinition, String> {
    get_site_adapter(&request.name).ok_or_else(|| "未找到对应的站点适配器".to_string())
}

#[tauri::command]
pub fn site_get_adapter_catalog_status() -> Result<SiteAdapterCatalogStatus, String> {
    get_site_adapter_catalog_status()
}

#[tauri::command]
pub fn site_apply_adapter_catalog_bootstrap(
    request: SiteAdapterCatalogBootstrapRequest,
) -> Result<SiteAdapterCatalogStatus, String> {
    apply_site_adapter_catalog_bootstrap(&request.payload)
}

#[tauri::command]
pub fn site_clear_adapter_catalog_cache() -> Result<SiteAdapterCatalogStatus, String> {
    clear_site_adapter_catalog_cache()
}

#[tauri::command]
pub async fn site_run_adapter(
    db: State<'_, DbConnection>,
    request: RunSiteAdapterRequest,
) -> Result<SiteAdapterRunResult, String> {
    Ok(run_site_adapter_with_optional_save(db.inner(), request).await)
}

#[tauri::command]
pub async fn site_debug_run_adapter(
    db: State<'_, DbConnection>,
    request: RunSiteAdapterRequest,
) -> Result<SiteAdapterRunResult, String> {
    Ok(run_site_adapter(db.inner(), request).await)
}

#[tauri::command]
pub fn site_save_adapter_result(
    db: State<'_, DbConnection>,
    request: SaveSiteAdapterResultRequest,
) -> Result<SavedSiteAdapterContent, String> {
    save_existing_site_result_to_project(db.inner(), request)
}
