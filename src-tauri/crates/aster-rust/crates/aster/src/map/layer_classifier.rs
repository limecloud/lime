//! 架构层分类器
//!
//! 根据文件路径和内容自动分类模块所属的架构层

use super::types::ModuleNode;
use super::types_enhanced::ArchitectureLayer;

/// 分类规则
struct ClassificationRule {
    patterns: Vec<&'static str>,
    layer: ArchitectureLayer,
    sub_layer: Option<&'static str>,
    priority: u8,
}

/// 分类规则配置
fn get_classification_rules() -> Vec<ClassificationRule> {
    vec![
        // 表现层 - UI 组件
        ClassificationRule {
            patterns: vec![
                "/ui/",
                "/components/",
                "/pages/",
                "/views/",
                "/screens/",
                ".tsx",
            ],
            layer: ArchitectureLayer::Presentation,
            sub_layer: Some("components"),
            priority: 10,
        },
        // 表现层 - 样式
        ClassificationRule {
            patterns: vec!["/styles/", "/css/", "/themes/", ".css", ".scss"],
            layer: ArchitectureLayer::Presentation,
            sub_layer: Some("styles"),
            priority: 10,
        },
        // 业务层 - 核心逻辑
        ClassificationRule {
            patterns: vec![
                "/core/",
                "/domain/",
                "/business/",
                "/services/",
                "/usecases/",
            ],
            layer: ArchitectureLayer::Business,
            sub_layer: Some("core"),
            priority: 20,
        },
        // 业务层 - 工具系统
        ClassificationRule {
            patterns: vec!["/tools/"],
            layer: ArchitectureLayer::Business,
            sub_layer: Some("tools"),
            priority: 15,
        },
        // 数据层 - API
        ClassificationRule {
            patterns: vec!["/api/", "/client/", "/http/", "/fetch/"],
            layer: ArchitectureLayer::Data,
            sub_layer: Some("api"),
            priority: 20,
        },
        // 数据层 - 存储
        ClassificationRule {
            patterns: vec![
                "/db/",
                "/database/",
                "/repositories/",
                "/storage/",
                "/cache/",
            ],
            layer: ArchitectureLayer::Data,
            sub_layer: Some("storage"),
            priority: 20,
        },
        // 基础设施 - 配置
        ClassificationRule {
            patterns: vec!["/config/", "/settings/", "/env/"],
            layer: ArchitectureLayer::Infrastructure,
            sub_layer: Some("config"),
            priority: 5,
        },
        // 基础设施 - 工具函数
        ClassificationRule {
            patterns: vec!["/utils/", "/helpers/", "/lib/", "/common/", "/shared/"],
            layer: ArchitectureLayer::Infrastructure,
            sub_layer: Some("utils"),
            priority: 5,
        },
        // 基础设施 - 类型定义
        ClassificationRule {
            patterns: vec!["/types/", "/interfaces/", "/models/", ".d.ts"],
            layer: ArchitectureLayer::Infrastructure,
            sub_layer: Some("types"),
            priority: 5,
        },
        // 横切关注点 - 钩子
        ClassificationRule {
            patterns: vec!["/hooks/"],
            layer: ArchitectureLayer::CrossCutting,
            sub_layer: Some("hooks"),
            priority: 15,
        },
        // 横切关注点 - 中间件
        ClassificationRule {
            patterns: vec!["/middleware/", "/interceptors/"],
            layer: ArchitectureLayer::CrossCutting,
            sub_layer: Some("middleware"),
            priority: 15,
        },
        // 横切关注点 - 日志
        ClassificationRule {
            patterns: vec!["/log/", "/logging/", "/monitor/", "/telemetry/"],
            layer: ArchitectureLayer::CrossCutting,
            sub_layer: Some("logging"),
            priority: 15,
        },
        // 横切关注点 - 认证
        ClassificationRule {
            patterns: vec!["/auth/", "/permission/", "/security/", "/oauth/"],
            layer: ArchitectureLayer::CrossCutting,
            sub_layer: Some("auth"),
            priority: 15,
        },
    ]
}

/// 分类结果
#[derive(Debug, Clone)]
pub struct ClassificationResult {
    pub layer: ArchitectureLayer,
    pub sub_layer: Option<String>,
    pub confidence: f64,
    pub matched_rules: Vec<String>,
}

/// 架构层分类器
pub struct LayerClassifier {
    rules: Vec<ClassificationRule>,
}

impl LayerClassifier {
    pub fn new() -> Self {
        Self {
            rules: get_classification_rules(),
        }
    }

    /// 对单个模块进行架构层分类
    pub fn classify(&self, module: &ModuleNode) -> ClassificationResult {
        let path = &module.id;
        let path_lower = path.to_lowercase();
        let mut matched: Vec<(&ClassificationRule, Vec<&str>)> = Vec::new();

        for rule in &self.rules {
            let matches: Vec<&str> = rule
                .patterns
                .iter()
                .filter(|p| path_lower.contains(&p.to_lowercase()))
                .copied()
                .collect();
            if !matches.is_empty() {
                matched.push((rule, matches));
            }
        }

        if !matched.is_empty() {
            matched.sort_by(|a, b| {
                b.0.priority
                    .cmp(&a.0.priority)
                    .then_with(|| b.1.len().cmp(&a.1.len()))
            });

            let best = &matched[0];
            return ClassificationResult {
                layer: best.0.layer,
                sub_layer: best.0.sub_layer.map(String::from),
                confidence: (0.5 + best.1.len() as f64 * 0.1).min(0.9),
                matched_rules: best.1.iter().map(|s| s.to_string()).collect(),
            };
        }

        // 基于内容特征分析
        if let Some(result) = self.classify_by_content(module) {
            return result;
        }

        // 默认分类
        ClassificationResult {
            layer: ArchitectureLayer::Infrastructure,
            sub_layer: None,
            confidence: 0.3,
            matched_rules: vec!["default".to_string()],
        }
    }

    fn classify_by_content(&self, module: &ModuleNode) -> Option<ClassificationResult> {
        let mut has_react = false;
        let mut has_db = false;
        let mut has_api = false;

        for imp in &module.imports {
            let src = imp.source.to_lowercase();
            if src.contains("react") || src.contains("ink") {
                has_react = true;
            }
            if src.contains("mongo") || src.contains("mysql") || src.contains("postgres") {
                has_db = true;
            }
            if src.contains("axios") || src.contains("fetch") || src.contains("http") {
                has_api = true;
            }
        }

        if has_react {
            return Some(ClassificationResult {
                layer: ArchitectureLayer::Presentation,
                sub_layer: None,
                confidence: 0.7,
                matched_rules: vec!["content:react".to_string()],
            });
        }

        if has_db {
            return Some(ClassificationResult {
                layer: ArchitectureLayer::Data,
                sub_layer: Some("storage".to_string()),
                confidence: 0.7,
                matched_rules: vec!["content:database".to_string()],
            });
        }

        if has_api {
            return Some(ClassificationResult {
                layer: ArchitectureLayer::Data,
                sub_layer: Some("api".to_string()),
                confidence: 0.6,
                matched_rules: vec!["content:api".to_string()],
            });
        }

        None
    }

    /// 批量分类
    pub fn classify_all(
        &self,
        modules: &[ModuleNode],
    ) -> std::collections::HashMap<String, ClassificationResult> {
        modules
            .iter()
            .map(|m| (m.id.clone(), self.classify(m)))
            .collect()
    }

    /// 获取层描述
    pub fn get_layer_description(layer: ArchitectureLayer) -> &'static str {
        match layer {
            ArchitectureLayer::Presentation => "表现层：用户界面、组件、页面、视图渲染",
            ArchitectureLayer::Business => "业务层：核心业务逻辑、领域模型、服务实现",
            ArchitectureLayer::Data => "数据层：API 调用、数据库访问、存储管理",
            ArchitectureLayer::Infrastructure => "基础设施层：工具函数、配置管理、类型定义",
            ArchitectureLayer::CrossCutting => "横切关注点：认证、日志、中间件、插件系统",
        }
    }
}

impl Default for LayerClassifier {
    fn default() -> Self {
        Self::new()
    }
}

/// 快速分类单个模块
pub fn classify_module(module: &ModuleNode) -> ClassificationResult {
    LayerClassifier::new().classify(module)
}

/// 批量分类模块
pub fn classify_modules(
    modules: &[ModuleNode],
) -> std::collections::HashMap<String, ClassificationResult> {
    LayerClassifier::new().classify_all(modules)
}
