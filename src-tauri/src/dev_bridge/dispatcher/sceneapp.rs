use super::{args_or_default, get_db, get_string_arg, parse_nested_arg, require_app_handle};
use crate::dev_bridge::DevBridgeState;
use crate::sceneapp::application::SceneAppService;
use crate::services::execution_tracker_service::ExecutionTracker;
use serde_json::Value as JsonValue;
use tauri::Manager;

type DynError = Box<dyn std::error::Error>;

pub(super) async fn try_handle(
    state: &DevBridgeState,
    cmd: &str,
    args: Option<&JsonValue>,
) -> Result<Option<JsonValue>, DynError> {
    if !matches!(
        cmd,
        "sceneapp_list_catalog"
            | "sceneapp_get_descriptor"
            | "sceneapp_plan_launch"
            | "sceneapp_save_context_baseline"
            | "sceneapp_create_automation_job"
            | "sceneapp_list_runs"
            | "sceneapp_get_run_summary"
            | "sceneapp_prepare_run_governance_artifact"
            | "sceneapp_get_scorecard"
    ) {
        return Ok(None);
    }

    let args = args_or_default(args);
    let result = match cmd {
        "sceneapp_list_catalog" => {
            serde_json::to_value(crate::commands::sceneapp_cmd::sceneapp_list_catalog().await?)?
        }
        "sceneapp_get_descriptor" => {
            let id = get_string_arg(&args, "id", "id")?;
            serde_json::to_value(crate::commands::sceneapp_cmd::sceneapp_get_descriptor(id).await?)?
        }
        "sceneapp_plan_launch" => {
            let db = get_db(state)?;
            let intent =
                parse_nested_arg::<crate::sceneapp::dto::SceneAppLaunchIntent>(&args, "intent")?;
            serde_json::to_value(SceneAppService::plan_launch(db, intent)?)?
        }
        "sceneapp_save_context_baseline" => {
            let db = get_db(state)?;
            let intent =
                parse_nested_arg::<crate::sceneapp::dto::SceneAppLaunchIntent>(&args, "intent")?;
            serde_json::to_value(SceneAppService::save_context_baseline(db, intent)?)?
        }
        "sceneapp_create_automation_job" => {
            let app_handle = require_app_handle(state)?;
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();
            let intent = parse_nested_arg::<crate::sceneapp::dto::SceneAppAutomationIntent>(
                &args, "intent",
            )?;
            let service = automation_state.0.read().await;
            serde_json::to_value(SceneAppService::create_automation_job(&service, intent).await?)?
        }
        "sceneapp_list_runs" => {
            let db = get_db(state)?.clone();
            let app_handle = require_app_handle(state)?;
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();
            let sceneapp_id = args
                .get("sceneappId")
                .or_else(|| args.get("sceneapp_id"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            let service = automation_state.0.read().await;
            let tracker = ExecutionTracker::new(db);
            serde_json::to_value(SceneAppService::collect_runs(
                &tracker,
                &service,
                sceneapp_id.as_deref(),
            )?)?
        }
        "sceneapp_get_run_summary" => {
            let db = get_db(state)?.clone();
            let run_id = get_string_arg(&args, "runId", "run_id")?;
            let tracker = ExecutionTracker::new(db);
            if let Some(summary) =
                SceneAppService::get_run_summary_from_tracker(&tracker, run_id.as_str())?
            {
                serde_json::to_value(Some(summary))?
            } else {
                serde_json::to_value(SceneAppService::get_run_summary(run_id.as_str()))?
            }
        }
        "sceneapp_prepare_run_governance_artifact" => {
            let db = get_db(state)?.clone();
            let run_id = get_string_arg(&args, "runId", "run_id")?;
            let kind = parse_nested_arg::<crate::sceneapp::dto::SceneAppGovernanceArtifactKind>(
                &args, "kind",
            )?;
            let tracker = ExecutionTracker::new(db);
            serde_json::to_value(SceneAppService::prepare_run_governance_artifact(
                &tracker,
                run_id.as_str(),
                &kind,
            )?)?
        }
        "sceneapp_get_scorecard" => {
            let db = get_db(state)?;
            let app_handle = require_app_handle(state)?;
            let automation_state =
                app_handle.state::<crate::services::automation_service::AutomationServiceState>();
            let sceneapp_id = get_string_arg(&args, "sceneappId", "sceneapp_id")?;
            let service = automation_state.0.read().await;
            serde_json::to_value(SceneAppService::get_scorecard(
                db,
                &service,
                sceneapp_id.as_str(),
            )?)?
        }
        _ => unreachable!("已通过前置 matches! 过滤 sceneapp 命令"),
    };

    Ok(Some(result))
}
