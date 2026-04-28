//! 核心类型定义
//!
//! 包含应用状态类型和相关实现。

use std::sync::Arc;
use tauri::{Emitter, Runtime};
use tokio::sync::RwLock;

use crate::logger;
use crate::tray::TrayManager;
use lime_server as server;

use lime_core::event_emit::EventEmit;

// 重新导出 core crate 的 ProviderType
pub use lime_core::ProviderType;

/// 应用状态类型别名
pub type AppState = Arc<RwLock<server::ServerState>>;

/// 日志状态类型别名
pub type LogState = Arc<RwLock<logger::LogStore>>;

/// TrayManager 状态封装
pub struct TrayManagerState<R: Runtime>(pub Arc<tokio::sync::RwLock<Option<TrayManager<R>>>>);

/// 通用 Tauri 事件发射器
///
/// 实现 `lime_core::EventEmit` trait，
/// 供所有独立 crate（MCP、Agent 等）通过 DynEmitter 使用。
#[derive(Clone)]
pub struct TauriEventEmitter(pub tauri::AppHandle);

impl EventEmit for TauriEventEmitter {
    fn emit_event(&self, event: &str, payload: &serde_json::Value) -> Result<(), String> {
        self.0
            .emit(event, payload.clone())
            .map_err(|e| format!("Tauri emit 失败: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_type_from_str() {
        assert_eq!("kiro".parse::<ProviderType>().unwrap(), ProviderType::Kiro);
        assert_eq!(
            "gemini".parse::<ProviderType>().unwrap(),
            ProviderType::Gemini
        );
        assert_eq!(
            "openai".parse::<ProviderType>().unwrap(),
            ProviderType::OpenAI
        );
        assert_eq!(
            "claude".parse::<ProviderType>().unwrap(),
            ProviderType::Claude
        );
        assert_eq!(
            "vertex".parse::<ProviderType>().unwrap(),
            ProviderType::Vertex
        );
        assert_eq!(
            "gemini_api_key".parse::<ProviderType>().unwrap(),
            ProviderType::GeminiApiKey
        );
        assert_eq!("KIRO".parse::<ProviderType>().unwrap(), ProviderType::Kiro);
        assert_eq!(
            "Gemini".parse::<ProviderType>().unwrap(),
            ProviderType::Gemini
        );
        assert_eq!(
            "VERTEX".parse::<ProviderType>().unwrap(),
            ProviderType::Vertex
        );
        assert!("invalid".parse::<ProviderType>().is_err());
    }

    #[test]
    fn test_provider_type_display() {
        assert_eq!(ProviderType::Kiro.to_string(), "kiro");
        assert_eq!(ProviderType::Gemini.to_string(), "gemini");
        assert_eq!(ProviderType::OpenAI.to_string(), "openai");
        assert_eq!(ProviderType::Claude.to_string(), "claude");
        assert_eq!(ProviderType::Vertex.to_string(), "vertex");
        assert_eq!(ProviderType::GeminiApiKey.to_string(), "gemini_api_key");
    }

    #[test]
    fn test_provider_type_serde() {
        assert_eq!(
            serde_json::to_string(&ProviderType::Kiro).unwrap(),
            "\"kiro\""
        );
        assert_eq!(
            serde_json::to_string(&ProviderType::OpenAI).unwrap(),
            "\"openai\""
        );
        assert_eq!(
            serde_json::from_str::<ProviderType>("\"kiro\"").unwrap(),
            ProviderType::Kiro
        );
        assert_eq!(
            serde_json::from_str::<ProviderType>("\"openai\"").unwrap(),
            ProviderType::OpenAI
        );
    }
}
