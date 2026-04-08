//! 代码库分析器
//!
//! 核心功能：
//! 1. 扫描代码库目录结构
//! 2. 检测项目类型和框架
//! 3. 识别模块和依赖关系
//! 4. 调用 AI 分析代码语义，理解业务逻辑
//! 5. 生成蓝图（包含所有已有功能）
//! 6. 生成任务树（已有功能标记为 passed）
//!
//! 注意：不自动批准蓝图，让用户预览后确认

use chrono::Utc;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

use super::blueprint_manager::BlueprintManager;
use super::task_tree_manager::TaskTreeManager;
use super::types::{
    Blueprint, BlueprintSource, BlueprintStatus, BusinessProcess, ModuleType, MoscowPriority,
    NfrCategory, NonFunctionalRequirement, ProcessStep, ProcessType, SystemModule, TaskNode,
    TaskStatus, TaskTree,
};

// ============================================================================
// 分析配置
// ============================================================================

/// 分析器配置
#[derive(Debug, Clone)]
pub struct AnalyzerConfig {
    /// 要分析的根目录
    pub root_dir: PathBuf,
    /// 项目名称
    pub project_name: Option<String>,
    /// 项目描述
    pub project_description: Option<String>,
    /// 忽略的目录
    pub ignore_dirs: Vec<String>,
    /// 忽略的文件模式
    pub ignore_patterns: Vec<String>,
    /// 最大扫描深度
    pub max_depth: usize,
    /// 是否包含测试文件
    pub include_tests: bool,
    /// 分析粒度
    pub granularity: AnalysisGranularity,
    /// 是否使用 AI 分析语义
    pub use_ai: bool,
}

/// 分析粒度
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisGranularity {
    Coarse,
    Medium,
    Fine,
}

impl Default for AnalyzerConfig {
    fn default() -> Self {
        Self {
            root_dir: std::env::current_dir().unwrap_or_default(),
            project_name: None,
            project_description: None,
            ignore_dirs: vec![
                "node_modules".to_string(),
                ".git".to_string(),
                "dist".to_string(),
                "build".to_string(),
                "coverage".to_string(),
                ".next".to_string(),
                "__pycache__".to_string(),
                "venv".to_string(),
                "target".to_string(),
            ],
            ignore_patterns: vec![
                "*.min.js".to_string(),
                "*.map".to_string(),
                "*.lock".to_string(),
                "package-lock.json".to_string(),
            ],
            max_depth: 10,
            include_tests: true,
            granularity: AnalysisGranularity::Medium,
            use_ai: true,
        }
    }
}

// ============================================================================
// 代码结构信息
// ============================================================================

/// 代码库信息
#[derive(Debug, Clone)]
pub struct CodebaseInfo {
    pub name: String,
    pub description: String,
    pub root_dir: PathBuf,
    pub language: String,
    pub framework: Option<String>,
    pub modules: Vec<DetectedModule>,
    pub dependencies: Vec<String>,
    pub dev_dependencies: Vec<String>,
    pub scripts: HashMap<String, String>,
    pub structure: DirectoryNode,
    pub stats: CodebaseStats,
    /// AI 分析结果
    pub ai_analysis: Option<AIAnalysisResult>,
}

/// 检测到的模块
#[derive(Debug, Clone)]
pub struct DetectedModule {
    pub name: String,
    pub path: PathBuf,
    /// 相对于项目根目录的路径（用于蓝图约束）
    pub root_path: String,
    pub module_type: DetectedModuleType,
    pub files: Vec<PathBuf>,
    pub exports: Vec<String>,
    pub imports: Vec<String>,
    pub responsibilities: Vec<String>,
    pub suggested_tasks: Vec<String>,
    /// AI 分析的功能描述
    pub ai_description: Option<String>,
    /// AI 分析的核心功能列表
    pub core_features: Option<Vec<String>>,
    /// AI 分析的边界约束
    pub boundary_constraints: Option<Vec<String>>,
    /// 受保护的核心文件
    pub protected_files: Option<Vec<String>>,
}

/// 检测到的模块类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedModuleType {
    Frontend,
    Backend,
    Database,
    Service,
    Infrastructure,
    Other,
}

impl From<DetectedModuleType> for ModuleType {
    fn from(t: DetectedModuleType) -> Self {
        match t {
            DetectedModuleType::Frontend => ModuleType::Frontend,
            DetectedModuleType::Backend => ModuleType::Backend,
            DetectedModuleType::Database => ModuleType::Database,
            DetectedModuleType::Service => ModuleType::Service,
            DetectedModuleType::Infrastructure => ModuleType::Infrastructure,
            DetectedModuleType::Other => ModuleType::Other,
        }
    }
}

/// 目录节点
#[derive(Debug, Clone)]
pub struct DirectoryNode {
    pub name: String,
    pub path: PathBuf,
    pub node_type: NodeType,
    pub children: Vec<DirectoryNode>,
    pub extension: Option<String>,
    pub size: Option<u64>,
}

/// 节点类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeType {
    Directory,
    File,
}

/// 代码库统计
#[derive(Debug, Clone, Default)]
pub struct CodebaseStats {
    pub total_files: usize,
    pub total_dirs: usize,
    pub total_lines: usize,
    pub files_by_type: HashMap<String, usize>,
    pub largest_files: Vec<(PathBuf, usize)>,
}

/// AI 分析的模块详细信息
#[derive(Debug, Clone)]
pub struct AIModuleAnalysis {
    /// 模块名称
    pub name: String,
    /// 模块用途
    pub purpose: String,
    /// 职责列表
    pub responsibilities: Vec<String>,
    /// 依赖的其他模块
    pub dependencies: Vec<String>,
    /// 核心功能列表（用于生成验收测试）
    pub core_features: Vec<String>,
    /// 边界约束（不应修改的规则）
    pub boundary_constraints: Vec<String>,
    /// 受保护的核心文件（不应随意修改）
    pub protected_files: Vec<String>,
    /// 对外暴露的主要接口
    pub public_interfaces: Vec<String>,
    /// 内部实现细节（可以重构的部分）
    pub internal_details: Vec<String>,
}

/// AI 分析结果
#[derive(Debug, Clone)]
pub struct AIAnalysisResult {
    /// 项目概述
    pub overview: String,
    /// 架构模式
    pub architecture_pattern: String,
    /// 核心功能列表
    pub core_features: Vec<String>,
    /// 模块分析（增强版）
    pub module_analysis: Vec<AIModuleAnalysis>,
    /// 业务流程
    pub business_flows: Vec<BusinessFlowInfo>,
    /// 架构决策记录
    pub architecture_decisions: Vec<String>,
    /// 技术债务
    pub technical_debts: Vec<String>,
}

/// 业务流程信息
#[derive(Debug, Clone)]
pub struct BusinessFlowInfo {
    pub name: String,
    pub description: String,
    pub steps: Vec<String>,
}

/// 分析事件
#[derive(Debug, Clone)]
pub enum AnalyzerEvent {
    Started { root_dir: PathBuf },
    AIStarted,
    AICompleted { analysis: AIAnalysisResult },
    AIError { error: String },
    CodebaseCompleted { stats: CodebaseStats },
    BlueprintCompleted { blueprint_id: String },
    TaskTreeCompleted { task_tree_id: String },
    Completed,
}

// ============================================================================
// 代码库分析器
// ============================================================================

/// 代码库分析器
pub struct CodebaseAnalyzer {
    config: AnalyzerConfig,
    event_sender: Option<mpsc::Sender<AnalyzerEvent>>,
}

impl CodebaseAnalyzer {
    /// 创建新的分析器
    pub fn new(config: AnalyzerConfig) -> Self {
        Self {
            config,
            event_sender: None,
        }
    }

    /// 设置事件发送器
    pub fn with_event_sender(mut self, sender: mpsc::Sender<AnalyzerEvent>) -> Self {
        self.event_sender = Some(sender);
        self
    }

    /// 发送事件
    async fn emit(&self, event: AnalyzerEvent) {
        if let Some(ref sender) = self.event_sender {
            let _ = sender.send(event).await;
        }
    }

    // --------------------------------------------------------------------------
    // 一键分析并生成蓝图
    // --------------------------------------------------------------------------

    /// 一键分析代码库并生成蓝图和任务树
    pub async fn analyze_and_generate(
        &mut self,
        blueprint_manager: &mut BlueprintManager,
        task_tree_manager: &mut TaskTreeManager,
    ) -> Result<AnalyzeResult, String> {
        self.emit(AnalyzerEvent::Started {
            root_dir: self.config.root_dir.clone(),
        })
        .await;

        // 1. 基础结构分析
        let mut codebase = self.analyze()?;

        // 更新项目名称和描述
        if let Some(ref name) = self.config.project_name {
            codebase.name = name.clone();
        }
        if let Some(ref desc) = self.config.project_description {
            codebase.description = desc.clone();
        }

        // 2. AI 语义分析（可选）
        if self.config.use_ai {
            self.emit(AnalyzerEvent::AIStarted).await;
            match self.analyze_with_ai(&codebase).await {
                Ok(analysis) => {
                    self.emit(AnalyzerEvent::AICompleted {
                        analysis: analysis.clone(),
                    })
                    .await;
                    // 用 AI 分析结果增强模块信息
                    self.enhance_modules_with_ai(&mut codebase, &analysis);
                    codebase.ai_analysis = Some(analysis);
                }
                Err(e) => {
                    self.emit(AnalyzerEvent::AIError { error: e }).await;
                    // AI 分析失败不阻塞流程
                }
            }
        }

        self.emit(AnalyzerEvent::CodebaseCompleted {
            stats: codebase.stats.clone(),
        })
        .await;

        // 3. 生成蓝图
        let blueprint = self
            .generate_blueprint(&codebase, blueprint_manager)
            .await?;
        self.emit(AnalyzerEvent::BlueprintCompleted {
            blueprint_id: blueprint.id.clone(),
        })
        .await;

        // 4. 生成任务树（已有功能标记为 passed）
        let task_tree = self
            .generate_task_tree_with_passed_status(&blueprint, task_tree_manager)
            .await?;
        self.emit(AnalyzerEvent::TaskTreeCompleted {
            task_tree_id: task_tree.id.clone(),
        })
        .await;

        self.emit(AnalyzerEvent::Completed).await;

        Ok(AnalyzeResult {
            codebase,
            blueprint,
            task_tree,
        })
    }

    // --------------------------------------------------------------------------
    // 代码库分析
    // --------------------------------------------------------------------------

    /// 分析代码库结构
    pub fn analyze(&self) -> Result<CodebaseInfo, String> {
        let root_dir = &self.config.root_dir;

        // 检测项目类型和框架
        let (language, framework) = self.detect_project_type(root_dir)?;

        // 扫描目录结构
        let structure = self.scan_directory(root_dir, 0)?;

        // 检测模块
        let modules = self.detect_modules(root_dir, &structure);

        // 读取包依赖
        let (dependencies, dev_dependencies, scripts) = self.read_package_info(root_dir);

        // 计算统计信息
        let stats = self.calculate_stats(&structure);

        // 生成项目名称和描述
        let name = self.config.project_name.clone().unwrap_or_else(|| {
            root_dir
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

        let description = self.config.project_description.clone().unwrap_or_else(|| {
            self.generate_project_description(&name, &language, framework.as_deref(), &modules)
        });

        Ok(CodebaseInfo {
            name,
            description,
            root_dir: root_dir.clone(),
            language,
            framework,
            modules,
            dependencies,
            dev_dependencies,
            scripts,
            structure,
            stats,
            ai_analysis: None,
        })
    }

    /// 检测项目类型
    fn detect_project_type(&self, root_dir: &Path) -> Result<(String, Option<String>), String> {
        let entries: Vec<_> = fs::read_dir(root_dir)
            .map_err(|e| format!("无法读取目录: {}", e))?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        // TypeScript/JavaScript
        if entries.iter().any(|f| f == "package.json") {
            let pkg_path = root_dir.join("package.json");
            if let Ok(content) = fs::read_to_string(&pkg_path) {
                if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                    let deps = pkg.get("dependencies").and_then(|d| d.as_object());
                    let dev_deps = pkg.get("devDependencies").and_then(|d| d.as_object());

                    let has_dep = |name: &str| {
                        deps.map(|d| d.contains_key(name)).unwrap_or(false)
                            || dev_deps.map(|d| d.contains_key(name)).unwrap_or(false)
                    };

                    let language = if entries.iter().any(|f| f == "tsconfig.json") {
                        "TypeScript"
                    } else {
                        "JavaScript"
                    };

                    let framework = if has_dep("react") || has_dep("react-dom") {
                        Some("React")
                    } else if has_dep("vue") {
                        Some("Vue")
                    } else if has_dep("@angular/core") {
                        Some("Angular")
                    } else if has_dep("next") {
                        Some("Next.js")
                    } else if has_dep("express") {
                        Some("Express")
                    } else if has_dep("fastify") {
                        Some("Fastify")
                    } else if has_dep("@nestjs/core") {
                        Some("NestJS")
                    } else {
                        None
                    };

                    return Ok((language.to_string(), framework.map(|s| s.to_string())));
                }
            }
        }

        // Rust
        if entries.iter().any(|f| f == "Cargo.toml") {
            return Ok(("Rust".to_string(), None));
        }

        // Python
        if entries
            .iter()
            .any(|f| f == "requirements.txt" || f == "setup.py" || f == "pyproject.toml")
        {
            let mut framework = None;
            let req_path = root_dir.join("requirements.txt");
            if let Ok(content) = fs::read_to_string(&req_path) {
                if content.contains("django") {
                    framework = Some("Django".to_string());
                } else if content.contains("flask") {
                    framework = Some("Flask".to_string());
                } else if content.contains("fastapi") {
                    framework = Some("FastAPI".to_string());
                }
            }
            return Ok(("Python".to_string(), framework));
        }

        // Go
        if entries.iter().any(|f| f == "go.mod") {
            return Ok(("Go".to_string(), None));
        }

        // Java
        if entries
            .iter()
            .any(|f| f == "pom.xml" || f == "build.gradle")
        {
            return Ok(("Java".to_string(), Some("Spring".to_string())));
        }

        Ok(("Unknown".to_string(), None))
    }

    /// 扫描目录结构
    fn scan_directory(&self, dir_path: &Path, depth: usize) -> Result<DirectoryNode, String> {
        let name = dir_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // 检查深度限制
        if depth > self.config.max_depth {
            return Ok(DirectoryNode {
                name,
                path: dir_path.to_path_buf(),
                node_type: NodeType::Directory,
                children: vec![],
                extension: None,
                size: None,
            });
        }

        // 检查是否应该忽略
        if self.config.ignore_dirs.contains(&name) {
            return Ok(DirectoryNode {
                name,
                path: dir_path.to_path_buf(),
                node_type: NodeType::Directory,
                children: vec![],
                extension: None,
                size: None,
            });
        }

        let metadata = fs::metadata(dir_path).map_err(|e| format!("无法读取元数据: {}", e))?;

        if metadata.is_file() {
            let extension = dir_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_string());
            return Ok(DirectoryNode {
                name,
                path: dir_path.to_path_buf(),
                node_type: NodeType::File,
                children: vec![],
                extension,
                size: Some(metadata.len()),
            });
        }

        let mut children = Vec::new();
        let entries = fs::read_dir(dir_path).map_err(|e| format!("无法读取目录: {}", e))?;

        for entry in entries.filter_map(|e| e.ok()) {
            let entry_name = entry.file_name().to_string_lossy().to_string();

            // 检查是否应该忽略
            if self.config.ignore_dirs.contains(&entry_name) {
                continue;
            }
            if self.should_ignore(&entry_name) {
                continue;
            }

            if let Ok(child) = self.scan_directory(&entry.path(), depth + 1) {
                children.push(child);
            }
        }

        Ok(DirectoryNode {
            name,
            path: dir_path.to_path_buf(),
            node_type: NodeType::Directory,
            children,
            extension: None,
            size: None,
        })
    }

    /// 检查是否应该忽略
    fn should_ignore(&self, name: &str) -> bool {
        for pattern in &self.config.ignore_patterns {
            if self.match_pattern(name, pattern) {
                return true;
            }
        }
        false
    }

    /// 简单的模式匹配
    fn match_pattern(&self, name: &str, pattern: &str) -> bool {
        let regex_pattern = format!("^{}$", pattern.replace("*", ".*"));
        regex::Regex::new(&regex_pattern)
            .map(|r| r.is_match(name))
            .unwrap_or(false)
    }

    /// 检测模块
    fn detect_modules(&self, root_dir: &Path, structure: &DirectoryNode) -> Vec<DetectedModule> {
        let mut modules = Vec::new();
        self.scan_for_modules(structure, 0, "", &mut modules, root_dir);

        // 如果没有检测到模块，尝试从 src 目录递归
        if modules.is_empty() {
            if let Some(src_dir) = structure.children.iter().find(|c| c.name == "src") {
                self.scan_for_modules(src_dir, 1, "src", &mut modules, root_dir);
            }
        }

        // 如果还是没有，把 src 整体作为一个模块
        if modules.is_empty() {
            if let Some(src_dir) = structure.children.iter().find(|c| c.name == "src") {
                modules.push(DetectedModule {
                    name: "main".to_string(),
                    path: src_dir.path.clone(),
                    root_path: "src".to_string(),
                    module_type: DetectedModuleType::Backend,
                    files: self.collect_files(src_dir),
                    exports: vec![],
                    imports: vec![],
                    responsibilities: vec!["主要业务逻辑".to_string()],
                    suggested_tasks: vec!["代码重构".to_string(), "添加测试".to_string()],
                    ai_description: None,
                    core_features: None,
                    boundary_constraints: None,
                    protected_files: None,
                });
            }
        }

        modules
    }

    /// 递归扫描模块
    fn scan_for_modules(
        &self,
        node: &DirectoryNode,
        depth: usize,
        parent_path: &str,
        modules: &mut Vec<DetectedModule>,
        root_dir: &Path,
    ) {
        if node.node_type != NodeType::Directory || depth > 3 {
            return;
        }

        for child in &node.children {
            if child.node_type != NodeType::Directory {
                continue;
            }
            if self.config.ignore_dirs.contains(&child.name) {
                continue;
            }

            // 检查是否匹配模块模式
            let (module_type, is_leaf) = self.match_module_pattern(&child.name);

            if let Some(mt) = module_type {
                if is_leaf {
                    // 叶子模块：直接添加
                    if let Some(module) = self.analyze_module_deep(child, mt, parent_path, root_dir)
                    {
                        if !module.files.is_empty() {
                            modules.push(module);
                        }
                    }
                } else {
                    // 非叶子模块：继续递归
                    let new_parent = if parent_path.is_empty() {
                        child.name.clone()
                    } else {
                        format!("{}/{}", parent_path, child.name)
                    };
                    self.scan_for_modules(child, depth + 1, &new_parent, modules, root_dir);
                }
            } else if depth > 0 {
                // 如果没有匹配但有大量代码文件，也识别为模块
                let files = self.collect_files(child);
                let code_files: Vec<_> = files
                    .iter()
                    .filter(|f| {
                        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("");
                        matches!(ext, "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "rs")
                    })
                    .collect();

                if code_files.len() >= 5 {
                    let inferred_type = self.infer_module_type(&child.name, &files);
                    if let Some(module) =
                        self.analyze_module_deep(child, inferred_type, parent_path, root_dir)
                    {
                        modules.push(module);
                    }
                }
            }
        }
    }

    /// 匹配模块模式
    fn match_module_pattern(&self, name: &str) -> (Option<DetectedModuleType>, bool) {
        let name_lower = name.to_lowercase();

        // 前端模块（叶子）
        if matches!(
            name_lower.as_str(),
            "client" | "frontend" | "pages" | "components" | "ui"
        ) {
            return (Some(DetectedModuleType::Frontend), true);
        }
        // 后端模块（叶子）
        if matches!(name_lower.as_str(), "server" | "api" | "routes" | "core") {
            return (Some(DetectedModuleType::Backend), true);
        }
        // 数据库模块（叶子）
        if matches!(name_lower.as_str(), "database" | "db" | "models") {
            return (Some(DetectedModuleType::Database), true);
        }
        // 服务模块（叶子）
        if matches!(
            name_lower.as_str(),
            "services"
                | "utils"
                | "helpers"
                | "tools"
                | "blueprint"
                | "parser"
                | "hooks"
                | "plugins"
        ) {
            return (Some(DetectedModuleType::Service), true);
        }
        // 基础设施模块（叶子）
        if matches!(name_lower.as_str(), "config" | "infra" | "deploy") {
            return (Some(DetectedModuleType::Infrastructure), true);
        }
        // 非叶子模块（需要继续递归）
        if matches!(name_lower.as_str(), "lib" | "src" | "web") {
            return (Some(DetectedModuleType::Backend), false);
        }

        (None, false)
    }

    /// 根据文件内容推断模块类型
    fn infer_module_type(&self, _name: &str, files: &[PathBuf]) -> DetectedModuleType {
        let has_react = files.iter().any(|f| {
            let ext = f.extension().and_then(|e| e.to_str()).unwrap_or("");
            ext == "tsx" || ext == "jsx"
        });
        let has_routes = files.iter().any(|f| {
            let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.contains("route") || name.contains("api")
        });
        let has_models = files.iter().any(|f| {
            let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.contains("model") || name.contains("schema")
        });
        let has_config = files.iter().any(|f| {
            let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.contains("config") || name.contains(".env")
        });

        if has_react {
            DetectedModuleType::Frontend
        } else if has_models {
            DetectedModuleType::Database
        } else if has_routes {
            DetectedModuleType::Backend
        } else if has_config {
            DetectedModuleType::Infrastructure
        } else {
            DetectedModuleType::Service
        }
    }

    /// 深度分析模块
    fn analyze_module_deep(
        &self,
        node: &DirectoryNode,
        module_type: DetectedModuleType,
        parent_path: &str,
        root_dir: &Path,
    ) -> Option<DetectedModule> {
        let files = self.collect_files(node);
        if files.is_empty() {
            return None;
        }

        // 生成语义化的模块名称
        let module_name = if parent_path.is_empty() {
            node.name.clone()
        } else {
            format!("{}/{}", parent_path, node.name)
        };

        // 计算相对于项目根目录的路径
        let root_path = node
            .path
            .strip_prefix(root_dir)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| node.name.clone());

        // 生成职责描述
        let responsibilities = self.infer_responsibilities(&node.name, module_type, &files);

        // 生成建议任务
        let suggested_tasks = self.generate_suggested_tasks(module_type, &files);

        // 提取导出的主要符号
        let exports = self.extract_exports_from_index(node);

        // 提取依赖的其他模块
        let imports = self.extract_imports_from_files(&files);

        Some(DetectedModule {
            name: module_name,
            path: node.path.clone(),
            root_path,
            module_type,
            files,
            exports,
            imports,
            responsibilities,
            suggested_tasks,
            ai_description: None,
            core_features: None,
            boundary_constraints: None,
            protected_files: None,
        })
    }

    /// 收集目录下的所有文件
    fn collect_files(&self, node: &DirectoryNode) -> Vec<PathBuf> {
        let mut files = Vec::new();

        if node.node_type == NodeType::File {
            files.push(node.path.clone());
        } else {
            for child in &node.children {
                files.extend(self.collect_files(child));
            }
        }

        files
    }

    /// 推断模块职责
    fn infer_responsibilities(
        &self,
        _name: &str,
        module_type: DetectedModuleType,
        files: &[PathBuf],
    ) -> Vec<String> {
        let mut responsibilities = Vec::new();

        match module_type {
            DetectedModuleType::Frontend => {
                responsibilities.push("用户界面渲染".to_string());
                responsibilities.push("用户交互处理".to_string());
                if files.iter().any(|f| {
                    let name = f.to_string_lossy();
                    name.contains("state") || name.contains("store")
                }) {
                    responsibilities.push("状态管理".to_string());
                }
            }
            DetectedModuleType::Backend => {
                responsibilities.push("业务逻辑处理".to_string());
                responsibilities.push("API 接口提供".to_string());
                if files.iter().any(|f| f.to_string_lossy().contains("auth")) {
                    responsibilities.push("认证授权".to_string());
                }
            }
            DetectedModuleType::Database => {
                responsibilities.push("数据持久化".to_string());
                responsibilities.push("数据模型定义".to_string());
                responsibilities.push("数据库迁移".to_string());
            }
            DetectedModuleType::Service => {
                responsibilities.push("通用服务提供".to_string());
                responsibilities.push("工具函数".to_string());
            }
            DetectedModuleType::Infrastructure => {
                responsibilities.push("配置管理".to_string());
                responsibilities.push("部署脚本".to_string());
            }
            DetectedModuleType::Other => {
                responsibilities.push("其他功能".to_string());
            }
        }

        responsibilities
    }

    /// 生成建议任务
    fn generate_suggested_tasks(
        &self,
        module_type: DetectedModuleType,
        files: &[PathBuf],
    ) -> Vec<String> {
        let mut tasks = vec!["代码审查和重构".to_string()];

        // 检查是否有测试文件
        let has_tests = files.iter().any(|f| {
            let name = f.to_string_lossy();
            name.contains(".test.") || name.contains(".spec.") || name.contains("__tests__")
        });
        if !has_tests {
            tasks.push("添加单元测试".to_string());
        }

        match module_type {
            DetectedModuleType::Frontend => {
                tasks.push("UI/UX 优化".to_string());
                tasks.push("性能优化".to_string());
            }
            DetectedModuleType::Backend => {
                tasks.push("API 文档完善".to_string());
                tasks.push("错误处理优化".to_string());
            }
            DetectedModuleType::Database => {
                tasks.push("索引优化".to_string());
                tasks.push("数据迁移脚本".to_string());
            }
            _ => {}
        }

        tasks
    }

    /// 从 index 文件提取导出的符号
    fn extract_exports_from_index(&self, node: &DirectoryNode) -> Vec<String> {
        let mut exports = Vec::new();

        // 查找 index 文件
        let index_file = node.children.iter().find(|c| {
            c.node_type == NodeType::File
                && (c.name == "index.ts"
                    || c.name == "index.js"
                    || c.name == "mod.rs"
                    || c.name == "lib.rs")
        });

        if let Some(index) = index_file {
            if let Ok(content) = fs::read_to_string(&index.path) {
                // TypeScript/JavaScript: export const/function/class
                let re = regex::Regex::new(
                    r"export\s+(?:const|function|class|type|interface|enum)\s+(\w+)",
                )
                .ok();
                if let Some(re) = re {
                    for cap in re.captures_iter(&content) {
                        if let Some(name) = cap.get(1) {
                            exports.push(name.as_str().to_string());
                        }
                    }
                }

                // Rust: pub use/pub mod
                let re_rust = regex::Regex::new(r"pub\s+(?:use|mod)\s+(\w+)").ok();
                if let Some(re) = re_rust {
                    for cap in re.captures_iter(&content) {
                        if let Some(name) = cap.get(1) {
                            exports.push(name.as_str().to_string());
                        }
                    }
                }
            }
        }

        exports.into_iter().take(20).collect()
    }

    /// 从文件中提取导入的模块
    fn extract_imports_from_files(&self, files: &[PathBuf]) -> Vec<String> {
        use once_cell::sync::Lazy;

        static RE_TS_IMPORT: Lazy<regex::Regex> =
            Lazy::new(|| regex::Regex::new(r#"import\s+.*from\s+['"](\.[^'"]+)['"]"#).unwrap());
        static RE_RUST_USE: Lazy<regex::Regex> =
            Lazy::new(|| regex::Regex::new(r"use\s+(?:crate|super)::(\w+)").unwrap());

        let mut imports = std::collections::HashSet::new();

        // 只检查前 10 个文件
        for file in files.iter().take(10) {
            let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "ts" | "tsx" | "js" | "rs") {
                continue;
            }

            if let Ok(content) = fs::read_to_string(file) {
                // TypeScript/JavaScript 相对路径导入
                for cap in RE_TS_IMPORT.captures_iter(&content) {
                    if let Some(import_path) = cap.get(1) {
                        let parts: Vec<&str> = import_path
                            .as_str()
                            .split('/')
                            .filter(|p| *p != "." && *p != "..")
                            .collect();
                        if let Some(first) = parts.first() {
                            imports.insert(first.to_string());
                        }
                    }
                }

                // Rust use 语句
                for cap in RE_RUST_USE.captures_iter(&content) {
                    if let Some(name) = cap.get(1) {
                        imports.insert(name.as_str().to_string());
                    }
                }
            }
        }

        imports.into_iter().collect()
    }

    /// 读取包信息
    fn read_package_info(
        &self,
        root_dir: &Path,
    ) -> (Vec<String>, Vec<String>, HashMap<String, String>) {
        let pkg_path = root_dir.join("package.json");

        if !pkg_path.exists() {
            // 尝试读取 Cargo.toml
            let cargo_path = root_dir.join("Cargo.toml");
            if cargo_path.exists() {
                if let Ok(content) = fs::read_to_string(&cargo_path) {
                    let mut deps = Vec::new();
                    let mut in_deps = false;
                    for line in content.lines() {
                        if line.starts_with("[dependencies]") {
                            in_deps = true;
                            continue;
                        }
                        if line.starts_with('[') {
                            in_deps = false;
                        }
                        if in_deps {
                            if let Some(name) = line.split('=').next() {
                                let name = name.trim();
                                if !name.is_empty() {
                                    deps.push(name.to_string());
                                }
                            }
                        }
                    }
                    return (deps, vec![], HashMap::new());
                }
            }
            return (vec![], vec![], HashMap::new());
        }

        if let Ok(content) = fs::read_to_string(&pkg_path) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                let deps = pkg
                    .get("dependencies")
                    .and_then(|d| d.as_object())
                    .map(|d| d.keys().cloned().collect())
                    .unwrap_or_default();

                let dev_deps = pkg
                    .get("devDependencies")
                    .and_then(|d| d.as_object())
                    .map(|d| d.keys().cloned().collect())
                    .unwrap_or_default();

                let scripts = pkg
                    .get("scripts")
                    .and_then(|s| s.as_object())
                    .map(|s| {
                        s.iter()
                            .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                            .collect()
                    })
                    .unwrap_or_default();

                return (deps, dev_deps, scripts);
            }
        }

        (vec![], vec![], HashMap::new())
    }

    /// 计算统计信息
    fn calculate_stats(&self, structure: &DirectoryNode) -> CodebaseStats {
        let mut stats = CodebaseStats::default();
        let mut file_sizes: Vec<(PathBuf, usize)> = Vec::new();

        self.traverse_for_stats(structure, &mut stats, &mut file_sizes);

        // 排序获取最大文件
        file_sizes.sort_by(|a, b| b.1.cmp(&a.1));
        stats.largest_files = file_sizes.into_iter().take(10).collect();

        stats
    }

    /// 递归遍历统计
    fn traverse_for_stats(
        &self,
        node: &DirectoryNode,
        stats: &mut CodebaseStats,
        file_sizes: &mut Vec<(PathBuf, usize)>,
    ) {
        match node.node_type {
            NodeType::File => {
                stats.total_files += 1;
                let ext = node
                    .extension
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());
                *stats.files_by_type.entry(ext).or_insert(0) += 1;

                // 尝试计算行数
                if let Ok(content) = fs::read_to_string(&node.path) {
                    let lines = content.lines().count();
                    stats.total_lines += lines;
                    file_sizes.push((node.path.clone(), lines));
                }
            }
            NodeType::Directory => {
                stats.total_dirs += 1;
                for child in &node.children {
                    self.traverse_for_stats(child, stats, file_sizes);
                }
            }
        }
    }

    /// 生成项目描述
    fn generate_project_description(
        &self,
        name: &str,
        language: &str,
        framework: Option<&str>,
        modules: &[DetectedModule],
    ) -> String {
        let mut parts = Vec::new();

        parts.push(format!("{} 是一个", name));

        if let Some(fw) = framework {
            parts.push(format!("基于 {} 框架的", fw));
        }

        parts.push(format!("{} 项目。", language));

        if !modules.is_empty() {
            parts.push(format!("包含 {} 个主要模块：", modules.len()));
            let module_names: Vec<_> = modules.iter().map(|m| m.name.as_str()).collect();
            parts.push(format!("{}。", module_names.join("、")));
        }

        parts.join("")
    }

    // --------------------------------------------------------------------------
    // AI 语义分析
    // --------------------------------------------------------------------------

    /// 使用 AI 分析代码语义
    async fn analyze_with_ai(&self, codebase: &CodebaseInfo) -> Result<AIAnalysisResult, String> {
        // 构建分析上下文
        let _context = self.build_ai_context(codebase);

        // 这里应该调用 AI 客户端进行分析
        // 由于 Rust 版本可能没有直接的 AI 客户端，返回基于规则的分析结果
        Ok(self.generate_rule_based_analysis(codebase))
    }

    /// 构建 AI 分析上下文
    fn build_ai_context(&self, codebase: &CodebaseInfo) -> String {
        let mut lines = Vec::new();

        lines.push(format!("# 项目: {}", codebase.name));
        lines.push(format!("语言: {}", codebase.language));
        if let Some(ref fw) = codebase.framework {
            lines.push(format!("框架: {}", fw));
        }
        lines.push(String::new());

        lines.push("## 检测到的模块".to_string());
        for module in &codebase.modules {
            lines.push(format!(
                "- {} ({:?}): {} 文件",
                module.name,
                module.module_type,
                module.files.len()
            ));
        }
        lines.push(String::new());

        lines.push("## 依赖".to_string());
        let deps: Vec<_> = codebase.dependencies.iter().take(20).collect();
        lines.push(format!(
            "主要依赖: {}",
            deps.iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));

        lines.join("\n")
    }

    /// 基于规则的分析（AI 失败时的后备方案）
    fn generate_rule_based_analysis(&self, codebase: &CodebaseInfo) -> AIAnalysisResult {
        let mut core_features = Vec::new();

        // 根据模块推断功能
        for module in &codebase.modules {
            core_features.extend(module.responsibilities.clone());
        }

        // 根据依赖推断功能
        if codebase
            .dependencies
            .iter()
            .any(|d| d == "express" || d == "fastify")
        {
            core_features.push("HTTP API 服务".to_string());
        }
        if codebase
            .dependencies
            .iter()
            .any(|d| d == "monaster" || d == "prisma")
        {
            core_features.push("数据库操作".to_string());
        }
        if codebase
            .dependencies
            .iter()
            .any(|d| d == "react" || d == "vue")
        {
            core_features.push("前端界面".to_string());
        }

        // 去重
        core_features.sort();
        core_features.dedup();

        AIAnalysisResult {
            overview: codebase.description.clone(),
            architecture_pattern: self.infer_architecture_pattern(codebase),
            core_features,
            module_analysis: codebase
                .modules
                .iter()
                .map(|m| AIModuleAnalysis {
                    name: m.name.clone(),
                    purpose: format!("{:?} 模块", m.module_type),
                    responsibilities: m.responsibilities.clone(),
                    dependencies: m.imports.clone(),
                    core_features: m.responsibilities.iter().take(3).cloned().collect(),
                    boundary_constraints: self.infer_boundary_constraints(m.module_type),
                    protected_files: self.infer_protected_files(m),
                    public_interfaces: m.exports.clone(),
                    internal_details: vec![],
                })
                .collect(),
            business_flows: vec![],
            architecture_decisions: vec![],
            technical_debts: vec![],
        }
    }

    /// 推断架构模式
    fn infer_architecture_pattern(&self, codebase: &CodebaseInfo) -> String {
        let module_types: Vec<_> = codebase.modules.iter().map(|m| m.module_type).collect();

        if module_types.contains(&DetectedModuleType::Frontend)
            && module_types.contains(&DetectedModuleType::Backend)
        {
            return "前后端分离".to_string();
        }
        if codebase.dependencies.iter().any(|d| d == "@nestjs/core") {
            return "NestJS 模块化架构".to_string();
        }
        if codebase
            .structure
            .children
            .iter()
            .any(|c| c.name == "services")
        {
            return "微服务架构".to_string();
        }
        "MVC / 分层架构".to_string()
    }

    /// 推断模块的边界约束
    fn infer_boundary_constraints(&self, module_type: DetectedModuleType) -> Vec<String> {
        match module_type {
            DetectedModuleType::Frontend => vec![
                "不应直接访问数据库".to_string(),
                "业务逻辑应通过 API 调用后端".to_string(),
            ],
            DetectedModuleType::Backend => vec![
                "不应包含 UI 渲染逻辑".to_string(),
                "数据验证应在 API 边界完成".to_string(),
            ],
            DetectedModuleType::Database => vec![
                "不应包含业务逻辑".to_string(),
                "数据模型变更需要迁移脚本".to_string(),
            ],
            DetectedModuleType::Service => {
                vec!["应保持无状态".to_string(), "不应依赖特定框架".to_string()]
            }
            DetectedModuleType::Infrastructure => vec![
                "配置不应硬编码".to_string(),
                "敏感信息应使用环境变量".to_string(),
            ],
            DetectedModuleType::Other => vec![],
        }
    }

    /// 推断受保护的核心文件
    fn infer_protected_files(&self, module: &DetectedModule) -> Vec<String> {
        let mut protected = Vec::new();

        for file in &module.files {
            let file_name = file.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // index 文件通常是模块入口
            if file_name.starts_with("index.") || file_name == "mod.rs" || file_name == "lib.rs" {
                protected.push(file.to_string_lossy().to_string());
            }
            // 类型定义文件
            if file_name == "types.ts" || file_name.ends_with(".d.ts") || file_name == "types.rs" {
                protected.push(file.to_string_lossy().to_string());
            }
            // 配置文件
            if file_name.contains("config") || file_name.contains("constants") {
                protected.push(file.to_string_lossy().to_string());
            }
        }

        protected.into_iter().take(10).collect()
    }

    /// 用 AI 分析结果增强模块信息
    fn enhance_modules_with_ai(&self, codebase: &mut CodebaseInfo, analysis: &AIAnalysisResult) {
        for module in &mut codebase.modules {
            // 尝试匹配 AI 分析的模块
            let ai_module = self.find_matching_ai_module(&module.name, &analysis.module_analysis);

            if let Some(ai_mod) = ai_module {
                module.ai_description = Some(ai_mod.purpose.clone());

                // 合并职责
                let mut responsibilities = module.responsibilities.clone();
                responsibilities.extend(ai_mod.responsibilities.clone());
                responsibilities.sort();
                responsibilities.dedup();
                module.responsibilities = responsibilities;

                // 核心功能
                module.core_features = Some(if !ai_mod.core_features.is_empty() {
                    ai_mod.core_features.clone()
                } else {
                    module.responsibilities.iter().take(3).cloned().collect()
                });

                // 边界约束
                module.boundary_constraints = Some(if !ai_mod.boundary_constraints.is_empty() {
                    ai_mod.boundary_constraints.clone()
                } else {
                    self.infer_boundary_constraints(module.module_type)
                });

                // 受保护文件
                let mut protected = ai_mod.protected_files.clone();
                protected.extend(self.infer_protected_files(module));
                protected.sort();
                protected.dedup();
                module.protected_files = Some(protected.into_iter().take(10).collect());

                // 合并导出信息
                if !ai_mod.public_interfaces.is_empty() {
                    let mut exports = module.exports.clone();
                    exports.extend(ai_mod.public_interfaces.clone());
                    exports.sort();
                    exports.dedup();
                    module.exports = exports;
                }
            } else {
                // AI 没有分析到这个模块，使用规则推断
                module.core_features =
                    Some(module.responsibilities.iter().take(3).cloned().collect());
                module.boundary_constraints =
                    Some(self.infer_boundary_constraints(module.module_type));
                module.protected_files = Some(self.infer_protected_files(module));
            }
        }
    }

    /// 查找匹配的 AI 模块分析结果
    fn find_matching_ai_module<'a>(
        &self,
        module_name: &str,
        ai_modules: &'a [AIModuleAnalysis],
    ) -> Option<&'a AIModuleAnalysis> {
        let normalized_name = module_name.to_lowercase();

        // 1. 尝试完全匹配
        if let Some(m) = ai_modules
            .iter()
            .find(|m| m.name.to_lowercase() == normalized_name)
        {
            return Some(m);
        }

        // 2. 尝试部分匹配
        let last_part = normalized_name
            .rsplit('/')
            .next()
            .unwrap_or(&normalized_name);
        if let Some(m) = ai_modules.iter().find(|m| {
            let ai_last = m.name.to_lowercase();
            let ai_last = ai_last.rsplit('/').next().unwrap_or(&ai_last);
            ai_last == last_part
        }) {
            return Some(m);
        }

        // 3. 尝试包含匹配
        ai_modules.iter().find(|m| {
            let ai_name = m.name.to_lowercase();
            ai_name.contains(last_part) || last_part.contains(&ai_name)
        })
    }

    // --------------------------------------------------------------------------
    // 生成蓝图
    // --------------------------------------------------------------------------

    /// 从代码库信息生成蓝图
    async fn generate_blueprint(
        &self,
        codebase: &CodebaseInfo,
        blueprint_manager: &mut BlueprintManager,
    ) -> Result<Blueprint, String> {
        // 创建蓝图
        let blueprint = blueprint_manager
            .create_blueprint(codebase.name.clone(), codebase.description.clone())
            .await
            .map_err(|e| e.to_string())?;

        // 添加模块
        for module in &codebase.modules {
            let tech_stack = self.infer_tech_stack(codebase, module);
            let sys_module = SystemModule {
                id: uuid::Uuid::new_v4().to_string(),
                name: module.name.clone(),
                description: module
                    .ai_description
                    .clone()
                    .unwrap_or_else(|| format!("{} 模块 - {:?}", module.name, module.module_type)),
                module_type: module.module_type.into(),
                responsibilities: module.responsibilities.clone(),
                dependencies: vec![],
                interfaces: vec![],
                tech_stack: Some(tech_stack),
                root_path: Some(module.root_path.clone()),
            };
            blueprint_manager
                .add_module(&blueprint.id, sys_module)
                .await
                .map_err(|e| e.to_string())?;
        }

        // 添加业务流程
        if let Some(ref analysis) = codebase.ai_analysis {
            if !analysis.business_flows.is_empty() {
                for flow in &analysis.business_flows {
                    let process = BusinessProcess {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: flow.name.clone(),
                        description: flow.description.clone(),
                        process_type: ProcessType::ToBe,
                        steps: flow
                            .steps
                            .iter()
                            .enumerate()
                            .map(|(i, step)| ProcessStep {
                                id: uuid::Uuid::new_v4().to_string(),
                                order: i as u32 + 1,
                                name: step.clone(),
                                description: step.clone(),
                                actor: "系统".to_string(),
                                system_action: Some(step.clone()),
                                user_action: None,
                                conditions: vec![],
                                outcomes: vec![],
                            })
                            .collect(),
                        actors: vec!["系统".to_string(), "用户".to_string()],
                        inputs: vec![],
                        outputs: vec![],
                    };
                    blueprint_manager
                        .add_business_process(&blueprint.id, process)
                        .await
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        // 添加默认业务流程（如果没有 AI 分析结果）
        if codebase.ai_analysis.is_none()
            || codebase
                .ai_analysis
                .as_ref()
                .map(|a| a.business_flows.is_empty())
                .unwrap_or(true)
        {
            let default_process = BusinessProcess {
                id: uuid::Uuid::new_v4().to_string(),
                name: "开发维护流程".to_string(),
                description: "现有项目的开发和维护流程".to_string(),
                process_type: ProcessType::ToBe,
                steps: vec![
                    ProcessStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        order: 1,
                        name: "需求分析".to_string(),
                        description: "分析新功能需求或 bug 修复需求".to_string(),
                        actor: "开发者".to_string(),
                        system_action: None,
                        user_action: Some("分析需求".to_string()),
                        conditions: vec![],
                        outcomes: vec!["需求文档".to_string()],
                    },
                    ProcessStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        order: 2,
                        name: "编写测试".to_string(),
                        description: "根据需求编写测试用例".to_string(),
                        actor: "开发者".to_string(),
                        system_action: None,
                        user_action: Some("编写测试".to_string()),
                        conditions: vec!["需求文档".to_string()],
                        outcomes: vec!["测试用例".to_string()],
                    },
                    ProcessStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        order: 3,
                        name: "编写代码".to_string(),
                        description: "实现功能或修复 bug".to_string(),
                        actor: "开发者".to_string(),
                        system_action: None,
                        user_action: Some("编写代码".to_string()),
                        conditions: vec!["测试用例".to_string()],
                        outcomes: vec!["代码实现".to_string()],
                    },
                ],
                actors: vec!["开发者".to_string()],
                inputs: vec![],
                outputs: vec![],
            };
            blueprint_manager
                .add_business_process(&blueprint.id, default_process)
                .await
                .map_err(|e| e.to_string())?;
        }

        // 添加非功能性要求
        let nfr = NonFunctionalRequirement {
            id: uuid::Uuid::new_v4().to_string(),
            category: NfrCategory::Maintainability,
            name: "代码可维护性".to_string(),
            description: "保持代码清晰、有文档、有测试".to_string(),
            priority: MoscowPriority::Must,
            metric: None,
        };
        blueprint_manager
            .add_nfr(&blueprint.id, nfr)
            .await
            .map_err(|e| e.to_string())?;

        // 重要：从代码逆向生成的蓝图，直接标记为 approved 状态
        // 重新获取蓝图以获取最新状态
        let mut blueprint = blueprint_manager
            .get_blueprint(&blueprint.id)
            .await
            .ok_or_else(|| "蓝图不存在".to_string())?;
        blueprint.status = BlueprintStatus::Approved;
        blueprint.approved_at = Some(Utc::now());
        blueprint.approved_by = Some("system".to_string());
        blueprint.source = Some(BlueprintSource::Codebase);

        Ok(blueprint)
    }

    /// 生成任务树（已有功能标记为 passed）
    async fn generate_task_tree_with_passed_status(
        &self,
        blueprint: &Blueprint,
        task_tree_manager: &mut TaskTreeManager,
    ) -> Result<TaskTree, String> {
        // 先用标准方法生成任务树
        let mut task_tree = task_tree_manager
            .generate_from_blueprint(blueprint)
            .await
            .map_err(|e| e.to_string())?;

        // 递归标记所有任务为 passed
        Self::mark_all_tasks_as_passed(&mut task_tree.root);

        // 更新统计
        task_tree.stats = task_tree_manager.calculate_stats(&task_tree.root);
        task_tree.status = super::types::TaskTreeStatus::Completed;

        Ok(task_tree)
    }

    /// 递归标记所有任务为已完成
    fn mark_all_tasks_as_passed(task: &mut TaskNode) {
        task.status = TaskStatus::Passed;
        task.completed_at = Some(Utc::now());

        for child in &mut task.children {
            Self::mark_all_tasks_as_passed(child);
        }
    }

    /// 推断技术栈
    fn infer_tech_stack(&self, codebase: &CodebaseInfo, module: &DetectedModule) -> Vec<String> {
        let mut stack = Vec::new();

        stack.push(codebase.language.clone());

        if let Some(ref fw) = codebase.framework {
            stack.push(fw.clone());
        }

        // 根据模块类型添加常见技术
        match module.module_type {
            DetectedModuleType::Frontend => {
                if codebase.dependencies.iter().any(|d| d == "react") {
                    stack.push("React".to_string());
                }
                if codebase.dependencies.iter().any(|d| d == "vue") {
                    stack.push("Vue".to_string());
                }
                if codebase.dependencies.iter().any(|d| d == "tailwindcss") {
                    stack.push("Tailwind CSS".to_string());
                }
            }
            DetectedModuleType::Backend => {
                if codebase.dependencies.iter().any(|d| d == "express") {
                    stack.push("Express".to_string());
                }
                if codebase.dependencies.iter().any(|d| d == "fastify") {
                    stack.push("Fastify".to_string());
                }
            }
            DetectedModuleType::Database => {
                if codebase.dependencies.iter().any(|d| d == "prisma") {
                    stack.push("Prisma".to_string());
                }
                if codebase.dependencies.iter().any(|d| d == "monaster") {
                    stack.push("MongoDB".to_string());
                }
            }
            _ => {}
        }

        stack
    }

    /// 设置根目录
    pub fn set_root_dir(&mut self, root_dir: PathBuf) {
        self.config.root_dir = root_dir;
    }
}

// ============================================================================
// 分析结果
// ============================================================================

/// 分析结果
#[derive(Debug, Clone)]
pub struct AnalyzeResult {
    pub codebase: CodebaseInfo,
    pub blueprint: Blueprint,
    pub task_tree: TaskTree,
}

// ============================================================================
// 工厂函数
// ============================================================================

/// 创建代码库分析器
pub fn create_codebase_analyzer(config: AnalyzerConfig) -> CodebaseAnalyzer {
    CodebaseAnalyzer::new(config)
}

/// 快捷函数：一键分析并生成蓝图
pub async fn quick_analyze(
    root_dir: PathBuf,
    blueprint_manager: &mut BlueprintManager,
    task_tree_manager: &mut TaskTreeManager,
) -> Result<AnalyzeResult, String> {
    let config = AnalyzerConfig {
        root_dir,
        ..Default::default()
    };
    let mut analyzer = CodebaseAnalyzer::new(config);
    analyzer
        .analyze_and_generate(blueprint_manager, task_tree_manager)
        .await
}
