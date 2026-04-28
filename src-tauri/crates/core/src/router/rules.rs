//! 路由器
//!
//! 简化的路由器，直接使用用户配置的默认 Provider

use crate::ProviderType;

/// 路由结果
#[derive(Debug, Clone)]
pub struct RouteResult {
    /// 目标 Provider（如果未设置默认 Provider 则为 None）
    pub provider: Option<ProviderType>,
    /// 是否使用默认 Provider
    pub is_default: bool,
}

/// 路由器 - 根据默认 Provider 路由请求
#[derive(Debug, Clone)]
pub struct Router {
    /// 默认 Provider（可选，未设置时为 None）
    default_provider: Option<ProviderType>,
}

impl Router {
    /// 创建新的路由器
    pub fn new(default_provider: ProviderType) -> Self {
        Self {
            default_provider: Some(default_provider),
        }
    }

    /// 创建没有默认 Provider 的路由器
    pub fn new_empty() -> Self {
        Self {
            default_provider: None,
        }
    }

    /// 设置默认 Provider
    pub fn set_default_provider(&mut self, provider: ProviderType) {
        self.default_provider = Some(provider);
    }

    /// 获取默认 Provider
    pub fn default_provider(&self) -> Option<ProviderType> {
        self.default_provider
    }

    /// 检查是否设置了默认 Provider
    pub fn has_default_provider(&self) -> bool {
        self.default_provider.is_some()
    }

    /// 路由请求到 Provider
    ///
    /// 返回默认 Provider，如果未设置则返回 None
    pub fn route(&self, _model: &str) -> RouteResult {
        RouteResult {
            provider: self.default_provider,
            is_default: true,
        }
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_router() {
        let router = Router::new(ProviderType::Kiro);
        assert_eq!(router.default_provider(), Some(ProviderType::Kiro));
    }

    #[test]
    fn test_new_empty_router() {
        let router = Router::new_empty();
        assert_eq!(router.default_provider(), None);
        assert!(!router.has_default_provider());
    }

    #[test]
    fn test_default_router_is_empty() {
        let router = Router::default();
        assert_eq!(router.default_provider(), None);
    }

    #[test]
    fn test_route_returns_default() {
        let router = Router::new(ProviderType::Gemini);
        let result = router.route("any-model");
        assert_eq!(result.provider, Some(ProviderType::Gemini));
        assert!(result.is_default);
    }

    #[test]
    fn test_route_returns_none_when_no_default() {
        let router = Router::new_empty();
        let result = router.route("any-model");
        assert_eq!(result.provider, None);
        assert!(result.is_default);
    }

    #[test]
    fn test_set_default_provider() {
        let mut router = Router::new_empty();
        assert!(!router.has_default_provider());
        router.set_default_provider(ProviderType::Gemini);
        assert_eq!(router.default_provider(), Some(ProviderType::Gemini));
        assert!(router.has_default_provider());
    }
}
