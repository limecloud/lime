use crate::database::DbConnection;
use crate::services::claw_solution_service::{
    ClawSolutionContext, ClawSolutionDetail, ClawSolutionPreparation, ClawSolutionReadinessResult,
    ClawSolutionService, ClawSolutionSummary,
};
use tauri::State;

#[tauri::command]
pub async fn claw_solution_list(
    db: State<'_, DbConnection>,
) -> Result<Vec<ClawSolutionSummary>, String> {
    ClawSolutionService::default().list(&db).await
}

#[tauri::command]
pub async fn claw_solution_detail(
    db: State<'_, DbConnection>,
    solution_id: String,
) -> Result<ClawSolutionDetail, String> {
    ClawSolutionService::default()
        .detail(&db, &solution_id)
        .await
}

#[tauri::command]
pub async fn claw_solution_check_readiness(
    db: State<'_, DbConnection>,
    solution_id: String,
    _context: Option<ClawSolutionContext>,
) -> Result<ClawSolutionReadinessResult, String> {
    ClawSolutionService::default()
        .check_readiness(&db, &solution_id)
        .await
}

#[tauri::command]
pub async fn claw_solution_prepare(
    db: State<'_, DbConnection>,
    solution_id: String,
    context: Option<ClawSolutionContext>,
) -> Result<ClawSolutionPreparation, String> {
    ClawSolutionService::default()
        .prepare(&db, &solution_id, context)
        .await
}
