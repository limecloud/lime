//! 边界检查器
//!
//!
//! 提供：
//! 1. 模块边界验证
//! 2. 受保护文件检测
//! 3. 技术栈扩展检查
//! 4. 跨模块修改检测

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

use super::types::*;

// ============================================================================
// 边界检查结果
// ============================================================================

/// 边界检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundaryCheckResult {
    /// 是否允许
    pub allowed: bool,
    /// 原因
    pub reason: Option<String>,
    /// 违规类型
    pub violation_type: Option<ViolationType>,
    /// 建议
    pub suggestion: Option<String>,
}

impl BoundaryCheckResult {
    /// 创建允许的结果
    pub fn allow() -> Self {
        Self {
            allowed: true,
            reason: None,
            violation_type: None,
            suggestion: None,
        }
    }

    /// 创建拒绝的结果
    pub fn deny(reason: String, violation_type: ViolationType) -> Self {
        Self {
            allowed: false,
            reason: Some(reason),
            violation_type: Some(violation_type),
            suggestion: None,
        }
    }

    /// 添加建议
    pub fn with_suggestion(mut self, suggestion: String) -> Self {
        self.suggestion = Some(suggestion);
        self
    }
}

/// 违规类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationType {
    /// 跨模块修改
    CrossModule,
    /// 修改受保护文件
    ProtectedFile,
    /// 技术栈不匹配
    TechStackMismatch,
    /// 修改配置文件
    ConfigFile,
    /// 超出根路径
    OutOfScope,
}

/// 受保护文件模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectedPattern {
    pub pattern: String,
    pub reason: String,
}

// ============================================================================
// 边界检查器配置
// ============================================================================

/// 边界检查器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoundaryCheckerConfig {
    /// 受保护的文件模式
    pub protected_patterns: Vec<ProtectedPattern>,
    /// 受保护的配置文件
    pub protected_configs: Vec<String>,
    /// 是否严格模式
    pub strict_mode: bool,
}

impl Default for BoundaryCheckerConfig {
    fn default() -> Self {
        Self {
            protected_patterns: vec![
                ProtectedPattern {
                    pattern: "package.json".to_string(),
                    reason: "包配置文件".to_string(),
                },
                ProtectedPattern {
                    pattern: "Cargo.toml".to_string(),
                    reason: "Rust 项目配置".to_string(),
                },
                ProtectedPattern {
                    pattern: "tsconfig.json".to_string(),
                    reason: "TypeScript 配置".to_string(),
                },
                ProtectedPattern {
                    pattern: ".env".to_string(),
                    reason: "环境变量文件".to_string(),
                },
                ProtectedPattern {
                    pattern: ".gitignore".to_string(),
                    reason: "Git 忽略配置".to_string(),
                },
            ],
            protected_configs: vec![
                "package.json".to_string(),
                "package-lock.json".to_string(),
                "Cargo.toml".to_string(),
                "Cargo.lock".to_string(),
                "tsconfig.json".to_string(),
                "vite.config.ts".to_string(),
                "webpack.config.js".to_string(),
            ],
            strict_mode: true,
        }
    }
}

// ============================================================================
// 边界检查器
// ============================================================================

/// 边界检查器
pub struct BoundaryChecker {
    config: BoundaryCheckerConfig,
    blueprint: Blueprint,
    /// 模块根路径映射
    module_paths: std::collections::HashMap<String, String>,
}

impl BoundaryChecker {
    /// 创建新的边界检查器
    pub fn new(blueprint: Blueprint, config: Option<BoundaryCheckerConfig>) -> Self {
        let config = config.unwrap_or_default();

        // 构建模块路径映射
        let mut module_paths = std::collections::HashMap::new();
        for module in &blueprint.modules {
            let root_path = module
                .root_path
                .clone()
                .unwrap_or_else(|| format!("src/{}", module.name.to_lowercase()));
            module_paths.insert(module.id.clone(), root_path);
        }

        Self {
            config,
            blueprint,
            module_paths,
        }
    }

    /// 检查任务边界
    pub fn check_task_boundary(
        &self,
        task_module_id: Option<&str>,
        file_path: &str,
    ) -> BoundaryCheckResult {
        // 1. 检查是否是受保护文件
        if let Some(result) = self.check_protected_file(file_path) {
            return result;
        }

        // 2. 检查是否是配置文件
        if let Some(result) = self.check_config_file(file_path) {
            return result;
        }

        // 3. 如果没有指定模块，允许
        let module_id = match task_module_id {
            Some(id) => id,
            None => return BoundaryCheckResult::allow(),
        };

        // 4. 检查是否在模块范围内
        self.check_module_scope(module_id, file_path)
    }

    /// 检查受保护文件
    fn check_protected_file(&self, file_path: &str) -> Option<BoundaryCheckResult> {
        let file_name = Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file_path);

        for pattern in &self.config.protected_patterns {
            if file_name == pattern.pattern || file_path.ends_with(&pattern.pattern) {
                return Some(
                    BoundaryCheckResult::deny(
                        format!("不能修改受保护文件: {} ({})", file_path, pattern.reason),
                        ViolationType::ProtectedFile,
                    )
                    .with_suggestion("请联系蜂王（主 Agent）处理此文件".to_string()),
                );
            }
        }

        None
    }

    /// 检查配置文件
    fn check_config_file(&self, file_path: &str) -> Option<BoundaryCheckResult> {
        let file_name = Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(file_path);

        if self
            .config
            .protected_configs
            .contains(&file_name.to_string())
        {
            return Some(
                BoundaryCheckResult::deny(
                    format!("不能修改配置文件: {}", file_path),
                    ViolationType::ConfigFile,
                )
                .with_suggestion("配置文件修改需要蜂王审批".to_string()),
            );
        }

        None
    }

    /// 检查模块范围
    fn check_module_scope(&self, module_id: &str, file_path: &str) -> BoundaryCheckResult {
        let module_root = match self.module_paths.get(module_id) {
            Some(root) => root,
            None => return BoundaryCheckResult::allow(),
        };

        // 规范化路径
        let normalized_path = file_path.replace('\\', "/");
        let normalized_root = module_root.replace('\\', "/");

        // 检查文件是否在模块根路径下
        if normalized_path.starts_with(&normalized_root) {
            return BoundaryCheckResult::allow();
        }

        // 检查是否在其他模块的范围内
        for (other_id, other_root) in &self.module_paths {
            if other_id != module_id {
                let other_normalized = other_root.replace('\\', "/");
                if normalized_path.starts_with(&other_normalized) {
                    return BoundaryCheckResult::deny(
                        format!(
                            "跨模块修改: 文件 {} 属于模块 {}，但当前任务属于模块 {}",
                            file_path, other_id, module_id
                        ),
                        ViolationType::CrossModule,
                    )
                    .with_suggestion(format!(
                        "请在模块 {} 的范围内工作，或请求蜂王重新分配任务",
                        module_id
                    ));
                }
            }
        }

        // 文件不在任何已知模块范围内
        if self.config.strict_mode {
            BoundaryCheckResult::deny(
                format!("文件 {} 不在模块 {} 的范围内", file_path, module_id),
                ViolationType::OutOfScope,
            )
            .with_suggestion(format!("请确保文件在 {} 目录下", module_root))
        } else {
            BoundaryCheckResult::allow()
        }
    }

    /// 检查技术栈匹配
    pub fn check_tech_stack(&self, module_id: &str, file_path: &str) -> BoundaryCheckResult {
        let module = match self.blueprint.modules.iter().find(|m| m.id == module_id) {
            Some(m) => m,
            None => return BoundaryCheckResult::allow(),
        };

        let tech_stack = match &module.tech_stack {
            Some(ts) => ts,
            None => return BoundaryCheckResult::allow(),
        };

        // 获取文件扩展名
        let extension = Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");

        // 检查扩展名是否与技术栈匹配
        let allowed_extensions = self.get_extensions_from_tech_stack(tech_stack);

        if allowed_extensions.is_empty() {
            return BoundaryCheckResult::allow();
        }

        if allowed_extensions.contains(&extension.to_string()) {
            BoundaryCheckResult::allow()
        } else {
            BoundaryCheckResult::deny(
                format!(
                    "文件扩展名 .{} 与模块 {} 的技术栈不匹配",
                    extension, module.name
                ),
                ViolationType::TechStackMismatch,
            )
            .with_suggestion(format!("允许的扩展名: {}", allowed_extensions.join(", ")))
        }
    }

    /// 根据技术栈获取允许的文件扩展名
    fn get_extensions_from_tech_stack(&self, tech_stack: &[String]) -> Vec<String> {
        let mut extensions = HashSet::new();

        for tech in tech_stack {
            let tech_lower = tech.to_lowercase();
            match tech_lower.as_str() {
                "typescript" => {
                    extensions.insert("ts".to_string());
                    extensions.insert("tsx".to_string());
                }
                "javascript" => {
                    extensions.insert("js".to_string());
                    extensions.insert("jsx".to_string());
                }
                "react" => {
                    extensions.insert("tsx".to_string());
                    extensions.insert("jsx".to_string());
                }
                "vue" => {
                    extensions.insert("vue".to_string());
                }
                "python" => {
                    extensions.insert("py".to_string());
                }
                "go" | "golang" => {
                    extensions.insert("go".to_string());
                }
                "rust" => {
                    extensions.insert("rs".to_string());
                }
                "java" => {
                    extensions.insert("java".to_string());
                }
                "kotlin" => {
                    extensions.insert("kt".to_string());
                }
                "swift" => {
                    extensions.insert("swift".to_string());
                }
                _ => {}
            }
        }

        extensions.into_iter().collect()
    }

    /// 获取模块信息
    pub fn get_module(&self, module_id: &str) -> Option<&SystemModule> {
        self.blueprint.modules.iter().find(|m| m.id == module_id)
    }

    /// 获取模块根路径
    pub fn get_module_root(&self, module_id: &str) -> Option<&String> {
        self.module_paths.get(module_id)
    }

    /// 获取所有模块 ID
    pub fn get_module_ids(&self) -> Vec<&String> {
        self.module_paths.keys().collect()
    }

    /// 批量检查文件
    pub fn check_files(
        &self,
        task_module_id: Option<&str>,
        file_paths: &[String],
    ) -> Vec<(String, BoundaryCheckResult)> {
        file_paths
            .iter()
            .map(|path| {
                let result = self.check_task_boundary(task_module_id, path);
                (path.clone(), result)
            })
            .collect()
    }

    /// 获取违规文件
    pub fn get_violations(
        &self,
        task_module_id: Option<&str>,
        file_paths: &[String],
    ) -> Vec<(String, BoundaryCheckResult)> {
        self.check_files(task_module_id, file_paths)
            .into_iter()
            .filter(|(_, result)| !result.allowed)
            .collect()
    }
}

/// 创建边界检查器
pub fn create_boundary_checker(
    blueprint: Blueprint,
    config: Option<BoundaryCheckerConfig>,
) -> BoundaryChecker {
    BoundaryChecker::new(blueprint, config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_blueprint() -> Blueprint {
        let mut blueprint = Blueprint::new("测试项目".to_string(), "测试描述".to_string());

        blueprint.modules.push(SystemModule {
            id: "frontend".to_string(),
            name: "前端模块".to_string(),
            description: "前端 UI".to_string(),
            module_type: ModuleType::Frontend,
            responsibilities: vec!["用户界面".to_string()],
            dependencies: vec![],
            interfaces: vec![],
            tech_stack: Some(vec!["TypeScript".to_string(), "React".to_string()]),
            root_path: Some("src/frontend".to_string()),
        });

        blueprint.modules.push(SystemModule {
            id: "backend".to_string(),
            name: "后端模块".to_string(),
            description: "后端服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["API 服务".to_string()],
            dependencies: vec![],
            interfaces: vec![],
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/backend".to_string()),
        });

        blueprint
    }

    #[test]
    fn test_boundary_checker_creation() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        assert_eq!(checker.get_module_ids().len(), 2);
    }

    #[test]
    fn test_protected_file_check() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_task_boundary(Some("frontend"), "package.json");
        assert!(!result.allowed);
        assert_eq!(result.violation_type, Some(ViolationType::ProtectedFile));
    }

    #[test]
    fn test_module_scope_check() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        // 在模块范围内
        let result =
            checker.check_task_boundary(Some("frontend"), "src/frontend/components/Button.tsx");
        assert!(result.allowed);

        // 跨模块
        let result = checker.check_task_boundary(Some("frontend"), "src/backend/api/handler.rs");
        assert!(!result.allowed);
        assert_eq!(result.violation_type, Some(ViolationType::CrossModule));
    }

    #[test]
    fn test_tech_stack_check() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        // 匹配的技术栈
        let result = checker.check_tech_stack("frontend", "src/frontend/App.tsx");
        assert!(result.allowed);

        // 不匹配的技术栈
        let result = checker.check_tech_stack("frontend", "src/frontend/main.rs");
        assert!(!result.allowed);
        assert_eq!(
            result.violation_type,
            Some(ViolationType::TechStackMismatch)
        );
    }
}
