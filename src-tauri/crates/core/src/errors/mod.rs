//! 错误类型模块
//!
//! 定义 Lime 应用中的各种错误类型。
//!
//! ## 模块结构
//! - `project_error`: 项目相关错误（ProjectError, PersonaError, MaterialError, MigrationError）

pub mod gateway_error;
pub mod project_error;

// 重新导出常用错误类型
pub use gateway_error::{
    GatewayError, GatewayErrorCode, GatewayErrorResponse, GatewayErrorUpstream,
};
#[allow(unused_imports)]
pub use project_error::{MaterialError, MigrationError, PersonaError, ProjectError};
