//! 代码分析器
//!
//! 负责分析代码文件，提取符号和结构信息

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::map::types::*;

/// 语言扩展名映射
fn detect_language(file_path: &Path) -> &'static str {
    match file_path.extension().and_then(|e| e.to_str()) {
        Some("ts") | Some("tsx") => "typescript",
        Some("js") | Some("jsx") | Some("mjs") | Some("cjs") => "javascript",
        Some("py") => "python",
        Some("go") => "go",
        Some("rs") => "rust",
        Some("java") => "java",
        Some("c") | Some("h") => "c",
        Some("cpp") | Some("hpp") | Some("cc") => "cpp",
        Some("rb") => "ruby",
        Some("php") => "php",
        Some("swift") => "swift",
        Some("kt") => "kotlin",
        Some("scala") => "scala",
        Some("cs") => "csharp",
        Some("sh") | Some("bash") => "bash",
        _ => "unknown",
    }
}

/// 默认包含模式
const DEFAULT_INCLUDE: &[&str] = &[
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.py",
    "**/*.go",
    "**/*.rs",
    "**/*.java",
];

/// 默认排除模式
const DEFAULT_EXCLUDE: &[&str] = &[
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/coverage/**",
    "**/__pycache__/**",
    "**/vendor/**",
    "**/target/**",
    "**/*.min.js",
    "**/*.bundle.js",
];

/// 代码分析器
pub struct CodeMapAnalyzer {
    root_path: PathBuf,
    include: Vec<String>,
    exclude: Vec<String>,
    concurrency: usize,
}

impl CodeMapAnalyzer {
    /// 创建新的分析器
    pub fn new(root_path: impl AsRef<Path>) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
            include: DEFAULT_INCLUDE.iter().map(|s| s.to_string()).collect(),
            exclude: DEFAULT_EXCLUDE.iter().map(|s| s.to_string()).collect(),
            concurrency: 10,
        }
    }

    /// 设置包含模式
    pub fn with_include(mut self, patterns: Vec<String>) -> Self {
        self.include = patterns;
        self
    }

    /// 设置排除模式
    pub fn with_exclude(mut self, patterns: Vec<String>) -> Self {
        self.exclude = patterns;
        self
    }

    /// 设置并发数
    pub fn with_concurrency(mut self, concurrency: usize) -> Self {
        self.concurrency = concurrency;
        self
    }

    /// 从选项创建
    pub fn from_options(root_path: impl AsRef<Path>, options: &GenerateOptions) -> Self {
        let mut analyzer = Self::new(root_path);
        if let Some(ref include) = options.include {
            analyzer.include = include.clone();
        }
        if let Some(ref exclude) = options.exclude {
            analyzer.exclude = exclude.clone();
        }
        if let Some(concurrency) = options.concurrency {
            analyzer.concurrency = concurrency;
        }
        analyzer
    }

    /// 发现所有待分析的文件
    pub fn discover_files(&self) -> Vec<PathBuf> {
        let mut all_files = HashSet::new();

        for pattern in &self.include {
            let full_pattern = self.root_path.join(pattern);
            if let Ok(entries) = glob::glob(full_pattern.to_str().unwrap_or("")) {
                for entry in entries.flatten() {
                    if entry.is_file() && !self.is_excluded(&entry) {
                        all_files.insert(entry);
                    }
                }
            }
        }

        let mut files: Vec<_> = all_files.into_iter().collect();
        files.sort();
        files
    }

    /// 检查文件是否被排除
    fn is_excluded(&self, path: &Path) -> bool {
        let path_str = path.to_string_lossy();
        for pattern in &self.exclude {
            if let Ok(glob_pattern) = glob::Pattern::new(pattern) {
                if glob_pattern.matches(&path_str) {
                    return true;
                }
            }
            // 简单的包含检查
            if path_str.contains(pattern.trim_matches('*')) {
                return true;
            }
        }
        false
    }

    /// 分析单个文件
    pub fn analyze_file(&self, file_path: &Path) -> Option<ModuleNode> {
        let content = std::fs::read_to_string(file_path).ok()?;
        let metadata = std::fs::metadata(file_path).ok()?;
        let language = detect_language(file_path);
        let relative_path = file_path
            .strip_prefix(&self.root_path)
            .unwrap_or(file_path)
            .to_string_lossy()
            .replace('\\', "/");
        let lines = content.lines().count();

        Some(ModuleNode {
            id: relative_path.clone(),
            name: file_path.file_name()?.to_string_lossy().to_string(),
            path: file_path.to_string_lossy().to_string(),
            language: language.to_string(),
            lines,
            size: metadata.len() as usize,
            imports: self.extract_imports(&content, &relative_path, language),
            exports: Vec::new(),
            classes: Vec::new(),
            interfaces: Vec::new(),
            types: Vec::new(),
            enums: Vec::new(),
            functions: self.extract_functions(&content, &relative_path, language),
            variables: Vec::new(),
        })
    }

    /// 批量分析文件
    pub fn analyze_files(&self, files: Option<Vec<PathBuf>>) -> Vec<ModuleNode> {
        let files_to_analyze = files.unwrap_or_else(|| self.discover_files());
        files_to_analyze
            .iter()
            .filter_map(|f| self.analyze_file(f))
            .collect()
    }

    /// 提取导入信息
    fn extract_imports(&self, content: &str, module_id: &str, lang: &str) -> Vec<ImportInfo> {
        let mut imports = Vec::new();

        match lang {
            "typescript" | "javascript" => {
                self.extract_js_imports(content, module_id, &mut imports);
            }
            "python" => {
                self.extract_python_imports(content, module_id, &mut imports);
            }
            "rust" => {
                self.extract_rust_imports(content, module_id, &mut imports);
            }
            _ => {}
        }

        imports
    }

    /// 提取 JS/TS 导入
    fn extract_js_imports(&self, content: &str, module_id: &str, imports: &mut Vec<ImportInfo>) {
        let import_re = regex::Regex::new(
            r#"import\s+(?:(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))\s+from\s+)?['"]([^'"]+)['"]"#,
        )
        .unwrap();

        for (line_num, line) in content.lines().enumerate() {
            if let Some(caps) = import_re.captures(line) {
                let source = caps
                    .get(4)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                let mut symbols = Vec::new();
                let mut is_default = false;
                let mut is_namespace = false;

                if let Some(named) = caps.get(1) {
                    symbols.extend(
                        named
                            .as_str()
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty()),
                    );
                }
                if caps.get(2).is_some() {
                    is_namespace = true;
                }
                if let Some(default) = caps.get(3) {
                    is_default = true;
                    symbols.push(default.as_str().to_string());
                }

                imports.push(ImportInfo {
                    source,
                    symbols,
                    is_default,
                    is_namespace,
                    is_dynamic: false,
                    location: LocationInfo {
                        file: module_id.to_string(),
                        start_line: (line_num + 1) as u32,
                        start_column: 0,
                        end_line: (line_num + 1) as u32,
                        end_column: line.len() as u32,
                    },
                });
            }
        }
    }

    /// 提取 Python 导入
    fn extract_python_imports(
        &self,
        content: &str,
        module_id: &str,
        imports: &mut Vec<ImportInfo>,
    ) {
        let from_import_re = regex::Regex::new(r"^from\s+(\S+)\s+import\s+(.+)$").unwrap();
        let import_re = regex::Regex::new(r"^import\s+(.+)$").unwrap();

        for (line_num, line) in content.lines().enumerate() {
            let trimmed = line.trim();

            if let Some(caps) = from_import_re.captures(trimmed) {
                let source = caps
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                let import_part = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let symbols: Vec<String> = import_part
                    .split(',')
                    .map(|s| {
                        s.trim()
                            .split(" as ")
                            .next()
                            .unwrap_or("")
                            .trim()
                            .to_string()
                    })
                    .filter(|s| !s.is_empty() && s != "*")
                    .collect();

                imports.push(ImportInfo {
                    source,
                    symbols,
                    is_default: false,
                    is_namespace: import_part.trim() == "*",
                    is_dynamic: false,
                    location: LocationInfo {
                        file: module_id.to_string(),
                        start_line: (line_num + 1) as u32,
                        start_column: 0,
                        end_line: (line_num + 1) as u32,
                        end_column: line.len() as u32,
                    },
                });
            } else if let Some(caps) = import_re.captures(trimmed) {
                let import_part = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let source = import_part
                    .split(',')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();

                imports.push(ImportInfo {
                    source,
                    symbols: Vec::new(),
                    is_default: false,
                    is_namespace: false,
                    is_dynamic: false,
                    location: LocationInfo {
                        file: module_id.to_string(),
                        start_line: (line_num + 1) as u32,
                        start_column: 0,
                        end_line: (line_num + 1) as u32,
                        end_column: line.len() as u32,
                    },
                });
            }
        }
    }

    /// 提取 Rust 导入
    fn extract_rust_imports(&self, content: &str, module_id: &str, imports: &mut Vec<ImportInfo>) {
        let use_re = regex::Regex::new(r"^use\s+([^;]+);").unwrap();

        for (line_num, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if let Some(caps) = use_re.captures(trimmed) {
                let use_path = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let source = use_path.split("::").next().unwrap_or("").to_string();

                imports.push(ImportInfo {
                    source,
                    symbols: vec![use_path.to_string()],
                    is_default: false,
                    is_namespace: use_path.contains('*'),
                    is_dynamic: false,
                    location: LocationInfo {
                        file: module_id.to_string(),
                        start_line: (line_num + 1) as u32,
                        start_column: 0,
                        end_line: (line_num + 1) as u32,
                        end_column: line.len() as u32,
                    },
                });
            }
        }
    }

    /// 提取函数
    fn extract_functions(&self, content: &str, module_id: &str, lang: &str) -> Vec<FunctionNode> {
        let mut functions = Vec::new();

        let fn_re = match lang {
            "rust" => regex::Regex::new(r"(?m)^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)").ok(),
            "typescript" | "javascript" => {
                regex::Regex::new(r"(?m)(?:export\s+)?(?:async\s+)?function\s+(\w+)").ok()
            }
            "python" => regex::Regex::new(r"(?m)^(?:async\s+)?def\s+(\w+)").ok(),
            _ => None,
        };

        if let Some(re) = fn_re {
            for (line_num, line) in content.lines().enumerate() {
                if let Some(caps) = re.captures(line) {
                    let name = caps
                        .get(1)
                        .map(|m| m.as_str().to_string())
                        .unwrap_or_default();
                    functions.push(FunctionNode {
                        id: format!("{}::{}", module_id, name),
                        name: name.clone(),
                        signature: line.trim().to_string(),
                        parameters: Vec::new(),
                        return_type: None,
                        is_async: line.contains("async"),
                        is_generator: false,
                        is_exported: line.contains("pub") || line.contains("export"),
                        location: LocationInfo {
                            file: module_id.to_string(),
                            start_line: (line_num + 1) as u32,
                            start_column: 0,
                            end_line: (line_num + 1) as u32,
                            end_column: line.len() as u32,
                        },
                        documentation: None,
                        calls: Vec::new(),
                        called_by: Vec::new(),
                    });
                }
            }
        }

        functions
    }
}

/// 创建分析器的便捷函数
pub fn create_analyzer(root_path: impl AsRef<Path>) -> CodeMapAnalyzer {
    CodeMapAnalyzer::new(root_path)
}

/// 生成代码本体图谱
pub fn generate_ontology(
    root_path: impl AsRef<Path>,
    options: Option<GenerateOptions>,
) -> CodeOntology {
    let opts = options.unwrap_or_default();
    let analyzer = CodeMapAnalyzer::from_options(&root_path, &opts);
    let modules = analyzer.analyze_files(None);

    let mut statistics = OntologyStatistics::default();
    let mut language_breakdown: HashMap<String, usize> = HashMap::new();

    for module in &modules {
        statistics.total_modules += 1;
        statistics.total_functions += module.functions.len();
        statistics.total_classes += module.classes.len();
        statistics.total_interfaces += module.interfaces.len();
        statistics.total_variables += module.variables.len();
        statistics.total_lines += module.lines;

        *language_breakdown
            .entry(module.language.clone())
            .or_insert(0) += 1;

        for class in &module.classes {
            statistics.total_methods += class.methods.len();
        }
    }

    statistics.language_breakdown = language_breakdown;

    CodeOntology {
        version: "1.0.0".to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        project: ProjectInfo {
            name: root_path
                .as_ref()
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            root_path: root_path.as_ref().to_string_lossy().to_string(),
            languages: statistics.language_breakdown.keys().cloned().collect(),
            file_count: statistics.total_modules,
            total_lines: statistics.total_lines,
        },
        modules,
        call_graph: CallGraph::default(),
        dependency_graph: DependencyGraph::default(),
        statistics,
    }
}
