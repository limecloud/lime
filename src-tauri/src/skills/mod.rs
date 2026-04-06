//! Skills 集成模块
//!
//! 纯逻辑已迁移到 `lime-skills` crate，
//! workflow 执行主链已继续下沉到 `lime-agent`，
//! 本模块只保留 Tauri 适配与兼容导出层。

mod catalog;
mod default_skills;
mod execution;
mod execution_callback;
mod llm_provider;
mod runtime;
mod social_post;

pub use catalog::{
    get_skill_detail_info, list_executable_skill_catalog, load_executable_skill_definition,
    ExecutableSkillInfo, SkillDetailInfo, WorkflowStepInfo,
};
pub use execution::{
    execute_named_skill, execute_skill_definition, execute_skill_prompt, execute_skill_workflow,
    SkillExecutionImageInput, SkillExecutionRequest, SkillExecutionResult, StepResult,
};
pub use runtime::{
    build_skill_run_finish_decision, build_skill_run_start_metadata, prepare_skill_execution,
    PreparedSkillExecution, SkillProviderSelection,
};
pub use social_post::infer_general_workbench_gate_key;
// Tauri 实现（留在主 crate）
pub use default_skills::ensure_default_local_skills;
pub use execution_callback::TauriExecutionCallback;

// 兼容导出（实际实现位于 lime-skills crate）
pub use llm_provider::LimeLlmProvider;
