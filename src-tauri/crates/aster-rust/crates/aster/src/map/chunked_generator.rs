//! 分块代码蓝图生成器
//!
//! 核心策略：
//! 1. 复用 EnhancedOntologyGenerator 生成完整蓝图
//! 2. 按目录拆分成多个 chunk 文件
//! 3. 生成轻量级 index.json

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::enhanced_generator::EnhancedOntologyGenerator;
use super::types_chunked::*;
use super::types_enhanced::*;

/// 分块蓝图生成器
pub struct ChunkedBlueprintGenerator {
    root_path: PathBuf,
    options: ChunkedGenerateOptions,
    map_dir: PathBuf,
    chunks_dir: PathBuf,
}

impl ChunkedBlueprintGenerator {
    pub fn new(root_path: impl AsRef<Path>, options: Option<ChunkedGenerateOptions>) -> Self {
        let root = root_path.as_ref().to_path_buf();
        let opts = options.unwrap_or_default();
        let map_dir = opts
            .output_dir
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join(".claude").join("map"));
        let chunks_dir = map_dir.join("chunks");

        Self {
            root_path: root,
            options: opts,
            map_dir,
            chunks_dir,
        }
    }

    /// 生成分块蓝图
    pub fn generate(&self) -> std::io::Result<()> {
        // 1. 生成完整蓝图
        let generator = EnhancedOntologyGenerator::new(&self.root_path, None);
        let blueprint = generator.generate();

        // 2. 确保目录存在
        std::fs::create_dir_all(&self.map_dir)?;
        std::fs::create_dir_all(&self.chunks_dir)?;

        // 3. 按目录分组模块
        let chunks = self.group_modules_by_directory(&blueprint.modules);

        // 4. 生成每个 chunk 文件
        let chunk_metadata = self.generate_chunks(&chunks, &blueprint)?;

        // 5. 生成 index.json
        let index = self.build_index_file(&blueprint, &chunks, &chunk_metadata);
        let index_path = self.map_dir.join("index.json");
        let json = serde_json::to_string_pretty(&index)?;
        std::fs::write(index_path, json)?;

        Ok(())
    }

    fn group_modules_by_directory(
        &self,
        modules: &HashMap<String, EnhancedModule>,
    ) -> HashMap<String, Vec<EnhancedModule>> {
        let mut chunks: HashMap<String, Vec<EnhancedModule>> = HashMap::new();

        for module in modules.values() {
            let dir_path = self.get_module_directory(&module.id);
            chunks.entry(dir_path).or_default().push(module.clone());
        }

        chunks
    }

    fn get_module_directory(&self, module_id: &str) -> String {
        let path = Path::new(module_id);
        path.parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    }

    fn generate_chunks(
        &self,
        chunks: &HashMap<String, Vec<EnhancedModule>>,
        blueprint: &EnhancedCodeBlueprint,
    ) -> std::io::Result<HashMap<String, ChunkMetadata>> {
        let mut metadata_map = HashMap::new();

        for (dir_path, modules) in chunks {
            let chunk_data = self.build_chunk_file(dir_path, modules, blueprint);
            let metadata = self.write_chunk_file(dir_path, &chunk_data)?;
            metadata_map.insert(dir_path.clone(), metadata);
        }

        Ok(metadata_map)
    }

    fn build_chunk_file(
        &self,
        dir_path: &str,
        modules: &[EnhancedModule],
        blueprint: &EnhancedCodeBlueprint,
    ) -> ChunkData {
        let module_ids: std::collections::HashSet<_> =
            modules.iter().map(|m| m.id.clone()).collect();

        let chunk_modules: HashMap<String, EnhancedModule> =
            modules.iter().map(|m| (m.id.clone(), m.clone())).collect();

        let chunk_symbols: HashMap<String, SymbolEntry> = blueprint
            .symbols
            .iter()
            .filter(|(_, s)| module_ids.contains(&s.module_id))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        let chunk_refs = ChunkReferences {
            module_deps: blueprint
                .references
                .module_deps
                .iter()
                .filter(|d| module_ids.contains(&d.source) || module_ids.contains(&d.target))
                .cloned()
                .collect(),
            symbol_calls: blueprint
                .references
                .symbol_calls
                .iter()
                .filter(|c| {
                    let caller_mod = c.caller.split("::").next().unwrap_or("");
                    let callee_mod = c.callee.split("::").next().unwrap_or("");
                    module_ids.contains(caller_mod) || module_ids.contains(callee_mod)
                })
                .cloned()
                .collect(),
            type_refs: blueprint
                .references
                .type_refs
                .iter()
                .filter(|r| {
                    let child_mod = r.child.split("::").next().unwrap_or("");
                    let parent_mod = r.parent.split("::").next().unwrap_or("");
                    module_ids.contains(child_mod) || module_ids.contains(parent_mod)
                })
                .cloned()
                .collect(),
        };

        ChunkData {
            path: dir_path.to_string(),
            modules: chunk_modules,
            symbols: chunk_symbols,
            references: chunk_refs,
            metadata: None,
            planned_modules: None,
            refactoring_tasks: None,
            module_design_meta: None,
        }
    }

    fn write_chunk_file(
        &self,
        dir_path: &str,
        chunk_data: &ChunkData,
    ) -> std::io::Result<ChunkMetadata> {
        let chunk_file_name = self.get_chunk_file_name(dir_path);
        let chunk_path = self.chunks_dir.join(&chunk_file_name);

        let json = serde_json::to_string_pretty(chunk_data)?;

        let checksum = if self.options.with_checksum {
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            json.hash(&mut hasher);
            format!("{:x}", hasher.finish())
        } else {
            String::new()
        };

        std::fs::write(chunk_path, &json)?;

        Ok(ChunkMetadata {
            last_modified: chrono::Utc::now().to_rfc3339(),
            module_count: chunk_data.modules.len(),
            checksum,
        })
    }

    fn get_chunk_file_name(&self, dir_path: &str) -> String {
        if dir_path.is_empty() {
            "root.json".to_string()
        } else {
            format!("{}.json", dir_path.replace(['/', '\\'], "_"))
        }
    }

    fn build_index_file(
        &self,
        blueprint: &EnhancedCodeBlueprint,
        chunks: &HashMap<String, Vec<EnhancedModule>>,
        _chunk_metadata: &HashMap<String, ChunkMetadata>,
    ) -> ChunkedIndex {
        let mut chunk_index = HashMap::new();
        for dir_path in chunks.keys() {
            chunk_index.insert(
                dir_path.clone(),
                format!("chunks/{}", self.get_chunk_file_name(dir_path)),
            );
        }

        let global_dep_graph = if self.options.with_global_dependency_graph {
            Some(self.build_global_dependency_graph(blueprint))
        } else {
            None
        };

        ChunkedIndex {
            format: "chunked-v1".to_string(),
            meta: ChunkedMeta {
                version: blueprint.meta.version.clone(),
                generated_at: blueprint.meta.generated_at.clone(),
                generator_version: blueprint.meta.generator_version.clone(),
                updated_at: Some(chrono::Utc::now().to_rfc3339()),
            },
            project: blueprint.project.clone(),
            views: self.build_lightweight_views(blueprint, chunks, &chunk_index),
            statistics: blueprint.statistics.clone(),
            chunk_index,
            global_dependency_graph: global_dep_graph,
        }
    }

    fn build_lightweight_views(
        &self,
        blueprint: &EnhancedCodeBlueprint,
        chunks: &HashMap<String, Vec<EnhancedModule>>,
        chunk_index: &HashMap<String, String>,
    ) -> LightweightViews {
        LightweightViews {
            directory_tree: self.convert_tree_with_chunks(
                &blueprint.views.directory_tree,
                chunks,
                chunk_index,
            ),
            architecture_layers: self.convert_layers_with_chunks(
                &blueprint.views.architecture_layers,
                chunks,
                chunk_index,
            ),
        }
    }

    fn convert_tree_with_chunks(
        &self,
        tree: &DirectoryNode,
        chunks: &HashMap<String, Vec<EnhancedModule>>,
        chunk_index: &HashMap<String, String>,
    ) -> DirectoryNodeWithChunk {
        let chunk_file = chunk_index.get(&tree.path).cloned();
        let module_count = chunks.get(&tree.path).map(|m| m.len());

        DirectoryNodeWithChunk {
            name: tree.name.clone(),
            path: tree.path.clone(),
            node_type: tree.node_type,
            chunk_file,
            module_count,
            children: tree.children.as_ref().map(|children| {
                children
                    .iter()
                    .map(|c| self.convert_tree_with_chunks(c, chunks, chunk_index))
                    .collect()
            }),
        }
    }

    fn convert_layers_with_chunks(
        &self,
        layers: &ArchitectureLayers,
        chunks: &HashMap<String, Vec<EnhancedModule>>,
        chunk_index: &HashMap<String, String>,
    ) -> ArchitectureLayersWithChunks {
        ArchitectureLayersWithChunks {
            presentation: self.convert_layer(&layers.presentation, chunks, chunk_index),
            business: self.convert_layer(&layers.business, chunks, chunk_index),
            data: self.convert_layer(&layers.data, chunks, chunk_index),
            infrastructure: self.convert_layer(&layers.infrastructure, chunks, chunk_index),
            cross_cutting: self.convert_layer(&layers.cross_cutting, chunks, chunk_index),
        }
    }

    fn convert_layer(
        &self,
        layer: &LayerInfo,
        _chunks: &HashMap<String, Vec<EnhancedModule>>,
        chunk_index: &HashMap<String, String>,
    ) -> LayerWithChunks {
        let mut chunk_files = std::collections::HashSet::new();
        for module_id in &layer.modules {
            let dir = self.get_module_directory(module_id);
            if let Some(chunk_file) = chunk_index.get(&dir) {
                chunk_files.insert(chunk_file.clone());
            }
        }

        LayerWithChunks {
            name: layer.description.clone(),
            description: Some(layer.description.clone()),
            chunk_files: chunk_files.into_iter().collect(),
            module_count: layer.modules.len(),
        }
    }

    fn build_global_dependency_graph(
        &self,
        blueprint: &EnhancedCodeBlueprint,
    ) -> HashMap<String, GlobalDependencyNode> {
        let mut graph: HashMap<String, GlobalDependencyNode> = HashMap::new();

        for module_id in blueprint.modules.keys() {
            graph.insert(
                module_id.clone(),
                GlobalDependencyNode {
                    imports: Vec::new(),
                    imported_by: Vec::new(),
                    exports_symbols: false,
                },
            );
        }

        for dep in &blueprint.references.module_deps {
            if let Some(node) = graph.get_mut(&dep.source) {
                node.imports.push(dep.target.clone());
            }
            if let Some(node) = graph.get_mut(&dep.target) {
                node.imported_by.push(dep.source.clone());
            }
        }

        for (module_id, module) in &blueprint.modules {
            if let Some(node) = graph.get_mut(module_id) {
                node.exports_symbols = !module.exports.is_empty();
            }
        }

        graph
    }
}
