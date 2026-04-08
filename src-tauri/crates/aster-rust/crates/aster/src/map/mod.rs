//! 代码本体图谱模块
//!

pub mod analyzer;
pub mod call_graph_builder;
pub mod chunked_generator;
pub mod dependency_analyzer;
pub mod enhanced_generator;
pub mod incremental_cache;
pub mod incremental_updater;
pub mod layer_classifier;
pub mod ontology_generator;
pub mod semantic_generator;
pub mod server;
pub mod symbol_reference_analyzer;
pub mod sync_manager;
pub mod type_reference_analyzer;
pub mod types;
pub mod types_chunked;
pub mod types_enhanced;
pub mod view_builder;

#[cfg(test)]
mod tests;

// 基础类型
pub use types::*;

// 增强类型
pub use types_enhanced::*;

// 分块类型
pub use types_chunked::*;

// 分析器
pub use analyzer::{create_analyzer, CodeMapAnalyzer};

// 依赖分析
pub use dependency_analyzer::{analyze_dependencies, DependencyAnalyzer, DependencyStats};

// 调用图
pub use call_graph_builder::{build_call_graph, CallGraphBuilder};

// 增量缓存
pub use incremental_cache::{create_cache, CacheStats, FileCheckResult, IncrementalCache};

// 架构层分类
pub use layer_classifier::{
    classify_module, classify_modules, ClassificationResult, LayerClassifier,
};

// 视图构建
pub use view_builder::{
    build_architecture_layers, build_directory_tree, build_views, count_tree_nodes, get_tree_depth,
    ViewBuilder,
};

// 本体生成
pub use ontology_generator::{generate_and_save_ontology, generate_ontology, OntologyGenerator};

// 增强版生成
pub use enhanced_generator::{
    generate_and_save_enhanced_blueprint, generate_enhanced_blueprint, EnhancedOntologyGenerator,
};

// 分块生成
pub use chunked_generator::ChunkedBlueprintGenerator;

// 增量更新
pub use incremental_updater::{
    update_blueprint, IncrementalBlueprintUpdater, UpdateOptions, UpdateResult,
};

// 双向同步
pub use sync_manager::{
    sync_blueprint_to_code, sync_code_to_blueprint, BlueprintCodeSyncManager, CodeGenerationResult,
    Conflict, ConflictResolution, ConflictType, SyncOptions, SyncResult,
};

// 符号引用分析
pub use symbol_reference_analyzer::{
    analyze_symbol_references, CallType, SymbolReferenceAnalyzer, SymbolReferenceResult,
};

// 类型引用分析
pub use type_reference_analyzer::{
    analyze_type_references, analyze_type_usages, TypeReferenceAnalyzer, TypeUsage,
    TypeUsageAnalyzer, TypeUsageKind, TypeUsageLocation,
};

// AI 语义生成
pub use semantic_generator::{
    batch_generate_semantics, generate_module_semantic, generate_project_semantic,
    SemanticGenerator, SemanticGeneratorOptions,
};

// 可视化服务器
pub use server::{
    start_visualization_server,
    ArchitectureMap,
    BeginnerGuide,
    BusinessStory,
    CallerInfo,
    CodeReadingGuide,
    CodeSnippet,
    DependencyTreeNode,
    EntryPointsResponse,
    FileImportance,
    Flowchart,
    FlowchartEdge,
    FlowchartEdgeType,
    FlowchartNode,
    FlowchartNodeType,
    GuideCard,
    GuideCardFile,
    KnowledgeSnapshot,
    KnowledgeSnapshotSummary,
    LineLocation,
    LineRange,
    LogicBlock,
    LogicBlockType,
    // 服务器类型
    ModuleDetailInfo,
    ModuleSymbols,
    ReadingDifficulty,
    ReadingPath,
    ReadingStep,
    ScenarioInfo,
    SearchResponse,
    SearchResultItem,
    StoryChapter,
    StoryGuide,
    StoryKeyFile,
    SymbolInfo,
    SymbolLocation,
    SymbolRefInfo,
    TypeRefInfo,
    VisualizationServer,
    VisualizationServerOptions,
};
