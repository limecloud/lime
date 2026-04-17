use crate::database::DbConnection;
use crate::sceneapp::application::SceneAppService;
use crate::sceneapp::dto::{
    SceneAppAutomationIntent, SceneAppAutomationResult, SceneAppCatalog, SceneAppDescriptor,
    SceneAppGovernanceArtifactKind, SceneAppLaunchIntent, SceneAppPlanResult, SceneAppRunSummary,
    SceneAppScorecard,
};
use crate::services::automation_service::AutomationServiceState;
use crate::services::execution_tracker_service::ExecutionTracker;
use tauri::State;

#[tauri::command]
pub async fn sceneapp_list_catalog() -> Result<SceneAppCatalog, String> {
    Ok(SceneAppService::list_catalog())
}

#[tauri::command]
pub async fn sceneapp_get_descriptor(id: String) -> Result<Option<SceneAppDescriptor>, String> {
    let normalized = id.trim();
    if normalized.is_empty() {
        return Err("sceneapp id 不能为空".to_string());
    }
    Ok(SceneAppService::get_descriptor(normalized))
}

#[tauri::command]
pub async fn sceneapp_plan_launch(
    db: State<'_, DbConnection>,
    intent: SceneAppLaunchIntent,
) -> Result<SceneAppPlanResult, String> {
    SceneAppService::plan_launch(db.inner(), intent)
}

#[tauri::command]
pub async fn sceneapp_create_automation_job(
    automation_state: State<'_, AutomationServiceState>,
    intent: SceneAppAutomationIntent,
) -> Result<SceneAppAutomationResult, String> {
    let service = automation_state.0.read().await;
    SceneAppService::create_automation_job(&service, intent).await
}

#[tauri::command]
pub async fn sceneapp_list_runs(
    automation_state: State<'_, AutomationServiceState>,
    db: State<'_, DbConnection>,
    sceneapp_id: Option<String>,
) -> Result<Vec<SceneAppRunSummary>, String> {
    let service = automation_state.0.read().await;
    let tracker = ExecutionTracker::new(db.inner().clone());
    SceneAppService::collect_runs(&tracker, &service, sceneapp_id.as_deref())
}

#[tauri::command]
pub async fn sceneapp_get_run_summary(
    db: State<'_, DbConnection>,
    run_id: String,
) -> Result<Option<SceneAppRunSummary>, String> {
    let normalized = run_id.trim();
    if normalized.is_empty() {
        return Err("run_id 不能为空".to_string());
    }
    let tracker = ExecutionTracker::new(db.inner().clone());
    if let Some(summary) = SceneAppService::get_run_summary_from_tracker(&tracker, normalized)? {
        return Ok(Some(summary));
    }
    Ok(SceneAppService::get_run_summary(normalized))
}

#[tauri::command]
pub async fn sceneapp_prepare_run_governance_artifact(
    db: State<'_, DbConnection>,
    run_id: String,
    kind: SceneAppGovernanceArtifactKind,
) -> Result<Option<SceneAppRunSummary>, String> {
    let normalized = run_id.trim();
    if normalized.is_empty() {
        return Err("run_id 不能为空".to_string());
    }

    let tracker = ExecutionTracker::new(db.inner().clone());
    SceneAppService::prepare_run_governance_artifact(&tracker, normalized, &kind)
}

#[tauri::command]
pub async fn sceneapp_get_scorecard(
    automation_state: State<'_, AutomationServiceState>,
    db: State<'_, DbConnection>,
    sceneapp_id: String,
) -> Result<SceneAppScorecard, String> {
    let normalized = sceneapp_id.trim();
    if normalized.is_empty() {
        return Err("sceneapp_id 不能为空".to_string());
    }
    let service = automation_state.0.read().await;
    SceneAppService::get_scorecard(db.inner(), &service, normalized)
}
