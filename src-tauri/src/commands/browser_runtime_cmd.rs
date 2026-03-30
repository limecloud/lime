//! 浏览器运行时窗口命令

use crate::app::AppState;
use crate::commands::webview_cmd::{
    append_browser_runtime_launch_audit, open_cdp_session_global,
    open_chrome_profile_window_global, resolve_profile_session_global, shared_browser_runtime,
    start_browser_stream_global, BrowserRuntimeLaunchAuditInput, ChromeProfileLaunchOptions,
    ChromeProfileSessionInfo, OpenCdpSessionRequest, OpenChromeProfileRequest,
    OpenChromeProfileResponse, StartBrowserStreamRequest,
};
use crate::database::{lock_db, DbConnection};
use crate::services::browser_environment_service::{
    apply_browser_environment_to_session, build_browser_environment_launch_config,
    get_browser_environment_preset, touch_browser_environment_preset_last_used,
    BrowserEnvironmentLaunchConfig,
};
use crate::services::browser_profile_service::{
    get_browser_profile, get_browser_profile_by_key, touch_browser_profile_last_used,
};
use crate::services::browser_runtime_window;
use lime_browser_runtime::BrowserStreamMode;
use lime_browser_runtime::CdpSessionState;
use lime_core::database::dao::browser_profile::BrowserProfileTransportKind;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;
use tauri::AppHandle;
use tokio::time::{sleep, Duration};
use tracing::{info, Instrument};

const CDP_READY_MAX_ATTEMPTS: usize = 60;
const CDP_READY_RETRY_INTERVAL_MS: u64 = 250;

#[derive(Debug, Deserialize)]
pub struct OpenBrowserRuntimeDebuggerWindowRequest {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub profile_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LaunchBrowserSessionRequest {
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub profile_key: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub environment_preset_id: Option<String>,
    #[serde(default)]
    pub environment: Option<BrowserEnvironmentLaunchConfig>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default = "default_open_window")]
    pub open_window: bool,
    #[serde(default)]
    pub headless: bool,
    #[serde(default = "default_stream_mode")]
    pub stream_mode: BrowserStreamMode,
}

#[derive(Debug, Deserialize)]
pub struct LaunchBrowserRuntimeAssistRequest {
    pub profile_key: String,
    pub url: String,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default = "default_open_window")]
    pub open_window: bool,
    #[serde(default)]
    pub headless: bool,
    #[serde(default = "default_stream_mode")]
    pub stream_mode: BrowserStreamMode,
    #[serde(default)]
    pub environment: Option<BrowserEnvironmentLaunchConfig>,
}

#[derive(Debug, Serialize)]
pub struct BrowserSessionLaunchResponse {
    pub profile: OpenChromeProfileResponse,
    pub session: CdpSessionState,
}

pub type BrowserRuntimeAssistLaunchResponse = BrowserSessionLaunchResponse;

#[derive(Debug, Clone)]
pub struct ResolvedLaunchBrowserSessionRequest {
    pub profile_id: Option<String>,
    pub profile_key: String,
    pub transport_kind: Option<BrowserProfileTransportKind>,
    pub url: String,
    pub environment_preset_id: Option<String>,
    pub environment: Option<BrowserEnvironmentLaunchConfig>,
    pub target_id: Option<String>,
    pub open_window: bool,
    pub headless: bool,
    pub stream_mode: BrowserStreamMode,
}

fn default_stream_mode() -> BrowserStreamMode {
    BrowserStreamMode::Both
}

fn default_open_window() -> bool {
    true
}

fn default_launch_url() -> String {
    "https://www.google.com/".to_string()
}

async fn finalize_browser_runtime_launch_audit(
    mut audit: BrowserRuntimeLaunchAuditInput,
    error: Option<String>,
) {
    audit.success = error.is_none();
    audit.error = error;
    append_browser_runtime_launch_audit(audit).await;
}

fn resolve_launch_browser_session_request(
    db: &DbConnection,
    request: LaunchBrowserSessionRequest,
) -> Result<ResolvedLaunchBrowserSessionRequest, String> {
    if request.environment_preset_id.is_some() && request.environment.is_some() {
        return Err(
            "启动浏览器会话时不能同时指定 environment_preset_id 与 environment".to_string(),
        );
    }

    let mut resolved_profile_id = None;
    let mut resolved_transport_kind = None;
    let mut resolved_profile_key = request
        .profile_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let mut resolved_url = request
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);

    if let Some(profile_id) = request.profile_id.as_deref() {
        let conn = lock_db(db)?;
        let profile = get_browser_profile(&conn, profile_id)?
            .filter(|profile| profile.archived_at.is_none())
            .ok_or_else(|| format!("未找到可用的浏览器资料: {profile_id}"))?;

        if let Some(ref profile_key) = resolved_profile_key {
            if profile.profile_key != *profile_key {
                return Err(format!(
                    "浏览器资料 {profile_id} 的 profile_key 与请求不一致: {} != {profile_key}",
                    profile.profile_key
                ));
            }
        }
        resolved_profile_id = Some(profile.id.clone());
        resolved_transport_kind = Some(profile.transport_kind.clone());
        resolved_profile_key = Some(profile.profile_key.clone());
        if resolved_url.is_none() {
            resolved_url = profile.launch_url.clone();
        }
    }

    let profile_key = resolved_profile_key
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "启动浏览器会话时必须提供 profile_id 或 profile_key".to_string())?;

    if resolved_profile_id.is_none() {
        let conn = lock_db(db)?;
        if let Some(profile) = get_browser_profile_by_key(&conn, &profile_key)?
            .filter(|profile| profile.archived_at.is_none())
        {
            resolved_profile_id = Some(profile.id.clone());
            resolved_transport_kind = Some(profile.transport_kind.clone());
        }
    }

    let environment = if let Some(preset_id) = request.environment_preset_id.as_deref() {
        let conn = lock_db(db)?;
        let preset = get_browser_environment_preset(&conn, preset_id)?
            .filter(|preset| preset.archived_at.is_none())
            .ok_or_else(|| format!("未找到可用的浏览器环境预设: {preset_id}"))?;
        Some(build_browser_environment_launch_config(&preset)?)
    } else {
        request.environment
    };

    let environment_preset_id = request.environment_preset_id.or_else(|| {
        environment
            .as_ref()
            .and_then(|value| value.preset_id.clone())
    });

    Ok(ResolvedLaunchBrowserSessionRequest {
        profile_id: resolved_profile_id,
        profile_key,
        transport_kind: resolved_transport_kind,
        url: resolved_url.unwrap_or_else(default_launch_url),
        environment_preset_id,
        environment,
        target_id: request.target_id,
        open_window: request.open_window,
        headless: request.headless,
        stream_mode: request.stream_mode,
    })
}

fn touch_launched_browser_session_records(
    db: &DbConnection,
    profile_id: Option<&str>,
    environment_preset_id: Option<&str>,
) {
    if let Ok(conn) = lock_db(db) {
        if let Some(profile_id) = profile_id {
            let _ = touch_browser_profile_last_used(&conn, profile_id);
        }
        if let Some(environment_preset_id) = environment_preset_id {
            let _ = touch_browser_environment_preset_last_used(&conn, environment_preset_id);
        }
    }
}

async fn wait_for_cdp_ready(
    remote_debugging_port: u16,
    requested_target_id: Option<&str>,
) -> Result<(), String> {
    let runtime = shared_browser_runtime();
    let mut last_error =
        format!("等待 CDP 端点就绪: http://127.0.0.1:{remote_debugging_port}/json/version");

    for attempt in 0..CDP_READY_MAX_ATTEMPTS {
        match runtime.list_targets(remote_debugging_port).await {
            Ok(targets) => {
                if let Some(target_id) = requested_target_id {
                    if targets.iter().any(|target| target.id == target_id) {
                        return Ok(());
                    }
                    last_error = if targets.is_empty() {
                        format!("CDP 已连通，但尚未发现 target_id={target_id}")
                    } else {
                        format!("CDP 已连通，但未找到 target_id={target_id}")
                    };
                } else {
                    return Ok(());
                }
            }
            Err(error) => {
                last_error = error;
                if runtime.is_cdp_endpoint_alive(remote_debugging_port).await {
                    last_error = format!("CDP 调试端点已响应，但标签页列表暂不可用: {last_error}");
                }
            }
        }

        if attempt + 1 < CDP_READY_MAX_ATTEMPTS {
            sleep(Duration::from_millis(CDP_READY_RETRY_INTERVAL_MS)).await;
        }
    }

    Err(format!("等待 CDP 就绪超时: {last_error}"))
}

#[tauri::command]
pub fn open_browser_runtime_debugger_window(
    app_handle: AppHandle,
    request: Option<OpenBrowserRuntimeDebuggerWindowRequest>,
) -> Result<(), String> {
    let request = request.unwrap_or(OpenBrowserRuntimeDebuggerWindowRequest {
        session_id: None,
        profile_key: None,
    });
    browser_runtime_window::open_browser_runtime_window(
        &app_handle,
        request.session_id.as_deref(),
        request.profile_key.as_deref(),
    )
    .map_err(|e| format!("打开浏览器运行时调试窗口失败: {e}"))
}

#[tauri::command]
pub fn close_browser_runtime_debugger_window(app_handle: AppHandle) -> Result<(), String> {
    browser_runtime_window::close_browser_runtime_window(&app_handle)
        .map_err(|e| format!("关闭浏览器运行时调试窗口失败: {e}"))
}

#[tauri::command]
pub async fn launch_browser_session(
    app_handle: AppHandle,
    app_state: tauri::State<'_, AppState>,
    db: tauri::State<'_, DbConnection>,
    request: LaunchBrowserSessionRequest,
) -> Result<BrowserSessionLaunchResponse, String> {
    launch_browser_session_with_db(
        app_handle,
        app_state.inner().clone(),
        db.inner().clone(),
        request,
    )
    .await
}

pub async fn launch_browser_session_with_db(
    app_handle: AppHandle,
    app_state: AppState,
    db: DbConnection,
    request: LaunchBrowserSessionRequest,
) -> Result<BrowserSessionLaunchResponse, String> {
    let request = resolve_launch_browser_session_request(&db, request)?;
    let response = launch_browser_session_global(app_handle, app_state, request.clone()).await?;
    touch_launched_browser_session_records(
        &db,
        request.profile_id.as_deref(),
        request.environment_preset_id.as_deref(),
    );
    Ok(response)
}

#[tauri::command]
pub async fn launch_browser_runtime_assist(
    app_handle: AppHandle,
    app_state: tauri::State<'_, AppState>,
    request: LaunchBrowserRuntimeAssistRequest,
) -> Result<BrowserRuntimeAssistLaunchResponse, String> {
    launch_browser_runtime_assist_global(app_handle, app_state.inner().clone(), request).await
}

#[tracing::instrument(
    name = "launch_browser_runtime_assist_global",
    skip(app_handle, app_state, request),
    fields(
        profile_key = %request.profile_key,
        profile_id = ?request.profile_id,
        target_id = ?request.target_id,
        open_window = request.open_window,
        headless = request.headless,
        stream_mode = ?request.stream_mode
    )
)]
pub async fn launch_browser_runtime_assist_global(
    app_handle: AppHandle,
    app_state: AppState,
    request: LaunchBrowserRuntimeAssistRequest,
) -> Result<BrowserRuntimeAssistLaunchResponse, String> {
    launch_browser_session_global(
        app_handle,
        app_state,
        ResolvedLaunchBrowserSessionRequest {
            profile_id: request.profile_id,
            profile_key: request.profile_key,
            transport_kind: None,
            url: request.url,
            environment_preset_id: request
                .environment
                .as_ref()
                .and_then(|environment| environment.preset_id.clone()),
            environment: request.environment,
            target_id: request.target_id,
            open_window: request.open_window,
            headless: request.headless,
            stream_mode: request.stream_mode,
        },
    )
    .await
}

#[tracing::instrument(
    name = "launch_browser_session_global",
    skip(app_handle, app_state, request),
    fields(
        profile_key = %request.profile_key,
        profile_id = ?request.profile_id,
        environment_preset_id = ?request.environment_preset_id,
        target_id = ?request.target_id,
        open_window = request.open_window,
        headless = request.headless,
        stream_mode = ?request.stream_mode
    )
)]
pub async fn launch_browser_session_global(
    app_handle: AppHandle,
    app_state: AppState,
    request: ResolvedLaunchBrowserSessionRequest,
) -> Result<BrowserSessionLaunchResponse, String> {
    let mut launch_audit = BrowserRuntimeLaunchAuditInput {
        profile_key: request.profile_key.clone(),
        profile_id: request.profile_id.clone(),
        environment_preset_id: request.environment_preset_id.clone(),
        environment_preset_name: request
            .environment
            .as_ref()
            .and_then(|environment| environment.preset_name.clone()),
        target_id: request.target_id.clone(),
        session_id: None,
        url: request.url.clone(),
        reused: None,
        open_window: request.open_window,
        stream_mode: request.stream_mode,
        browser_source: None,
        remote_debugging_port: None,
        success: false,
        error: None,
    };
    let chrome_launch_options = request
        .environment
        .as_ref()
        .map(build_chrome_launch_options)
        .unwrap_or_default();
    let chrome_launch_options = ChromeProfileLaunchOptions {
        headless: request.headless,
        ..chrome_launch_options
    };
    let launch_url = request.url.clone();
    let bootstrap_url = if request.environment.is_some() {
        "about:blank".to_string()
    } else {
        launch_url.clone()
    };
    let launch_started_at = Instant::now();
    let profile_started_at = Instant::now();
    let profile = match request.transport_kind.clone() {
        Some(BrowserProfileTransportKind::ExistingSession) => {
            let profile_session = match resolve_profile_session_global(Some(
                request.profile_key.clone(),
            ))
            .instrument(tracing::info_span!(
                "launch_browser_session_global.resolve_existing_session"
            ))
            .await
            {
                Ok(session) => session,
                Err(error) => {
                    let wrapped = format!(
                        "当前资料使用“附着当前 Chrome”模式，但没有检测到可复用的浏览器会话：{error}。请确认 Lime Chrome 插件已连接，并且当前 Chrome 已开启远程调试。"
                    );
                    finalize_browser_runtime_launch_audit(launch_audit, Some(wrapped.clone()))
                        .await;
                    return Err(wrapped);
                }
            };
            build_existing_session_profile_response(&profile_session)
        }
        _ => match open_chrome_profile_window_global(
            app_handle.clone(),
            app_state,
            OpenChromeProfileRequest {
                profile_key: request.profile_key.clone(),
                url: bootstrap_url.clone(),
                launch_options: Some(chrome_launch_options),
            },
        )
        .instrument(tracing::info_span!(
            "launch_browser_session_global.open_profile"
        ))
        .await
        {
            Ok(profile) => profile,
            Err(error) => {
                finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
                return Err(error);
            }
        },
    };
    let profile_elapsed_ms = profile_started_at.elapsed().as_millis();
    launch_audit.reused = Some(profile.reused);
    launch_audit.browser_source = profile.browser_source.clone();
    launch_audit.remote_debugging_port = profile.remote_debugging_port;

    if !profile.success {
        let error = profile
            .error
            .clone()
            .unwrap_or_else(|| "打开浏览器 profile 失败".to_string());
        finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
        return Err(error);
    }

    info!(
        profile_key = %request.profile_key,
        url = %request.url,
        reused = profile.reused,
        remote_debugging_port = ?profile.remote_debugging_port,
        elapsed_ms = profile_elapsed_ms,
        "browser session launch: profile ready"
    );

    let remote_debugging_port = match profile.remote_debugging_port {
        Some(port) => port,
        None => {
            let error = "浏览器 profile 缺少 remote_debugging_port，无法连接 CDP".to_string();
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
    };
    launch_audit.remote_debugging_port = Some(remote_debugging_port);

    let cdp_ready_started_at = Instant::now();
    if let Err(error) = wait_for_cdp_ready(remote_debugging_port, request.target_id.as_deref())
        .instrument(tracing::info_span!(
            "launch_browser_session_global.wait_for_cdp_ready",
            remote_debugging_port
        ))
        .await
    {
        finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
        return Err(error);
    }
    let cdp_ready_elapsed_ms = cdp_ready_started_at.elapsed().as_millis();
    info!(
        profile_key = %request.profile_key,
        remote_debugging_port,
        elapsed_ms = cdp_ready_elapsed_ms,
        "browser session launch: cdp ready"
    );

    let open_session_started_at = Instant::now();
    let session = match open_cdp_session_global(OpenCdpSessionRequest {
        profile_key: request.profile_key.clone(),
        target_id: request.target_id.clone(),
        environment_preset_id: request
            .environment
            .as_ref()
            .and_then(|environment| environment.preset_id.clone()),
        environment_preset_name: request
            .environment
            .as_ref()
            .and_then(|environment| environment.preset_name.clone()),
    })
    .instrument(tracing::info_span!(
        "launch_browser_session_global.open_cdp_session"
    ))
    .await
    {
        Ok(session) => session,
        Err(error) => {
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
    };
    let open_session_elapsed_ms = open_session_started_at.elapsed().as_millis();
    launch_audit.target_id = Some(session.target_id.clone());
    launch_audit.session_id = Some(session.session_id.clone());
    info!(
        profile_key = %request.profile_key,
        session_id = %session.session_id,
        target_id = ?session.target_id,
        elapsed_ms = open_session_elapsed_ms,
        "browser session launch: cdp session opened"
    );

    if let Some(environment) = request.environment.as_ref() {
        let runtime = shared_browser_runtime();
        if let Err(error) =
            apply_browser_environment_to_session(runtime.as_ref(), &session.session_id, environment)
                .instrument(tracing::info_span!(
                    "launch_browser_session_global.apply_environment",
                    session_id = %session.session_id
                ))
                .await
        {
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
    }

    let stream_started_at = Instant::now();
    let stream_mode = request.stream_mode;
    let mut session = match start_browser_stream_global(
        app_handle.clone(),
        StartBrowserStreamRequest {
            session_id: session.session_id.clone(),
            mode: stream_mode,
        },
    )
    .instrument(tracing::info_span!(
        "launch_browser_session_global.start_stream",
        session_id = %session.session_id
    ))
    .await
    {
        Ok(session) => session,
        Err(error) => {
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
    };
    let stream_elapsed_ms = stream_started_at.elapsed().as_millis();
    info!(
        profile_key = %request.profile_key,
        session_id = %session.session_id,
        stream_mode = ?stream_mode,
        elapsed_ms = stream_elapsed_ms,
        "browser session launch: stream started"
    );

    if request.open_window {
        let window_started_at = Instant::now();
        if let Err(error) = tracing::info_span!(
            "launch_browser_session_global.open_debugger_window",
            session_id = %session.session_id
        )
        .in_scope(|| {
            browser_runtime_window::open_browser_runtime_window(
                &app_handle,
                Some(&session.session_id),
                Some(&request.profile_key),
            )
            .map_err(|e| format!("打开浏览器运行时调试窗口失败: {e}"))
        }) {
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
        info!(
            profile_key = %request.profile_key,
            session_id = %session.session_id,
            elapsed_ms = window_started_at.elapsed().as_millis(),
            "browser session launch: debugger window opened"
        );
    }

    if request.environment.is_some() {
        let navigation_started_at = Instant::now();
        let runtime = shared_browser_runtime();
        if let Err(error) = runtime
            .execute_action(
                &session.session_id,
                "navigate",
                json!({
                    "url": launch_url,
                }),
            )
            .instrument(tracing::info_span!(
                "launch_browser_session_global.navigate",
                session_id = %session.session_id
            ))
            .await
        {
            finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
            return Err(error);
        }
        session = match runtime
            .refresh_page_info(&session.session_id)
            .instrument(tracing::debug_span!(
                "launch_browser_session_global.refresh_page_info",
                session_id = %session.session_id
            ))
            .await
        {
            Ok(session) => session,
            Err(error) => {
                finalize_browser_runtime_launch_audit(launch_audit, Some(error.clone())).await;
                return Err(error);
            }
        };
        info!(
            profile_key = %request.profile_key,
            session_id = %session.session_id,
            elapsed_ms = navigation_started_at.elapsed().as_millis(),
            "browser session launch: environment ready and navigated"
        );
    }

    info!(
        profile_key = %request.profile_key,
        session_id = %session.session_id,
        total_elapsed_ms = launch_started_at.elapsed().as_millis(),
        profile_elapsed_ms,
        cdp_ready_elapsed_ms,
        open_session_elapsed_ms,
        stream_elapsed_ms,
        open_window = request.open_window,
        headless = request.headless,
        "browser session launch: launch completed"
    );

    finalize_browser_runtime_launch_audit(launch_audit, None).await;
    Ok(BrowserSessionLaunchResponse { profile, session })
}

fn build_existing_session_profile_response(
    profile_session: &ChromeProfileSessionInfo,
) -> OpenChromeProfileResponse {
    let browser_path = (!profile_session.browser_path.trim().is_empty())
        .then(|| profile_session.browser_path.clone());
    let profile_dir = (!profile_session.profile_dir.trim().is_empty())
        .then(|| profile_session.profile_dir.clone());
    let devtools_http_url = format!(
        "http://127.0.0.1:{}/json/version",
        profile_session.remote_debugging_port
    );
    OpenChromeProfileResponse {
        success: true,
        reused: true,
        browser_source: Some(profile_session.browser_source.clone()),
        browser_path,
        profile_dir,
        remote_debugging_port: Some(profile_session.remote_debugging_port),
        pid: Some(profile_session.pid),
        devtools_http_url: Some(devtools_http_url),
        error: None,
    }
}

fn build_chrome_launch_options(
    environment: &BrowserEnvironmentLaunchConfig,
) -> ChromeProfileLaunchOptions {
    ChromeProfileLaunchOptions {
        proxy_server: environment.proxy_server.clone(),
        language: environment.browser_launch_language(),
        headless: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    fn setup_db() -> DbConnection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE browser_profiles (
                id TEXT PRIMARY KEY,
                profile_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                site_scope TEXT,
                launch_url TEXT,
                transport_kind TEXT NOT NULL DEFAULT 'managed_cdp',
                profile_dir TEXT NOT NULL,
                managed_profile_dir TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                archived_at TEXT
            );
            CREATE TABLE browser_environment_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                proxy_server TEXT,
                timezone_id TEXT,
                locale TEXT,
                accept_language TEXT,
                geolocation_lat REAL,
                geolocation_lng REAL,
                geolocation_accuracy_m REAL,
                user_agent TEXT,
                platform TEXT,
                viewport_width INTEGER,
                viewport_height INTEGER,
                device_scale_factor REAL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                archived_at TEXT
            );",
        )
        .unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[test]
    fn resolve_launch_browser_session_request_should_resolve_profile_and_preset() {
        let db = setup_db();
        {
            let conn = lock_db(&db).unwrap();
            conn.execute(
                "INSERT INTO browser_profiles (
                    id, profile_key, name, description, site_scope, launch_url, transport_kind,
                    profile_dir, managed_profile_dir, created_at, updated_at, last_used_at, archived_at
                ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'managed_cdp', ?5, ?5, ?6, ?6, NULL, NULL)",
                (
                    "profile-1",
                    "shop_us",
                    "美区电商账号",
                    "https://seller.example.com/",
                    "/tmp/lime/chrome_profiles/shop_us",
                    "2026-03-15T00:00:00Z",
                ),
            )
            .unwrap();
            conn.execute(
                "INSERT INTO browser_environment_presets (
                    id, name, description, proxy_server, timezone_id, locale, accept_language,
                    geolocation_lat, geolocation_lng, geolocation_accuracy_m, user_agent, platform,
                    viewport_width, viewport_height, device_scale_factor, created_at, updated_at,
                    last_used_at, archived_at
                ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL, NULL, ?7, ?8, ?9, ?10, ?10, NULL, NULL)",
                (
                    "env-1",
                    "美区桌面",
                    "http://127.0.0.1:7890",
                    "America/Los_Angeles",
                    "en-US",
                    "en-US,en;q=0.9",
                    1440_i64,
                    900_i64,
                    2.0_f64,
                    "2026-03-15T00:00:00Z",
                ),
            )
            .unwrap();
        }

        let resolved = resolve_launch_browser_session_request(
            &db,
            LaunchBrowserSessionRequest {
                profile_id: Some("profile-1".to_string()),
                profile_key: None,
                url: None,
                environment_preset_id: Some("env-1".to_string()),
                environment: None,
                target_id: Some("target-1".to_string()),
                open_window: false,
                headless: true,
                stream_mode: BrowserStreamMode::Both,
            },
        )
        .expect("request should resolve");

        assert_eq!(resolved.profile_id.as_deref(), Some("profile-1"));
        assert_eq!(resolved.profile_key, "shop_us");
        assert_eq!(resolved.url, "https://seller.example.com/");
        assert_eq!(resolved.environment_preset_id.as_deref(), Some("env-1"));
        assert_eq!(
            resolved
                .environment
                .as_ref()
                .and_then(|value| value.preset_name.as_deref()),
            Some("美区桌面")
        );
        assert_eq!(
            resolved
                .environment
                .as_ref()
                .and_then(|value| value.proxy_server.as_deref()),
            Some("http://127.0.0.1:7890")
        );
        assert!(resolved.headless);
    }

    #[test]
    fn resolve_launch_browser_session_request_should_reject_mixed_environment_inputs() {
        let db = setup_db();
        let error = resolve_launch_browser_session_request(
            &db,
            LaunchBrowserSessionRequest {
                profile_id: None,
                profile_key: Some("general_browser_assist".to_string()),
                url: Some("https://example.com/".to_string()),
                environment_preset_id: Some("env-1".to_string()),
                environment: Some(BrowserEnvironmentLaunchConfig::default()),
                target_id: None,
                open_window: false,
                headless: false,
                stream_mode: BrowserStreamMode::Both,
            },
        )
        .unwrap_err();

        assert!(error.contains("不能同时指定"));
    }

    #[test]
    fn resolve_launch_browser_session_request_should_allow_existing_session_profile() {
        let db = setup_db();
        {
            let conn = lock_db(&db).unwrap();
            conn.execute(
                "INSERT INTO browser_profiles (
                    id, profile_key, name, description, site_scope, launch_url, transport_kind,
                    profile_dir, managed_profile_dir, created_at, updated_at, last_used_at, archived_at
                ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'existing_session', '', NULL, ?5, ?5, NULL, NULL)",
                (
                    "profile-attach",
                    "weibo_attach",
                    "微博附着",
                    "https://weibo.com/",
                    "2026-03-15T00:00:00Z",
                ),
            )
            .unwrap();
        }

        let resolved = resolve_launch_browser_session_request(
            &db,
            LaunchBrowserSessionRequest {
                profile_id: Some("profile-attach".to_string()),
                profile_key: None,
                url: None,
                environment_preset_id: None,
                environment: None,
                target_id: None,
                open_window: false,
                headless: false,
                stream_mode: BrowserStreamMode::Both,
            },
        )
        .expect("existing_session profile should resolve");

        assert_eq!(resolved.profile_id.as_deref(), Some("profile-attach"));
        assert_eq!(resolved.profile_key, "weibo_attach");
        assert_eq!(
            resolved.transport_kind,
            Some(BrowserProfileTransportKind::ExistingSession)
        );
    }

    #[test]
    fn resolve_launch_browser_session_request_should_allow_existing_session_profile_key() {
        let db = setup_db();
        {
            let conn = lock_db(&db).unwrap();
            conn.execute(
                "INSERT INTO browser_profiles (
                    id, profile_key, name, description, site_scope, launch_url, transport_kind,
                    profile_dir, managed_profile_dir, created_at, updated_at, last_used_at, archived_at
                ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'existing_session', '', NULL, ?5, ?5, NULL, NULL)",
                (
                    "profile-attach",
                    "weibo_attach",
                    "微博附着",
                    "https://weibo.com/",
                    "2026-03-15T00:00:00Z",
                ),
            )
            .unwrap();
        }

        let resolved = resolve_launch_browser_session_request(
            &db,
            LaunchBrowserSessionRequest {
                profile_id: None,
                profile_key: Some("weibo_attach".to_string()),
                url: Some("https://weibo.com/".to_string()),
                environment_preset_id: None,
                environment: None,
                target_id: None,
                open_window: false,
                headless: false,
                stream_mode: BrowserStreamMode::Both,
            },
        )
        .expect("existing_session profile_key should resolve");

        assert_eq!(resolved.profile_id.as_deref(), Some("profile-attach"));
        assert_eq!(resolved.profile_key, "weibo_attach");
        assert_eq!(
            resolved.transport_kind,
            Some(BrowserProfileTransportKind::ExistingSession)
        );
    }
}
