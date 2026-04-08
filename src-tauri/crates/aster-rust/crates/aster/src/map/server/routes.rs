//! API 路由处理
//!
//! 定义可视化服务器的 API 端点

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::map::server::services::{
    architecture::{build_architecture_map, get_module_detail, get_symbol_refs},
    dependency::{build_dependency_tree, detect_entry_points},
};
use crate::map::server::types::*;
use crate::map::types_enhanced::EnhancedCodeBlueprint;

/// API 错误
#[derive(Debug, Clone)]
pub struct ApiError {
    pub message: String,
    pub status_code: u16,
}

impl ApiError {
    pub fn not_found(msg: &str) -> Self {
        Self {
            message: msg.to_string(),
            status_code: 404,
        }
    }

    pub fn bad_request(msg: &str) -> Self {
        Self {
            message: msg.to_string(),
            status_code: 400,
        }
    }

    pub fn internal(msg: &str) -> Self {
        Self {
            message: msg.to_string(),
            status_code: 500,
        }
    }
}

/// 检查是否为增强格式
pub fn is_enhanced_format(data: &serde_json::Value) -> bool {
    data.get("format").and_then(|v| v.as_str()) == Some("enhanced")
        && data.get("modules").is_some()
        && data.get("references").is_some()
}

/// 加载蓝图数据
pub fn load_blueprint(ontology_path: &Path) -> Result<serde_json::Value, ApiError> {
    let content = fs::read_to_string(ontology_path)
        .map_err(|e| ApiError::internal(&format!("读取文件失败: {}", e)))?;
    serde_json::from_str(&content)
        .map_err(|e| ApiError::internal(&format!("解析 JSON 失败: {}", e)))
}

/// 加载增强蓝图
pub fn load_enhanced_blueprint(ontology_path: &Path) -> Result<EnhancedCodeBlueprint, ApiError> {
    let content = fs::read_to_string(ontology_path)
        .map_err(|e| ApiError::internal(&format!("读取文件失败: {}", e)))?;
    serde_json::from_str(&content).map_err(|e| ApiError::internal(&format!("解析蓝图失败: {}", e)))
}

/// 推断 map 目录
pub fn infer_map_dir(ontology_path: &Path) -> PathBuf {
    if ontology_path
        .extension()
        .map(|e| e == "json")
        .unwrap_or(false)
    {
        ontology_path
            .parent()
            .unwrap_or(Path::new("."))
            .join(".claude/map")
    } else {
        ontology_path.to_path_buf()
    }
}

/// API 处理器集合
pub struct ApiHandlers {
    ontology_path: PathBuf,
    map_dir: PathBuf,
}

impl ApiHandlers {
    pub fn new(ontology_path: PathBuf) -> Self {
        let map_dir = infer_map_dir(&ontology_path);
        Self {
            ontology_path,
            map_dir,
        }
    }

    /// 获取本体数据（chunked 模式的 index.json）
    pub fn get_ontology(&self) -> Result<serde_json::Value, ApiError> {
        let index_path = self.map_dir.join("index.json");
        if index_path.exists() {
            let content =
                fs::read_to_string(&index_path).map_err(|e| ApiError::internal(&e.to_string()))?;
            serde_json::from_str(&content).map_err(|e| ApiError::internal(&e.to_string()))
        } else {
            Err(ApiError::not_found(
                "Blueprint not found. Please run /map generate first.",
            ))
        }
    }

    /// 获取 chunk 数据
    pub fn get_chunk(&self, chunk_path: &str) -> Result<serde_json::Value, ApiError> {
        // 安全性检查
        if chunk_path.contains("..") || chunk_path.contains('~') {
            return Err(ApiError::bad_request("Invalid chunk path"));
        }

        let chunk_file = self
            .map_dir
            .join("chunks")
            .join(format!("{}.json", chunk_path));
        if !chunk_file.exists() {
            return Err(ApiError::not_found(&format!(
                "Chunk not found: {}",
                chunk_path
            )));
        }

        let content =
            fs::read_to_string(&chunk_file).map_err(|e| ApiError::internal(&e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| ApiError::internal(&e.to_string()))
    }

    /// 获取架构图数据
    pub fn get_architecture(&self) -> Result<ArchitectureMap, ApiError> {
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        Ok(build_architecture_map(&blueprint))
    }

    /// 获取入口点列表
    pub fn get_entry_points(&self) -> Result<EntryPointsResponse, ApiError> {
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        let entries = detect_entry_points(&blueprint);
        Ok(EntryPointsResponse {
            entry_points: entries,
        })
    }

    /// 获取依赖树
    pub fn get_dependency_tree(
        &self,
        entry_id: &str,
        max_depth: usize,
    ) -> Result<DependencyTreeNode, ApiError> {
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        build_dependency_tree(&blueprint, entry_id, max_depth)
            .ok_or_else(|| ApiError::not_found("Entry module not found"))
    }

    /// 获取模块详情
    pub fn get_module_detail(&self, module_id: &str) -> Result<ModuleDetailInfo, ApiError> {
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        get_module_detail(&blueprint, module_id)
            .ok_or_else(|| ApiError::not_found("Module not found"))
    }

    /// 获取符号引用
    pub fn get_symbol_refs(&self, symbol_id: &str) -> Result<SymbolRefInfo, ApiError> {
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        get_symbol_refs(&blueprint, symbol_id)
            .ok_or_else(|| ApiError::not_found("Symbol not found"))
    }

    /// 搜索
    pub fn search(&self, query: &str) -> Result<SearchResponse, ApiError> {
        if query.is_empty() {
            return Ok(SearchResponse {
                results: Vec::new(),
            });
        }

        let query_lower = query.to_lowercase();
        let blueprint = load_enhanced_blueprint(&self.ontology_path)?;
        let mut results: Vec<SearchResultItem> = Vec::new();

        // 搜索模块
        for module in blueprint.modules.values() {
            if module.name.to_lowercase().contains(&query_lower)
                || module.id.to_lowercase().contains(&query_lower)
            {
                results.push(SearchResultItem {
                    result_type: "module".to_string(),
                    id: module.id.clone(),
                    name: module.name.clone(),
                    module_id: None,
                    description: module.semantic.as_ref().map(|s| s.description.clone()),
                });
            }
        }

        // 搜索符号
        for symbol in blueprint.symbols.values() {
            if symbol.name.to_lowercase().contains(&query_lower) {
                let kind_str = format!("{:?}", symbol.kind).to_lowercase();
                results.push(SearchResultItem {
                    result_type: kind_str,
                    id: symbol.id.clone(),
                    name: symbol.name.clone(),
                    module_id: Some(symbol.module_id.clone()),
                    description: symbol.semantic.as_ref().map(|s| s.description.clone()),
                });
            }
        }

        results.truncate(50);
        Ok(SearchResponse { results })
    }

    /// 获取所有 chunk 元数据
    pub fn get_all_chunk_metadata(&self) -> Result<HashMap<String, ChunkMetadata>, ApiError> {
        let chunks_dir = self.map_dir.join("chunks");
        if !chunks_dir.exists() {
            return Ok(HashMap::new());
        }

        let mut metadata: HashMap<String, ChunkMetadata> = HashMap::new();

        let entries = fs::read_dir(&chunks_dir).map_err(|e| ApiError::internal(&e.to_string()))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Some(file_name) = path.file_stem().and_then(|s| s.to_str()) {
                    let dir_path = if file_name == "root" {
                        String::new()
                    } else {
                        file_name.replace('_', "/")
                    };

                    if let Ok(meta) = fs::metadata(&path) {
                        let modified = meta
                            .modified()
                            .map(|t| {
                                t.duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_secs())
                                    .unwrap_or(0)
                            })
                            .unwrap_or(0);

                        metadata.insert(
                            dir_path,
                            ChunkMetadata {
                                file: format!("chunks/{}.json", file_name),
                                last_modified: modified,
                                size: meta.len(),
                                checksum: format!("{}-{}", meta.len(), modified),
                            },
                        );
                    }
                }
            }
        }

        Ok(metadata)
    }
}

/// Chunk 元数据
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMetadata {
    pub file: String,
    pub last_modified: u64,
    pub size: u64,
    pub checksum: String,
}
