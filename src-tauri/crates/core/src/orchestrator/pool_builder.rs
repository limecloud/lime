//! 模型编排器 - 动态模型池构建
//!
//! 根据用户凭证动态构建各等级的模型池。

use super::tier::{AvailableModel, ServiceTier, TierPool};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Provider 类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    Anthropic,
    OpenAI,
    Google,
    Kiro,
    Azure,
    Bedrock,
    Custom,
}

impl ProviderType {
    /// 从字符串解析
    pub fn parse_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "anthropic" => Some(ProviderType::Anthropic),
            "openai" => Some(ProviderType::OpenAI),
            "google" | "gemini" => Some(ProviderType::Google),
            "kiro" | "codewhisperer" => Some(ProviderType::Kiro),
            "azure" => Some(ProviderType::Azure),
            "bedrock" => Some(ProviderType::Bedrock),
            _ => Some(ProviderType::Custom),
        }
    }

    /// 获取显示名称
    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderType::Anthropic => "Anthropic",
            ProviderType::OpenAI => "OpenAI",
            ProviderType::Google => "Google",
            ProviderType::Kiro => "Kiro",
            ProviderType::Azure => "Azure",
            ProviderType::Bedrock => "Bedrock",
            ProviderType::Custom => "Custom",
        }
    }
}

/// 模型家族定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamily {
    /// 家族名称
    pub name: String,
    /// 匹配模式（glob 风格）
    pub pattern: String,
    /// 对应的服务等级 (1=Mini, 2=Pro, 3=Max)
    pub tier: u8,
    /// 描述
    pub description: Option<String>,
}

/// Provider 定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderDefinition {
    /// Provider 类型
    pub provider_type: ProviderType,
    /// 显示名称
    pub display_name: String,
    /// 模型家族列表（按优先级排序）
    pub families: Vec<ModelFamily>,
    /// 默认 base URL
    pub default_base_url: Option<String>,
}

impl ProviderDefinition {
    /// 获取模型的家族
    pub fn get_family(&self, model_id: &str) -> Option<&ModelFamily> {
        let model_lower = model_id.to_lowercase();
        self.families.iter().find(|f| {
            let pattern_lower = f.pattern.to_lowercase();
            if pattern_lower.contains('*') {
                // 简单的 glob 匹配
                let parts: Vec<&str> = pattern_lower.split('*').collect();
                if parts.len() == 2 {
                    // 模式如 "claude-*" 或 "*sonnet"
                    let prefix = parts[0];
                    let suffix = parts[1];
                    if prefix.is_empty() {
                        model_lower.ends_with(suffix)
                    } else if suffix.is_empty() {
                        model_lower.starts_with(prefix)
                    } else {
                        model_lower.starts_with(prefix) && model_lower.ends_with(suffix)
                    }
                } else if parts.len() == 3 {
                    // 模式如 "claude-*opus*" (prefix*middle*suffix)
                    let prefix = parts[0];
                    let middle = parts[1];
                    let suffix = parts[2];
                    let starts_ok = prefix.is_empty() || model_lower.starts_with(prefix);
                    let ends_ok = suffix.is_empty() || model_lower.ends_with(suffix);
                    let contains_middle = middle.is_empty() || model_lower.contains(middle);
                    starts_ok && ends_ok && contains_middle
                } else if parts.len() == 1 {
                    model_lower.starts_with(parts[0])
                } else {
                    // 复杂模式，回退到简单包含检查
                    parts
                        .iter()
                        .all(|p| p.is_empty() || model_lower.contains(p))
                }
            } else {
                model_lower.contains(&pattern_lower)
            }
        })
    }

    /// 获取模型对应的服务等级
    pub fn get_tier(&self, model_id: &str) -> Option<ServiceTier> {
        self.get_family(model_id).map(|f| match f.tier {
            1 => ServiceTier::Mini,
            2 => ServiceTier::Pro,
            3 => ServiceTier::Max,
            _ => ServiceTier::Pro,
        })
    }
}

/// 内置 Provider 定义
pub fn builtin_provider_definitions() -> Vec<ProviderDefinition> {
    vec![
        // Anthropic
        ProviderDefinition {
            provider_type: ProviderType::Anthropic,
            display_name: "Anthropic".to_string(),
            families: vec![
                ModelFamily {
                    name: "opus".to_string(),
                    pattern: "claude-*opus*".to_string(),
                    tier: 3,
                    description: Some("Claude Opus - 最强能力".to_string()),
                },
                ModelFamily {
                    name: "sonnet".to_string(),
                    pattern: "claude-*sonnet*".to_string(),
                    tier: 2,
                    description: Some("Claude Sonnet - 均衡选择".to_string()),
                },
                ModelFamily {
                    name: "haiku".to_string(),
                    pattern: "claude-*haiku*".to_string(),
                    tier: 1,
                    description: Some("Claude Haiku - 快速响应".to_string()),
                },
            ],
            default_base_url: Some("https://api.anthropic.com".to_string()),
        },
        // OpenAI
        ProviderDefinition {
            provider_type: ProviderType::OpenAI,
            display_name: "OpenAI".to_string(),
            families: vec![
                ModelFamily {
                    name: "o1".to_string(),
                    pattern: "o1*".to_string(),
                    tier: 3,
                    description: Some("O1 - 推理能力最强".to_string()),
                },
                ModelFamily {
                    name: "gpt-4o".to_string(),
                    pattern: "gpt-4o*".to_string(),
                    tier: 2,
                    description: Some("GPT-4o - 多模态均衡".to_string()),
                },
                ModelFamily {
                    name: "gpt-4".to_string(),
                    pattern: "gpt-4*".to_string(),
                    tier: 2,
                    description: Some("GPT-4 - 强大能力".to_string()),
                },
                ModelFamily {
                    name: "gpt-3.5".to_string(),
                    pattern: "gpt-3.5*".to_string(),
                    tier: 1,
                    description: Some("GPT-3.5 - 快速响应".to_string()),
                },
            ],
            default_base_url: Some("https://api.openai.com".to_string()),
        },
        // Google
        ProviderDefinition {
            provider_type: ProviderType::Google,
            display_name: "Google".to_string(),
            families: vec![
                ModelFamily {
                    name: "ultra".to_string(),
                    pattern: "gemini-*ultra*".to_string(),
                    tier: 3,
                    description: Some("Gemini Ultra - 最强能力".to_string()),
                },
                ModelFamily {
                    name: "pro".to_string(),
                    pattern: "gemini-*pro*".to_string(),
                    tier: 2,
                    description: Some("Gemini Pro - 均衡选择".to_string()),
                },
                ModelFamily {
                    name: "flash".to_string(),
                    pattern: "gemini-*flash*".to_string(),
                    tier: 1,
                    description: Some("Gemini Flash - 快速响应".to_string()),
                },
            ],
            default_base_url: Some("https://generativelanguage.googleapis.com".to_string()),
        },
        // Kiro (CodeWhisperer)
        ProviderDefinition {
            provider_type: ProviderType::Kiro,
            display_name: "Kiro".to_string(),
            families: vec![
                ModelFamily {
                    name: "opus".to_string(),
                    pattern: "claude-*opus*".to_string(),
                    tier: 3,
                    description: Some("Claude Opus via Kiro".to_string()),
                },
                ModelFamily {
                    name: "sonnet".to_string(),
                    pattern: "claude-*sonnet*".to_string(),
                    tier: 2,
                    description: Some("Claude Sonnet via Kiro".to_string()),
                },
                ModelFamily {
                    name: "haiku".to_string(),
                    pattern: "claude-*haiku*".to_string(),
                    tier: 1,
                    description: Some("Claude Haiku via Kiro".to_string()),
                },
            ],
            default_base_url: None,
        },
    ]
}

/// 模型元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMetadata {
    /// 模型 ID
    pub id: String,
    /// 显示名称
    pub display_name: String,
    /// Provider 类型
    pub provider_type: ProviderType,
    /// 模型家族
    pub family: Option<String>,
    /// 上下文长度
    pub context_length: Option<u32>,
    /// 是否支持视觉
    pub supports_vision: bool,
    /// 是否支持工具调用
    pub supports_tools: bool,
    /// 输入价格（每 1M tokens）
    pub input_cost_per_million: Option<f64>,
    /// 输出价格（每 1M tokens）
    pub output_cost_per_million: Option<f64>,
    /// 发布日期
    pub release_date: Option<String>,
    /// 是否是最新版本
    pub is_latest: bool,
}

/// 内置模型元数据
pub fn builtin_model_metadata() -> Vec<ModelMetadata> {
    vec![
        // Anthropic Models
        ModelMetadata {
            id: "claude-opus-4-5-20251101".to_string(),
            display_name: "Claude Opus 4.5".to_string(),
            provider_type: ProviderType::Anthropic,
            family: Some("opus".to_string()),
            context_length: Some(200000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(15.0),
            output_cost_per_million: Some(75.0),
            release_date: Some("2025-11-01".to_string()),
            is_latest: true,
        },
        ModelMetadata {
            id: "claude-sonnet-4-5-20250514".to_string(),
            display_name: "Claude Sonnet 4.5".to_string(),
            provider_type: ProviderType::Anthropic,
            family: Some("sonnet".to_string()),
            context_length: Some(200000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(3.0),
            output_cost_per_million: Some(15.0),
            release_date: Some("2025-05-14".to_string()),
            is_latest: true,
        },
        ModelMetadata {
            id: "claude-3-5-sonnet-20241022".to_string(),
            display_name: "Claude 3.5 Sonnet".to_string(),
            provider_type: ProviderType::Anthropic,
            family: Some("sonnet".to_string()),
            context_length: Some(200000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(3.0),
            output_cost_per_million: Some(15.0),
            release_date: Some("2024-10-22".to_string()),
            is_latest: false,
        },
        ModelMetadata {
            id: "claude-3-5-haiku-20241022".to_string(),
            display_name: "Claude 3.5 Haiku".to_string(),
            provider_type: ProviderType::Anthropic,
            family: Some("haiku".to_string()),
            context_length: Some(200000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(0.25),
            output_cost_per_million: Some(1.25),
            release_date: Some("2024-10-22".to_string()),
            is_latest: true,
        },
        // OpenAI Models
        ModelMetadata {
            id: "o1".to_string(),
            display_name: "O1".to_string(),
            provider_type: ProviderType::OpenAI,
            family: Some("o1".to_string()),
            context_length: Some(200000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(15.0),
            output_cost_per_million: Some(60.0),
            release_date: Some("2024-12-01".to_string()),
            is_latest: true,
        },
        ModelMetadata {
            id: "gpt-4o".to_string(),
            display_name: "GPT-4o".to_string(),
            provider_type: ProviderType::OpenAI,
            family: Some("gpt-4o".to_string()),
            context_length: Some(128000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(2.5),
            output_cost_per_million: Some(10.0),
            release_date: Some("2024-05-13".to_string()),
            is_latest: true,
        },
        ModelMetadata {
            id: "gpt-4-turbo".to_string(),
            display_name: "GPT-4 Turbo".to_string(),
            provider_type: ProviderType::OpenAI,
            family: Some("gpt-4".to_string()),
            context_length: Some(128000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(10.0),
            output_cost_per_million: Some(30.0),
            release_date: Some("2024-04-09".to_string()),
            is_latest: false,
        },
        ModelMetadata {
            id: "gpt-3.5-turbo".to_string(),
            display_name: "GPT-3.5 Turbo".to_string(),
            provider_type: ProviderType::OpenAI,
            family: Some("gpt-3.5".to_string()),
            context_length: Some(16385),
            supports_vision: false,
            supports_tools: true,
            input_cost_per_million: Some(0.5),
            output_cost_per_million: Some(1.5),
            release_date: Some("2023-11-06".to_string()),
            is_latest: true,
        },
        // Google Models
        ModelMetadata {
            id: "gemini-2.0-flash".to_string(),
            display_name: "Gemini 2.0 Flash".to_string(),
            provider_type: ProviderType::Google,
            family: Some("flash".to_string()),
            context_length: Some(1000000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(0.075),
            output_cost_per_million: Some(0.3),
            release_date: Some("2024-12-11".to_string()),
            is_latest: true,
        },
        ModelMetadata {
            id: "gemini-1.5-pro".to_string(),
            display_name: "Gemini 1.5 Pro".to_string(),
            provider_type: ProviderType::Google,
            family: Some("pro".to_string()),
            context_length: Some(2000000),
            supports_vision: true,
            supports_tools: true,
            input_cost_per_million: Some(1.25),
            output_cost_per_million: Some(5.0),
            release_date: Some("2024-05-14".to_string()),
            is_latest: true,
        },
    ]
}

/// 凭证信息（用于构建模型池）
#[derive(Debug, Clone)]
pub struct CredentialInfo {
    /// 凭证 ID
    pub id: String,
    /// Provider 类型（用于模型分类）
    pub provider_type: ProviderType,
    /// 原始 Provider 类型字符串（用于前端识别，如 "kiro" 等）
    pub original_provider_type: Option<String>,
    /// 支持的模型列表
    pub supported_models: Vec<String>,
    /// 是否健康
    pub is_healthy: bool,
    /// 当前负载
    pub current_load: Option<u8>,
}

/// 动态模型池构建器
pub struct DynamicPoolBuilder {
    /// Provider 定义
    provider_definitions: Vec<ProviderDefinition>,
    /// 模型元数据
    model_metadata: HashMap<String, ModelMetadata>,
}

impl DynamicPoolBuilder {
    /// 创建新的构建器
    pub fn new() -> Self {
        let definitions = builtin_provider_definitions();
        let metadata: HashMap<_, _> = builtin_model_metadata()
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect();

        Self {
            provider_definitions: definitions,
            model_metadata: metadata,
        }
    }

    /// 添加自定义 Provider 定义
    pub fn add_provider_definition(&mut self, definition: ProviderDefinition) {
        self.provider_definitions.push(definition);
    }

    /// 添加模型元数据
    pub fn add_model_metadata(&mut self, metadata: ModelMetadata) {
        self.model_metadata.insert(metadata.id.clone(), metadata);
    }

    /// 获取 Provider 定义
    pub fn get_provider_definition(
        &self,
        provider_type: ProviderType,
    ) -> Option<&ProviderDefinition> {
        self.provider_definitions
            .iter()
            .find(|d| d.provider_type == provider_type)
    }

    /// 根据凭证构建模型池
    pub fn build_pool(&self, credentials: &[CredentialInfo]) -> TierPool {
        let mut pool = TierPool::new();

        for credential in credentials {
            if !credential.is_healthy {
                continue;
            }

            let provider_def = match self.get_provider_definition(credential.provider_type) {
                Some(def) => def,
                None => continue,
            };

            for model_id in &credential.supported_models {
                // 获取模型元数据
                let metadata = self.model_metadata.get(model_id);

                // 确定服务等级
                let tier = provider_def.get_tier(model_id).unwrap_or(ServiceTier::Pro);

                // 获取家族名称
                let family = provider_def
                    .get_family(model_id)
                    .map(|f| f.name.clone())
                    .or_else(|| metadata.as_ref().and_then(|m| m.family.clone()));

                // 构建 AvailableModel
                // 优先使用原始 provider 类型，否则使用枚举名称
                let provider_type_str = credential
                    .original_provider_type
                    .clone()
                    .unwrap_or_else(|| format!("{:?}", credential.provider_type).to_lowercase());

                let available_model = AvailableModel {
                    id: model_id.clone(),
                    display_name: metadata
                        .as_ref()
                        .map(|m| m.display_name.clone())
                        .unwrap_or_else(|| model_id.clone()),
                    provider_type: provider_type_str,
                    family,
                    credential_id: credential.id.clone(),
                    context_length: metadata.as_ref().and_then(|m| m.context_length),
                    supports_vision: metadata
                        .as_ref()
                        .map(|m| m.supports_vision)
                        .unwrap_or(false),
                    supports_tools: metadata.as_ref().map(|m| m.supports_tools).unwrap_or(false),
                    input_cost_per_million: metadata
                        .as_ref()
                        .and_then(|m| m.input_cost_per_million),
                    output_cost_per_million: metadata
                        .as_ref()
                        .and_then(|m| m.output_cost_per_million),
                    is_healthy: credential.is_healthy,
                    current_load: credential.current_load,
                };

                pool.add(tier, available_model);
            }
        }

        // 按评分排序
        pool.sort_by_score();

        pool
    }

    /// 为每个等级选择最佳模型（每个 Provider 一个）
    pub fn build_best_pool(&self, credentials: &[CredentialInfo]) -> TierPool {
        let full_pool = self.build_pool(credentials);
        let mut best_pool = TierPool::new();

        for tier in ServiceTier::all() {
            let models = full_pool.get(*tier);
            let mut seen_providers: HashMap<String, bool> = HashMap::new();

            for model in models {
                // 每个 Provider 只选择一个最佳模型
                if !seen_providers.contains_key(&model.provider_type) {
                    seen_providers.insert(model.provider_type.clone(), true);
                    best_pool.add(*tier, model.clone());
                }
            }
        }

        best_pool
    }
}

impl Default for DynamicPoolBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_definition_get_family() {
        let definitions = builtin_provider_definitions();
        let anthropic = definitions
            .iter()
            .find(|d| d.provider_type == ProviderType::Anthropic)
            .unwrap();

        let family = anthropic.get_family("claude-3-5-sonnet-20241022");
        assert!(family.is_some());
        assert_eq!(family.unwrap().name, "sonnet");

        let family = anthropic.get_family("claude-opus-4-5-20251101");
        assert!(family.is_some());
        assert_eq!(family.unwrap().name, "opus");
    }

    #[test]
    fn test_provider_definition_get_tier() {
        let definitions = builtin_provider_definitions();
        let anthropic = definitions
            .iter()
            .find(|d| d.provider_type == ProviderType::Anthropic)
            .unwrap();

        assert_eq!(
            anthropic.get_tier("claude-3-5-haiku-20241022"),
            Some(ServiceTier::Mini)
        );
        assert_eq!(
            anthropic.get_tier("claude-3-5-sonnet-20241022"),
            Some(ServiceTier::Pro)
        );
        assert_eq!(
            anthropic.get_tier("claude-opus-4-5-20251101"),
            Some(ServiceTier::Max)
        );
    }

    #[test]
    fn test_dynamic_pool_builder() {
        let builder = DynamicPoolBuilder::new();

        let credentials = vec![
            CredentialInfo {
                id: "cred-1".to_string(),
                provider_type: ProviderType::Anthropic,
                original_provider_type: None,
                supported_models: vec![
                    "claude-opus-4-5-20251101".to_string(),
                    "claude-sonnet-4-5-20250514".to_string(),
                    "claude-3-5-haiku-20241022".to_string(),
                ],
                is_healthy: true,
                current_load: Some(30),
            },
            CredentialInfo {
                id: "cred-2".to_string(),
                provider_type: ProviderType::OpenAI,
                original_provider_type: None,
                supported_models: vec!["gpt-4o".to_string(), "gpt-3.5-turbo".to_string()],
                is_healthy: true,
                current_load: Some(20),
            },
        ];

        let pool = builder.build_pool(&credentials);

        assert!(!pool.is_empty());
        assert!(!pool.get(ServiceTier::Mini).is_empty());
        assert!(!pool.get(ServiceTier::Pro).is_empty());
        assert!(!pool.get(ServiceTier::Max).is_empty());
    }

    #[test]
    fn test_build_best_pool() {
        let builder = DynamicPoolBuilder::new();

        let credentials = vec![CredentialInfo {
            id: "cred-1".to_string(),
            provider_type: ProviderType::Anthropic,
            original_provider_type: None,
            supported_models: vec![
                "claude-sonnet-4-5-20250514".to_string(),
                "claude-3-5-sonnet-20241022".to_string(),
            ],
            is_healthy: true,
            current_load: Some(30),
        }];

        let pool = builder.build_best_pool(&credentials);

        // Pro 等级应该只有一个 Anthropic 模型
        let pro_models = pool.get(ServiceTier::Pro);
        let anthropic_count = pro_models
            .iter()
            .filter(|m| m.provider_type == "anthropic")
            .count();
        assert_eq!(anthropic_count, 1);
    }
}
