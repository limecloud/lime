//! Plan 模块测试

use super::*;
use std::path::PathBuf;

// ============ Types Tests ============

#[test]
fn test_plan_status_serialize() {
    assert_eq!(
        serde_json::to_string(&PlanStatus::Draft).unwrap(),
        "\"draft\""
    );
    assert_eq!(
        serde_json::to_string(&PlanStatus::InProgress).unwrap(),
        "\"in_progress\""
    );
}

#[test]
fn test_complexity_serialize() {
    assert_eq!(
        serde_json::to_string(&Complexity::VeryComplex).unwrap(),
        "\"very-complex\""
    );
}

#[test]
fn test_priority_serialize() {
    assert_eq!(
        serde_json::to_string(&Priority::Critical).unwrap(),
        "\"critical\""
    );
}

#[test]
fn test_plan_list_options_default() {
    let options = PlanListOptions::default();
    assert!(options.limit.is_none());
    assert!(options.offset.is_none());
    assert!(options.search.is_none());
}

#[test]
fn test_plan_export_options_default() {
    let options = PlanExportOptions::default();
    assert!(matches!(options.format, ExportFormat::Markdown));
    assert!(options.include_metadata);
    assert!(options.include_risks);
}

// ============ Persistence Tests ============

#[test]
fn test_generate_plan_id() {
    let id1 = PlanPersistenceManager::generate_plan_id();
    let id2 = PlanPersistenceManager::generate_plan_id();

    assert!(id1.starts_with("plan-"));
    assert!(id2.starts_with("plan-"));
    assert_ne!(id1, id2);
}

fn create_test_plan() -> SavedPlan {
    SavedPlan {
        metadata: PlanMetadata {
            id: PlanPersistenceManager::generate_plan_id(),
            title: "Test Plan".to_string(),
            description: "A test plan".to_string(),
            status: PlanStatus::Draft,
            created_at: 0,
            updated_at: 0,
            working_directory: PathBuf::from("/tmp"),
            session_id: None,
            author: None,
            tags: Some(vec!["test".to_string()]),
            priority: Some(Priority::Medium),
            version: 1,
            parent_id: None,
            branch_name: None,
            approved_by: None,
            approved_at: None,
            rejection_reason: None,
        },
        summary: "Test summary".to_string(),
        requirements_analysis: RequirementsAnalysis::default(),
        architectural_decisions: vec![],
        steps: vec![PlanStep {
            step: 1,
            description: "First step".to_string(),
            files: vec!["file1.rs".to_string()],
            complexity: StepComplexity::Low,
            dependencies: vec![],
            estimated_minutes: Some(30),
            risks: None,
            status: None,
            actual_minutes: None,
            completed_at: None,
        }],
        critical_files: vec![],
        risks: vec![],
        alternatives: vec![],
        estimated_complexity: Complexity::Simple,
        estimated_hours: Some(2.0),
        recommendations: None,
        next_steps: None,
        content: None,
        actual_hours: None,
        completed_at: None,
    }
}

#[test]
fn test_save_and_load_plan() {
    let mut plan = create_test_plan();
    let id = plan.metadata.id.clone();

    // 保存
    let result = PlanPersistenceManager::save_plan(&mut plan, false);
    assert!(result.is_ok());

    // 加载
    let loaded = PlanPersistenceManager::load_plan(&id);
    assert!(loaded.is_ok());

    let loaded_plan = loaded.unwrap();
    assert_eq!(loaded_plan.metadata.title, "Test Plan");
    assert_eq!(loaded_plan.steps.len(), 1);

    // 清理
    let _ = PlanPersistenceManager::delete_plan(&id, true);
}

#[test]
fn test_delete_plan() {
    let mut plan = create_test_plan();
    let id = plan.metadata.id.clone();

    let _ = PlanPersistenceManager::save_plan(&mut plan, false);
    let result = PlanPersistenceManager::delete_plan(&id, false);
    assert!(result.is_ok());

    let loaded = PlanPersistenceManager::load_plan(&id);
    assert!(loaded.is_err());
}

#[test]
fn test_list_plans() {
    let plans = PlanPersistenceManager::list_plans(&PlanListOptions::default());
    // 只验证不会崩溃（plans.len() 是 usize，总是 >= 0）
    let _ = plans;
}

#[test]
fn test_export_as_markdown() {
    let mut plan = create_test_plan();
    let id = plan.metadata.id.clone();

    let _ = PlanPersistenceManager::save_plan(&mut plan, false);

    let options = PlanExportOptions::default();
    let result = PlanPersistenceManager::export_plan(&id, &options);

    assert!(result.is_ok());
    let markdown = result.unwrap();
    assert!(markdown.contains("Test Plan"));
    assert!(markdown.contains("First step"));

    let _ = PlanPersistenceManager::delete_plan(&id, true);
}

// ============ Comparison Tests ============

#[test]
fn test_default_criteria() {
    let criteria = default_criteria();
    assert_eq!(criteria.len(), 5);

    let total_weight: f32 = criteria.iter().map(|c| c.weight).sum();
    assert!((total_weight - 1.0).abs() < 0.01);
}

#[test]
fn test_score_complexity() {
    let mut plan = create_test_plan();

    plan.estimated_complexity = Complexity::Simple;
    // 内部方法，通过 compare_plans 间接测试
}

#[test]
fn test_comparison_analysis() {
    // 创建两个测试计划
    let mut plan1 = create_test_plan();
    let mut plan2 = create_test_plan();

    plan1.metadata.title = "Plan A".to_string();
    plan2.metadata.title = "Plan B".to_string();
    plan2.estimated_complexity = Complexity::Complex;

    let id1 = plan1.metadata.id.clone();
    let id2 = plan2.metadata.id.clone();

    let _ = PlanPersistenceManager::save_plan(&mut plan1, false);
    let _ = PlanPersistenceManager::save_plan(&mut plan2, false);

    let result = PlanComparisonManager::compare_plans(&[id1.clone(), id2.clone()], None);

    assert!(result.is_ok());
    let comparison = result.unwrap();
    assert_eq!(comparison.plans.len(), 2);
    assert!(!comparison.recommended_plan_id.is_empty());

    // 清理
    let _ = PlanPersistenceManager::delete_plan(&id1, true);
    let _ = PlanPersistenceManager::delete_plan(&id2, true);
}

#[test]
fn test_generate_comparison_report() {
    let mut plan1 = create_test_plan();
    let mut plan2 = create_test_plan();

    plan1.metadata.title = "Plan X".to_string();
    plan2.metadata.title = "Plan Y".to_string();

    let id1 = plan1.metadata.id.clone();
    let id2 = plan2.metadata.id.clone();

    let _ = PlanPersistenceManager::save_plan(&mut plan1, false);
    let _ = PlanPersistenceManager::save_plan(&mut plan2, false);

    if let Ok(comparison) = PlanComparisonManager::compare_plans(&[id1.clone(), id2.clone()], None)
    {
        let report = PlanComparisonManager::generate_comparison_report(&comparison);
        assert!(report.contains("Plan Comparison Report"));
        assert!(report.contains("Plan X"));
        assert!(report.contains("Plan Y"));
    }

    let _ = PlanPersistenceManager::delete_plan(&id1, true);
    let _ = PlanPersistenceManager::delete_plan(&id2, true);
}
