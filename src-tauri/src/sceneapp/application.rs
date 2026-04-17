use super::adapters::{
    build_sceneapp_automation_draft, build_sceneapp_automation_result,
    build_sceneapp_run_summary_from_agent_run_with_db,
    build_sceneapp_run_summary_from_automation_job, extract_sceneapp_id_from_automation_job,
    extract_sceneapp_id_from_run_metadata, prepare_sceneapp_run_governance_artifact,
};
use super::catalog::{get_sceneapp_descriptor, seeded_sceneapp_catalog};
use super::context::store::{
    build_persisted_sceneapp_context, load_persisted_sceneapp_context,
    save_persisted_sceneapp_context,
};
use super::dto::*;
use super::governance::build_sceneapp_scorecard_from_runs;
use super::runtime::build_launch_plan;
use crate::database::DbConnection;
use crate::services::automation_service::AutomationService;
use crate::services::execution_tracker_service::ExecutionTracker;

pub struct SceneAppService;

const SCENEAPP_TRACKER_RUN_LIMIT: usize = 200;

fn sort_and_dedupe_runs(runs: &mut Vec<SceneAppRunSummary>) {
    runs.sort_by(|left, right| {
        right
            .started_at
            .cmp(&left.started_at)
            .then_with(|| right.run_id.cmp(&left.run_id))
    });
    runs.dedup_by(|left, right| left.run_id == right.run_id);
}

impl SceneAppService {
    pub fn list_catalog() -> SceneAppCatalog {
        seeded_sceneapp_catalog()
    }

    pub fn get_descriptor(id: &str) -> Option<SceneAppDescriptor> {
        get_sceneapp_descriptor(id)
    }

    pub fn plan_launch(
        db: &DbConnection,
        intent: SceneAppLaunchIntent,
    ) -> Result<SceneAppPlanResult, String> {
        let sceneapp_id = intent.sceneapp_id.clone();
        let workspace_id = intent.workspace_id.clone();
        let project_id = intent.project_id.clone();
        let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str())
            .ok_or_else(|| format!("未找到 SceneApp: {sceneapp_id}"))?;

        let persisted_context = match load_persisted_sceneapp_context(
            db,
            sceneapp_id.as_str(),
            workspace_id.as_deref(),
            project_id.as_deref(),
        ) {
            Ok(context) => context,
            Err(error) => {
                let mut result = build_launch_plan(descriptor, intent, None);
                result.plan.warnings.push(format!(
                    "读取项目级 Context Snapshot 失败，本次先按最新输入继续 planning：{error}"
                ));
                return Ok(result);
            }
        };

        let mut result = build_launch_plan(descriptor, intent, persisted_context.as_ref());
        let Some(context_overlay) = result.context_overlay.as_ref() else {
            return Ok(result);
        };
        let persisted_context =
            build_persisted_sceneapp_context(sceneapp_id.as_str(), &context_overlay.snapshot);

        match save_persisted_sceneapp_context(db, &persisted_context) {
            Ok(Some(_)) => {}
            Ok(None) => result
                .plan
                .warnings
                .push("当前未解析到项目目录，暂未写入项目级 Context Snapshot。".to_string()),
            Err(error) => result.plan.warnings.push(format!(
                "写入项目级 Context Snapshot 失败，本次 planning 结果仍已返回：{error}"
            )),
        }

        Ok(result)
    }

    fn seeded_runs() -> Vec<SceneAppRunSummary> {
        vec![
            SceneAppRunSummary {
                run_id: "sceneapp-run-story-video-seed".to_string(),
                sceneapp_id: "story-video-suite".to_string(),
                status: SceneAppRunStatus::Success,
                source: "catalog_seed".to_string(),
                source_ref: None,
                session_id: None,
                browser_runtime_ref: None,
                cloud_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T00:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T00:08:00.000Z".to_string()),
                artifact_count: 3,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: vec![
                    "brief".to_string(),
                    "storyboard".to_string(),
                    "script".to_string(),
                    "music_refs".to_string(),
                    "video_draft".to_string(),
                    "review_note".to_string(),
                ],
                delivery_completed_parts: vec![
                    "brief".to_string(),
                    "storyboard".to_string(),
                    "script".to_string(),
                ],
                delivery_missing_parts: vec![
                    "music_refs".to_string(),
                    "video_draft".to_string(),
                    "review_note".to_string(),
                ],
                delivery_completion_rate: Some(50.0),
                delivery_part_coverage_known: true,
                failure_signal: Some("review_blocked".to_string()),
                runtime_evidence_used: false,
                evidence_known_gaps: Vec::new(),
                verification_failure_outcomes: Vec::new(),
                request_telemetry_available: None,
                request_telemetry_matched_count: None,
                artifact_validator_applicable: None,
                artifact_validator_issue_count: None,
                artifact_validator_recovered_count: None,
            },
            SceneAppRunSummary {
                run_id: "sceneapp-run-article-export-seed".to_string(),
                sceneapp_id: "x-article-export".to_string(),
                status: SceneAppRunStatus::Queued,
                source: "catalog_seed".to_string(),
                source_ref: None,
                session_id: None,
                browser_runtime_ref: None,
                cloud_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T00:12:00.000Z".to_string(),
                finished_at: None,
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: vec!["index.md".to_string(), "meta.json".to_string()],
                delivery_completed_parts: Vec::new(),
                delivery_missing_parts: Vec::new(),
                delivery_completion_rate: None,
                delivery_part_coverage_known: false,
                failure_signal: None,
                runtime_evidence_used: false,
                evidence_known_gaps: Vec::new(),
                verification_failure_outcomes: Vec::new(),
                request_telemetry_available: None,
                request_telemetry_matched_count: None,
                artifact_validator_applicable: None,
                artifact_validator_issue_count: None,
                artifact_validator_recovered_count: None,
            },
        ]
    }

    pub fn list_runs(sceneapp_id: Option<&str>) -> Vec<SceneAppRunSummary> {
        let candidate_runs = Self::seeded_runs();
        let mut runs = match sceneapp_id.map(str::trim).filter(|value| !value.is_empty()) {
            Some(sceneapp_id) => candidate_runs
                .into_iter()
                .filter(|run| run.sceneapp_id == sceneapp_id)
                .collect(),
            None => candidate_runs,
        };
        sort_and_dedupe_runs(&mut runs);
        runs
    }

    pub fn get_run_summary(run_id: &str) -> Option<SceneAppRunSummary> {
        Self::seeded_runs()
            .into_iter()
            .find(|run| run.run_id == run_id.trim())
    }

    pub async fn create_automation_job(
        automation_service: &AutomationService,
        intent: SceneAppAutomationIntent,
    ) -> Result<SceneAppAutomationResult, String> {
        let descriptor = get_sceneapp_descriptor(intent.launch_intent.sceneapp_id.as_str())
            .ok_or_else(|| format!("未找到 SceneApp: {}", intent.launch_intent.sceneapp_id))?;
        let run_now = intent.run_now.unwrap_or(false);
        let draft = build_sceneapp_automation_draft(&descriptor, &intent)?;
        let job = automation_service.create_job(draft)?;
        let run_now_result = if run_now {
            Some(automation_service.run_job_now(job.id.as_str()).await?)
        } else {
            None
        };

        Ok(build_sceneapp_automation_result(
            &descriptor,
            &job,
            run_now_result,
        ))
    }

    pub fn list_runs_from_automation(
        db: &DbConnection,
        automation_service: &AutomationService,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let sceneapp_id_filter = sceneapp_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let jobs = automation_service.list_jobs()?;
        let mut runs = Vec::new();

        for job in jobs {
            let Some(job_sceneapp_id) = extract_sceneapp_id_from_automation_job(&job) else {
                continue;
            };
            if sceneapp_id_filter
                .as_deref()
                .is_some_and(|value| value != job_sceneapp_id)
            {
                continue;
            }

            let job_runs = automation_service.get_job_runs(job.id.as_str(), 20)?;
            if job_runs.is_empty() {
                let descriptor = get_sceneapp_descriptor(job_sceneapp_id.as_str());
                runs.push(build_sceneapp_run_summary_from_automation_job(
                    &job,
                    descriptor.as_ref(),
                    job_sceneapp_id.clone(),
                ));
                continue;
            }

            runs.extend(job_runs.into_iter().map(|run| {
                let descriptor = get_sceneapp_descriptor(job_sceneapp_id.as_str());
                build_sceneapp_run_summary_from_agent_run_with_db(
                    db,
                    &run,
                    descriptor.as_ref(),
                    job_sceneapp_id.clone(),
                )
            }));
        }

        sort_and_dedupe_runs(&mut runs);
        Ok(runs)
    }

    pub fn list_runs_from_tracker(
        tracker: &ExecutionTracker,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let sceneapp_id_filter = sceneapp_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let mut runs = tracker
            .list_runs(SCENEAPP_TRACKER_RUN_LIMIT, 0)?
            .into_iter()
            .filter_map(|run| {
                let run_sceneapp_id = extract_sceneapp_id_from_run_metadata(&run)?;
                if sceneapp_id_filter
                    .as_deref()
                    .is_some_and(|value| value != run_sceneapp_id)
                {
                    return None;
                }
                let descriptor = get_sceneapp_descriptor(run_sceneapp_id.as_str());
                Some(build_sceneapp_run_summary_from_agent_run_with_db(
                    tracker.db(),
                    &run,
                    descriptor.as_ref(),
                    run_sceneapp_id,
                ))
            })
            .collect::<Vec<_>>();
        sort_and_dedupe_runs(&mut runs);
        Ok(runs)
    }

    pub fn collect_runs(
        tracker: &ExecutionTracker,
        automation_service: &AutomationService,
        sceneapp_id: Option<&str>,
    ) -> Result<Vec<SceneAppRunSummary>, String> {
        let mut live_runs = Self::list_runs_from_tracker(tracker, sceneapp_id)?;
        live_runs.extend(Self::list_runs_from_automation(
            tracker.db(),
            automation_service,
            sceneapp_id,
        )?);
        sort_and_dedupe_runs(&mut live_runs);

        if !live_runs.is_empty() {
            return Ok(live_runs);
        }

        Ok(Self::list_runs(sceneapp_id))
    }

    pub fn get_run_summary_from_tracker(
        tracker: &ExecutionTracker,
        run_id: &str,
    ) -> Result<Option<SceneAppRunSummary>, String> {
        let Some(run) = tracker.get_run(run_id)? else {
            return Ok(None);
        };
        let Some(sceneapp_id) = extract_sceneapp_id_from_run_metadata(&run) else {
            return Ok(None);
        };
        let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str());
        Ok(Some(build_sceneapp_run_summary_from_agent_run_with_db(
            tracker.db(),
            &run,
            descriptor.as_ref(),
            sceneapp_id,
        )))
    }

    pub fn prepare_run_governance_artifact(
        tracker: &ExecutionTracker,
        run_id: &str,
        kind: &SceneAppGovernanceArtifactKind,
    ) -> Result<Option<SceneAppRunSummary>, String> {
        let Some(run) = tracker.get_run(run_id)? else {
            return Ok(None);
        };
        let Some(sceneapp_id) = extract_sceneapp_id_from_run_metadata(&run) else {
            return Ok(None);
        };
        prepare_sceneapp_run_governance_artifact(tracker.db(), &run, kind)?;
        let descriptor = get_sceneapp_descriptor(sceneapp_id.as_str());

        Ok(Some(build_sceneapp_run_summary_from_agent_run_with_db(
            tracker.db(),
            &run,
            descriptor.as_ref(),
            sceneapp_id,
        )))
    }

    pub fn get_scorecard(
        db: &DbConnection,
        automation_service: &AutomationService,
        sceneapp_id: &str,
    ) -> Result<SceneAppScorecard, String> {
        let descriptor = get_sceneapp_descriptor(sceneapp_id)
            .ok_or_else(|| format!("未找到 SceneApp scorecard: {sceneapp_id}"))?;
        let tracker = ExecutionTracker::new(db.clone());
        let runs = Self::collect_runs(&tracker, automation_service, Some(sceneapp_id))?;
        Ok(build_sceneapp_scorecard_from_runs(&descriptor, &runs))
    }
}
