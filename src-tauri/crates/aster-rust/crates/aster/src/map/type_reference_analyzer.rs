//! 类型引用分析器
//!
//! 分析 extends、implements 等类型级引用关系

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::types::{ClassNode, InterfaceNode, ModuleNode};
use super::types_enhanced::{TypeRefKind, TypeReference};

/// 类型引用分析器
pub struct TypeReferenceAnalyzer {
    root_path: PathBuf,
    /// 类索引（按名称）
    class_index: HashMap<String, Vec<String>>,
    /// 接口索引（按名称）
    interface_index: HashMap<String, Vec<String>>,
}

impl TypeReferenceAnalyzer {
    /// 创建新的分析器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
            class_index: HashMap::new(),
            interface_index: HashMap::new(),
        }
    }

    /// 分析模块列表，提取类型引用关系
    pub fn analyze(&mut self, modules: &[ModuleNode]) -> Vec<TypeReference> {
        // 1. 构建类型索引
        self.build_type_index(modules);

        // 2. 分析继承和实现关系
        let mut references = Vec::new();

        for module in modules {
            // 分析类的继承和实现
            for cls in &module.classes {
                let class_refs = self.analyze_class_relations(cls, module);
                references.extend(class_refs);
            }

            // 分析接口的继承
            for iface in &module.interfaces {
                let iface_refs = self.analyze_interface_relations(iface, module);
                references.extend(iface_refs);
            }
        }

        references
    }

    /// 构建类型索引
    fn build_type_index(&mut self, modules: &[ModuleNode]) {
        self.class_index.clear();
        self.interface_index.clear();

        for module in modules {
            // 索引类
            for cls in &module.classes {
                self.class_index
                    .entry(cls.name.clone())
                    .or_default()
                    .push(cls.id.clone());
            }

            // 索引接口
            for iface in &module.interfaces {
                self.interface_index
                    .entry(iface.name.clone())
                    .or_default()
                    .push(iface.id.clone());
            }
        }
    }

    /// 分析类的继承和实现关系
    fn analyze_class_relations(&self, cls: &ClassNode, module: &ModuleNode) -> Vec<TypeReference> {
        let mut refs = Vec::new();

        // extends 关系
        if let Some(ref extends) = cls.extends {
            let parent_name = self.extract_type_name(extends);
            let parent_ids = self.find_type_by_name(&parent_name, module, TypeKind::Class);

            for parent_id in parent_ids {
                refs.push(TypeReference {
                    child: cls.id.clone(),
                    parent: parent_id,
                    kind: TypeRefKind::Extends,
                });
            }
        }

        // implements 关系
        if let Some(ref implements) = cls.implements {
            for iface_name in implements {
                let clean_name = self.extract_type_name(iface_name);
                let iface_ids = self.find_type_by_name(&clean_name, module, TypeKind::Interface);

                for iface_id in iface_ids {
                    refs.push(TypeReference {
                        child: cls.id.clone(),
                        parent: iface_id,
                        kind: TypeRefKind::Implements,
                    });
                }
            }
        }

        refs
    }

    /// 分析接口的继承关系
    fn analyze_interface_relations(
        &self,
        iface: &InterfaceNode,
        module: &ModuleNode,
    ) -> Vec<TypeReference> {
        let mut refs = Vec::new();

        if let Some(ref extends) = iface.extends {
            for parent_name in extends {
                let clean_name = self.extract_type_name(parent_name);
                let parent_ids = self.find_type_by_name(&clean_name, module, TypeKind::Interface);

                for parent_id in parent_ids {
                    refs.push(TypeReference {
                        child: iface.id.clone(),
                        parent: parent_id,
                        kind: TypeRefKind::Extends,
                    });
                }
            }
        }

        refs
    }

    /// 提取类型名称（去除泛型参数）
    fn extract_type_name(&self, full_type: &str) -> String {
        // 去除泛型参数 Foo<T> -> Foo
        if let Some(generic_index) = full_type.find('<') {
            full_type
                .get(..generic_index)
                .unwrap_or(full_type)
                .trim()
                .to_string()
        } else {
            full_type.trim().to_string()
        }
    }

    /// 根据名称查找类型
    fn find_type_by_name(
        &self,
        name: &str,
        current_module: &ModuleNode,
        prefer_kind: TypeKind,
    ) -> Vec<String> {
        let index = match prefer_kind {
            TypeKind::Class => &self.class_index,
            TypeKind::Interface => &self.interface_index,
        };

        let candidates = match index.get(name) {
            Some(c) => c.clone(),
            None => {
                // 尝试在另一个索引中查找
                let other_index = match prefer_kind {
                    TypeKind::Class => &self.interface_index,
                    TypeKind::Interface => &self.class_index,
                };
                other_index.get(name).cloned().unwrap_or_default()
            }
        };

        if candidates.is_empty() {
            return vec![];
        }

        // 优先选择同模块或导入的
        let imported_types: std::collections::HashSet<String> = current_module
            .imports
            .iter()
            .flat_map(|imp| imp.symbols.iter().cloned())
            .collect();

        let same_module: Vec<_> = candidates
            .iter()
            .filter(|id| id.starts_with(&format!("{}::", current_module.id)))
            .cloned()
            .collect();

        if !same_module.is_empty() {
            return same_module;
        }

        let imported: Vec<_> = candidates
            .iter()
            .filter(|_| imported_types.contains(name))
            .cloned()
            .collect();

        if !imported.is_empty() {
            return imported;
        }

        // 返回第一个候选
        candidates.into_iter().take(1).collect()
    }
}

/// 类型种类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TypeKind {
    Class,
    Interface,
}

// ============================================================================
// 类型使用分析
// ============================================================================

/// 类型使用信息
#[derive(Debug, Clone)]
pub struct TypeUsage {
    /// 使用者符号 ID
    pub user: String,
    /// 被使用的类型名称
    pub type_name: String,
    /// 使用方式
    pub usage_kind: TypeUsageKind,
    /// 位置信息
    pub location: Option<TypeUsageLocation>,
}

/// 类型使用位置
#[derive(Debug, Clone)]
pub struct TypeUsageLocation {
    pub file: String,
    pub line: usize,
}

/// 类型使用方式
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeUsageKind {
    Parameter,
    Return,
    Property,
    Generic,
    Cast,
}

/// 类型使用分析器
pub struct TypeUsageAnalyzer {
    root_path: PathBuf,
}

impl TypeUsageAnalyzer {
    /// 创建新的分析器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
        }
    }

    /// 分析类型使用
    pub fn analyze(&self, modules: &[ModuleNode]) -> Vec<TypeUsage> {
        let mut usages = Vec::new();

        for module in modules {
            // 分析函数参数和返回值
            for func in &module.functions {
                // 参数类型
                for param in &func.parameters {
                    if let Some(ref param_type) = param.param_type {
                        if self.is_custom_type(param_type) {
                            usages.push(TypeUsage {
                                user: func.id.clone(),
                                type_name: self.extract_type_name(param_type),
                                usage_kind: TypeUsageKind::Parameter,
                                location: None,
                            });
                        }
                    }
                }

                // 返回类型
                if let Some(ref return_type) = func.return_type {
                    if self.is_custom_type(return_type) {
                        usages.push(TypeUsage {
                            user: func.id.clone(),
                            type_name: self.extract_type_name(return_type),
                            usage_kind: TypeUsageKind::Return,
                            location: None,
                        });
                    }
                }
            }

            // 分析类方法和属性
            for cls in &module.classes {
                for method in &cls.methods {
                    for param in &method.parameters {
                        if let Some(ref param_type) = param.param_type {
                            if self.is_custom_type(param_type) {
                                usages.push(TypeUsage {
                                    user: method.id.clone(),
                                    type_name: self.extract_type_name(param_type),
                                    usage_kind: TypeUsageKind::Parameter,
                                    location: None,
                                });
                            }
                        }
                    }

                    if let Some(ref return_type) = method.return_type {
                        if self.is_custom_type(return_type) {
                            usages.push(TypeUsage {
                                user: method.id.clone(),
                                type_name: self.extract_type_name(return_type),
                                usage_kind: TypeUsageKind::Return,
                                location: None,
                            });
                        }
                    }
                }

                for prop in &cls.properties {
                    if let Some(ref prop_type) = prop.prop_type {
                        if self.is_custom_type(prop_type) {
                            usages.push(TypeUsage {
                                user: prop.id.clone(),
                                type_name: self.extract_type_name(prop_type),
                                usage_kind: TypeUsageKind::Property,
                                location: None,
                            });
                        }
                    }
                }
            }
        }

        usages
    }

    /// 判断是否为自定义类型（非基础类型）
    fn is_custom_type(&self, type_name: &str) -> bool {
        let builtin_types: std::collections::HashSet<&str> = [
            "string",
            "number",
            "boolean",
            "void",
            "null",
            "undefined",
            "any",
            "unknown",
            "never",
            "object",
            "symbol",
            "bigint",
            "String",
            "Number",
            "Boolean",
            "Object",
            "Symbol",
            "BigInt",
            "Array",
            "Map",
            "Set",
            "WeakMap",
            "WeakSet",
            "Promise",
            "Date",
            "RegExp",
            "Error",
            "Function",
            // Rust types
            "str",
            "i8",
            "i16",
            "i32",
            "i64",
            "i128",
            "isize",
            "u8",
            "u16",
            "u32",
            "u64",
            "u128",
            "usize",
            "f32",
            "f64",
            "bool",
            "char",
            "Vec",
            "HashMap",
            "HashSet",
            "Option",
            "Result",
            "Box",
            "Rc",
            "Arc",
            "RefCell",
            "Cell",
        ]
        .into_iter()
        .collect();

        let base_name = self.extract_type_name(type_name);
        !builtin_types.contains(base_name.as_str())
    }

    /// 提取类型名称
    fn extract_type_name(&self, full_type: &str) -> String {
        // 去除泛型、数组标记等
        let name = full_type
            .replace(['<', '>'], " ")
            .replace("[]", "")
            .replace(['|', '&'], " ");

        // 取第一个单词
        name.split_whitespace().next().unwrap_or(&name).to_string()
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/// 分析类型引用关系
pub fn analyze_type_references(
    root_path: impl AsRef<Path>,
    modules: &[ModuleNode],
) -> Vec<TypeReference> {
    let mut analyzer = TypeReferenceAnalyzer::new(root_path);
    analyzer.analyze(modules)
}

/// 分析类型使用
pub fn analyze_type_usages(root_path: impl AsRef<Path>, modules: &[ModuleNode]) -> Vec<TypeUsage> {
    let analyzer = TypeUsageAnalyzer::new(root_path);
    analyzer.analyze(modules)
}
