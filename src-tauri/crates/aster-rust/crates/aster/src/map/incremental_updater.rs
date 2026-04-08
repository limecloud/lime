//! 增量蓝图更新器
//!
//! 核心功能：
//! 1. 检测变更文件（基于 git diff 或手动指定）
//! 2. 分析影响范围（级联更新）
//! 3. 重新生成受影响的 chunk
//! 4. 更新 index.json 的统计信息

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::types_chunked::*;

/// 更新选项
#[derive(Debug, Clone, Default)]
pub struct UpdateOptions {
    /// 完全重新生成（忽略增量）
    pub full_rebuild: bool,
    /// 手动指定变更文件
    pub files: Option<Vec<String>>,
    /// 手动指定目标目录
    pub target_dir: Option<String>,
    /// 是否显示详细日志
    pub verbose: bool,
    /// 进度回调
    pub on_progress: Option<fn(&str)>,
}

/// 更新结果
#[derive(Debug, Clone)]
pub struct UpdateResult {
    /// 结果消息
    pub message: String,
    /// 更新的 chunk 数量
    pub chunks_updated: usize,
    /// 变更的文件列表
    pub files: Vec<String>,
    /// 受影响的目录列表
    pub affected_dirs: Vec<String>,
}

/// Git diff 结果
#[derive(Debug, Clone, Default)]
struct GitDiffResult {
    /// 修改的文件
    modified_files: Vec<String>,
    /// 新增的文件
    added_files: Vec<String>,
    /// 删除的文件
    deleted_files: Vec<String>,
}

/// 增量蓝图更新器
pub struct IncrementalBlueprintUpdater {
    root_path: PathBuf,
    map_dir: PathBuf,
    chunks_dir: PathBuf,
    index_path: PathBuf,
    index: Option<ChunkedIndex>,
}

impl IncrementalBlueprintUpdater {
    /// 创建新的更新器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        let root = root_path.as_ref().to_path_buf();
        let map_dir = root.join(".claude").join("map");
        let chunks_dir = map_dir.join("chunks");
        let index_path = map_dir.join("index.json");

        Self {
            root_path: root,
            map_dir,
            chunks_dir,
            index_path,
            index: None,
        }
    }

    /// 执行增量更新
    pub fn update(&mut self, options: &UpdateOptions) -> UpdateResult {
        self.log(options, "开始增量更新...");

        // 检查蓝图是否存在
        if !self.index_path.exists() {
            return UpdateResult {
                message: "蓝图不存在，请先运行 /map generate".to_string(),
                chunks_updated: 0,
                files: vec![],
                affected_dirs: vec![],
            };
        }

        // 加载索引
        if let Err(e) = self.load_index() {
            return UpdateResult {
                message: format!("加载索引失败: {}", e),
                chunks_updated: 0,
                files: vec![],
                affected_dirs: vec![],
            };
        }

        // 1. 检测变更文件
        let changed_files = self.detect_changed_files(options);

        if changed_files.is_empty() {
            return UpdateResult {
                message: "没有检测到变更".to_string(),
                chunks_updated: 0,
                files: vec![],
                affected_dirs: vec![],
            };
        }

        self.log(
            options,
            &format!("检测到 {} 个变更文件", changed_files.len()),
        );

        // 2. 分析影响范围
        let affected_dirs = self.analyze_impact(&changed_files, options);
        self.log(
            options,
            &format!("影响范围：{} 个目录", affected_dirs.len()),
        );

        // 3. 重新生成受影响的 chunk
        let updated_chunks = self.regenerate_chunks(&affected_dirs, options);
        self.log(
            options,
            &format!("已更新 {} 个 chunk", updated_chunks.len()),
        );

        // 4. 更新 index.json
        self.update_index(&updated_chunks, &changed_files, options);

        UpdateResult {
            message: format!("✓ 已更新 {} 个 chunk", updated_chunks.len()),
            chunks_updated: updated_chunks.len(),
            files: changed_files,
            affected_dirs: affected_dirs.into_iter().collect(),
        }
    }

    /// 加载索引
    fn load_index(&mut self) -> Result<(), String> {
        let content =
            fs::read_to_string(&self.index_path).map_err(|e| format!("读取索引失败: {}", e))?;
        self.index =
            Some(serde_json::from_str(&content).map_err(|e| format!("解析索引失败: {}", e))?);
        Ok(())
    }

    /// 检测变更文件
    fn detect_changed_files(&self, options: &UpdateOptions) -> Vec<String> {
        // 完全重建：返回所有源文件
        if options.full_rebuild {
            return self.get_all_source_files();
        }

        // 手动指定文件
        if let Some(ref files) = options.files {
            return files
                .iter()
                .filter(|f| self.is_source_file(f))
                .cloned()
                .collect();
        }

        // 手动指定目录
        if let Some(ref target_dir) = options.target_dir {
            return self.get_files_in_directory(target_dir);
        }

        // 自动检测 git 变更
        match self.get_git_diff() {
            Ok(git_diff) => {
                let mut all_changed = Vec::new();
                all_changed.extend(git_diff.modified_files);
                all_changed.extend(git_diff.added_files);
                all_changed.extend(git_diff.deleted_files);
                all_changed
                    .into_iter()
                    .filter(|f| self.is_source_file(f))
                    .collect()
            }
            Err(e) => {
                self.log(options, &format!("Git diff 失败: {}", e));
                vec![]
            }
        }
    }

    /// 获取 git diff 结果
    fn get_git_diff(&self) -> Result<GitDiffResult, String> {
        let mut result = GitDiffResult::default();

        // 检测工作区修改（未暂存）
        let unstaged = Command::new("git")
            .args(["diff", "--name-status"])
            .current_dir(&self.root_path)
            .output()
            .map_err(|e| format!("执行 git diff 失败: {}", e))?;

        // 检测暂存区修改
        let staged = Command::new("git")
            .args(["diff", "--cached", "--name-status"])
            .current_dir(&self.root_path)
            .output()
            .map_err(|e| format!("执行 git diff --cached 失败: {}", e))?;

        // 解析结果
        self.parse_git_output(&String::from_utf8_lossy(&unstaged.stdout), &mut result);
        self.parse_git_output(&String::from_utf8_lossy(&staged.stdout), &mut result);

        Ok(result)
    }

    /// 解析 git 输出
    fn parse_git_output(&self, output: &str, result: &mut GitDiffResult) {
        for line in output.lines().filter(|l| !l.is_empty()) {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 {
                continue;
            }

            let status = parts[0].chars().next().unwrap_or(' ');
            let file = parts[1..].join("\t");

            match status {
                'M' => {
                    if !result.modified_files.contains(&file) {
                        result.modified_files.push(file);
                    }
                }
                'A' => {
                    if !result.added_files.contains(&file) {
                        result.added_files.push(file);
                    }
                }
                'D' => {
                    if !result.deleted_files.contains(&file) {
                        result.deleted_files.push(file);
                    }
                }
                'R' => {
                    // 重命名：parts[1] 是旧名，parts[2] 是新名
                    if parts.len() >= 3 {
                        result.deleted_files.push(parts[1].to_string());
                        result.added_files.push(parts[2].to_string());
                    }
                }
                _ => {}
            }
        }
    }

    /// 获取所有源文件
    fn get_all_source_files(&self) -> Vec<String> {
        let mut files = Vec::new();
        let src_dir = self.root_path.join("src");

        if src_dir.exists() {
            self.collect_source_files(&src_dir, &mut files);
        }

        files
    }

    /// 递归收集源文件
    fn collect_source_files(&self, dir: &Path, files: &mut Vec<String>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // 跳过 node_modules 和 dist
                    let name = path.file_name().unwrap_or_default().to_string_lossy();
                    if name != "node_modules" && name != "dist" && name != "target" {
                        self.collect_source_files(&path, files);
                    }
                } else if self.is_source_file(&path.to_string_lossy()) {
                    if let Ok(rel_path) = path.strip_prefix(&self.root_path) {
                        files.push(rel_path.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    /// 获取指定目录下的文件
    fn get_files_in_directory(&self, dir: &str) -> Vec<String> {
        let mut files = Vec::new();
        let target_dir = self.root_path.join(dir);

        if target_dir.exists() {
            self.collect_source_files(&target_dir, &mut files);
        }

        files
    }

    /// 判断是否为源文件
    fn is_source_file(&self, file_path: &str) -> bool {
        let source_exts = [".ts", ".tsx", ".js", ".jsx", ".rs", ".py", ".go"];
        let path = Path::new(file_path);

        if let Some(ext) = path.extension() {
            let ext_str = format!(".{}", ext.to_string_lossy());
            source_exts.contains(&ext_str.as_str())
                && !file_path.ends_with(".d.ts")
                && !file_path.contains("node_modules")
                && !file_path.contains("dist/")
                && !file_path.contains("target/")
        } else {
            false
        }
    }

    /// 分析影响范围
    fn analyze_impact(
        &self,
        changed_files: &[String],
        _options: &UpdateOptions,
    ) -> HashSet<String> {
        let mut affected_dirs = HashSet::new();

        if let Some(ref index) = self.index {
            for file in changed_files {
                // 1. 该文件所属的目录必须更新
                if let Some(parent) = Path::new(file).parent() {
                    let dir_path = parent.to_string_lossy().to_string();
                    affected_dirs.insert(if dir_path == "." {
                        String::new()
                    } else {
                        dir_path
                    });
                }

                // 2. 如果有全局依赖图，检查级联影响
                let dependents = self.find_dependents(file, index);
                for dep in dependents {
                    if let Some(parent) = Path::new(&dep).parent() {
                        let dir_path = parent.to_string_lossy().to_string();
                        affected_dirs.insert(if dir_path == "." {
                            String::new()
                        } else {
                            dir_path
                        });
                    }
                }
            }
        }

        affected_dirs
    }

    /// 查找依赖当前模块的其他模块
    fn find_dependents(&self, module_id: &str, index: &ChunkedIndex) -> Vec<String> {
        let mut dependents = Vec::new();

        if let Some(ref graph) = index.global_dependency_graph {
            if let Some(node) = graph.get(module_id) {
                // 如果该模块导出符号，返回所有导入它的模块
                if node.exports_symbols {
                    dependents.extend(node.imported_by.clone());
                }
            }
        }

        dependents
    }

    /// 重新生成受影响的 chunk
    fn regenerate_chunks(
        &self,
        affected_dirs: &HashSet<String>,
        options: &UpdateOptions,
    ) -> Vec<String> {
        let mut updated_chunks = Vec::new();

        for dir_path in affected_dirs {
            self.log(
                options,
                &format!(
                    "正在更新 chunk: {}",
                    if dir_path.is_empty() {
                        "root"
                    } else {
                        dir_path
                    }
                ),
            );

            // 获取该目录下的所有文件
            let files = if dir_path.is_empty() {
                self.get_files_in_directory("src")
            } else {
                self.get_files_in_directory(dir_path)
            };

            if files.is_empty() {
                // 目录为空或被删除，检查是否需要删除 chunk
                let chunk_file_name = self.get_chunk_file_name(dir_path);
                let chunk_path = self.chunks_dir.join(&chunk_file_name);
                if chunk_path.exists() {
                    if let Err(e) = fs::remove_file(&chunk_path) {
                        self.log(options, &format!("删除空 chunk 失败: {}", e));
                    } else {
                        self.log(options, &format!("已删除空 chunk: {}", chunk_file_name));
                    }
                }
                continue;
            }

            // 构建新的 chunk 数据
            if let Ok(chunk_data) = self.build_chunk_data(dir_path, &files) {
                // 写入 chunk 文件
                let chunk_file_name = self.get_chunk_file_name(dir_path);
                let chunk_path = self.chunks_dir.join(&chunk_file_name);

                // 确保目录存在
                if let Some(parent) = chunk_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }

                match serde_json::to_string_pretty(&chunk_data) {
                    Ok(json) => {
                        if let Err(e) = fs::write(&chunk_path, json) {
                            self.log(options, &format!("写入 chunk 失败 ({}): {}", dir_path, e));
                        } else {
                            updated_chunks.push(dir_path.clone());
                        }
                    }
                    Err(e) => {
                        self.log(options, &format!("序列化 chunk 失败 ({}): {}", dir_path, e));
                    }
                }
            }
        }

        updated_chunks
    }

    /// 构建 chunk 数据
    fn build_chunk_data(&self, dir_path: &str, _files: &[String]) -> Result<ChunkData, String> {
        // 读取现有 chunk 以保留设计相关数据
        let chunk_file_name = self.get_chunk_file_name(dir_path);
        let existing_chunk_path = self.chunks_dir.join(&chunk_file_name);
        let existing_chunk: Option<ChunkData> = if existing_chunk_path.exists() {
            fs::read_to_string(&existing_chunk_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
        } else {
            None
        };

        // 构建新的 chunk 数据
        let mut chunk_data = ChunkData {
            path: dir_path.to_string(),
            modules: HashMap::new(),
            symbols: HashMap::new(),
            references: ChunkReferences {
                module_deps: vec![],
                symbol_calls: vec![],
                type_refs: vec![],
            },
            metadata: None,
            planned_modules: None,
            refactoring_tasks: None,
            module_design_meta: None,
        };

        // 保留设计相关数据
        if let Some(existing) = existing_chunk {
            chunk_data.planned_modules = existing.planned_modules;
            chunk_data.refactoring_tasks = existing.refactoring_tasks;
            chunk_data.module_design_meta = existing.module_design_meta;
        }

        Ok(chunk_data)
    }

    /// 获取 chunk 文件名
    fn get_chunk_file_name(&self, dir_path: &str) -> String {
        if dir_path.is_empty() || dir_path == "." {
            "root.json".to_string()
        } else {
            format!("{}.json", dir_path.replace(['/', '\\'], "_"))
        }
    }

    /// 更新 index.json
    fn update_index(
        &mut self,
        updated_chunks: &[String],
        changed_files: &[String],
        options: &UpdateOptions,
    ) {
        // 预先计算 chunk 文件名，避免借用冲突
        let chunk_updates: Vec<_> = updated_chunks
            .iter()
            .map(|dir_path| {
                let chunk_file_name = Self::get_chunk_file_name_static(dir_path);
                let chunk_path = self.chunks_dir.join(&chunk_file_name);
                (dir_path.clone(), chunk_file_name, chunk_path.exists())
            })
            .collect();

        if let Some(ref mut index) = self.index {
            // 更新元数据
            index.meta.updated_at = Some(chrono::Utc::now().to_rfc3339());

            // 重新计算统计信息
            Self::recalculate_statistics_static(&self.chunks_dir, index);

            // 更新 chunk_index
            for (dir_path, chunk_file_name, exists) in chunk_updates {
                if exists {
                    index
                        .chunk_index
                        .insert(dir_path, format!("chunks/{}", chunk_file_name));
                } else {
                    index.chunk_index.remove(&dir_path);
                }
            }

            // 更新全局依赖图
            Self::update_global_dependency_graph_static(&self.chunks_dir, changed_files, index);

            // 写入 index.json
            match serde_json::to_string_pretty(&index) {
                Ok(json) => {
                    if let Err(e) = fs::write(&self.index_path, json) {
                        self.log(options, &format!("写入 index.json 失败: {}", e));
                    } else {
                        self.log(options, "已更新 index.json");
                    }
                }
                Err(e) => {
                    self.log(options, &format!("序列化 index.json 失败: {}", e));
                }
            }
        }
    }

    /// 获取 chunk 文件名（静态版本）
    fn get_chunk_file_name_static(dir_path: &str) -> String {
        if dir_path.is_empty() || dir_path == "." {
            "root.json".to_string()
        } else {
            format!("{}.json", dir_path.replace(['/', '\\'], "_"))
        }
    }

    /// 重新计算统计信息（静态版本）
    fn recalculate_statistics_static(chunks_dir: &Path, index: &mut ChunkedIndex) {
        let mut total_modules = 0;
        let mut total_symbols = 0;
        let mut total_lines = 0;
        let mut total_module_deps = 0;
        let mut total_symbol_calls = 0;
        let mut total_type_refs = 0;

        // 遍历所有 chunk 文件
        if let Ok(entries) = fs::read_dir(chunks_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(chunk) = serde_json::from_str::<ChunkData>(&content) {
                            total_modules += chunk.modules.len();
                            total_symbols += chunk.symbols.len();

                            for module in chunk.modules.values() {
                                total_lines += module.lines;
                            }

                            total_module_deps += chunk.references.module_deps.len();
                            total_symbol_calls += chunk.references.symbol_calls.len();
                            total_type_refs += chunk.references.type_refs.len();
                        }
                    }
                }
            }
        }

        // 更新统计信息
        index.statistics.total_modules = total_modules;
        index.statistics.total_symbols = total_symbols;
        index.statistics.total_lines = total_lines;
        index.statistics.reference_stats = super::types_enhanced::ReferenceStats {
            total_module_deps,
            total_symbol_calls,
            total_type_refs,
        };
    }

    /// 重新计算统计信息
    #[allow(dead_code)]
    fn recalculate_statistics(&self, index: &mut ChunkedIndex) {
        Self::recalculate_statistics_static(&self.chunks_dir, index);
    }

    /// 更新全局依赖图（静态版本）
    fn update_global_dependency_graph_static(
        chunks_dir: &Path,
        changed_files: &[String],
        index: &mut ChunkedIndex,
    ) {
        if index.global_dependency_graph.is_none() {
            return;
        }

        let graph = index.global_dependency_graph.as_mut().unwrap();

        for file in changed_files {
            let dir_path = Path::new(file)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let dir_path = if dir_path == "." {
                String::new()
            } else {
                dir_path
            };

            let chunk_file_name = Self::get_chunk_file_name_static(&dir_path);
            let chunk_path = chunks_dir.join(&chunk_file_name);

            if !chunk_path.exists() {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&chunk_path) {
                if let Ok(chunk) = serde_json::from_str::<ChunkData>(&content) {
                    if let Some(module_info) = chunk.modules.get(file) {
                        // 更新该模块的依赖节点
                        let import_sources: Vec<String> = module_info
                            .imports
                            .iter()
                            .map(|imp| imp.source.clone())
                            .collect();

                        let existing_imported_by = graph
                            .get(file)
                            .map(|n| n.imported_by.clone())
                            .unwrap_or_default();

                        graph.insert(
                            file.clone(),
                            GlobalDependencyNode {
                                imports: import_sources,
                                imported_by: existing_imported_by,
                                exports_symbols: !module_info.exports.is_empty(),
                            },
                        );

                        // 更新反向依赖
                        for dep in &chunk.references.module_deps {
                            if dep.source == *file {
                                if let Some(target_node) = graph.get_mut(&dep.target) {
                                    if !target_node.imported_by.contains(file) {
                                        target_node.imported_by.push(file.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// 更新全局依赖图
    #[allow(dead_code)]
    fn update_global_dependency_graph(&self, changed_files: &[String], index: &mut ChunkedIndex) {
        Self::update_global_dependency_graph_static(&self.chunks_dir, changed_files, index);
    }

    /// 日志输出
    fn log(&self, options: &UpdateOptions, message: &str) {
        if options.verbose {
            if let Some(callback) = options.on_progress {
                callback(message);
            } else {
                println!("{}", message);
            }
        }
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/// 执行增量更新
pub fn update_blueprint(root_path: impl AsRef<Path>, options: &UpdateOptions) -> UpdateResult {
    let mut updater = IncrementalBlueprintUpdater::new(root_path);
    updater.update(options)
}
