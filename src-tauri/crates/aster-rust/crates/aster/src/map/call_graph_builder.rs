//! 调用图构建器
//!
//! 分析函数/方法之间的调用关系

use std::collections::HashMap;

use super::types::*;

/// 需要忽略的内置函数/关键字
const IGNORED_NAMES: &[&str] = &[
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "with",
    "function",
    "class",
    "return",
    "throw",
    "typeof",
    "instanceof",
    "void",
    "delete",
    "await",
    "async",
    "yield",
    "new",
    "super",
    "this",
    "console",
    "Math",
    "JSON",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Date",
    "RegExp",
    "Error",
    "Promise",
    "Map",
    "Set",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "print",
    "len",
    "range",
    "str",
    "int",
    "float",
    "list",
    "dict",
];

/// 调用图构建器
pub struct CallGraphBuilder {
    function_index: HashMap<String, CallGraphNode>,
    name_to_ids: HashMap<String, Vec<String>>,
}

impl CallGraphBuilder {
    pub fn new() -> Self {
        Self {
            function_index: HashMap::new(),
            name_to_ids: HashMap::new(),
        }
    }

    /// 构建调用图
    pub fn build_call_graph(&mut self, modules: &[ModuleNode]) -> CallGraph {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();

        self.build_function_index(modules, &mut nodes);

        for module in modules {
            self.analyze_module_calls(module, &mut edges);
        }

        let merged_edges = self.merge_edges(edges);
        CallGraph {
            nodes,
            edges: merged_edges,
        }
    }

    /// 建立函数索引
    fn build_function_index(&mut self, modules: &[ModuleNode], nodes: &mut Vec<CallGraphNode>) {
        self.function_index.clear();
        self.name_to_ids.clear();

        for module in modules {
            for func in &module.functions {
                let node = CallGraphNode {
                    id: func.id.clone(),
                    name: func.name.clone(),
                    node_type: CallGraphNodeType::Function,
                    module_id: module.id.clone(),
                    class_name: None,
                    signature: Some(func.signature.clone()),
                };
                nodes.push(node.clone());
                self.function_index.insert(func.id.clone(), node);
                self.add_to_name_index(&func.name, &func.id);
            }

            for cls in &module.classes {
                for method in &cls.methods {
                    let node = CallGraphNode {
                        id: method.id.clone(),
                        name: method.name.clone(),
                        node_type: if method.name == "constructor" {
                            CallGraphNodeType::Constructor
                        } else {
                            CallGraphNodeType::Method
                        },
                        module_id: module.id.clone(),
                        class_name: Some(cls.name.clone()),
                        signature: Some(method.signature.clone()),
                    };
                    nodes.push(node.clone());
                    self.function_index.insert(method.id.clone(), node);
                    self.add_to_name_index(&method.name, &method.id);
                    self.add_to_name_index(&format!("{}.{}", cls.name, method.name), &method.id);
                }
            }
        }
    }

    fn add_to_name_index(&mut self, name: &str, id: &str) {
        self.name_to_ids
            .entry(name.to_string())
            .or_default()
            .push(id.to_string());
    }

    /// 分析模块中的调用
    fn analyze_module_calls(&self, module: &ModuleNode, edges: &mut Vec<CallGraphEdge>) {
        let content = match std::fs::read_to_string(&module.path) {
            Ok(c) => c,
            Err(_) => return,
        };
        let lines: Vec<&str> = content.lines().collect();
        let call_re = regex::Regex::new(r"\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(").unwrap();

        for func in &module.functions {
            self.analyze_function_calls(func, &lines, &call_re, &module.id, edges);
        }

        for cls in &module.classes {
            for method in &cls.methods {
                self.analyze_method_calls(method, &lines, &call_re, &module.id, edges);
            }
        }
    }

    fn analyze_function_calls(
        &self,
        func: &FunctionNode,
        lines: &[&str],
        call_re: &regex::Regex,
        module_id: &str,
        edges: &mut Vec<CallGraphEdge>,
    ) {
        let start = func.location.start_line.saturating_sub(1) as usize;
        let end = (func.location.end_line as usize).min(lines.len());

        for (i, line) in lines[start..end].iter().enumerate() {
            let line_num = start + i + 1;
            for cap in call_re.captures_iter(line) {
                let called_name = &cap[1];
                if IGNORED_NAMES.contains(&called_name) || called_name == func.name {
                    continue;
                }
                if let Some(target_ids) = self.name_to_ids.get(called_name) {
                    if let Some(target_id) = target_ids.iter().next() {
                        edges.push(CallGraphEdge {
                            source: func.id.clone(),
                            target: target_id.clone(),
                            edge_type: self.detect_call_type(line, called_name),
                            count: 1,
                            locations: vec![LocationInfo {
                                file: module_id.to_string(),
                                start_line: line_num as u32,
                                start_column: 0,
                                end_line: line_num as u32,
                                end_column: line.len() as u32,
                            }],
                        });
                    }
                }
            }
        }
    }

    fn analyze_method_calls(
        &self,
        method: &MethodNode,
        lines: &[&str],
        call_re: &regex::Regex,
        module_id: &str,
        edges: &mut Vec<CallGraphEdge>,
    ) {
        let start = method.location.start_line.saturating_sub(1) as usize;
        let end = (method.location.end_line as usize).min(lines.len());

        for (i, line) in lines[start..end].iter().enumerate() {
            let line_num = start + i + 1;
            for cap in call_re.captures_iter(line) {
                let called_name = &cap[1];
                if IGNORED_NAMES.contains(&called_name) || called_name == method.name {
                    continue;
                }
                if let Some(target_ids) = self.name_to_ids.get(called_name) {
                    if let Some(target_id) = target_ids.iter().next() {
                        edges.push(CallGraphEdge {
                            source: method.id.clone(),
                            target: target_id.clone(),
                            edge_type: self.detect_call_type(line, called_name),
                            count: 1,
                            locations: vec![LocationInfo {
                                file: module_id.to_string(),
                                start_line: line_num as u32,
                                start_column: 0,
                                end_line: line_num as u32,
                                end_column: line.len() as u32,
                            }],
                        });
                    }
                }
            }
        }
    }

    fn detect_call_type(&self, line: &str, name: &str) -> CallType {
        if line.contains(&format!(".{}(", name)) || line.contains(&format!("?.{}(", name)) {
            CallType::Method
        } else if line.contains(&format!("({})", name)) || line.contains(&format!(", {})", name)) {
            CallType::Callback
        } else if line.contains(&format!("[{}](", name)) {
            CallType::Dynamic
        } else {
            CallType::Direct
        }
    }

    /// 合并重复边
    fn merge_edges(&self, edges: Vec<CallGraphEdge>) -> Vec<CallGraphEdge> {
        let mut edge_map: HashMap<String, CallGraphEdge> = HashMap::new();

        for edge in edges {
            let key = format!("{}|{}", edge.source, edge.target);
            if let Some(existing) = edge_map.get_mut(&key) {
                existing.count += edge.count;
                existing.locations.extend(edge.locations);
            } else {
                edge_map.insert(key, edge);
            }
        }

        edge_map.into_values().collect()
    }
}

impl Default for CallGraphBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// 便捷函数：构建调用图
pub fn build_call_graph(modules: &[ModuleNode]) -> CallGraph {
    let mut builder = CallGraphBuilder::new();
    builder.build_call_graph(modules)
}
