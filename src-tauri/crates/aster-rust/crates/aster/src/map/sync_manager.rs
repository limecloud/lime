//! 蓝图代码同步管理器
//!
//! 核心功能：
//! 1. sync_code_to_blueprint - 代码变更 → 蓝图更新
//! 2. sync_blueprint_to_code - 蓝图设计 → 代码生成
//! 3. 冲突检测和解决机制

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::incremental_updater::{IncrementalBlueprintUpdater, UpdateOptions};
use super::types_chunked::*;

/// 同步选项
#[derive(Debug, Clone, Default)]
pub struct SyncOptions {
    /// 是否显示详细日志
    pub verbose: bool,
    /// 进度回调
    pub on_progress: Option<fn(&str)>,
}

/// 同步结果
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// 是否成功
    pub success: bool,
    /// 结果消息
    pub message: String,
    /// 同步的文件
    pub synced_files: Vec<String>,
    /// 冲突列表
    pub conflicts: Vec<Conflict>,
}

/// 冲突信息
#[derive(Debug, Clone)]
pub struct Conflict {
    /// 冲突类型
    pub conflict_type: ConflictType,
    /// 模块 ID
    pub module_id: String,
    /// 期望值（蓝图设计）
    pub expected: Vec<String>,
    /// 实际值（代码）
    pub actual: Vec<String>,
    /// 解决方案
    pub resolution: ConflictResolution,
    /// 描述
    pub description: String,
}

/// 冲突类型
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConflictType {
    /// 导出不匹配
    ExportMismatch,
    /// 结构变更
    StructureChange,
    /// 内容分歧
    ContentDiverged,
}

/// 冲突解决方案
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConflictResolution {
    /// 使用蓝图设计
    UseBlueprint,
    /// 使用代码
    UseCode,
    /// 手动解决
    Manual,
}

/// 代码生成结果
#[derive(Debug, Clone)]
pub struct CodeGenerationResult {
    /// 是否成功
    pub success: bool,
    /// 生成的文件路径
    pub file_path: Option<String>,
    /// 生成的代码
    pub code: Option<String>,
    /// 错误消息
    pub error: Option<String>,
}

/// 蓝图代码同步管理器
pub struct BlueprintCodeSyncManager {
    root_path: PathBuf,
    map_dir: PathBuf,
    chunks_dir: PathBuf,
    index_path: PathBuf,
    updater: IncrementalBlueprintUpdater,
}

impl BlueprintCodeSyncManager {
    /// 创建新的同步管理器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        let root = root_path.as_ref().to_path_buf();
        let map_dir = root.join(".claude").join("map");
        let chunks_dir = map_dir.join("chunks");
        let index_path = map_dir.join("index.json");

        Self {
            root_path: root.clone(),
            map_dir,
            chunks_dir,
            index_path,
            updater: IncrementalBlueprintUpdater::new(root),
        }
    }

    // ========================================================================
    // 代码 → 蓝图同步
    // ========================================================================

    /// 代码变更同步到蓝图
    pub fn sync_code_to_blueprint(
        &mut self,
        changed_files: &[String],
        options: &SyncOptions,
    ) -> SyncResult {
        let mut conflicts = Vec::new();
        let mut synced_files = Vec::new();

        self.log(
            options,
            &format!("开始同步 {} 个文件到蓝图...", changed_files.len()),
        );

        for file in changed_files {
            // 1. 检查蓝图中该模块的设计状态
            let design = self.get_module_design(file);

            // 2. 如果是计划模块，检测是否已实现
            if let Some(ref d) = design {
                if d.status == PlannedStatus::Planned {
                    let code_path = self.root_path.join(file);
                    if code_path.exists() {
                        // 从 planned 移动到 implemented
                        self.update_module_status(file, ModuleStatus::Implemented);
                        self.log(options, &format!("  ✓ {}: planned → implemented", file));
                    }
                }
            }

            // 3. 分析代码，检测冲突
            if let Some(conflict) = self.detect_conflict(file, &design) {
                conflicts.push(conflict);
                self.log(options, &format!("  ⚠ {}: 检测到冲突", file));
            }

            synced_files.push(file.clone());
        }

        // 4. 执行增量更新
        let update_options = UpdateOptions {
            files: Some(changed_files.to_vec()),
            verbose: options.verbose,
            on_progress: options.on_progress,
            ..Default::default()
        };
        let _ = self.updater.update(&update_options);

        SyncResult {
            success: true,
            message: format!(
                "已同步 {} 个文件，{} 个冲突",
                synced_files.len(),
                conflicts.len()
            ),
            synced_files,
            conflicts,
        }
    }

    // ========================================================================
    // 蓝图 → 代码同步
    // ========================================================================

    /// 蓝图设计同步到代码
    pub fn sync_blueprint_to_code(
        &mut self,
        module_id: &str,
        options: &SyncOptions,
    ) -> CodeGenerationResult {
        self.log(options, &format!("正在从蓝图生成代码: {}...", module_id));

        // 1. 读取设计
        let design = match self.get_module_design(module_id) {
            Some(d) => d,
            None => {
                return CodeGenerationResult {
                    success: false,
                    file_path: None,
                    code: None,
                    error: Some(format!("未找到模块设计: {}", module_id)),
                };
            }
        };

        // 2. 检查状态
        if design.status == PlannedStatus::InProgress {
            // 已经在进行中，不需要重新生成
        }

        // 3. 生成代码
        let code = self.generate_code_from_design(module_id, &design);

        // 4. 确保目录存在
        let target_path = self.root_path.join(module_id);
        if let Some(parent) = target_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        // 5. 检查文件是否已存在
        if target_path.exists() {
            return CodeGenerationResult {
                success: false,
                file_path: None,
                code: None,
                error: Some(format!(
                    "文件已存在: {}。请先删除现有文件或更新蓝图状态。",
                    module_id
                )),
            };
        }

        // 6. 写入文件
        if let Err(e) = fs::write(&target_path, &code) {
            return CodeGenerationResult {
                success: false,
                file_path: None,
                code: None,
                error: Some(format!("写入文件失败: {}", e)),
            };
        }

        // 7. 更新蓝图状态
        self.update_module_status(module_id, ModuleStatus::InProgress);

        self.log(options, &format!("  ✓ 已生成: {}", module_id));

        CodeGenerationResult {
            success: true,
            file_path: Some(target_path.to_string_lossy().to_string()),
            code: Some(code),
            error: None,
        }
    }

    /// 批量从蓝图生成代码
    pub fn sync_all_planned_modules(&mut self, options: &SyncOptions) -> SyncResult {
        let planned_modules = self.get_all_planned_modules();
        let mut synced_files = Vec::new();
        let mut conflicts = Vec::new();

        self.log(
            options,
            &format!("找到 {} 个计划模块", planned_modules.len()),
        );

        for module in planned_modules {
            let result = self.sync_blueprint_to_code(&module.id, options);

            if result.success {
                synced_files.push(module.id.clone());
            } else if let Some(ref error) = result.error {
                if error.contains("已存在") {
                    conflicts.push(Conflict {
                        conflict_type: ConflictType::ContentDiverged,
                        module_id: module.id,
                        expected: vec!["planned".to_string()],
                        actual: vec!["file-exists".to_string()],
                        resolution: ConflictResolution::Manual,
                        description: error.clone(),
                    });
                }
            }
        }

        SyncResult {
            success: conflicts.is_empty(),
            message: format!(
                "已生成 {} 个文件，{} 个冲突",
                synced_files.len(),
                conflicts.len()
            ),
            synced_files,
            conflicts,
        }
    }

    // ========================================================================
    // 冲突检测
    // ========================================================================

    /// 检测冲突
    fn detect_conflict(&self, module_id: &str, design: &Option<PlannedModule>) -> Option<Conflict> {
        let design = design.as_ref()?;

        let code_path = self.root_path.join(module_id);
        if !code_path.exists() {
            return None;
        }

        // 读取代码
        let code = fs::read_to_string(&code_path).ok()?;

        // 分析实际导出
        let actual_exports = self.extract_exports(&code);

        // 与设计期望对比
        let expected_exports = design.expected_exports.as_ref()?;

        if !expected_exports.is_empty() {
            let missing: Vec<_> = expected_exports
                .iter()
                .filter(|e| !actual_exports.contains(e))
                .cloned()
                .collect();
            let extra: Vec<_> = actual_exports
                .iter()
                .filter(|e| !expected_exports.contains(e))
                .cloned()
                .collect();

            if !missing.is_empty() || !extra.is_empty() {
                return Some(Conflict {
                    conflict_type: ConflictType::ExportMismatch,
                    module_id: module_id.to_string(),
                    expected: expected_exports.clone(),
                    actual: actual_exports,
                    resolution: ConflictResolution::Manual,
                    description: format!(
                        "导出不匹配。缺少: {}；多余: {}",
                        missing.join(", "),
                        extra.join(", ")
                    ),
                });
            }
        }

        None
    }

    /// 提取代码中的导出
    fn extract_exports(&self, code: &str) -> Vec<String> {
        let mut exports = Vec::new();

        // 匹配 pub struct/fn/const/enum/trait/type
        let patterns = [
            r"pub\s+struct\s+(\w+)",
            r"pub\s+fn\s+(\w+)",
            r"pub\s+const\s+(\w+)",
            r"pub\s+enum\s+(\w+)",
            r"pub\s+trait\s+(\w+)",
            r"pub\s+type\s+(\w+)",
            // TypeScript/JavaScript patterns
            r"export\s+(?:default\s+)?class\s+(\w+)",
            r"export\s+(?:default\s+)?function\s+(\w+)",
            r"export\s+(?:const|let|var)\s+(\w+)",
            r"export\s+interface\s+(\w+)",
            r"export\s+type\s+(\w+)",
            r"export\s+enum\s+(\w+)",
        ];

        for pattern in patterns {
            if let Ok(re) = regex::Regex::new(pattern) {
                for cap in re.captures_iter(code) {
                    if let Some(name) = cap.get(1) {
                        exports.push(name.as_str().to_string());
                    }
                }
            }
        }

        exports.sort();
        exports.dedup();
        exports
    }

    // ========================================================================
    // 辅助方法
    // ========================================================================

    /// 获取模块设计
    fn get_module_design(&self, module_id: &str) -> Option<PlannedModule> {
        let dir_path = Path::new(module_id)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let dir_path = if dir_path == "." {
            String::new()
        } else {
            dir_path
        };

        let chunk_file_name = self.get_chunk_file_name(&dir_path);
        let chunk_path = self.chunks_dir.join(&chunk_file_name);

        if !chunk_path.exists() {
            return None;
        }

        let content = fs::read_to_string(&chunk_path).ok()?;
        let chunk: ChunkData = serde_json::from_str(&content).ok()?;

        // 检查 planned_modules
        if let Some(ref planned_modules) = chunk.planned_modules {
            if let Some(planned) = planned_modules.iter().find(|m| m.id == module_id) {
                return Some(planned.clone());
            }
        }

        None
    }

    /// 更新模块状态
    fn update_module_status(&self, module_id: &str, status: ModuleStatus) {
        let dir_path = Path::new(module_id)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let dir_path = if dir_path == "." {
            String::new()
        } else {
            dir_path
        };

        let chunk_file_name = self.get_chunk_file_name(&dir_path);
        let chunk_path = self.chunks_dir.join(&chunk_file_name);

        if !chunk_path.exists() {
            return;
        }

        let content = match fs::read_to_string(&chunk_path) {
            Ok(c) => c,
            Err(_) => return,
        };

        let mut chunk: ChunkData = match serde_json::from_str(&content) {
            Ok(c) => c,
            Err(_) => return,
        };

        // 如果是从 planned 变成 implemented
        if status == ModuleStatus::Implemented {
            if let Some(ref mut planned_modules) = chunk.planned_modules {
                if let Some(pos) = planned_modules.iter().position(|m| m.id == module_id) {
                    let planned = planned_modules.remove(pos);

                    // 添加到 module_design_meta
                    let meta = chunk.module_design_meta.get_or_insert_with(HashMap::new);
                    meta.insert(
                        module_id.to_string(),
                        ModuleDesignMeta {
                            status: Some(ModuleStatus::Implemented),
                            design_notes: Some(planned.design_notes),
                            marked_at: Some(chrono::Utc::now().to_rfc3339()),
                        },
                    );
                }
            }
        } else {
            // 更新现有状态
            let meta = chunk.module_design_meta.get_or_insert_with(HashMap::new);
            if let Some(existing) = meta.get_mut(module_id) {
                existing.status = Some(status);
                existing.marked_at = Some(chrono::Utc::now().to_rfc3339());
            } else {
                meta.insert(
                    module_id.to_string(),
                    ModuleDesignMeta {
                        status: Some(status),
                        design_notes: None,
                        marked_at: Some(chrono::Utc::now().to_rfc3339()),
                    },
                );
            }
        }

        // 写回文件
        if let Ok(json) = serde_json::to_string_pretty(&chunk) {
            let _ = fs::write(&chunk_path, json);
        }
    }

    /// 获取所有计划模块
    fn get_all_planned_modules(&self) -> Vec<PlannedModule> {
        let mut planned_modules = Vec::new();

        if !self.chunks_dir.exists() {
            return planned_modules;
        }

        if let Ok(entries) = fs::read_dir(&self.chunks_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(chunk) = serde_json::from_str::<ChunkData>(&content) {
                            if let Some(modules) = chunk.planned_modules {
                                for module in modules {
                                    if module.status == PlannedStatus::Planned
                                        || module.status == PlannedStatus::InProgress
                                    {
                                        planned_modules.push(module);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        planned_modules
    }

    /// 根据设计生成代码
    fn generate_code_from_design(&self, module_id: &str, design: &PlannedModule) -> String {
        let name = Path::new(module_id)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "module".to_string());
        let struct_name = self.to_pascal_case(&name);

        // 获取设计备注
        let design_notes = &design.design_notes;

        // 获取依赖
        let dependencies = &design.dependencies;

        // 生成导入语句
        let mut imports = String::new();
        for dep in dependencies {
            let dep_name = Path::new(dep)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            imports.push_str(&format!("// use crate::{}::*; // TODO\n", dep_name));
        }

        // 生成预期导出
        let expected_exports = design
            .expected_exports
            .clone()
            .unwrap_or_else(|| vec![struct_name.clone()]);

        // 检测语言类型
        let is_rust = module_id.ends_with(".rs");
        let is_typescript = module_id.ends_with(".ts") || module_id.ends_with(".tsx");

        if is_rust {
            self.generate_rust_code(
                &name,
                &struct_name,
                design_notes,
                &imports,
                &expected_exports,
            )
        } else if is_typescript {
            self.generate_typescript_code(
                &name,
                &struct_name,
                design_notes,
                &imports,
                &expected_exports,
            )
        } else {
            self.generate_rust_code(
                &name,
                &struct_name,
                design_notes,
                &imports,
                &expected_exports,
            )
        }
    }

    /// 生成 Rust 代码
    fn generate_rust_code(
        &self,
        name: &str,
        struct_name: &str,
        design_notes: &str,
        imports: &str,
        expected_exports: &[String],
    ) -> String {
        let other_exports: String = expected_exports
            .iter()
            .filter(|e| *e != struct_name)
            .map(|e| {
                format!(
                    "\n/// {}\n/// TODO: 实现\npub const {}: () = ();\n",
                    e,
                    e.to_uppercase()
                )
            })
            .collect();

        format!(
            r#"//! {}
//!
//! {}
//!
//! @module {}
//! @created {}
//! @status in-progress

{}
/// {}
///
/// 设计说明：
/// {}
pub struct {} {{
    // TODO: 添加字段
}}

impl {} {{
    /// 创建新实例
    pub fn new() -> Self {{
        Self {{
            // TODO: 初始化
        }}
    }}

    // TODO: 实现方法
}}

impl Default for {} {{
    fn default() -> Self {{
        Self::new()
    }}
}}
{}
"#,
            name,
            design_notes,
            name,
            chrono::Utc::now().format("%Y-%m-%d"),
            imports,
            struct_name,
            design_notes.replace('\n', "\n/// "),
            struct_name,
            struct_name,
            struct_name,
            other_exports
        )
    }

    /// 生成 TypeScript 代码
    fn generate_typescript_code(
        &self,
        name: &str,
        class_name: &str,
        design_notes: &str,
        imports: &str,
        expected_exports: &[String],
    ) -> String {
        let other_exports: String = expected_exports
            .iter()
            .filter(|e| *e != class_name)
            .map(|e| {
                format!(
                    "\n/**\n * {}\n * TODO: 实现\n */\nexport const {} = undefined;\n",
                    e, e
                )
            })
            .collect();

        format!(
            r#"/**
 * {}
 *
 * {}
 *
 * @module {}
 * @created {}
 * @status in-progress
 */

{}
/**
 * {}
 *
 * 设计说明：
 * {}
 */
export class {} {{
  constructor() {{
    // TODO: 初始化
  }}

  // TODO: 实现方法
}}
{}
export default {};
"#,
            name,
            design_notes,
            name,
            chrono::Utc::now().format("%Y-%m-%d"),
            imports,
            class_name,
            design_notes.replace('\n', "\n * "),
            class_name,
            other_exports,
            class_name
        )
    }

    /// 转换为 PascalCase
    fn to_pascal_case(&self, s: &str) -> String {
        s.split(['-', '_'])
            .map(|word| {
                let mut chars = word.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().chain(chars).collect(),
                }
            })
            .collect()
    }

    /// 获取 chunk 文件名
    fn get_chunk_file_name(&self, dir_path: &str) -> String {
        if dir_path.is_empty() || dir_path == "." {
            "root.json".to_string()
        } else {
            format!("{}.json", dir_path.replace(['/', '\\'], "_"))
        }
    }

    /// 日志输出
    fn log(&self, options: &SyncOptions, message: &str) {
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

/// 代码同步到蓝图
pub fn sync_code_to_blueprint(
    root_path: impl AsRef<Path>,
    changed_files: &[String],
    options: &SyncOptions,
) -> SyncResult {
    let mut manager = BlueprintCodeSyncManager::new(root_path);
    manager.sync_code_to_blueprint(changed_files, options)
}

/// 蓝图同步到代码
pub fn sync_blueprint_to_code(
    root_path: impl AsRef<Path>,
    module_id: &str,
    options: &SyncOptions,
) -> CodeGenerationResult {
    let mut manager = BlueprintCodeSyncManager::new(root_path);
    manager.sync_blueprint_to_code(module_id, options)
}
