//! 浏览器连接器引导独立窗口管理

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, thiserror::Error)]
pub enum BrowserConnectorGuideWindowError {
    #[error("窗口创建失败: {0}")]
    CreateFailed(String),
    #[error("窗口操作失败: {0}")]
    OperationFailed(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserConnectorGuideMode {
    Extension,
    Cdp,
}

const GUIDE_WINDOW_LABEL_PREFIX: &str = "browser-connector-guide";
const GUIDE_WINDOW_ROUTE: &str = "/browser-connector-guide";
const WINDOW_WIDTH: f64 = 900.0;
const WINDOW_HEIGHT: f64 = 700.0;
const MIN_WINDOW_WIDTH: f64 = 760.0;
const MIN_WINDOW_HEIGHT: f64 = 560.0;

impl BrowserConnectorGuideMode {
    fn as_query_value(self) -> &'static str {
        match self {
            Self::Extension => "extension",
            Self::Cdp => "cdp",
        }
    }

    fn window_title(self) -> &'static str {
        match self {
            Self::Extension => "浏览器扩展连接引导",
            Self::Cdp => "浏览器直连配置引导",
        }
    }
}

pub fn normalize_browser_connector_guide_mode(mode: Option<&str>) -> BrowserConnectorGuideMode {
    match mode.map(str::trim) {
        Some("cdp") => BrowserConnectorGuideMode::Cdp,
        _ => BrowserConnectorGuideMode::Extension,
    }
}

fn build_browser_connector_guide_label(mode: BrowserConnectorGuideMode) -> String {
    format!("{GUIDE_WINDOW_LABEL_PREFIX}-{}", mode.as_query_value())
}

fn build_browser_connector_guide_route(mode: BrowserConnectorGuideMode) -> String {
    format!(
        "{GUIDE_WINDOW_ROUTE}?mode={}",
        urlencoding::encode(mode.as_query_value())
    )
}

pub fn open_browser_connector_guide_window(
    app: &AppHandle,
    mode: BrowserConnectorGuideMode,
) -> Result<(), BrowserConnectorGuideWindowError> {
    let label = build_browser_connector_guide_label(mode);
    let route = build_browser_connector_guide_route(mode);

    if let Some(window) = app.get_webview_window(&label) {
        let route_literal = serde_json::to_string(&route).map_err(|error| {
            BrowserConnectorGuideWindowError::OperationFailed(format!("窗口路由编码失败: {error}"))
        })?;
        let js = format!("window.location.replace({route_literal});");
        window.eval(&js).map_err(|error| {
            BrowserConnectorGuideWindowError::OperationFailed(format!("导航失败: {error}"))
        })?;
        let _ = window.unminimize();
        window.show().map_err(|error| {
            BrowserConnectorGuideWindowError::OperationFailed(format!("显示窗口失败: {error}"))
        })?;
        window.set_focus().map_err(|error| {
            BrowserConnectorGuideWindowError::OperationFailed(format!("聚焦窗口失败: {error}"))
        })?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title(mode.window_title())
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        .resizable(true)
        .visible(true)
        .focused(true)
        .center()
        .build()
        .map_err(|error| BrowserConnectorGuideWindowError::CreateFailed(format!("{error}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guide_mode_should_fallback_to_extension() {
        assert_eq!(
            normalize_browser_connector_guide_mode(None),
            BrowserConnectorGuideMode::Extension
        );
        assert_eq!(
            normalize_browser_connector_guide_mode(Some("unknown")),
            BrowserConnectorGuideMode::Extension
        );
    }

    #[test]
    fn cdp_mode_should_build_stable_route_and_label() {
        let mode = normalize_browser_connector_guide_mode(Some("cdp"));

        assert_eq!(
            build_browser_connector_guide_label(mode),
            "browser-connector-guide-cdp"
        );
        assert_eq!(
            build_browser_connector_guide_route(mode),
            "/browser-connector-guide?mode=cdp"
        );
    }
}
