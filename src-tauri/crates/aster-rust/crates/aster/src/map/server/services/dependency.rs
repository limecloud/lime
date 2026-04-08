//! 依赖分析服务
//!
//! 负责入口点检测和依赖树构建

use regex::Regex;
use std::collections::{HashMap, HashSet};

use crate::map::server::types::DependencyTreeNode;
use crate::map::types_enhanced::{EnhancedCodeBlueprint, ModuleDependency};

/// 入口文件名模式
static ENTRY_PATTERNS: &[&str] = &[
    r"cli\.(ts|js)$",
    r"index\.(ts|js)$",
    r"main\.(ts|js)$",
    r"app\.(ts|js)$",
    r"server\.(ts|js)$",
    r"entry\.(ts|js)$",
];

/// 检测项目入口点
pub fn detect_entry_points(blueprint: &EnhancedCodeBlueprint) -> Vec<String> {
    let entry_patterns: Vec<Regex> = ENTRY_PATTERNS
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect();

    // 计算每个模块被导入的次数
    let mut import_counts: HashMap<String, usize> = HashMap::new();
    for dep in &blueprint.references.module_deps {
        *import_counts.entry(dep.target.clone()).or_insert(0) += 1;
    }

    let mut candidates: Vec<(String, i32)> = Vec::new();

    for module in blueprint.modules.values() {
        use once_cell::sync::Lazy;
        static ROOT_PATTERN: Lazy<Regex> =
            Lazy::new(|| Regex::new(r"^(src/)?[^/]+\.(ts|js)$").unwrap());

        let mut score: i32 = 0;

        // 入口文件名模式匹配
        for (i, pattern) in entry_patterns.iter().enumerate() {
            if pattern.is_match(&module.id) {
                score += ((entry_patterns.len() - i) * 10) as i32;
                break;
            }
        }

        // 在根目录或 src 目录下的文件加分
        if ROOT_PATTERN.is_match(&module.id) {
            score += 5;
        }

        // 不被任何其他模块导入的文件加分
        let import_count = import_counts.get(&module.id).copied().unwrap_or(0);
        if import_count == 0 {
            score += 20;
        }

        // 有导入其他模块的文件加分
        if !module.imports.is_empty() {
            score += module.imports.len().min(10) as i32;
        }

        if score > 0 {
            candidates.push((module.id.clone(), score));
        }
    }

    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates.into_iter().take(5).map(|(id, _)| id).collect()
}

/// 构建从入口点开始的依赖树
pub fn build_dependency_tree(
    blueprint: &EnhancedCodeBlueprint,
    entry_id: &str,
    max_depth: usize,
) -> Option<DependencyTreeNode> {
    let _module = blueprint.modules.get(entry_id)?;

    // 构建依赖图
    let mut deps_by_source: HashMap<String, Vec<&ModuleDependency>> = HashMap::new();
    for dep in &blueprint.references.module_deps {
        deps_by_source
            .entry(dep.source.clone())
            .or_default()
            .push(dep);
    }

    fn build_node(
        blueprint: &EnhancedCodeBlueprint,
        deps_by_source: &HashMap<String, Vec<&ModuleDependency>>,
        module_id: &str,
        depth: usize,
        max_depth: usize,
        visited: &mut HashSet<String>,
    ) -> Option<DependencyTreeNode> {
        let module = blueprint.modules.get(module_id)?;
        let is_circular = visited.contains(module_id);

        let mut node = DependencyTreeNode {
            id: module_id.to_string(),
            name: module.name.clone(),
            path: module.path.clone(),
            language: Some(module.language.clone()),
            lines: Some(module.lines),
            semantic: module
                .semantic
                .as_ref()
                .map(|s| serde_json::to_value(s).unwrap_or_default()),
            children: Vec::new(),
            depth,
            is_circular: if is_circular { Some(true) } else { None },
        };

        if is_circular || depth >= max_depth {
            return Some(node);
        }

        visited.insert(module_id.to_string());

        if let Some(deps) = deps_by_source.get(module_id) {
            let mut sorted_deps: Vec<_> = deps.iter().collect();
            sorted_deps.sort_by(|a, b| a.target.cmp(&b.target));

            for dep in sorted_deps {
                if blueprint.modules.contains_key(&dep.target) {
                    if let Some(child) = build_node(
                        blueprint,
                        deps_by_source,
                        &dep.target,
                        depth + 1,
                        max_depth,
                        visited,
                    ) {
                        node.children.push(child);
                    }
                }
            }
        }

        visited.remove(module_id);
        Some(node)
    }

    let mut visited = HashSet::new();
    build_node(
        blueprint,
        &deps_by_source,
        entry_id,
        0,
        max_depth,
        &mut visited,
    )
}
