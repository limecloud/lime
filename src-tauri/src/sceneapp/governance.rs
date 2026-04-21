use super::catalog::get_sceneapp_descriptor;
use super::dto::*;

fn metric(
    key: &str,
    label: &str,
    value: f64,
    status: SceneAppMetricStatus,
) -> SceneAppScorecardMetric {
    SceneAppScorecardMetric {
        key: key.to_string(),
        label: label.to_string(),
        value,
        status,
    }
}

fn round_percentage(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn percentage(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        round_percentage((numerator as f64 / denominator as f64) * 100.0)
    }
}

fn metric_status(value: f64, good_threshold: f64, watch_threshold: f64) -> SceneAppMetricStatus {
    if value >= good_threshold {
        SceneAppMetricStatus::Good
    } else if value >= watch_threshold {
        SceneAppMetricStatus::Watch
    } else {
        SceneAppMetricStatus::Risk
    }
}

fn sceneapp_type_label(sceneapp_type: &SceneAppType) -> &'static str {
    match sceneapp_type {
        SceneAppType::LocalInstant => "本地即时",
        SceneAppType::LocalDurable => "本地 durable",
        SceneAppType::BrowserGrounded => "浏览器依赖",
        SceneAppType::CloudManaged => "目录同步",
        SceneAppType::Hybrid => "多模态组合",
    }
}

fn recommended_action_label(action: &SceneAppRecommendedAction) -> &'static str {
    match action {
        SceneAppRecommendedAction::Launch => "继续扩大样本",
        SceneAppRecommendedAction::Keep => "继续保留",
        SceneAppRecommendedAction::Optimize => "优先优化",
        SceneAppRecommendedAction::Retire => "考虑收口",
    }
}

fn classify_failure_bucket(
    descriptor: &SceneAppDescriptor,
    run: &SceneAppRunSummary,
) -> Option<&'static str> {
    match run.status {
        SceneAppRunStatus::Timeout => Some("dependency_failure"),
        SceneAppRunStatus::Canceled => Some("adoption_failure"),
        SceneAppRunStatus::Error => Some(match descriptor.sceneapp_type {
            SceneAppType::BrowserGrounded | SceneAppType::CloudManaged => "dependency_failure",
            _ => "runtime_failure",
        }),
        SceneAppRunStatus::Queued | SceneAppRunStatus::Running | SceneAppRunStatus::Success => None,
    }
}

fn failure_signal_label(signal: &str) -> &str {
    match signal {
        "pack_incomplete" => "整包不完整",
        "review_blocked" => "复核阻塞",
        "publish_stalled" => "发布卡点",
        "automation_timeout" => "自动化超时",
        "dependency_failure" => "外部依赖与会话稳定性",
        "adoption_failure" => "补参与人工中断",
        "runtime_failure" => "运行链稳定性",
        _ => signal,
    }
}

fn collect_observed_failure_signals(
    descriptor: &SceneAppDescriptor,
    runs: &[SceneAppRunSummary],
) -> Vec<String> {
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    for run in runs {
        let signal = run
            .failure_signal
            .clone()
            .or_else(|| classify_failure_bucket(descriptor, run).map(str::to_string));
        if let Some(signal) = signal {
            *counts.entry(signal).or_insert(0) += 1;
        }
    }

    let mut ordered = counts.into_iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    ordered.into_iter().map(|(signal, _)| signal).collect()
}

fn metric_label(key: &str) -> &str {
    match key {
        "complete_pack_rate" => "整包交付率",
        "review_pass_rate" => "复核通过率",
        "publish_conversion_rate" => "发布转化率",
        "success_rate" | "run_success_rate" => "执行成功率",
        "reuse_rate" | "repeat_use_rate" => "复用率",
        "artifact_output_rate" => "结果产出率",
        "sample_coverage" => "运行样本充足度",
        "delivery_readiness" => "交付就绪度",
        "reuse_potential" => "结果复用潜力",
        _ => key,
    }
}

fn metric_status_for_key(key: &str, value: f64) -> SceneAppMetricStatus {
    match key {
        "complete_pack_rate" => metric_status(value, 80.0, 50.0),
        "review_pass_rate" => metric_status(value, 75.0, 45.0),
        "publish_conversion_rate" => metric_status(value, 60.0, 30.0),
        "success_rate" | "run_success_rate" => metric_status(value, 80.0, 50.0),
        "reuse_rate" | "repeat_use_rate" => metric_status(value, 35.0, 15.0),
        "artifact_output_rate" => metric_status(value, 60.0, 30.0),
        "sample_coverage" => metric_status(value, 80.0, 40.0),
        "delivery_readiness" => metric_status(value, 80.0, 50.0),
        "reuse_potential" => metric_status(value, 70.0, 40.0),
        _ => metric_status(value, 70.0, 40.0),
    }
}

fn build_seeded_sceneapp_scorecard(descriptor: &SceneAppDescriptor) -> SceneAppScorecard {
    let (summary, recommended_action, metrics) = match descriptor.sceneapp_type {
        SceneAppType::Hybrid => (
            "多模态组合场景已经具备经营价值，但最需要继续打磨交付稳定性与跨执行器治理。"
                .to_string(),
            SceneAppRecommendedAction::Optimize,
            vec![
                metric(
                    "delivery_readiness",
                    "交付就绪度",
                    78.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "reuse_potential",
                    "结果复用潜力",
                    86.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "operational_risk",
                    "运行复杂度风险",
                    64.0,
                    SceneAppMetricStatus::Watch,
                ),
            ],
        ),
        SceneAppType::BrowserGrounded => (
            "浏览器依赖型场景适合继续保留，但应优先降低登录态和页面结构波动带来的阻塞。"
                .to_string(),
            SceneAppRecommendedAction::Keep,
            vec![
                metric(
                    "delivery_readiness",
                    "交付就绪度",
                    80.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "reuse_potential",
                    "结果复用潜力",
                    82.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "operational_risk",
                    "运行复杂度风险",
                    58.0,
                    SceneAppMetricStatus::Watch,
                ),
            ],
        ),
        SceneAppType::CloudManaged => (
            "目录同步型场景仍可能带入历史兼容目录输入，但 current 执行已经回到本地主链，应持续关注目录质量、完成率和单位成功成本。"
                .to_string(),
            SceneAppRecommendedAction::Launch,
            vec![
                metric(
                    "delivery_readiness",
                    "交付就绪度",
                    84.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "reuse_potential",
                    "结果复用潜力",
                    75.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "operational_risk",
                    "运行复杂度风险",
                    42.0,
                    SceneAppMetricStatus::Good,
                ),
            ],
        ),
        SceneAppType::LocalDurable => (
            "本地 durable 场景适合保留，下一步重点是提高调度透明度和失败可恢复性。".to_string(),
            SceneAppRecommendedAction::Keep,
            vec![
                metric(
                    "delivery_readiness",
                    "交付就绪度",
                    76.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "reuse_potential",
                    "结果复用潜力",
                    81.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "operational_risk",
                    "运行复杂度风险",
                    47.0,
                    SceneAppMetricStatus::Good,
                ),
            ],
        ),
        SceneAppType::LocalInstant => (
            "本地即时场景适合继续保留，并优先作为新能力的装配试验田。".to_string(),
            SceneAppRecommendedAction::Keep,
            vec![
                metric(
                    "delivery_readiness",
                    "交付就绪度",
                    79.0,
                    SceneAppMetricStatus::Good,
                ),
                metric(
                    "reuse_potential",
                    "结果复用潜力",
                    68.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "operational_risk",
                    "运行复杂度风险",
                    35.0,
                    SceneAppMetricStatus::Good,
                ),
            ],
        ),
    };

    SceneAppScorecard {
        sceneapp_id: descriptor.id.clone(),
        updated_at: "2026-04-15T00:00:00.000Z".to_string(),
        summary,
        metrics,
        recommended_action,
        observed_failure_signals: Vec::new(),
        top_failure_signal: None,
    }
}

pub fn build_sceneapp_scorecard_from_runs(
    descriptor: &SceneAppDescriptor,
    runs: &[SceneAppRunSummary],
) -> SceneAppScorecard {
    if runs.is_empty() {
        return build_seeded_sceneapp_scorecard(descriptor);
    }

    let run_count = runs.len();
    let terminal_runs: Vec<&SceneAppRunSummary> = runs
        .iter()
        .filter(|run| {
            matches!(
                run.status,
                SceneAppRunStatus::Success
                    | SceneAppRunStatus::Error
                    | SceneAppRunStatus::Canceled
                    | SceneAppRunStatus::Timeout
            )
        })
        .collect();
    let success_count = terminal_runs
        .iter()
        .filter(|run| matches!(run.status, SceneAppRunStatus::Success))
        .count();
    let artifactful_count = runs.iter().filter(|run| run.artifact_count > 0).count();
    let repeat_use_rate = if run_count <= 1 {
        0.0
    } else {
        percentage(run_count.saturating_sub(1), run_count)
    };
    let sample_coverage = percentage(run_count.min(6), 6);
    let success_rate = percentage(success_count, terminal_runs.len());
    let artifact_output_rate = percentage(artifactful_count, run_count);
    let failure_count = terminal_runs.len().saturating_sub(success_count);
    let observed_failure_signals = collect_observed_failure_signals(descriptor, runs);
    let top_failure_signal = observed_failure_signals.first().cloned();

    let recommended_action = if run_count < 2 {
        SceneAppRecommendedAction::Launch
    } else if success_rate >= 78.0 && artifact_output_rate >= 50.0 && repeat_use_rate >= 25.0 {
        SceneAppRecommendedAction::Keep
    } else if run_count >= 5 && success_rate < 35.0 && artifact_output_rate < 20.0 {
        SceneAppRecommendedAction::Retire
    } else {
        SceneAppRecommendedAction::Optimize
    };

    let failure_sentence = match top_failure_signal.as_deref() {
        Some(signal) => format!("当前主要阻塞集中在{}。", failure_signal_label(signal)),
        None if failure_count > 0 => "当前失败分布仍偏分散，需要继续补样本。".to_string(),
        _ => "当前还没有出现明显失败簇。".to_string(),
    };
    let activity_sentence = if runs.iter().any(|run| {
        matches!(
            run.status,
            SceneAppRunStatus::Queued | SceneAppRunStatus::Running
        )
    }) {
        "目录里仍有运行中的样本，后续分数会继续波动。"
    } else {
        "当前样本已经以终态运行记录为主。"
    };
    let summary = format!(
        "基于最近 {run_count} 次真实运行，{sceneapp_type}场景的执行成功率为 {success_rate:.1}% ，结果产出率为 {artifact_output_rate:.1}% ，重复使用率为 {repeat_use_rate:.1}% 。{failure_sentence}{activity_sentence} 目前更适合{}。",
        recommended_action_label(&recommended_action),
        sceneapp_type = sceneapp_type_label(&descriptor.sceneapp_type),
    );

    let updated_at = runs
        .iter()
        .map(|run| {
            run.finished_at
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(run.started_at.as_str())
                .to_string()
        })
        .max()
        .unwrap_or_else(|| "2026-04-15T00:00:00.000Z".to_string());

    if descriptor.delivery_contract == SceneAppDeliveryContract::ProjectPack {
        let complete_pack_rate = percentage(
            terminal_runs
                .iter()
                .filter(|run| {
                    run.delivery_part_coverage_known
                        && !run.delivery_required_parts.is_empty()
                        && run.delivery_missing_parts.is_empty()
                })
                .count(),
            terminal_runs.len(),
        );
        let review_pass_rate = percentage(
            terminal_runs
                .iter()
                .filter(|run| {
                    matches!(run.status, SceneAppRunStatus::Success)
                        && run.failure_signal.as_deref() != Some("review_blocked")
                        && run.artifact_count > 0
                })
                .count(),
            terminal_runs.len(),
        );
        let publish_conversion_rate = percentage(
            terminal_runs
                .iter()
                .filter(|run| {
                    matches!(run.status, SceneAppRunStatus::Success)
                        && run.artifact_count > 0
                        && run.failure_signal.as_deref() != Some("publish_stalled")
                })
                .count(),
            terminal_runs.len(),
        );
        let pack_recommended_action = if run_count < 2 {
            SceneAppRecommendedAction::Launch
        } else if complete_pack_rate >= 75.0
            && review_pass_rate >= 70.0
            && publish_conversion_rate >= 55.0
        {
            SceneAppRecommendedAction::Keep
        } else if terminal_runs.len() >= 5
            && complete_pack_rate < 25.0
            && publish_conversion_rate < 20.0
        {
            SceneAppRecommendedAction::Retire
        } else {
            SceneAppRecommendedAction::Optimize
        };
        let summary = format!(
            "基于最近 {run_count} 次真实运行，{sceneapp_type}场景的整包交付率为 {complete_pack_rate:.1}% ，复核通过率为 {review_pass_rate:.1}% ，发布转化率为 {publish_conversion_rate:.1}% 。{failure_sentence}{activity_sentence} 目前更适合{}。",
            recommended_action_label(&pack_recommended_action),
            sceneapp_type = sceneapp_type_label(&descriptor.sceneapp_type),
        );
        let metric_keys = descriptor
            .scorecard_profile
            .as_ref()
            .map(|profile| profile.metric_keys.clone())
            .filter(|keys| !keys.is_empty())
            .unwrap_or_else(|| {
                vec![
                    "complete_pack_rate".to_string(),
                    "review_pass_rate".to_string(),
                    "publish_conversion_rate".to_string(),
                ]
            });

        let metrics = metric_keys
            .iter()
            .filter_map(|key| {
                let value = match key.as_str() {
                    "complete_pack_rate" => Some(complete_pack_rate),
                    "review_pass_rate" => Some(review_pass_rate),
                    "publish_conversion_rate" => Some(publish_conversion_rate),
                    "success_rate" | "run_success_rate" => Some(success_rate),
                    "reuse_rate" | "repeat_use_rate" => Some(repeat_use_rate),
                    "artifact_output_rate" => Some(artifact_output_rate),
                    "sample_coverage" => Some(sample_coverage),
                    _ => None,
                }?;
                Some(metric(
                    key,
                    metric_label(key),
                    value,
                    metric_status_for_key(key, value),
                ))
            })
            .collect::<Vec<_>>();

        return SceneAppScorecard {
            sceneapp_id: descriptor.id.clone(),
            updated_at,
            summary,
            metrics,
            recommended_action: pack_recommended_action,
            observed_failure_signals,
            top_failure_signal,
        };
    }

    let requested_metric_keys = descriptor
        .scorecard_profile
        .as_ref()
        .map(|profile| profile.metric_keys.clone())
        .filter(|keys| !keys.is_empty())
        .unwrap_or_else(|| {
            vec![
                "sample_coverage".to_string(),
                "success_rate".to_string(),
                "artifact_output_rate".to_string(),
                "reuse_rate".to_string(),
            ]
        });
    SceneAppScorecard {
        sceneapp_id: descriptor.id.clone(),
        updated_at,
        summary,
        metrics: requested_metric_keys
            .iter()
            .filter_map(|key| {
                let value = match key.as_str() {
                    "sample_coverage" => Some(sample_coverage),
                    "success_rate" | "run_success_rate" => Some(success_rate),
                    "artifact_output_rate" => Some(artifact_output_rate),
                    "reuse_rate" | "repeat_use_rate" => Some(repeat_use_rate),
                    "delivery_readiness" => Some(artifact_output_rate),
                    "reuse_potential" => Some(repeat_use_rate),
                    _ => None,
                }?;
                Some(metric(
                    key,
                    metric_label(key),
                    value,
                    metric_status_for_key(key, value),
                ))
            })
            .collect(),
        recommended_action,
        observed_failure_signals,
        top_failure_signal,
    }
}

pub fn get_sceneapp_scorecard(sceneapp_id: &str) -> Option<SceneAppScorecard> {
    let descriptor = get_sceneapp_descriptor(sceneapp_id)?;
    Some(build_seeded_sceneapp_scorecard(&descriptor))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sceneapp::catalog::get_sceneapp_descriptor;

    fn run(
        run_id: &str,
        status: SceneAppRunStatus,
        artifact_count: usize,
        started_at: &str,
    ) -> SceneAppRunSummary {
        SceneAppRunSummary {
            run_id: run_id.to_string(),
            sceneapp_id: "daily-trend-briefing".to_string(),
            status,
            source: "automation".to_string(),
            source_ref: Some("job-daily-trend".to_string()),
            session_id: None,
            browser_runtime_ref: None,
            service_scene_runtime_ref: None,
            native_skill_runtime_ref: None,
            started_at: started_at.to_string(),
            finished_at: Some(started_at.to_string()),
            artifact_count,
            delivery_artifact_refs: Vec::new(),
            governance_artifact_refs: Vec::new(),
            delivery_required_parts: Vec::new(),
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
        }
    }

    fn project_pack_run(
        run_id: &str,
        status: SceneAppRunStatus,
        completed_parts: &[&str],
        missing_parts: &[&str],
        failure_signal: Option<&str>,
        started_at: &str,
    ) -> SceneAppRunSummary {
        SceneAppRunSummary {
            run_id: run_id.to_string(),
            sceneapp_id: "story-video-suite".to_string(),
            status,
            source: "chat".to_string(),
            source_ref: Some("session-story-video".to_string()),
            session_id: Some("session-story-video".to_string()),
            browser_runtime_ref: None,
            service_scene_runtime_ref: None,
            native_skill_runtime_ref: None,
            started_at: started_at.to_string(),
            finished_at: Some(started_at.to_string()),
            artifact_count: completed_parts.len(),
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
            delivery_completed_parts: completed_parts
                .iter()
                .map(|part| part.to_string())
                .collect(),
            delivery_missing_parts: missing_parts.iter().map(|part| part.to_string()).collect(),
            delivery_completion_rate: Some(percentage(
                completed_parts.len(),
                completed_parts.len() + missing_parts.len(),
            )),
            delivery_part_coverage_known: true,
            failure_signal: failure_signal.map(str::to_string),
            runtime_evidence_used: false,
            evidence_known_gaps: Vec::new(),
            verification_failure_outcomes: Vec::new(),
            request_telemetry_available: None,
            request_telemetry_matched_count: None,
            artifact_validator_applicable: None,
            artifact_validator_issue_count: None,
            artifact_validator_recovered_count: None,
        }
    }

    #[test]
    fn build_sceneapp_scorecard_from_runs_should_keep_stable_scene() {
        let descriptor =
            get_sceneapp_descriptor("daily-trend-briefing").expect("descriptor should exist");
        let scorecard = build_sceneapp_scorecard_from_runs(
            &descriptor,
            &[
                run(
                    "run-1",
                    SceneAppRunStatus::Success,
                    1,
                    "2026-04-15T00:00:00.000Z",
                ),
                run(
                    "run-2",
                    SceneAppRunStatus::Success,
                    1,
                    "2026-04-15T01:00:00.000Z",
                ),
                run(
                    "run-3",
                    SceneAppRunStatus::Success,
                    1,
                    "2026-04-15T02:00:00.000Z",
                ),
                run(
                    "run-4",
                    SceneAppRunStatus::Success,
                    1,
                    "2026-04-15T03:00:00.000Z",
                ),
            ],
        );

        assert_eq!(
            scorecard.recommended_action,
            SceneAppRecommendedAction::Keep
        );
        assert!(scorecard.summary.contains("执行成功率为 100.0%"));
        assert_eq!(scorecard.updated_at, "2026-04-15T03:00:00.000Z");
    }

    #[test]
    fn build_sceneapp_scorecard_from_runs_should_fallback_to_seeded_baseline() {
        let descriptor =
            get_sceneapp_descriptor("story-video-suite").expect("descriptor should exist");
        let scorecard = build_sceneapp_scorecard_from_runs(&descriptor, &[]);

        assert_eq!(
            scorecard.recommended_action,
            SceneAppRecommendedAction::Optimize
        );
        assert!(scorecard.summary.contains("多模态组合场景"));
    }

    #[test]
    fn build_sceneapp_scorecard_from_runs_should_use_project_pack_metrics() {
        let descriptor =
            get_sceneapp_descriptor("story-video-suite").expect("descriptor should exist");
        let scorecard = build_sceneapp_scorecard_from_runs(
            &descriptor,
            &[
                project_pack_run(
                    "run-1",
                    SceneAppRunStatus::Success,
                    &[
                        "brief",
                        "storyboard",
                        "script",
                        "music_refs",
                        "video_draft",
                        "review_note",
                    ],
                    &[],
                    None,
                    "2026-04-15T00:00:00.000Z",
                ),
                project_pack_run(
                    "run-2",
                    SceneAppRunStatus::Success,
                    &["brief", "storyboard", "script", "music_refs", "video_draft"],
                    &["review_note"],
                    Some("review_blocked"),
                    "2026-04-15T01:00:00.000Z",
                ),
            ],
        );

        assert_eq!(
            scorecard.metrics,
            vec![
                metric(
                    "complete_pack_rate",
                    "整包交付率",
                    50.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "review_pass_rate",
                    "复核通过率",
                    50.0,
                    SceneAppMetricStatus::Watch,
                ),
                metric(
                    "publish_conversion_rate",
                    "发布转化率",
                    100.0,
                    SceneAppMetricStatus::Good,
                ),
            ]
        );
        assert_eq!(
            scorecard.recommended_action,
            SceneAppRecommendedAction::Optimize
        );
        assert_eq!(
            scorecard.top_failure_signal.as_deref(),
            Some("review_blocked")
        );
        assert_eq!(
            scorecard.observed_failure_signals,
            vec!["review_blocked".to_string()]
        );
        assert!(scorecard.summary.contains("整包交付率为 50.0%"));
    }

    #[test]
    fn build_sceneapp_scorecard_from_runs_should_retire_poor_scene() {
        let descriptor =
            get_sceneapp_descriptor("x-article-export").expect("descriptor should exist");
        let runs = [
            SceneAppRunSummary {
                run_id: "run-1".to_string(),
                sceneapp_id: descriptor.id.clone(),
                status: SceneAppRunStatus::Error,
                source: "chat".to_string(),
                source_ref: None,
                session_id: Some("session-1".to_string()),
                browser_runtime_ref: None,
                service_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T00:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T00:00:00.000Z".to_string()),
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: Vec::new(),
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
            SceneAppRunSummary {
                run_id: "run-2".to_string(),
                sceneapp_id: descriptor.id.clone(),
                status: SceneAppRunStatus::Timeout,
                source: "chat".to_string(),
                source_ref: None,
                session_id: Some("session-2".to_string()),
                browser_runtime_ref: None,
                service_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T01:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T01:00:00.000Z".to_string()),
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: Vec::new(),
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
            SceneAppRunSummary {
                run_id: "run-3".to_string(),
                sceneapp_id: descriptor.id.clone(),
                status: SceneAppRunStatus::Error,
                source: "chat".to_string(),
                source_ref: None,
                session_id: Some("session-3".to_string()),
                browser_runtime_ref: None,
                service_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T02:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T02:00:00.000Z".to_string()),
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: Vec::new(),
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
            SceneAppRunSummary {
                run_id: "run-4".to_string(),
                sceneapp_id: descriptor.id.clone(),
                status: SceneAppRunStatus::Canceled,
                source: "chat".to_string(),
                source_ref: None,
                session_id: Some("session-4".to_string()),
                browser_runtime_ref: None,
                service_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T03:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T03:00:00.000Z".to_string()),
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: Vec::new(),
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
            SceneAppRunSummary {
                run_id: "run-5".to_string(),
                sceneapp_id: descriptor.id.clone(),
                status: SceneAppRunStatus::Error,
                source: "chat".to_string(),
                source_ref: None,
                session_id: Some("session-5".to_string()),
                browser_runtime_ref: None,
                service_scene_runtime_ref: None,
                native_skill_runtime_ref: None,
                started_at: "2026-04-15T04:00:00.000Z".to_string(),
                finished_at: Some("2026-04-15T04:00:00.000Z".to_string()),
                artifact_count: 0,
                delivery_artifact_refs: Vec::new(),
                governance_artifact_refs: Vec::new(),
                delivery_required_parts: Vec::new(),
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
        ];

        let scorecard = build_sceneapp_scorecard_from_runs(&descriptor, &runs);

        assert_eq!(
            scorecard.recommended_action,
            SceneAppRecommendedAction::Retire
        );
        assert!(scorecard.summary.contains("外部依赖与会话稳定性"));
    }
}
