//! 依赖分析器
//!
//! 分析模块之间的导入/依赖关系

use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::types::{DependencyEdge, DependencyGraph, DependencyType, ModuleNode};

/// 解析配置
struct ResolutionConfig {
    extensions: Vec<&'static str>,
    index_files: Vec<&'static str>,
}

fn get_resolution_config(language: &str) -> ResolutionConfig {
    match language {
        "typescript" => ResolutionConfig {
            extensions: vec![".ts", ".tsx", ".d.ts", ".js", ".jsx", ""],
            index_files: vec!["index.ts", "index.tsx", "index.js", "index.jsx"],
        },
        "javascript" => ResolutionConfig {
            extensions: vec![".js", ".jsx", ".mjs", ".cjs", ""],
            index_files: vec!["index.js", "index.jsx", "index.mjs"],
        },
        "python" => ResolutionConfig {
            extensions: vec![".py", ""],
            index_files: vec!["__init__.py"],
        },
        _ => ResolutionConfig {
            extensions: vec![""],
            index_files: vec![],
        },
    }
}

/// 依赖分析器
pub struct DependencyAnalyzer {
    module_index: HashMap<String, ModuleNode>,
    module_ids: HashSet<String>,
}

impl DependencyAnalyzer {
    pub fn new() -> Self {
        Self {
            module_index: HashMap::new(),
            module_ids: HashSet::new(),
        }
    }

    /// 分析模块间的依赖关系
    pub fn analyze_dependencies(&mut self, modules: &[ModuleNode]) -> DependencyGraph {
        self.build_module_index(modules);
        let mut edges = Vec::new();

        for module in modules {
            self.analyze_module_dependencies(module, &mut edges);
        }

        DependencyGraph { edges }
    }

    /// 建立模块索引
    fn build_module_index(&mut self, modules: &[ModuleNode]) {
        self.module_index.clear();
        self.module_ids.clear();

        for module in modules {
            self.module_index.insert(module.id.clone(), module.clone());
            self.module_ids.insert(module.id.clone());

            // 也索引不带扩展名的路径
            if let Some(pos) = module.id.rfind('.') {
                let without_ext = module.id.get(..pos).unwrap_or(&module.id);
                self.module_index
                    .insert(without_ext.to_string(), module.clone());
            }
        }
    }

    /// 分析单个模块的依赖
    fn analyze_module_dependencies(&self, module: &ModuleNode, edges: &mut Vec<DependencyEdge>) {
        for imp in &module.imports {
            if let Some(target_id) =
                self.resolve_import_target(&imp.source, &module.id, &module.language)
            {
                edges.push(DependencyEdge {
                    source: module.id.clone(),
                    target: target_id,
                    edge_type: if imp.is_dynamic {
                        DependencyType::Dynamic
                    } else {
                        DependencyType::Import
                    },
                    symbols: imp.symbols.clone(),
                    is_type_only: self.is_type_only_import(imp),
                });
            }
        }
    }

    /// 解析导入目标模块
    fn resolve_import_target(&self, source: &str, current_id: &str, lang: &str) -> Option<String> {
        // 跳过外部依赖
        if !source.starts_with('.') && !source.starts_with('/') {
            return None;
        }

        let current_dir = Path::new(current_id).parent()?.to_str()?;
        let target_path = self.normalize_path(&format!("{}/{}", current_dir, source));
        let config = get_resolution_config(lang);

        // 尝试各种扩展名
        for ext in &config.extensions {
            let candidate = format!("{}{}", target_path, ext);
            if self.module_ids.contains(&candidate) {
                return Some(candidate);
            }
        }

        // 尝试 index 文件
        for index_file in &config.index_files {
            let candidate = format!("{}/{}", target_path, index_file);
            if self.module_ids.contains(&candidate) {
                return Some(candidate);
            }
        }

        None
    }

    /// 规范化路径
    fn normalize_path(&self, p: &str) -> String {
        let parts: Vec<&str> = p.split('/').collect();
        let mut result = Vec::new();

        for part in parts {
            match part {
                ".." => {
                    result.pop();
                }
                "." | "" => {}
                _ => result.push(part),
            }
        }

        result.join("/")
    }

    /// 判断是否为纯类型导入
    fn is_type_only_import(&self, imp: &super::types::ImportInfo) -> bool {
        imp.symbols.iter().any(|s| s.starts_with("type "))
    }

    /// 检测循环依赖
    pub fn detect_circular_dependencies(&self, graph: &DependencyGraph) -> Vec<Vec<String>> {
        let mut cycles = Vec::new();
        let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

        for edge in &graph.edges {
            adjacency
                .entry(edge.source.clone())
                .or_default()
                .push(edge.target.clone());
        }

        let mut visited = HashSet::new();
        let mut rec_stack = HashSet::new();
        let mut path = Vec::new();

        for node in adjacency.keys() {
            if !visited.contains(node) {
                self.dfs_cycle(
                    node,
                    &adjacency,
                    &mut visited,
                    &mut rec_stack,
                    &mut path,
                    &mut cycles,
                );
            }
        }

        cycles
    }

    fn dfs_cycle(
        &self,
        node: &str,
        adj: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        rec_stack: &mut HashSet<String>,
        path: &mut Vec<String>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        visited.insert(node.to_string());
        rec_stack.insert(node.to_string());
        path.push(node.to_string());

        if let Some(neighbors) = adj.get(node) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    self.dfs_cycle(neighbor, adj, visited, rec_stack, path, cycles);
                } else if rec_stack.contains(neighbor) {
                    if let Some(start) = path.iter().position(|x| x == neighbor) {
                        let mut cycle: Vec<String> = path[start..].to_vec();
                        cycle.push(neighbor.clone());
                        cycles.push(cycle);
                    }
                }
            }
        }

        path.pop();
        rec_stack.remove(node);
    }

    /// 获取依赖统计信息
    pub fn get_dependency_stats(&self, graph: &DependencyGraph) -> DependencyStats {
        let mut dependent_count: HashMap<String, usize> = HashMap::new();
        let mut depended_count: HashMap<String, usize> = HashMap::new();
        let mut type_only = 0;
        let mut dynamic = 0;

        for edge in &graph.edges {
            *dependent_count.entry(edge.source.clone()).or_insert(0) += 1;
            *depended_count.entry(edge.target.clone()).or_insert(0) += 1;
            if edge.is_type_only {
                type_only += 1;
            }
            if edge.edge_type == DependencyType::Dynamic {
                dynamic += 1;
            }
        }

        let mut most_dependent: Vec<_> = dependent_count.into_iter().collect();
        most_dependent.sort_by(|a, b| b.1.cmp(&a.1));

        let mut most_depended: Vec<_> = depended_count.into_iter().collect();
        most_depended.sort_by(|a, b| b.1.cmp(&a.1));

        DependencyStats {
            total_edges: graph.edges.len(),
            type_only_deps: type_only,
            dynamic_deps: dynamic,
            most_dependent: most_dependent.into_iter().take(10).collect(),
            most_depended: most_depended.into_iter().take(10).collect(),
        }
    }
}

impl Default for DependencyAnalyzer {
    fn default() -> Self {
        Self::new()
    }
}

/// 依赖统计
#[derive(Debug, Clone, Default)]
pub struct DependencyStats {
    pub total_edges: usize,
    pub type_only_deps: usize,
    pub dynamic_deps: usize,
    pub most_dependent: Vec<(String, usize)>,
    pub most_depended: Vec<(String, usize)>,
}

/// 便捷函数：分析依赖
pub fn analyze_dependencies(modules: &[ModuleNode]) -> DependencyGraph {
    let mut analyzer = DependencyAnalyzer::new();
    analyzer.analyze_dependencies(modules)
}
