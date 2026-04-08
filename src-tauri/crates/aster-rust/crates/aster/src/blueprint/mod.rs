//! 蓝图系统模块
//!
//!
//! 提供：
//! 1. 蓝图设计和管理 (BlueprintManager)
//! 2. 任务树生成和执行 (TaskTreeManager)
//! 3. TDD 驱动的开发循环 (TddExecutor)
//! 4. 主/子 Agent 协调（蜂王-蜜蜂模型）(AgentCoordinator)
//! 5. 检查点和时光倒流 (TimeTravelManager)
//! 6. 边界检查器 (BoundaryChecker)
//!
//! ## 核心概念
//!
//! - **Blueprint（蓝图）**：需求调研后形成的目标业务流程、功能边界和系统架构草图
//! - **TaskTree（任务树）**：由蓝图推导出的层级化任务结构
//! - **TDD Loop**：每个 Agent 都在 任务→测试→编码→验证 的循环中
//! - **Checkpoint（检查点）**：支持时光倒流的快照系统
//!
//! ## 使用示例
//!
//! ```rust,ignore
//! use aster::blueprint::{BlueprintManager, TaskTreeManager, Blueprint};
//!
//! // 创建蓝图管理器
//! let bp_manager = BlueprintManager::default();
//!
//! // 创建蓝图
//! let blueprint = bp_manager.create_blueprint(
//!     "我的项目".to_string(),
//!     "项目描述".to_string(),
//! ).await?;
//!
//! // 生成任务树
//! let tree_manager = TaskTreeManager::default();
//! let task_tree = tree_manager.generate_from_blueprint(&blueprint).await?;
//! ```

pub mod acceptance_test_generator;
pub mod acceptance_test_runner;
pub mod agent_coordinator;
pub mod blueprint_context;
pub mod blueprint_manager;
pub mod boundary_checker;
pub mod codebase_analyzer;
pub mod requirement_dialog;
pub mod task_granularity;
pub mod task_tree_manager;
pub mod tdd_executor;
pub mod time_travel;
pub mod types;
pub mod worker_executor;
pub mod worker_sandbox;

#[cfg(test)]
mod tests;

// 类型导出
pub use types::*;

// 蓝图管理
pub use blueprint_manager::{generate_blueprint_summary, BlueprintManager};

// 任务树管理
pub use task_tree_manager::TaskTreeManager;

// TDD 执行器
pub use tdd_executor::{TddConfig, TddExecutor, TddLoopState, TddPrompts};

// 时光倒流
pub use time_travel::{
    BranchInfo, BranchStatus, CheckpointInfo, CheckpointType, CompareResult, TimeTravelManager,
    TimelineView,
};

// 边界检查器
pub use boundary_checker::{
    create_boundary_checker, BoundaryCheckResult, BoundaryChecker, BoundaryCheckerConfig,
    ViolationType,
};

// Agent 协调器
pub use agent_coordinator::{AgentCoordinator, CoordinatorConfig, ModelStrategy};

// Worker 执行器
pub use worker_executor::{
    create_worker_executor, CodeArtifactOutput, ExecutionContext, PhaseResult, TestFramework,
    WorkerExecutor, WorkerExecutorConfig,
};

// Worker 沙箱
pub use worker_sandbox::{
    create_lock_manager, create_worker_sandbox, FileLockManager, LockInfo, SandboxConfig,
    SandboxStats, SyncResult, WorkerSandbox,
};

// 验收测试生成器
pub use acceptance_test_generator::{
    create_acceptance_test_generator, AcceptanceTestContext, AcceptanceTestGenerator,
    AcceptanceTestGeneratorConfig, AcceptanceTestResult,
};

// 任务粒度控制器
pub use task_granularity::{
    create_task_granularity_controller, AdjustmentResult, ComplexityFactors, ComplexityScore,
    ComplexityWeights, GranularityConfig, MergeCheck, MergeStrategy, MergeSuggestion, SplitCheck,
    SplitStrategy, SplitSuggestion, TaskGranularityController,
};

// 验收测试运行器
pub use acceptance_test_runner::{
    create_acceptance_test_runner, AcceptanceTestRunResult, AcceptanceTestRunner,
    AcceptanceTestRunnerConfig,
};

// 蓝图上下文（工具层面的边界检查桥梁）
pub use blueprint_context::{
    check_file_operation, clear_active_task, clear_blueprint, enforce_file_operation,
    get_blueprint_context, set_active_task, set_blueprint, ActiveTaskContext,
    BlueprintContextManager, BlueprintContextStatus, FileOperation,
};

// 代码库分析器
pub use codebase_analyzer::{
    create_codebase_analyzer, quick_analyze, AIAnalysisResult, AIModuleAnalysis,
    AnalysisGranularity, AnalyzeResult, AnalyzerConfig, AnalyzerEvent, BusinessFlowInfo,
    CodebaseAnalyzer, CodebaseInfo, CodebaseStats, DetectedModule, DetectedModuleType,
    DirectoryNode, NodeType,
};

// 需求对话流程
pub use requirement_dialog::{
    create_requirement_dialog_manager, BusinessProcessDraft, DialogEvent, DialogMessage,
    DialogPhase, DialogState, MessageRole, ModuleDraftType, NFRDraft, NFRDraftCategory,
    NFRDraftPriority, ProcessDraftType, RequirementDialogManager, SystemModuleDraft,
};
