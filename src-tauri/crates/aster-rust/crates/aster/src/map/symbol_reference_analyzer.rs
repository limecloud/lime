//! 符号引用分析器
//!
//! 分析函数调用、变量读写等符号级引用关系

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::{ClassNode, FunctionNode, LocationInfo, ModuleNode};
use super::types_enhanced::{SymbolCall, SymbolEntry, SymbolKind};

/// 符号信息
#[derive(Debug, Clone)]
struct SymbolInfo {
    id: String,
    name: String,
    kind: SymbolKind,
    module_id: String,
    location: LocationInfo,
    signature: Option<String>,
    parent: Option<String>,
}

/// 调用信息
#[derive(Debug, Clone)]
struct CallInfo {
    caller_symbol: String,
    callee_symbol: String,
    callee_name: String,
    call_type: CallType,
    location: LocationInfo,
}

/// 调用类型
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CallType {
    Direct,
    Method,
    Constructor,
}

/// 符号引用分析结果
#[derive(Debug, Clone)]
pub struct SymbolReferenceResult {
    pub symbols: HashMap<String, SymbolEntry>,
    pub calls: Vec<SymbolCall>,
}

/// 符号引用分析器
pub struct SymbolReferenceAnalyzer {
    root_path: PathBuf,
    /// 符号索引
    symbol_index: HashMap<String, SymbolInfo>,
    /// 名称到符号的映射
    name_to_symbols: HashMap<String, Vec<String>>,
}

impl SymbolReferenceAnalyzer {
    /// 创建新的分析器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
            symbol_index: HashMap::new(),
            name_to_symbols: HashMap::new(),
        }
    }

    /// 分析模块列表，提取符号引用关系
    pub fn analyze(&mut self, modules: &[ModuleNode]) -> SymbolReferenceResult {
        // 1. 构建符号索引
        self.build_symbol_index(modules);

        // 2. 分析调用关系
        let calls = self.analyze_call_relations(modules);

        // 3. 转换为输出格式
        let symbols = self.convert_to_symbol_entries();

        SymbolReferenceResult { symbols, calls }
    }

    /// 构建符号索引
    fn build_symbol_index(&mut self, modules: &[ModuleNode]) {
        self.symbol_index.clear();
        self.name_to_symbols.clear();

        for module in modules {
            // 函数
            for func in &module.functions {
                let info = SymbolInfo {
                    id: func.id.clone(),
                    name: func.name.clone(),
                    kind: SymbolKind::Function,
                    module_id: module.id.clone(),
                    location: func.location.clone(),
                    signature: Some(func.signature.clone()),
                    parent: None,
                };
                self.add_symbol(info);
            }

            // 类
            for cls in &module.classes {
                let class_info = SymbolInfo {
                    id: cls.id.clone(),
                    name: cls.name.clone(),
                    kind: SymbolKind::Class,
                    module_id: module.id.clone(),
                    location: cls.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(class_info);

                // 方法
                for method in &cls.methods {
                    let method_info = SymbolInfo {
                        id: method.id.clone(),
                        name: method.name.clone(),
                        kind: SymbolKind::Method,
                        module_id: module.id.clone(),
                        location: method.location.clone(),
                        signature: Some(method.signature.clone()),
                        parent: Some(cls.id.clone()),
                    };
                    self.add_symbol(method_info);
                }

                // 属性
                for prop in &cls.properties {
                    let prop_info = SymbolInfo {
                        id: prop.id.clone(),
                        name: prop.name.clone(),
                        kind: SymbolKind::Property,
                        module_id: module.id.clone(),
                        location: prop.location.clone(),
                        signature: None,
                        parent: Some(cls.id.clone()),
                    };
                    self.add_symbol(prop_info);
                }
            }

            // 接口
            for iface in &module.interfaces {
                let info = SymbolInfo {
                    id: iface.id.clone(),
                    name: iface.name.clone(),
                    kind: SymbolKind::Interface,
                    module_id: module.id.clone(),
                    location: iface.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(info);
            }

            // 类型
            for type_node in &module.types {
                let info = SymbolInfo {
                    id: type_node.id.clone(),
                    name: type_node.name.clone(),
                    kind: SymbolKind::Type,
                    module_id: module.id.clone(),
                    location: type_node.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(info);
            }

            // 枚举
            for enum_node in &module.enums {
                let info = SymbolInfo {
                    id: enum_node.id.clone(),
                    name: enum_node.name.clone(),
                    kind: SymbolKind::Enum,
                    module_id: module.id.clone(),
                    location: enum_node.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(info);
            }

            // 变量
            for var in &module.variables {
                let kind = if var.kind == super::types::VariableKind::Const {
                    SymbolKind::Constant
                } else {
                    SymbolKind::Variable
                };
                let info = SymbolInfo {
                    id: var.id.clone(),
                    name: var.name.clone(),
                    kind,
                    module_id: module.id.clone(),
                    location: var.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(info);
            }

            // 导出的符号
            for exp in &module.exports {
                if exp.name.starts_with('*') {
                    continue;
                }

                let existing_id = format!("{}::{}", module.id, exp.name);
                if self.symbol_index.contains_key(&existing_id) {
                    continue;
                }

                let starts_with_uppercase =
                    exp.name.chars().next().is_some_and(|c| c.is_uppercase());
                let looks_like_type = starts_with_uppercase && !exp.name.contains('_');

                let info = SymbolInfo {
                    id: existing_id,
                    name: exp.name.clone(),
                    kind: if looks_like_type {
                        SymbolKind::Type
                    } else {
                        SymbolKind::Variable
                    },
                    module_id: module.id.clone(),
                    location: exp.location.clone(),
                    signature: None,
                    parent: None,
                };
                self.add_symbol(info);
            }
        }
    }

    /// 添加符号到索引
    fn add_symbol(&mut self, info: SymbolInfo) {
        let name = info.name.clone();
        let id = info.id.clone();

        self.symbol_index.insert(id.clone(), info);

        self.name_to_symbols.entry(name).or_default().push(id);
    }

    /// 分析调用关系
    fn analyze_call_relations(&self, modules: &[ModuleNode]) -> Vec<SymbolCall> {
        let mut call_map: HashMap<String, SymbolCall> = HashMap::new();

        for module in modules {
            // 读取文件内容
            let file_path = self.root_path.join(&module.id);
            let content = match fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let lines: Vec<&str> = content.lines().collect();

            // 分析函数内的调用
            for func in &module.functions {
                let func_calls = self.analyze_calls_in_function(func, module, &lines, None);
                self.merge_calls_into_map(func_calls, &mut call_map);
            }

            // 分析类方法内的调用
            for cls in &module.classes {
                for method in &cls.methods {
                    let method_calls = self.analyze_calls_in_method(method, module, &lines, cls);
                    self.merge_calls_into_map(method_calls, &mut call_map);
                }
            }
        }

        call_map.into_values().collect()
    }

    /// 分析方法内的调用
    fn analyze_calls_in_method(
        &self,
        method: &super::types::MethodNode,
        module: &ModuleNode,
        lines: &[&str],
        parent_class: &ClassNode,
    ) -> Vec<CallInfo> {
        // 创建一个临时的 FunctionNode 风格的数据来复用逻辑
        let func_like = FunctionNode {
            id: method.id.clone(),
            name: method.name.clone(),
            signature: method.signature.clone(),
            parameters: method.parameters.clone(),
            return_type: method.return_type.clone(),
            location: method.location.clone(),
            is_async: method.is_async,
            is_exported: false,
            is_generator: false,
            documentation: method.documentation.clone(),
            calls: vec![],
            called_by: vec![],
        };
        self.analyze_calls_in_function(&func_like, module, lines, Some(parent_class))
    }

    /// 分析函数/方法内的调用
    fn analyze_calls_in_function(
        &self,
        func: &FunctionNode,
        module: &ModuleNode,
        lines: &[&str],
        parent_class: Option<&ClassNode>,
    ) -> Vec<CallInfo> {
        use once_cell::sync::Lazy;

        static RE_FUNC_CALL: Lazy<regex::Regex> =
            Lazy::new(|| regex::Regex::new(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(").unwrap());
        static RE_METHOD_CALL: Lazy<regex::Regex> = Lazy::new(|| {
            regex::Regex::new(
                r"(?:([a-zA-Z_][a-zA-Z0-9_]*)|self|this)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(",
            )
            .unwrap()
        });
        static RE_CONSTRUCTOR: Lazy<regex::Regex> =
            Lazy::new(|| regex::Regex::new(r"(?:new\s+|::new\s*\()([A-Z][a-zA-Z0-9_]*)").unwrap());

        let mut calls = Vec::new();
        let caller_symbol = func.id.clone();

        // 获取函数体的行范围
        let start_line = (func.location.start_line as usize).saturating_sub(1);
        let end_line = (func.location.end_line as usize).min(lines.len());

        // 忽略的关键字
        let ignored: std::collections::HashSet<&str> = [
            "if",
            "else",
            "for",
            "while",
            "switch",
            "case",
            "catch",
            "try",
            "return",
            "throw",
            "typeof",
            "instanceof",
            "delete",
            "void",
            "function",
            "class",
            "const",
            "let",
            "var",
            "import",
            "export",
            "async",
            "await",
            "yield",
            "super",
            "this",
            "fn",
            "pub",
            "mod",
            "use",
            "impl",
            "struct",
            "enum",
            "trait",
            "match",
            "loop",
        ]
        .into_iter()
        .collect();

        for (i, line) in lines.iter().enumerate().take(end_line).skip(start_line) {
            let line_num = (i + 1) as u32;

            // 跳过注释行
            let trimmed = line.trim();
            if trimmed.starts_with("//") || trimmed.starts_with('*') || trimmed.starts_with("/*") {
                continue;
            }

            // 模式 1: 普通函数调用 functionName(
            for cap in RE_FUNC_CALL.captures_iter(line) {
                if let Some(func_name) = cap.get(1) {
                    let name = func_name.as_str();
                    if ignored.contains(name) {
                        continue;
                    }

                    let targets = self.find_target_symbols(name, module);
                    for target_id in targets {
                        calls.push(CallInfo {
                            caller_symbol: caller_symbol.clone(),
                            callee_symbol: target_id,
                            callee_name: name.to_string(),
                            call_type: CallType::Direct,
                            location: LocationInfo {
                                file: module.id.clone(),
                                start_line: line_num,
                                start_column: func_name.start() as u32,
                                end_line: line_num,
                                end_column: func_name.end() as u32,
                            },
                        });
                    }
                }
            }

            // 模式 2: 方法调用 obj.methodName( 或 self.methodName(
            for cap in RE_METHOD_CALL.captures_iter(line) {
                let obj_name = cap.get(1).map(|m| m.as_str());
                if let Some(method_name) = cap.get(2) {
                    let name = method_name.as_str();
                    if ignored.contains(name) {
                        continue;
                    }

                    // self.method() 或 this.method() 调用
                    if obj_name.is_none() {
                        if let Some(cls) = parent_class {
                            let target_id = format!("{}::{}::{}", module.id, cls.name, name);
                            if self.symbol_index.contains_key(&target_id) {
                                calls.push(CallInfo {
                                    caller_symbol: caller_symbol.clone(),
                                    callee_symbol: target_id,
                                    callee_name: name.to_string(),
                                    call_type: CallType::Method,
                                    location: LocationInfo {
                                        file: module.id.clone(),
                                        start_line: line_num,
                                        start_column: method_name.start() as u32,
                                        end_line: line_num,
                                        end_column: method_name.end() as u32,
                                    },
                                });
                            }
                        }
                    } else {
                        // obj.method() 调用
                        let targets = self.find_method_targets(name);
                        for target_id in targets {
                            calls.push(CallInfo {
                                caller_symbol: caller_symbol.clone(),
                                callee_symbol: target_id,
                                callee_name: name.to_string(),
                                call_type: CallType::Method,
                                location: LocationInfo {
                                    file: module.id.clone(),
                                    start_line: line_num,
                                    start_column: method_name.start() as u32,
                                    end_line: line_num,
                                    end_column: method_name.end() as u32,
                                },
                            });
                        }
                    }
                }
            }

            // 模式 3: 构造函数调用 new ClassName( 或 ClassName::new(
            for cap in RE_CONSTRUCTOR.captures_iter(line) {
                if let Some(class_name) = cap.get(1) {
                    let name = class_name.as_str();
                    let targets = self.find_target_symbols(name, module);
                    for target_id in targets {
                        if let Some(symbol) = self.symbol_index.get(&target_id) {
                            if symbol.kind == SymbolKind::Class {
                                calls.push(CallInfo {
                                    caller_symbol: caller_symbol.clone(),
                                    callee_symbol: target_id,
                                    callee_name: name.to_string(),
                                    call_type: CallType::Constructor,
                                    location: LocationInfo {
                                        file: module.id.clone(),
                                        start_line: line_num,
                                        start_column: class_name.start() as u32,
                                        end_line: line_num,
                                        end_column: class_name.end() as u32,
                                    },
                                });
                            }
                        }
                    }
                }
            }
        }

        calls
    }

    /// 查找目标符号
    fn find_target_symbols(&self, name: &str, current_module: &ModuleNode) -> Vec<String> {
        let candidates = match self.name_to_symbols.get(name) {
            Some(c) => c.clone(),
            None => return vec![],
        };

        // 获取当前模块导入的符号
        let imported_symbols: std::collections::HashSet<String> = current_module
            .imports
            .iter()
            .flat_map(|imp| imp.symbols.iter().cloned())
            .collect();

        let mut same_module = Vec::new();
        let mut imported = Vec::new();
        let mut others = Vec::new();

        for candidate_id in candidates {
            if let Some(symbol) = self.symbol_index.get(&candidate_id) {
                if symbol.module_id == current_module.id {
                    same_module.push(candidate_id);
                } else if imported_symbols.contains(name) {
                    imported.push(candidate_id);
                } else {
                    others.push(candidate_id);
                }
            }
        }

        // 返回最可能的目标
        if !same_module.is_empty() {
            return same_module;
        }
        if !imported.is_empty() {
            return imported;
        }
        others.into_iter().take(1).collect()
    }

    /// 查找方法目标
    fn find_method_targets(&self, method_name: &str) -> Vec<String> {
        self.symbol_index
            .iter()
            .filter(|(_, symbol)| symbol.kind == SymbolKind::Method && symbol.name == method_name)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 合并调用到 Map（去重）
    fn merge_calls_into_map(&self, calls: Vec<CallInfo>, map: &mut HashMap<String, SymbolCall>) {
        for call in calls {
            let key = format!("{}::{}", call.caller_symbol, call.callee_symbol);

            if let Some(existing) = map.get_mut(&key) {
                existing.locations.push(call.location);
            } else {
                map.insert(
                    key,
                    SymbolCall {
                        caller: call.caller_symbol,
                        callee: call.callee_symbol,
                        call_type: match call.call_type {
                            CallType::Direct => "direct".to_string(),
                            CallType::Method => "method".to_string(),
                            CallType::Constructor => "constructor".to_string(),
                        },
                        locations: vec![call.location],
                    },
                );
            }
        }
    }

    /// 转换为 SymbolEntry 格式
    fn convert_to_symbol_entries(&self) -> HashMap<String, SymbolEntry> {
        let mut entries = HashMap::new();

        for (id, info) in &self.symbol_index {
            let mut entry = SymbolEntry {
                id: info.id.clone(),
                name: info.name.clone(),
                kind: info.kind,
                module_id: info.module_id.clone(),
                location: info.location.clone(),
                signature: info.signature.clone(),
                semantic: None,
                parent: info.parent.clone(),
                children: None,
            };

            // 收集子符号
            if info.kind == SymbolKind::Class {
                let children: Vec<String> = self
                    .symbol_index
                    .iter()
                    .filter(|(_, child)| child.parent.as_ref() == Some(id))
                    .map(|(child_id, _)| child_id.clone())
                    .collect();

                if !children.is_empty() {
                    entry.children = Some(children);
                }
            }

            entries.insert(id.clone(), entry);
        }

        entries
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/// 分析符号引用
pub fn analyze_symbol_references(
    root_path: impl AsRef<Path>,
    modules: &[ModuleNode],
) -> SymbolReferenceResult {
    let mut analyzer = SymbolReferenceAnalyzer::new(root_path);
    analyzer.analyze(modules)
}
