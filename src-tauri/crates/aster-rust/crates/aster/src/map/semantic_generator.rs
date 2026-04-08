//! AI 语义生成器
//!
//! 使用 LLM 为模块和符号生成业务语义描述

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::types::ModuleNode;
use super::types_enhanced::{
    ArchitectureLayer, EnhancedAnalysisPhase, EnhancedAnalysisProgress, ProjectSemantic,
    SemanticInfo, SymbolEntry,
};

/// 默认模型
const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";
/// 最大代码长度
const MAX_CODE_LENGTH: usize = 8000;
/// 批量处理大小
const BATCH_SIZE: usize = 5;
/// 并发数
const CONCURRENCY: usize = 3;

/// 语义生成器选项
#[derive(Debug, Clone)]
pub struct SemanticGeneratorOptions {
    /// 使用的模型
    pub model: String,
    /// 并发数
    pub concurrency: usize,
    /// 批量大小
    pub batch_size: usize,
    /// 进度回调
    pub on_progress: Option<fn(&EnhancedAnalysisProgress)>,
}

impl Default for SemanticGeneratorOptions {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            concurrency: CONCURRENCY,
            batch_size: BATCH_SIZE,
            on_progress: None,
        }
    }
}

/// 模块语义响应
#[derive(Debug, Clone)]
struct ModuleSemanticResponse {
    description: String,
    responsibility: String,
    business_domain: Option<String>,
    architecture_layer: ArchitectureLayer,
    tags: Vec<String>,
}

/// 项目语义响应
#[derive(Debug, Clone)]
struct ProjectSemanticResponse {
    description: String,
    purpose: String,
    domains: Vec<String>,
    key_concepts: Vec<KeyConceptResponse>,
}

/// 关键概念响应
#[derive(Debug, Clone)]
struct KeyConceptResponse {
    name: String,
    description: String,
}

/// 语义生成器
pub struct SemanticGenerator {
    root_path: PathBuf,
    model: String,
    concurrency: usize,
    batch_size: usize,
    on_progress: Option<fn(&EnhancedAnalysisProgress)>,
}

impl SemanticGenerator {
    /// 创建新的生成器
    pub fn new(root_path: impl AsRef<Path>, options: SemanticGeneratorOptions) -> Self {
        Self {
            root_path: root_path.as_ref().to_path_buf(),
            model: options.model,
            concurrency: options.concurrency,
            batch_size: options.batch_size,
            on_progress: options.on_progress,
        }
    }

    /// 为单个模块生成语义描述
    pub fn generate_module_semantic(&self, module: &ModuleNode) -> SemanticInfo {
        // 读取文件内容
        let file_path = self.root_path.join(&module.id);
        let content = match fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => return self.generate_fallback_semantic(module),
        };

        // 截断过长的代码
        let content = if content.len() > MAX_CODE_LENGTH {
            // Find safe UTF-8 boundary for truncation
            let truncate_at = content
                .char_indices()
                .take_while(|(i, _)| *i < MAX_CODE_LENGTH)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(0);
            format!(
                "{}\n// ... (code truncated)",
                content.get(..truncate_at).unwrap_or(&content)
            )
        } else {
            content
        };

        // 构建提示词
        let _prompt = self.build_module_prompt(module, &content);

        // TODO: 调用 LLM API
        // 目前返回基于规则的语义
        self.generate_fallback_semantic(module)
    }

    /// 批量生成模块语义
    pub fn batch_generate_module_semantics(
        &self,
        modules: &[ModuleNode],
    ) -> HashMap<String, SemanticInfo> {
        let mut results = HashMap::new();
        let total = modules.len();

        for (i, module) in modules.iter().enumerate() {
            let semantic = self.generate_module_semantic(module);
            results.insert(module.id.clone(), semantic);

            if let Some(callback) = self.on_progress {
                callback(&EnhancedAnalysisProgress {
                    phase: EnhancedAnalysisPhase::Semantics,
                    current: i + 1,
                    total,
                    current_file: Some(module.id.clone()),
                    message: Some(format!("生成语义: {}", module.id)),
                });
            }
        }

        results
    }

    /// 生成项目级语义描述
    pub fn generate_project_semantic(&self, modules: &[ModuleNode]) -> ProjectSemantic {
        // 收集项目信息
        let _module_list: Vec<_> = modules
            .iter()
            .take(50)
            .map(|m| {
                (
                    m.id.clone(),
                    m.classes.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
                    m.functions
                        .iter()
                        .take(10)
                        .map(|f| f.name.clone())
                        .collect::<Vec<_>>(),
                )
            })
            .collect();

        // TODO: 调用 LLM API
        // 目前返回基于规则的语义
        self.generate_fallback_project_semantic(modules)
    }

    /// 为符号生成语义描述
    pub fn generate_symbol_semantic(
        &self,
        symbol: &SymbolEntry,
        _context: Option<&str>,
    ) -> SemanticInfo {
        // TODO: 调用 LLM API
        let kind_str = format!("{:?}", symbol.kind);
        SemanticInfo {
            description: format!("{} {}", kind_str, symbol.name),
            responsibility: kind_str,
            business_domain: None,
            architecture_layer: ArchitectureLayer::Infrastructure,
            tags: vec![],
            confidence: 0.3,
            generated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    // ========================================================================
    // Prompt 构建
    // ========================================================================

    /// 构建模块提示词
    fn build_module_prompt(&self, module: &ModuleNode, content: &str) -> String {
        let classes: Vec<_> = module.classes.iter().map(|c| c.name.as_str()).collect();
        let functions: Vec<_> = module
            .functions
            .iter()
            .take(10)
            .map(|f| f.name.as_str())
            .collect();
        let imports: Vec<_> = module
            .imports
            .iter()
            .take(5)
            .map(|i| i.source.as_str())
            .collect();

        format!(
            r#"分析以下代码模块，生成简洁的业务描述。

文件路径: {}
语言: {}
代码行数: {}
类: {}
函数: {}
导入: {}

代码内容:
```{}
{}
```

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{{
  "description": "这个模块做什么（1-2句话，用中文）",
  "responsibility": "核心职责（1句话）",
  "businessDomain": "所属业务领域（如：用户管理、支付、搜索等）",
  "architectureLayer": "presentation|business|data|infrastructure|crossCutting",
  "tags": ["关键词1", "关键词2", "关键词3"]
}}

architectureLayer 说明：
- presentation: UI 组件、页面、视图渲染
- business: 核心业务逻辑、领域模型、服务
- data: API 调用、数据库、存储
- infrastructure: 工具函数、配置、类型定义
- crossCutting: 认证、日志、中间件、插件"#,
            module.id,
            module.language,
            module.lines,
            classes.join(", "),
            functions.join(", "),
            imports.join(", "),
            module.language,
            content
        )
    }

    /// 构建项目提示词
    fn build_project_prompt(&self, module_list: &[(String, Vec<String>, Vec<String>)]) -> String {
        let modules_summary: String = module_list
            .iter()
            .map(|(path, classes, functions)| {
                format!(
                    "- {}: 类[{}], 函数[{}]",
                    path,
                    classes.join(", "),
                    functions.join(", ")
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            r#"分析以下项目结构，生成项目级语义描述。

项目模块列表（前50个）：
{}

请返回 JSON 格式（不要包含 markdown 代码块标记）：
{{
  "description": "这个项目做什么（2-3句话，用中文）",
  "purpose": "项目的核心价值和目的（1-2句话）",
  "domains": ["业务领域1", "业务领域2", "业务领域3"],
  "keyConcepts": [
    {{
      "name": "核心概念1",
      "description": "这个概念的含义和作用"
    }},
    {{
      "name": "核心概念2",
      "description": "这个概念的含义和作用"
    }}
  ]
}}"#,
            modules_summary
        )
    }

    // ========================================================================
    // 辅助方法
    // ========================================================================

    /// 验证架构层
    fn validate_layer(&self, layer: &str) -> ArchitectureLayer {
        match layer {
            "presentation" => ArchitectureLayer::Presentation,
            "business" => ArchitectureLayer::Business,
            "data" => ArchitectureLayer::Data,
            "infrastructure" => ArchitectureLayer::Infrastructure,
            "crossCutting" => ArchitectureLayer::CrossCutting,
            _ => ArchitectureLayer::Infrastructure,
        }
    }

    /// 查找相关模块
    fn find_related_modules(&self, concept_name: &str, modules: &[ModuleNode]) -> Vec<String> {
        let lower_name = concept_name.to_lowercase();
        let mut related = Vec::new();

        for module in modules {
            let module_path = module.id.to_lowercase();
            let has_matching_class = module
                .classes
                .iter()
                .any(|c| c.name.to_lowercase().contains(&lower_name));
            let has_matching_function = module
                .functions
                .iter()
                .any(|f| f.name.to_lowercase().contains(&lower_name));

            if module_path.contains(&lower_name) || has_matching_class || has_matching_function {
                related.push(module.id.clone());
            }
        }

        related.into_iter().take(10).collect()
    }

    /// 生成回退语义
    fn generate_fallback_semantic(&self, module: &ModuleNode) -> SemanticInfo {
        let path_parts: Vec<&str> = module.id.split('/').collect();
        let file_name = path_parts.last().unwrap_or(&"module");

        let (layer, description) =
            if module.id.contains("/ui/") || module.id.contains("/components/") {
                (
                    ArchitectureLayer::Presentation,
                    format!("UI 组件模块 {}", file_name),
                )
            } else if module.id.contains("/core/") || module.id.contains("/services/") {
                (
                    ArchitectureLayer::Business,
                    format!("业务逻辑模块 {}", file_name),
                )
            } else if module.id.contains("/api/") || module.id.contains("/data/") {
                (
                    ArchitectureLayer::Data,
                    format!("数据处理模块 {}", file_name),
                )
            } else {
                (
                    ArchitectureLayer::Infrastructure,
                    format!("{} 模块", file_name),
                )
            };

        let tags: Vec<String> = path_parts
            .iter()
            .filter(|p| **p != "src" && !p.contains('.'))
            .map(|s| s.to_string())
            .collect();

        SemanticInfo {
            description,
            responsibility: format!("{} 的功能实现", file_name),
            business_domain: None,
            architecture_layer: layer,
            tags,
            confidence: 0.4,
            generated_at: chrono::Utc::now().to_rfc3339(),
        }
    }

    /// 生成回退项目语义
    fn generate_fallback_project_semantic(&self, modules: &[ModuleNode]) -> ProjectSemantic {
        let paths: Vec<&str> = modules.iter().map(|m| m.id.as_str()).collect();
        let has_ui = paths
            .iter()
            .any(|p| p.contains("/ui/") || p.contains("/components/"));
        let has_tools = paths.iter().any(|p| p.contains("/tools/"));
        let has_core = paths.iter().any(|p| p.contains("/core/"));

        let mut domains = Vec::new();
        if has_ui {
            domains.push("用户界面".to_string());
        }
        if has_tools {
            domains.push("工具系统".to_string());
        }
        if has_core {
            domains.push("核心引擎".to_string());
        }

        if domains.is_empty() {
            domains.push("软件开发".to_string());
        }

        ProjectSemantic {
            description: "代码项目（语义描述待生成）".to_string(),
            purpose: "项目目的待分析".to_string(),
            domains,
            key_concepts: vec![],
        }
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/// 快速生成模块语义
pub fn generate_module_semantic(
    root_path: impl AsRef<Path>,
    module: &ModuleNode,
    options: Option<SemanticGeneratorOptions>,
) -> SemanticInfo {
    let generator = SemanticGenerator::new(root_path, options.unwrap_or_default());
    generator.generate_module_semantic(module)
}

/// 批量生成模块语义
pub fn batch_generate_semantics(
    root_path: impl AsRef<Path>,
    modules: &[ModuleNode],
    options: Option<SemanticGeneratorOptions>,
) -> HashMap<String, SemanticInfo> {
    let generator = SemanticGenerator::new(root_path, options.unwrap_or_default());
    generator.batch_generate_module_semantics(modules)
}

/// 生成项目语义
pub fn generate_project_semantic(
    root_path: impl AsRef<Path>,
    modules: &[ModuleNode],
    options: Option<SemanticGeneratorOptions>,
) -> ProjectSemantic {
    let generator = SemanticGenerator::new(root_path, options.unwrap_or_default());
    generator.generate_project_semantic(modules)
}
