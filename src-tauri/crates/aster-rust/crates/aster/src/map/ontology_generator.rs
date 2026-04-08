//! 本体生成器
//!
//! 生成完整的代码本体图谱

use std::path::Path;

use super::analyzer::CodeMapAnalyzer;
use super::call_graph_builder::build_call_graph;
use super::dependency_analyzer::analyze_dependencies;
use super::types::*;

/// 本体生成器
pub struct OntologyGenerator {
    root_path: String,
    options: GenerateOptions,
}

impl OntologyGenerator {
    pub fn new(root_path: impl AsRef<Path>, options: Option<GenerateOptions>) -> Self {
        Self {
            root_path: root_path.as_ref().to_string_lossy().to_string(),
            options: options.unwrap_or_default(),
        }
    }

    /// 生成代码本体
    pub fn generate(&self) -> CodeOntology {
        let analyzer = CodeMapAnalyzer::from_options(&self.root_path, &self.options);
        let modules = analyzer.analyze_files(None);

        let call_graph = build_call_graph(&modules);
        let dependency_graph = analyze_dependencies(&modules);
        let statistics = self.compute_statistics(&modules, &call_graph, &dependency_graph);

        CodeOntology {
            version: "1.0.0".to_string(),
            generated_at: chrono::Utc::now().to_rfc3339(),
            project: ProjectInfo {
                name: Path::new(&self.root_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                root_path: self.root_path.clone(),
                languages: self.collect_languages(&modules),
                file_count: modules.len(),
                total_lines: modules.iter().map(|m| m.lines).sum(),
            },
            modules,
            call_graph,
            dependency_graph,
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

    fn compute_statistics(
        &self,
        modules: &[ModuleNode],
        call_graph: &CallGraph,
        dep_graph: &DependencyGraph,
    ) -> OntologyStatistics {
        let mut stats = OntologyStatistics::default();
        let mut lang_breakdown: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        for module in modules {
            stats.total_modules += 1;
            stats.total_functions += module.functions.len();
            stats.total_classes += module.classes.len();
            stats.total_interfaces += module.interfaces.len();
            stats.total_variables += module.variables.len();
            stats.total_lines += module.lines;

            *lang_breakdown.entry(module.language.clone()).or_insert(0) += 1;

            for cls in &module.classes {
                stats.total_methods += cls.methods.len();
            }
        }

        stats.total_call_edges = call_graph.edges.len();
        stats.total_dependency_edges = dep_graph.edges.len();
        stats.language_breakdown = lang_breakdown;

        // 最大文件
        let mut files: Vec<_> = modules
            .iter()
            .map(|m| FileStat {
                path: m.id.clone(),
                lines: m.lines,
                size: m.size,
            })
            .collect();
        files.sort_by(|a, b| b.lines.cmp(&a.lines));
        stats.largest_files = files.into_iter().take(10).collect();

        // 被调用最多的函数
        let mut call_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for edge in &call_graph.edges {
            *call_counts.entry(edge.target.clone()).or_insert(0) += edge.count;
        }
        let mut most_called: Vec<_> = call_counts
            .into_iter()
            .map(|(id, count)| {
                let name = id.split("::").last().unwrap_or(&id).to_string();
                FunctionStat {
                    id,
                    name,
                    call_count: count,
                }
            })
            .collect();
        most_called.sort_by(|a, b| b.call_count.cmp(&a.call_count));
        stats.most_called_functions = most_called.into_iter().take(10).collect();

        // 被导入最多的模块
        let mut import_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for edge in &dep_graph.edges {
            *import_counts.entry(edge.target.clone()).or_insert(0) += 1;
        }
        let mut most_imported: Vec<_> = import_counts
            .into_iter()
            .map(|(id, count)| ModuleStat {
                id,
                import_count: count,
            })
            .collect();
        most_imported.sort_by(|a, b| b.import_count.cmp(&a.import_count));
        stats.most_imported_modules = most_imported.into_iter().take(10).collect();

        stats
    }
}

/// 便捷函数：生成本体
pub fn generate_ontology(
    root_path: impl AsRef<Path>,
    options: Option<GenerateOptions>,
) -> CodeOntology {
    OntologyGenerator::new(root_path, options).generate()
}

/// 生成并保存本体
pub fn generate_and_save_ontology(
    root_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    options: Option<GenerateOptions>,
) -> std::io::Result<CodeOntology> {
    let ontology = generate_ontology(root_path, options);
    let json = serde_json::to_string_pretty(&ontology)?;
    std::fs::write(output_path, json)?;
    Ok(ontology)
}
