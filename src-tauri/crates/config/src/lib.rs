//! Lime 配置观察者模块
//!
//! 提供基于观察者模式的配置管理系统。
//! Tauri 相关的具体实现（TauriObserver、AppHandle 集成）
//! 保留在主 crate 中。

pub mod observer;

// 重新导出观察者模块的核心类型
pub use observer::emitter::ConfigEventEmit;
pub use observer::events::{
    AmpConfigChangeEvent, ConfigChangeEvent, ConfigChangeSource, EndpointProvidersChangeEvent,
    FullReloadEvent, InjectionChangeEvent, LoggingChangeEvent, NativeAgentChangeEvent,
    RetryChangeEvent, RoutingChangeEvent, ServerChangeEvent,
};
pub use observer::manager::GlobalConfigManager;
pub use observer::observers::{
    DefaultProviderRefObserver, EndpointObserver, InjectorObserver, LoggingObserver, RouterObserver,
};
pub use observer::subject::{ConfigSubject, CONFIG_CHANGED_EVENT, CONFIG_RELOAD_EVENT};
pub use observer::traits::{ConfigObserver, FnObserver, SyncConfigObserver, SyncObserverWrapper};

/// 全局配置管理器状态（用于 Tauri 状态管理）
pub struct GlobalConfigManagerState(pub std::sync::Arc<GlobalConfigManager>);

impl GlobalConfigManagerState {
    pub fn new(manager: GlobalConfigManager) -> Self {
        Self(std::sync::Arc::new(manager))
    }
}

impl std::ops::Deref for GlobalConfigManagerState {
    type Target = std::sync::Arc<GlobalConfigManager>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
