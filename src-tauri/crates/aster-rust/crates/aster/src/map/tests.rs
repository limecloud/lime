//! map 模块测试

use super::*;

#[test]
fn test_location_info_default() {
    let loc = LocationInfo::default();
    assert_eq!(loc.start_line, 0);
    assert_eq!(loc.file, "");
}

#[test]
fn test_project_info() {
    let info = ProjectInfo {
        name: "test-project".to_string(),
        root_path: "/tmp/test".to_string(),
        languages: vec!["rust".to_string()],
        file_count: 10,
        total_lines: 1000,
    };
    assert_eq!(info.name, "test-project");
    assert_eq!(info.file_count, 10);
}

#[test]
fn test_export_type_serialize() {
    let export = ExportInfo {
        name: "foo".to_string(),
        export_type: ExportType::Named,
        original_name: None,
        source: None,
        location: LocationInfo::default(),
    };
    let json = serde_json::to_string(&export).unwrap();
    assert!(json.contains("named"));
}

#[test]
fn test_visibility_default() {
    let vis = Visibility::default();
    assert_eq!(vis, Visibility::Public);
}

#[test]
fn test_variable_kind_serialize() {
    let kind = VariableKind::Const;
    let json = serde_json::to_string(&kind).unwrap();
    assert_eq!(json, "\"const\"");
}

#[test]
fn test_call_type_serialize() {
    let ct = CallType::Method;
    let json = serde_json::to_string(&ct).unwrap();
    assert_eq!(json, "\"method\"");
}

#[test]
fn test_dependency_type() {
    let dt = DependencyType::Import;
    let json = serde_json::to_string(&dt).unwrap();
    assert_eq!(json, "\"import\"");
}

#[test]
fn test_analysis_phase() {
    let phase = AnalysisPhase::Parse;
    let json = serde_json::to_string(&phase).unwrap();
    assert_eq!(json, "\"parse\"");
}

#[test]
fn test_generate_options_default() {
    let opts = GenerateOptions::default();
    assert!(!opts.incremental);
    assert!(!opts.use_lsp);
    assert!(opts.include.is_none());
}

#[test]
fn test_ontology_statistics_default() {
    let stats = OntologyStatistics::default();
    assert_eq!(stats.total_modules, 0);
    assert_eq!(stats.total_functions, 0);
    assert!(stats.language_breakdown.is_empty());
}

#[test]
fn test_call_graph_default() {
    let cg = CallGraph::default();
    assert!(cg.nodes.is_empty());
    assert!(cg.edges.is_empty());
}

#[test]
fn test_dependency_graph_default() {
    let dg = DependencyGraph::default();
    assert!(dg.edges.is_empty());
}

#[test]
fn test_analyzer_new() {
    let analyzer = CodeMapAnalyzer::new("/tmp/test");
    let files = analyzer.discover_files();
    // 空目录应该返回空列表
    let _ = files; // 只验证函数能运行
}

#[test]
fn test_create_analyzer() {
    let analyzer = create_analyzer("/tmp");
    let _ = analyzer.discover_files(); // 只验证函数能运行
}

// ============================================================================
// types_enhanced 测试
// ============================================================================

#[test]
fn test_architecture_layer_serialize() {
    let layer = super::types_enhanced::ArchitectureLayer::Business;
    let json = serde_json::to_string(&layer).unwrap();
    assert_eq!(json, "\"business\"");
}

#[test]
fn test_directory_node_type() {
    let node = super::types_enhanced::DirectoryNode {
        name: "src".to_string(),
        path: "src".to_string(),
        node_type: super::types_enhanced::DirectoryNodeType::Directory,
        description: None,
        purpose: None,
        module_id: None,
        children: Some(Vec::new()),
    };
    assert_eq!(
        node.node_type,
        super::types_enhanced::DirectoryNodeType::Directory
    );
}

#[test]
fn test_architecture_layers_default() {
    let layers = super::types_enhanced::ArchitectureLayers::default();
    assert!(layers.presentation.modules.is_empty());
    assert!(layers.business.modules.is_empty());
}

#[test]
fn test_symbol_kind_serialize() {
    let kind = super::types_enhanced::SymbolKind::Function;
    let json = serde_json::to_string(&kind).unwrap();
    assert_eq!(json, "\"function\"");
}

#[test]
fn test_type_ref_kind() {
    let kind = super::types_enhanced::TypeRefKind::Extends;
    let json = serde_json::to_string(&kind).unwrap();
    assert_eq!(json, "\"extends\"");
}

#[test]
fn test_references_default() {
    let refs = super::types_enhanced::References::default();
    assert!(refs.module_deps.is_empty());
    assert!(refs.symbol_calls.is_empty());
    assert!(refs.type_refs.is_empty());
}

// ============================================================================
// dependency_analyzer 测试
// ============================================================================

#[test]
fn test_dependency_analyzer_new() {
    let mut analyzer = super::dependency_analyzer::DependencyAnalyzer::new();
    let graph = analyzer.analyze_dependencies(&[]);
    assert!(graph.edges.is_empty());
}

#[test]
fn test_analyze_dependencies_empty() {
    let graph = super::dependency_analyzer::analyze_dependencies(&[]);
    assert!(graph.edges.is_empty());
}

// ============================================================================
// call_graph_builder 测试
// ============================================================================

#[test]
fn test_call_graph_builder_new() {
    let mut builder = super::call_graph_builder::CallGraphBuilder::new();
    let graph = builder.build_call_graph(&[]);
    assert!(graph.nodes.is_empty());
    assert!(graph.edges.is_empty());
}

#[test]
fn test_build_call_graph_empty() {
    let graph = super::call_graph_builder::build_call_graph(&[]);
    assert!(graph.nodes.is_empty());
}

// ============================================================================
// incremental_cache 测试
// ============================================================================

#[test]
fn test_incremental_cache_new() {
    let cache = super::incremental_cache::IncrementalCache::new("/tmp/test");
    let stats = cache.get_stats();
    assert_eq!(stats.entry_count, 0);
}

#[test]
fn test_create_cache() {
    let cache = super::incremental_cache::create_cache("/tmp");
    assert_eq!(cache.get_stats().entry_count, 0);
}

// ============================================================================
// layer_classifier 测试
// ============================================================================

#[test]
fn test_layer_classifier_new() {
    let classifier = super::layer_classifier::LayerClassifier::new();
    let module = super::types::ModuleNode {
        id: "src/ui/button.tsx".to_string(),
        name: "button.tsx".to_string(),
        path: "/test/src/ui/button.tsx".to_string(),
        language: "typescript".to_string(),
        lines: 100,
        size: 2000,
        imports: Vec::new(),
        exports: Vec::new(),
        classes: Vec::new(),
        interfaces: Vec::new(),
        types: Vec::new(),
        enums: Vec::new(),
        functions: Vec::new(),
        variables: Vec::new(),
    };
    let result = classifier.classify(&module);
    assert_eq!(
        result.layer,
        super::types_enhanced::ArchitectureLayer::Presentation
    );
}

#[test]
fn test_classify_module() {
    let module = super::types::ModuleNode {
        id: "src/services/auth.ts".to_string(),
        name: "auth.ts".to_string(),
        path: "/test/src/services/auth.ts".to_string(),
        language: "typescript".to_string(),
        lines: 50,
        size: 1000,
        imports: Vec::new(),
        exports: Vec::new(),
        classes: Vec::new(),
        interfaces: Vec::new(),
        types: Vec::new(),
        enums: Vec::new(),
        functions: Vec::new(),
        variables: Vec::new(),
    };
    let result = super::layer_classifier::classify_module(&module);
    assert_eq!(
        result.layer,
        super::types_enhanced::ArchitectureLayer::Business
    );
}

#[test]
fn test_get_layer_description() {
    let desc = super::layer_classifier::LayerClassifier::get_layer_description(
        super::types_enhanced::ArchitectureLayer::Data,
    );
    assert!(desc.contains("数据层"));
}

// ============================================================================
// view_builder 测试
// ============================================================================

#[test]
fn test_view_builder_new() {
    let builder = super::view_builder::ViewBuilder::new();
    let views = builder.build_views(&[]);
    assert!(views.architecture_layers.presentation.modules.is_empty());
}

#[test]
fn test_build_views_empty() {
    let views = super::view_builder::build_views(&[]);
    assert!(views.architecture_layers.business.modules.is_empty());
}

#[test]
fn test_count_tree_nodes() {
    let node = super::types_enhanced::DirectoryNode {
        name: "root".to_string(),
        path: "root".to_string(),
        node_type: super::types_enhanced::DirectoryNodeType::Directory,
        description: None,
        purpose: None,
        module_id: None,
        children: Some(vec![super::types_enhanced::DirectoryNode {
            name: "file.ts".to_string(),
            path: "root/file.ts".to_string(),
            node_type: super::types_enhanced::DirectoryNodeType::File,
            description: None,
            purpose: None,
            module_id: Some("root/file.ts".to_string()),
            children: None,
        }]),
    };
    let (dirs, files) = super::view_builder::count_tree_nodes(&node);
    assert_eq!(dirs, 1);
    assert_eq!(files, 1);
}

#[test]
fn test_get_tree_depth() {
    let node = super::types_enhanced::DirectoryNode {
        name: "root".to_string(),
        path: "root".to_string(),
        node_type: super::types_enhanced::DirectoryNodeType::Directory,
        description: None,
        purpose: None,
        module_id: None,
        children: None,
    };
    let depth = super::view_builder::get_tree_depth(&node);
    assert_eq!(depth, 0);
}

// ============================================================================
// ontology_generator 测试
// ============================================================================

#[test]
fn test_ontology_generator() {
    let ontology = super::ontology_generator::generate_ontology("/tmp/nonexistent", None);
    assert_eq!(ontology.version, "1.0.0");
    assert!(ontology.modules.is_empty());
}

// ============================================================================
// enhanced_generator 测试
// ============================================================================

#[test]
fn test_enhanced_generator() {
    let blueprint =
        super::enhanced_generator::generate_enhanced_blueprint("/tmp/nonexistent", None);
    assert_eq!(blueprint.format, "enhanced");
    assert!(blueprint.modules.is_empty());
}
