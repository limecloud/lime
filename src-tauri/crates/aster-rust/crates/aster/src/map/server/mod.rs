//! 可视化服务器模块
//!
//! 提供代码本体图谱的交互式可视化 Web 服务器
//!
//! ## 模块结构
//! - `types`: 可视化相关类型定义
//! - `server`: HTTP 服务器实现
//! - `routes`: API 路由处理
//! - `services`: 业务逻辑服务

pub mod routes;
#[allow(clippy::module_inception)]
pub mod server;
pub mod services;
pub mod types;

// 类型导出
pub use types::*;

// 服务器导出
pub use server::{start_visualization_server, VisualizationServer, VisualizationServerOptions};

// 服务导出
pub use services::{
    architecture::{build_architecture_map, get_dir, get_module_detail, get_symbol_refs},
    dependency::{build_dependency_tree, detect_entry_points},
};
