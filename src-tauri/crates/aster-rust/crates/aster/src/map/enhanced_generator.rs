//! 增强版本体生成器
//!
//! 生成带有视图、引用关系和语义信息的增强版代码蓝图

use std::collections::HashMap;
use std::path::Path;

use super::analyzer::CodeMapAnalyzer;
use super::call_graph_builder::build_call_graph;
use super::dependency_analyzer::analyze_dependencies;
use super::layer_classifier::LayerClassifier;
use super::types::{CallGraph, DependencyGraph, FileStat, GenerateOptions, ModuleNode};
use super::types_enhanced::*;
use super::view_builder::ViewBuilder;

/// 增强版本体生成器
pub struct EnhancedOntologyGenerator {
    root_path: String,
    options: EnhancedGenerateOptions,
}

impl EnhancedOntologyGenerator {
    pub fn new(root_path: impl AsRef<Path>, options: Option<EnhancedGenerateOptions>) -> Self {
        Self {
            root_path: root_path.as_ref().to_string_lossy().to_string(),
            options: options.unwrap_or_default(),
        }
    }

    /// 生成增强版代码蓝图
    pub fn generate(&self) -> EnhancedCodeBlueprint {
        let gen_opts = GenerateOptions {
            include: self.options.include.clone(),
            exclude: self.options.exclude.clone(),
            concurrency: self.options.concurrency,
            ..Default::default()
        };

        let analyzer = CodeMapAnalyzer::from_options(&self.root_path, &gen_opts);
        let modules = analyzer.analyze_files(None);

        let call_graph = build_call_graph(&modules);
        let dep_graph = analyze_dependencies(&modules);

        let view_builder = ViewBuilder::new();
        let views = view_builder.build_views(&modules);

        let (enhanced_modules, symbols) = self.build_enhanced_modules(&modules);
        let references = self.build_references(&modules, &call_graph, &dep_graph);
        let statistics = self.compute_statistics(&modules, &symbols, &references);

        EnhancedCodeBlueprint {
            format: "enhanced".to_string(),
            meta: BlueprintMeta {
                version: "2.0.0".to_string(),
                generated_at: chrono::Utc::now().to_rfc3339(),
                generator_version: env!("CARGO_PKG_VERSION").to_string(),
                semantic_version: None,
            },
            project: EnhancedProjectInfo {
                name: Path::new(&self.root_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                root_path: self.root_path.clone(),
                semantic: None,
                languages: self.collect_languages(&modules),
                technologies: None,
            },
            views,
            modules: enhanced_modules,
            symbols,
            references,
            statistics,
        }
    }

    fn collect_languages(&self, modules: &[ModuleNode]) -> Vec<String> {
        let mut langs: std::collections::HashSet<String> = std::collections::HashSet::new();
        for m in modules {
            langs.insert(m.language.clone());
        }
        langs.into_iter().collect()
    }

    fn build_enhanced_modules(
        &self,
        modules: &[ModuleNode],
    ) -> (
        HashMap<String, EnhancedModule>,
        HashMap<String, SymbolEntry>,
    ) {
        let mut enhanced = HashMap::new();
        let mut symbols = HashMap::new();
        let classifier = LayerClassifier::new();

        for module in modules {
            let classification = classifier.classify(module);

            // 收集导出符号
            let mut exports = Vec::new();
            for func in &module.functions {
                if func.is_exported {
                    exports.push(func.id.clone());
                    symbols.insert(
                        func.id.clone(),
                        SymbolEntry {
                            id: func.id.clone(),
                            name: func.name.clone(),
                            kind: SymbolKind::Function,
                            module_id: module.id.clone(),
                            location: func.location.clone(),
                            signature: Some(func.signature.clone()),
                            semantic: None,
                            children: None,
                            parent: None,
                        },
                    );
                }
            }

            for cls in &module.classes {
                if cls.is_exported {
                    exports.push(cls.id.clone());
                    let children: Vec<String> = cls.methods.iter().map(|m| m.id.clone()).collect();
                    symbols.insert(
                        cls.id.clone(),
                        SymbolEntry {
                            id: cls.id.clone(),
                            name: cls.name.clone(),
                            kind: SymbolKind::Class,
                            module_id: module.id.clone(),
                            location: cls.location.clone(),
                            signature: None,
                            semantic: None,
                            children: Some(children),
                            parent: None,
                        },
                    );

                    for method in &cls.methods {
                        symbols.insert(
                            method.id.clone(),
                            SymbolEntry {
                                id: method.id.clone(),
                                name: method.name.clone(),
                                kind: SymbolKind::Method,
                                module_id: module.id.clone(),
                                location: method.location.clone(),
                                signature: Some(method.signature.clone()),
                                semantic: None,
                                children: None,
                                parent: Some(cls.id.clone()),
                            },
                        );
                    }
                }
            }

            // 构建导入
            let imports: Vec<ModuleImport> = module
                .imports
                .iter()
                .map(|imp| ModuleImport {
                    source: imp.source.clone(),
                    symbols: imp.symbols.clone(),
                    is_external: !imp.source.starts_with('.') && !imp.source.starts_with('/'),
                    is_type_only: Some(imp.symbols.iter().any(|s| s.starts_with("type "))),
                })
                .collect();

            enhanced.insert(
                module.id.clone(),
                EnhancedModule {
                    id: module.id.clone(),
                    name: module.name.clone(),
                    path: module.path.clone(),
                    language: module.language.clone(),
                    lines: module.lines,
                    size: module.size,
                    semantic: Some(SemanticInfo {
                        description: String::new(),
                        responsibility: String::new(),
                        business_domain: None,
                        architecture_layer: classification.layer,
                        tags: Vec::new(),
                        confidence: classification.confidence,
                        generated_at: chrono::Utc::now().to_rfc3339(),
                    }),
                    exports,
                    imports,
                },
            );
        }

        (enhanced, symbols)
    }

    fn build_references(
        &self,
        _modules: &[ModuleNode],
        call_graph: &CallGraph,
        dep_graph: &DependencyGraph,
    ) -> References {
        let module_deps: Vec<ModuleDependency> = dep_graph
            .edges
            .iter()
            .map(|e| ModuleDependency {
                source: e.source.clone(),
                target: e.target.clone(),
                dep_type: format!("{:?}", e.edge_type).to_lowercase(),
                symbols: e.symbols.clone(),
                is_type_only: e.is_type_only,
            })
            .collect();

        let symbol_calls: Vec<SymbolCall> = call_graph
            .edges
            .iter()
            .map(|e| SymbolCall {
                caller: e.source.clone(),
                callee: e.target.clone(),
                call_type: format!("{:?}", e.edge_type).to_lowercase(),
                locations: e.locations.clone(),
            })
            .collect();

        References {
            module_deps,
            symbol_calls,
            type_refs: Vec::new(),
        }
    }

    fn compute_statistics(
        &self,
        modules: &[ModuleNode],
        symbols: &HashMap<String, SymbolEntry>,
        references: &References,
    ) -> EnhancedStatistics {
        let mut layer_dist: HashMap<String, usize> = HashMap::new();
        let mut lang_breakdown: HashMap<String, usize> = HashMap::new();
        let classifier = LayerClassifier::new();

        for module in modules {
            let result = classifier.classify(module);
            let layer_name = format!("{:?}", result.layer).to_lowercase();
            *layer_dist.entry(layer_name).or_insert(0) += 1;
            *lang_breakdown.entry(module.language.clone()).or_insert(0) += 1;
        }

        let mut largest: Vec<_> = modules
            .iter()
            .map(|m| FileStat {
                path: m.id.clone(),
                lines: m.lines,
                size: m.size,
            })
            .collect();
        largest.sort_by(|a, b| b.lines.cmp(&a.lines));

        EnhancedStatistics {
            total_modules: modules.len(),
            total_symbols: symbols.len(),
            total_lines: modules.iter().map(|m| m.lines).sum(),
            semantic_coverage: SemanticCoverage::default(),
            reference_stats: ReferenceStats {
                total_module_deps: references.module_deps.len(),
                total_symbol_calls: references.symbol_calls.len(),
                total_type_refs: references.type_refs.len(),
            },
            layer_distribution: layer_dist,
            language_breakdown: lang_breakdown,
            largest_files: largest.into_iter().take(10).collect(),
            most_called_symbols: Vec::new(),
            most_imported_modules: Vec::new(),
        }
    }
}

/// 便捷函数：生成增强版蓝图
pub fn generate_enhanced_blueprint(
    root_path: impl AsRef<Path>,
    options: Option<EnhancedGenerateOptions>,
) -> EnhancedCodeBlueprint {
    EnhancedOntologyGenerator::new(root_path, options).generate()
}

/// 生成并保存增强版蓝图
pub fn generate_and_save_enhanced_blueprint(
    root_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    options: Option<EnhancedGenerateOptions>,
) -> std::io::Result<EnhancedCodeBlueprint> {
    let blueprint = generate_enhanced_blueprint(root_path, options);
    let json = serde_json::to_string_pretty(&blueprint)?;
    std::fs::write(output_path, json)?;
    Ok(blueprint)
}
