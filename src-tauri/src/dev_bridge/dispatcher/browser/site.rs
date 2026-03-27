use super::super::get_db;
use super::{parse_request, DynError};
use crate::dev_bridge::DevBridgeState;
use crate::services::site_adapter_registry::{
    apply_site_adapter_catalog_bootstrap, clear_site_adapter_catalog_cache,
    get_site_adapter_catalog_status,
};
use crate::services::site_capability_service::{
    get_site_adapter, list_site_adapters, recommend_site_adapters, run_site_adapter,
    run_site_adapter_with_optional_save, save_existing_site_result_to_project,
    search_site_adapters,
};
use serde_json::Value as JsonValue;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    let result = match cmd {
        "site_list_adapters" => serde_json::to_value(list_site_adapters())?,
        "site_recommend_adapters" => {
            let request: crate::commands::site_capability_cmd::SiteAdapterRecommendRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(recommend_site_adapters(&db, request.limit).await?)?
        }
        "site_search_adapters" => {
            let request: crate::commands::site_capability_cmd::SiteAdapterSearchRequest =
                parse_request(args)?;
            serde_json::to_value(search_site_adapters(&request.query))?
        }
        "site_get_adapter_info" => {
            let request: crate::commands::site_capability_cmd::SiteAdapterNameRequest =
                parse_request(args)?;
            let adapter = get_site_adapter(&request.name)
                .ok_or_else(|| "未找到对应的站点适配器".to_string())?;
            serde_json::to_value(adapter)?
        }
        "site_get_adapter_catalog_status" => {
            serde_json::to_value(get_site_adapter_catalog_status()?)?
        }
        "site_apply_adapter_catalog_bootstrap" => {
            let request: crate::commands::site_capability_cmd::SiteAdapterCatalogBootstrapRequest =
                parse_request(args)?;
            serde_json::to_value(apply_site_adapter_catalog_bootstrap(&request.payload)?)?
        }
        "site_clear_adapter_catalog_cache" => {
            serde_json::to_value(clear_site_adapter_catalog_cache()?)?
        }
        "site_run_adapter" | "site_debug_run_adapter" => {
            let request: crate::services::site_capability_service::RunSiteAdapterRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            if cmd == "site_run_adapter" {
                serde_json::to_value(run_site_adapter_with_optional_save(&db, request).await)?
            } else {
                serde_json::to_value(run_site_adapter(&db, request).await)?
            }
        }
        "site_save_adapter_result" => {
            let request: crate::services::site_capability_service::SaveSiteAdapterResultRequest =
                parse_request(args)?;
            let db = get_db(state)?.clone();
            serde_json::to_value(save_existing_site_result_to_project(&db, request)?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(result))
}
