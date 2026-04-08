//! 视图构建器
//!
//! 构建目录树视图和架构分层视图

use std::collections::HashMap;

use super::layer_classifier::LayerClassifier;
use super::types::ModuleNode;
use super::types_enhanced::*;

/// 视图构建器
pub struct ViewBuilder {
    classifier: LayerClassifier,
}

impl ViewBuilder {
    pub fn new() -> Self {
        Self {
            classifier: LayerClassifier::new(),
        }
    }

    /// 构建所有视图
    pub fn build_views(&self, modules: &[ModuleNode]) -> Views {
        Views {
            directory_tree: self.build_directory_tree(modules),
            architecture_layers: self.build_architecture_layers(modules),
        }
    }

    /// 构建目录树视图
    pub fn build_directory_tree(&self, modules: &[ModuleNode]) -> DirectoryNode {
        let mut root = DirectoryNode {
            name: "src".to_string(),
            path: "src".to_string(),
            node_type: DirectoryNodeType::Directory,
            description: None,
            purpose: None,
            module_id: None,
            children: Some(Vec::new()),
        };

        let mut sorted_modules: Vec<_> = modules.iter().collect();
        sorted_modules.sort_by(|a, b| a.id.cmp(&b.id));

        let mut dir_cache: HashMap<String, usize> = HashMap::new();

        for module in sorted_modules {
            let path = &module.id;
            if !path.starts_with("src/") && !path.starts_with("src\\") {
                continue;
            }

            let parts: Vec<&str> = path.split(&['/', '\\'][..]).collect();
            self.insert_module_node(&mut root, &parts, 1, module, &mut dir_cache);
        }

        self.sort_directory_children(&mut root);
        root
    }

    fn insert_module_node(
        &self,
        parent: &mut DirectoryNode,
        parts: &[&str],
        index: usize,
        module: &ModuleNode,
        _dir_cache: &mut HashMap<String, usize>,
    ) {
        if index >= parts.len() {
            return;
        }

        let part = parts[index];
        let is_last = index == parts.len() - 1;
        let current_path = parts[..=index].join("/");

        let children = parent.children.get_or_insert_with(Vec::new);

        if is_last {
            children.push(DirectoryNode {
                name: part.to_string(),
                path: current_path,
                node_type: DirectoryNodeType::File,
                description: None,
                purpose: None,
                module_id: Some(module.id.clone()),
                children: None,
            });
        } else {
            let dir_idx = children
                .iter()
                .position(|c| c.name == part && c.node_type == DirectoryNodeType::Directory);

            if let Some(idx) = dir_idx {
                self.insert_module_node(&mut children[idx], parts, index + 1, module, _dir_cache);
            } else {
                let mut new_dir = DirectoryNode {
                    name: part.to_string(),
                    path: current_path,
                    node_type: DirectoryNodeType::Directory,
                    description: None,
                    purpose: None,
                    module_id: None,
                    children: Some(Vec::new()),
                };
                self.insert_module_node(&mut new_dir, parts, index + 1, module, _dir_cache);
                children.push(new_dir);
            }
        }
    }

    fn sort_directory_children(&self, node: &mut DirectoryNode) {
        if let Some(ref mut children) = node.children {
            children.sort_by(|a, b| match (&a.node_type, &b.node_type) {
                (DirectoryNodeType::Directory, DirectoryNodeType::File) => std::cmp::Ordering::Less,
                (DirectoryNodeType::File, DirectoryNodeType::Directory) => {
                    std::cmp::Ordering::Greater
                }
                _ => a.name.cmp(&b.name),
            });

            for child in children.iter_mut() {
                if child.node_type == DirectoryNodeType::Directory {
                    self.sort_directory_children(child);
                }
            }
        }
    }

    /// 构建架构分层视图
    pub fn build_architecture_layers(&self, modules: &[ModuleNode]) -> ArchitectureLayers {
        let mut layers = ArchitectureLayers::default();

        for module in modules {
            let result = self.classifier.classify(module);

            let layer_info = match result.layer {
                ArchitectureLayer::Presentation => &mut layers.presentation,
                ArchitectureLayer::Business => &mut layers.business,
                ArchitectureLayer::Data => &mut layers.data,
                ArchitectureLayer::Infrastructure => &mut layers.infrastructure,
                ArchitectureLayer::CrossCutting => &mut layers.cross_cutting,
            };

            layer_info.modules.push(module.id.clone());

            if let Some(sub) = result.sub_layer {
                let sub_layers = layer_info.sub_layers.get_or_insert_with(HashMap::new);
                sub_layers.entry(sub).or_default().push(module.id.clone());
            }
        }

        // 排序
        layers.presentation.modules.sort();
        layers.business.modules.sort();
        layers.data.modules.sort();
        layers.infrastructure.modules.sort();
        layers.cross_cutting.modules.sort();

        layers
    }
}

impl Default for ViewBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// 统计目录树节点数量
pub fn count_tree_nodes(node: &DirectoryNode) -> (usize, usize) {
    let mut dirs = 0;
    let mut files = 0;

    fn count(n: &DirectoryNode, dirs: &mut usize, files: &mut usize) {
        match n.node_type {
            DirectoryNodeType::Directory => *dirs += 1,
            DirectoryNodeType::File => *files += 1,
        }
        if let Some(ref children) = n.children {
            for child in children {
                count(child, dirs, files);
            }
        }
    }

    count(node, &mut dirs, &mut files);
    (dirs, files)
}

/// 获取目录树最大深度
pub fn get_tree_depth(node: &DirectoryNode) -> usize {
    fn depth(n: &DirectoryNode, current: usize) -> usize {
        if let Some(ref children) = n.children {
            children
                .iter()
                .map(|c| depth(c, current + 1))
                .max()
                .unwrap_or(current)
        } else {
            current
        }
    }
    depth(node, 0)
}

/// 快速构建视图
pub fn build_views(modules: &[ModuleNode]) -> Views {
    ViewBuilder::new().build_views(modules)
}

/// 快速构建目录树
pub fn build_directory_tree(modules: &[ModuleNode]) -> DirectoryNode {
    ViewBuilder::new().build_directory_tree(modules)
}

/// 快速构建架构分层
pub fn build_architecture_layers(modules: &[ModuleNode]) -> ArchitectureLayers {
    ViewBuilder::new().build_architecture_layers(modules)
}
