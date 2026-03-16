//! HTTP 请求处理器模块
//!
//! 将 server 中的各类处理器拆分到独立文件

pub mod api;
pub mod api_key_provider_utils;
pub mod chrome_bridge_ws;
pub mod credentials_api;
pub mod image_handler;
pub mod kiro_credential;
pub mod provider_calls;
pub mod websocket;

pub use api::*;
pub use chrome_bridge_ws::*;
pub use credentials_api::*;
pub use image_handler::*;
// 避免 SelectCredentialRequest 歧义 glob re-export（credentials_api 和 kiro_credential 都定义了同名类型）
pub use kiro_credential::{
    get_available_credentials, get_credential_status, refresh_credential, select_credential,
    AvailableCredential, AvailableCredentialsResponse, RefreshCredentialResponse,
    SelectCredentialResponse,
};
pub use provider_calls::*;
pub use websocket::*;
