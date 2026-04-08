//! 可视化 Web 服务器
//!
//! 提供代码本体图谱的交互式可视化

use std::path::PathBuf;

use crate::map::server::routes::ApiHandlers;

/// 服务器配置选项
#[derive(Debug, Clone)]
pub struct VisualizationServerOptions {
    pub ontology_path: PathBuf,
    pub port: u16,
}

impl Default for VisualizationServerOptions {
    fn default() -> Self {
        Self {
            ontology_path: PathBuf::from("CODE_MAP.json"),
            port: 3000,
        }
    }
}

/// 可视化服务器
///
/// 注意：实际的 HTTP 服务器实现需要依赖 axum/actix-web 等框架
/// 这里提供核心逻辑和 API 处理器
pub struct VisualizationServer {
    options: VisualizationServerOptions,
    handlers: ApiHandlers,
}

impl VisualizationServer {
    /// 创建新的可视化服务器
    pub fn new(options: VisualizationServerOptions) -> Self {
        let handlers = ApiHandlers::new(options.ontology_path.clone());
        Self { options, handlers }
    }

    /// 获取配置的端口
    pub fn port(&self) -> u16 {
        self.options.port
    }

    /// 获取本体路径
    pub fn ontology_path(&self) -> &PathBuf {
        &self.options.ontology_path
    }

    /// 获取 API 处理器
    pub fn handlers(&self) -> &ApiHandlers {
        &self.handlers
    }

    /// 获取服务器地址
    pub fn get_address(&self) -> String {
        format!("http://localhost:{}", self.options.port)
    }
}

/// 便捷函数：创建并返回可视化服务器
pub fn start_visualization_server(ontology_path: PathBuf, port: u16) -> VisualizationServer {
    let options = VisualizationServerOptions {
        ontology_path,
        port,
    };
    VisualizationServer::new(options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_creation() {
        let server = VisualizationServer::new(VisualizationServerOptions {
            ontology_path: PathBuf::from("test.json"),
            port: 8080,
        });

        assert_eq!(server.port(), 8080);
        assert_eq!(server.get_address(), "http://localhost:8080");
    }

    #[test]
    fn test_default_options() {
        let options = VisualizationServerOptions::default();
        assert_eq!(options.port, 3000);
    }
}
