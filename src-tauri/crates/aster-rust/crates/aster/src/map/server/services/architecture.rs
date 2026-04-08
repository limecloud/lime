//! 架构分析服务
//!
//! 负责构建逻辑架构图、模块详情、符号引用等

use regex::Regex;
use std::collections::{HashMap, HashSet};

use crate::map::server::types::{
    ArchitectureMap, CallerInfo, LineLocation, LogicBlock, LogicBlockType, ModuleDetailInfo,
    ModuleSymbols, SymbolInfo, SymbolLocation, SymbolRefInfo, TypeRefInfo,
};
use crate::map::types_enhanced::{EnhancedCodeBlueprint, EnhancedModule};

/// 获取模块所在目录
pub fn get_dir(module_id: &str) -> String {
    let parts: Vec<&str> = module_id.split('/').collect();
    match parts.len() {
        1 => ".".to_string(),
        2 => parts[0].to_string(),
        _ => parts[..parts.len() - 1].join("/"),
    }
}

/// 目录类型模式
struct TypePattern {
    pattern: Regex,
    block_type: LogicBlockType,
    name: &'static str,
}

impl TypePattern {
    fn new(pattern: &str, block_type: LogicBlockType, name: &'static str) -> Self {
        Self {
            pattern: Regex::new(pattern).unwrap(),
            block_type,
            name,
        }
    }
}

/// 构建逻辑架构图
pub fn build_architecture_map(blueprint: &EnhancedCodeBlueprint) -> ArchitectureMap {
    let modules: Vec<&EnhancedModule> = blueprint.modules.values().collect();

    // 按目录分组
    let mut dir_groups: HashMap<String, Vec<&EnhancedModule>> = HashMap::new();
    for module in &modules {
        let dir = get_dir(&module.id);
        dir_groups.entry(dir).or_default().push(module);
    }

    // 类型模式定义
    let type_patterns = vec![
        TypePattern::new(r"^(src/)?cli", LogicBlockType::Entry, "程序入口"),
        TypePattern::new(r"^(src/)?core", LogicBlockType::Core, "核心引擎"),
        TypePattern::new(r"^(src/)?tools?", LogicBlockType::Feature, "工具系统"),
        TypePattern::new(r"^(src/)?commands?", LogicBlockType::Feature, "命令处理"),
        TypePattern::new(r"^(src/)?ui", LogicBlockType::Ui, "用户界面"),
        TypePattern::new(r"^(src/)?hooks?", LogicBlockType::Feature, "钩子系统"),
        TypePattern::new(r"^(src/)?plugins?", LogicBlockType::Feature, "插件系统"),
        TypePattern::new(r"^(src/)?config", LogicBlockType::Config, "配置管理"),
        TypePattern::new(r"^(src/)?session", LogicBlockType::Data, "会话管理"),
        TypePattern::new(r"^(src/)?context", LogicBlockType::Core, "上下文管理"),
        TypePattern::new(r"^(src/)?streaming", LogicBlockType::Core, "流式处理"),
        TypePattern::new(r"^(src/)?providers?", LogicBlockType::Core, "API 提供者"),
        TypePattern::new(r"^(src/)?utils?", LogicBlockType::Util, "工具函数"),
        TypePattern::new(r"^(src/)?parser", LogicBlockType::Util, "代码解析"),
        TypePattern::new(r"^(src/)?search", LogicBlockType::Util, "代码搜索"),
        TypePattern::new(r"^(src/)?map", LogicBlockType::Feature, "代码地图"),
        TypePattern::new(r"^(src/)?mcp", LogicBlockType::Feature, "MCP 服务"),
        TypePattern::new(r"^(src/)?ide", LogicBlockType::Feature, "IDE 集成"),
    ];

    // 为每个目录创建逻辑块
    let mut blocks: Vec<LogicBlock> = Vec::new();
    let mut block_map: HashMap<String, usize> = HashMap::new();

    for (dir, mods) in &dir_groups {
        let mut block_type = LogicBlockType::Util;
        let mut default_name = dir.rsplit('/').next().unwrap_or(dir).to_string();

        for pattern in &type_patterns {
            if pattern.pattern.is_match(dir) {
                block_type = pattern.block_type;
                default_name = pattern.name.to_string();
                break;
            }
        }

        // 获取描述
        let descriptions: Vec<String> = mods
            .iter()
            .filter_map(|m| m.semantic.as_ref().map(|s| s.description.clone()))
            .collect();

        let description = if !descriptions.is_empty() {
            descriptions[0].clone()
        } else if mods.len() > 3 {
            let func_names: Vec<String> = mods
                .iter()
                .take(5)
                .map(|m| {
                    m.name
                        .trim_end_matches(".ts")
                        .trim_end_matches(".js")
                        .to_string()
                })
                .collect();
            format!("包含 {} 等 {} 个模块", func_names.join(", "), mods.len())
        } else {
            format!("{}相关功能", default_name)
        };

        let block = LogicBlock {
            id: dir.clone(),
            name: default_name,
            description,
            block_type,
            files: mods.iter().map(|m| m.id.clone()).collect(),
            file_count: mods.len(),
            total_lines: mods.iter().map(|m| m.lines).sum(),
            children: Vec::new(),
            dependencies: Vec::new(),
        };

        block_map.insert(dir.clone(), blocks.len());
        blocks.push(block);
    }

    // 建立块之间的依赖关系
    for dep in &blueprint.references.module_deps {
        let source_dir = get_dir(&dep.source);
        let target_dir = get_dir(&dep.target);

        if source_dir != target_dir {
            if let Some(&source_idx) = block_map.get(&source_dir) {
                if block_map.contains_key(&target_dir) {
                    let block = &mut blocks[source_idx];
                    if !block.dependencies.contains(&target_dir) {
                        block.dependencies.push(target_dir);
                    }
                }
            }
        }
    }

    // 按类型和重要性排序
    let type_order = |t: LogicBlockType| -> usize {
        match t {
            LogicBlockType::Entry => 0,
            LogicBlockType::Core => 1,
            LogicBlockType::Feature => 2,
            LogicBlockType::Ui => 3,
            LogicBlockType::Data => 4,
            LogicBlockType::Config => 5,
            LogicBlockType::Util => 6,
        }
    };

    blocks.sort_by(|a, b| {
        let order_a = type_order(a.block_type);
        let order_b = type_order(b.block_type);
        if order_a != order_b {
            order_a.cmp(&order_b)
        } else {
            b.file_count.cmp(&a.file_count)
        }
    });

    let project_desc = blueprint
        .project
        .semantic
        .as_ref()
        .map(|s| s.description.clone())
        .unwrap_or_else(|| "项目描述".to_string());

    ArchitectureMap {
        project_name: blueprint.project.name.clone(),
        project_description: project_desc,
        blocks,
    }
}

/// 将 SymbolKind 转换为字符串
fn symbol_kind_to_string(kind: &crate::map::types_enhanced::SymbolKind) -> String {
    use crate::map::types_enhanced::SymbolKind;
    match kind {
        SymbolKind::Function => "function",
        SymbolKind::Class => "class",
        SymbolKind::Method => "method",
        SymbolKind::Property => "property",
        SymbolKind::Variable => "variable",
        SymbolKind::Constant => "constant",
        SymbolKind::Interface => "interface",
        SymbolKind::Type => "type",
        SymbolKind::Enum => "enum",
    }
    .to_string()
}

/// 获取模块详情
pub fn get_module_detail(
    blueprint: &EnhancedCodeBlueprint,
    module_id: &str,
) -> Option<ModuleDetailInfo> {
    let module = blueprint.modules.get(module_id)?;

    let mut symbols = ModuleSymbols::default();

    // 从全局符号表中查找属于此模块的符号
    for symbol in blueprint.symbols.values() {
        if symbol.module_id != module_id {
            continue;
        }

        let kind_str = symbol_kind_to_string(&symbol.kind);
        let info = SymbolInfo {
            id: symbol.id.clone(),
            name: symbol.name.clone(),
            kind: kind_str.clone(),
            signature: symbol.signature.clone(),
            semantic: symbol
                .semantic
                .as_ref()
                .map(|s| serde_json::to_value(s).unwrap_or_default()),
            location: SymbolLocation {
                start_line: symbol.location.start_line as usize,
                end_line: symbol.location.end_line as usize,
            },
            children: Vec::new(), // TODO: 添加子符号
        };

        match kind_str.as_str() {
            "class" => symbols.classes.push(info),
            "interface" => symbols.interfaces.push(info),
            "function" => symbols.functions.push(info),
            "type" => symbols.types.push(info),
            "variable" => symbols.variables.push(info),
            "constant" => symbols.constants.push(info),
            _ => symbols.functions.push(info),
        }
    }

    // 解析导入
    let mut external_imports: HashSet<String> = HashSet::new();
    let mut internal_imports: HashSet<String> = HashSet::new();

    for imp in &module.imports {
        if imp.is_external {
            external_imports.insert(imp.source.clone());
        } else {
            internal_imports.insert(imp.source.clone());
        }
    }

    Some(ModuleDetailInfo {
        id: module.id.clone(),
        name: module.name.clone(),
        path: module.path.clone(),
        language: module.language.clone(),
        lines: module.lines,
        semantic: module
            .semantic
            .as_ref()
            .map(|s| serde_json::to_value(s).unwrap_or_default()),
        symbols,
        external_imports: external_imports.into_iter().collect(),
        internal_imports: internal_imports.into_iter().collect(),
    })
}

/// 获取符号引用信息
pub fn get_symbol_refs(
    blueprint: &EnhancedCodeBlueprint,
    symbol_id: &str,
) -> Option<SymbolRefInfo> {
    let symbol_entry = blueprint.symbols.get(symbol_id)?;

    let mut refs = SymbolRefInfo {
        symbol_id: symbol_id.to_string(),
        symbol_name: symbol_entry.name.clone(),
        symbol_kind: symbol_kind_to_string(&symbol_entry.kind),
        module_id: symbol_entry.module_id.clone(),
        called_by: Vec::new(),
        calls: Vec::new(),
        type_refs: Vec::new(),
    };

    // 从 blueprint.references.symbol_calls 中查找调用关系
    for call in &blueprint.references.symbol_calls {
        if call.callee == symbol_id {
            let caller_symbol = blueprint.symbols.get(&call.caller);
            refs.called_by.push(CallerInfo {
                symbol_id: call.caller.clone(),
                symbol_name: caller_symbol
                    .map(|s| s.name.clone())
                    .unwrap_or_else(|| call.caller.split("::").last().unwrap_or("").to_string()),
                module_id: caller_symbol
                    .map(|s| s.module_id.clone())
                    .unwrap_or_default(),
                call_type: call.call_type.clone(),
                locations: call
                    .locations
                    .iter()
                    .map(|loc| LineLocation {
                        line: loc.start_line as usize,
                    })
                    .collect(),
            });
        }

        if call.caller == symbol_id {
            let callee_symbol = blueprint.symbols.get(&call.callee);
            refs.calls.push(CallerInfo {
                symbol_id: call.callee.clone(),
                symbol_name: callee_symbol
                    .map(|s| s.name.clone())
                    .unwrap_or_else(|| call.callee.split("::").last().unwrap_or("").to_string()),
                module_id: callee_symbol
                    .map(|s| s.module_id.clone())
                    .unwrap_or_default(),
                call_type: call.call_type.clone(),
                locations: call
                    .locations
                    .iter()
                    .map(|loc| LineLocation {
                        line: loc.start_line as usize,
                    })
                    .collect(),
            });
        }
    }

    // 查找类型引用（extends/implements）
    for type_ref in &blueprint.references.type_refs {
        if type_ref.child == symbol_id {
            let parent_symbol = blueprint.symbols.get(&type_ref.parent);
            refs.type_refs.push(TypeRefInfo {
                related_symbol_id: type_ref.parent.clone(),
                related_symbol_name: parent_symbol.map(|s| s.name.clone()).unwrap_or_default(),
                kind: format!("{:?}", type_ref.kind).to_lowercase(),
                direction: "parent".to_string(),
            });
        }
        if type_ref.parent == symbol_id {
            let child_symbol = blueprint.symbols.get(&type_ref.child);
            refs.type_refs.push(TypeRefInfo {
                related_symbol_id: type_ref.child.clone(),
                related_symbol_name: child_symbol.map(|s| s.name.clone()).unwrap_or_default(),
                kind: format!("{:?}", type_ref.kind).to_lowercase(),
                direction: "child".to_string(),
            });
        }
    }

    Some(refs)
}
