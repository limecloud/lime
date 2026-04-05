//! 提示路由命令

use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HintRouteEntryResponse {
    pub hint: String,
    pub provider: String,
    pub model: String,
}

#[tauri::command]
pub async fn get_hint_routes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<HintRouteEntryResponse>, String> {
    let s = state.read().await;
    Ok(s.config
        .hint_router
        .routes
        .iter()
        .map(|r| HintRouteEntryResponse {
            hint: r.hint.clone(),
            provider: r.provider.clone(),
            model: r.model.clone(),
        })
        .collect())
}
