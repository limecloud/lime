//! 更新检查命令模块
//!
//! 提供自动更新检查相关的 Tauri 命令。
//! 检查逻辑走静态 `latest.json` 清单，安装逻辑走 Tauri updater。

use crate::app::AppState;
use crate::config;
use crate::services::update_window;
use lime_services::update_check_service::{
    UpdateCheckService, UpdateCheckServiceState, UpdateInfo,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::UpdaterExt;

const DAY_SECONDS: u64 = 24 * 3600;
const UPDATE_CHECK_CACHE_TTL_SECS: u64 = 10 * 60;
const FALLBACK_RELEASES_URL: &str = "https://github.com/aiclientproxy/lime/releases";
const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://github.com/aiclientproxy/lime/releases/latest/download/latest.json";

/// 编译期注入 updater 公钥；开发环境可为空，此时仅保留手动下载兜底。
const COMPILED_UPDATER_PUBLIC_KEY: Option<&str> = option_env!("LIME_UPDATER_PUBLIC_KEY");
/// 编译期注入 updater manifest 地址；未配置时使用 GitHub Releases latest.json。
const COMPILED_UPDATER_ENDPOINT: Option<&str> = option_env!("LIME_UPDATER_ENDPOINT");

/// 更新检查配置（前端可见）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckSettings {
    pub enabled: bool,
    pub check_interval_hours: u32,
    pub show_notification: bool,
    pub last_check_timestamp: u64,
    pub skipped_version: Option<String>,
    pub remind_later_until: Option<u64>,
}

/// 更新提醒埋点指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNotificationMetrics {
    pub shown_count: u64,
    pub update_now_count: u64,
    pub remind_later_count: u64,
    pub skip_version_count: u64,
    pub dismiss_count: u64,
    pub update_now_rate: f64,
    pub remind_later_rate: f64,
    pub skip_version_rate: f64,
    pub dismiss_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCheckResult {
    pub current: String,
    pub latest: Option<String>,
    #[serde(rename = "hasUpdate")]
    pub has_update: bool,
    #[serde(rename = "downloadUrl")]
    pub download_url: Option<String>,
    #[serde(rename = "releaseNotes")]
    pub release_notes: Option<String>,
    #[serde(rename = "pubDate")]
    pub pub_date: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub success: bool,
    pub message: String,
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct UpdateCheckCache {
    latest: Option<String>,
    download_url: Option<String>,
    release_notes: Option<String>,
    pub_date: Option<String>,
    last_checked_unix: u64,
}

#[derive(Debug, Deserialize)]
struct StaticUpdateManifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    pub_date: Option<String>,
    platforms: HashMap<String, StaticUpdatePlatform>,
}

#[derive(Debug, Deserialize)]
struct StaticUpdatePlatform {
    url: String,
    #[allow(dead_code)]
    signature: Option<String>,
}

fn rate_percent(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 {
        return 0.0;
    }
    let rate = numerator as f64 * 100.0 / denominator as f64;
    (rate * 10.0).round() / 10.0
}

fn current_unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn updater_manifest_url() -> &'static str {
    COMPILED_UPDATER_ENDPOINT
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_UPDATE_MANIFEST_URL)
}

fn updater_public_key() -> Option<&'static str> {
    COMPILED_UPDATER_PUBLIC_KEY
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn release_tag_url(version: &str) -> String {
    format!(
        "https://github.com/aiclientproxy/lime/releases/tag/v{}",
        version.trim_start_matches('v')
    )
}

fn current_platform_key() -> Option<&'static str> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some("windows-x86_64");
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Some("windows-aarch64");
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Some("darwin-x86_64");
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Some("darwin-aarch64");
    }

    #[allow(unreachable_code)]
    None
}

fn get_update_check_cache_path() -> PathBuf {
    let base_dir = dirs::cache_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."));

    base_dir.join("lime").join("update-check-cache.json")
}

fn is_update_cache_fresh(cache: &UpdateCheckCache, now_unix: u64, ttl_secs: u64) -> bool {
    if cache.latest.is_none() {
        return false;
    }

    now_unix.saturating_sub(cache.last_checked_unix) < ttl_secs
}

fn load_update_check_cache(path: &PathBuf) -> Option<UpdateCheckCache> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<UpdateCheckCache>(&content).ok()
}

fn save_update_check_cache(path: &PathBuf, cache: &UpdateCheckCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = serde_json::to_string(cache).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

fn build_update_info(
    latest: Option<String>,
    release_notes: Option<String>,
    pub_date: Option<String>,
    error: Option<String>,
) -> UpdateInfo {
    let current_version = UpdateCheckService::current_version().to_string();
    let latest_version = latest
        .as_deref()
        .map(|value| value.trim_start_matches('v').to_string());
    let download_url = latest_version
        .as_deref()
        .map(release_tag_url)
        .or_else(|| Some(FALLBACK_RELEASES_URL.to_string()));
    let has_update = latest_version
        .as_deref()
        .map(|latest_version| UpdateCheckService::version_compare(&current_version, latest_version))
        .unwrap_or(false);

    UpdateInfo {
        current_version,
        latest_version,
        has_update,
        download_url: download_url.clone(),
        release_notes_url: download_url,
        release_notes,
        pub_date,
        checked_at: current_unix_timestamp(),
        error,
    }
}

fn build_update_info_from_cache_or_default(
    cache: Option<&UpdateCheckCache>,
    error: Option<String>,
) -> UpdateInfo {
    if let Some(cached) = cache {
        let mut info = build_update_info(
            cached.latest.clone(),
            cached.release_notes.clone(),
            cached.pub_date.clone(),
            error,
        );
        if cached.download_url.is_some() {
            info.download_url = cached.download_url.clone();
            info.release_notes_url = cached.download_url.clone();
        }
        return info;
    }

    build_update_info(None, None, None, error)
}

fn build_version_check_result(info: UpdateInfo) -> VersionCheckResult {
    VersionCheckResult {
        current: info.current_version,
        latest: info.latest_version,
        has_update: info.has_update,
        download_url: info.download_url,
        release_notes: info.release_notes,
        pub_date: info.pub_date,
        error: info.error,
    }
}

fn manifest_to_cache(manifest: &StaticUpdateManifest, checked_at: u64) -> UpdateCheckCache {
    UpdateCheckCache {
        latest: Some(manifest.version.trim_start_matches('v').to_string()),
        download_url: Some(release_tag_url(&manifest.version)),
        release_notes: manifest.notes.clone(),
        pub_date: manifest.pub_date.clone(),
        last_checked_unix: checked_at,
    }
}

fn build_update_info_from_manifest(manifest: StaticUpdateManifest) -> UpdateInfo {
    let latest_version = manifest.version.trim_start_matches('v').to_string();
    let platform_error = match current_platform_key() {
        Some(platform_key)
            if manifest
                .platforms
                .get(platform_key)
                .is_some_and(|platform| !platform.url.trim().is_empty()) =>
        {
            None
        }
        Some(platform_key) if manifest.platforms.contains_key(platform_key) => Some(format!(
            "已检测到新版本，但当前平台 {} 的安装包地址为空，请前往发布页手动下载",
            platform_key
        )),
        Some(platform_key) => Some(format!(
            "已检测到新版本，但当前平台 {} 暂无安装包，请前往发布页手动下载",
            platform_key
        )),
        None => Some("当前平台暂不支持应用内升级，请前往发布页手动下载".to_string()),
    };

    build_update_info(
        Some(latest_version),
        manifest.notes,
        manifest.pub_date,
        platform_error,
    )
}

async fn fetch_update_info() -> UpdateInfo {
    let now_unix = current_unix_timestamp();
    let cache_path = get_update_check_cache_path();
    let cached = load_update_check_cache(&cache_path);

    if let Some(cache) = &cached {
        if is_update_cache_fresh(cache, now_unix, UPDATE_CHECK_CACHE_TTL_SECS) {
            return build_update_info_from_cache_or_default(cached.as_ref(), None);
        }
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return build_update_info_from_cache_or_default(
                cached.as_ref(),
                Some(format!("创建更新检查客户端失败，已回退本地缓存: {error}")),
            );
        }
    };

    match client
        .get(updater_manifest_url())
        .header("User-Agent", "Lime")
        .send()
        .await
    {
        Ok(response) => {
            if !response.status().is_success() {
                return build_update_info_from_cache_or_default(
                    cached.as_ref(),
                    Some(format!(
                        "更新清单请求失败（HTTP {}），已回退本地缓存",
                        response.status()
                    )),
                );
            }

            match response.json::<StaticUpdateManifest>().await {
                Ok(manifest) => {
                    let cache = manifest_to_cache(&manifest, now_unix);
                    let _ = save_update_check_cache(&cache_path, &cache);
                    build_update_info_from_manifest(manifest)
                }
                Err(error) => build_update_info_from_cache_or_default(
                    cached.as_ref(),
                    Some(format!("解析更新清单失败，已回退本地缓存: {error}")),
                ),
            }
        }
        Err(error) => build_update_info_from_cache_or_default(
            cached.as_ref(),
            Some(format!("请求更新清单失败，已回退本地缓存: {error}")),
        ),
    }
}

async fn perform_update_check(update_service: &UpdateCheckServiceState) -> UpdateInfo {
    {
        let service = update_service.0.read().await;
        service.begin_check().await;
    }

    let result = fetch_update_info().await;

    let service = update_service.0.read().await;
    service.finish_check(result).await
}

async fn install_update_via_updater(app_handle: &AppHandle) -> Result<(), String> {
    let public_key = updater_public_key()
        .ok_or_else(|| "当前构建未内置更新签名公钥，请前往网页下载最新版".to_string())?;
    let manifest_url = url::Url::parse(updater_manifest_url())
        .map_err(|error| format!("更新清单地址无效: {error}"))?;

    let updater = app_handle
        .updater_builder()
        .pubkey(public_key)
        .endpoints(vec![manifest_url])
        .map_err(|error| format!("初始化更新源失败: {error}"))?
        .build()
        .map_err(|error| format!("创建 updater 失败: {error}"))?;

    let update = updater
        .check()
        .await
        .map_err(|error| format!("检查更新安装包失败: {error}"))?
        .ok_or_else(|| "当前已是最新版本".to_string())?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("安装更新失败: {error}"))?;

    Ok(())
}

/// 手动检查更新，返回完整检查结果
#[tauri::command]
pub async fn check_update(
    update_service: State<'_, UpdateCheckServiceState>,
) -> Result<UpdateInfo, String> {
    Ok(perform_update_check(update_service.inner()).await)
}

/// 手动检查更新，返回前端兼容结构
#[tauri::command]
pub async fn check_for_updates(
    update_service: State<'_, UpdateCheckServiceState>,
) -> Result<VersionCheckResult, String> {
    let info = perform_update_check(update_service.inner()).await;
    Ok(build_version_check_result(info))
}

/// 下载并安装更新
#[tauri::command]
pub async fn download_update(
    app_handle: AppHandle,
    update_service: State<'_, UpdateCheckServiceState>,
) -> Result<DownloadResult, String> {
    let update_info = perform_update_check(update_service.inner()).await;

    if !update_info.has_update {
        return Ok(DownloadResult {
            success: false,
            message: "当前已是最新版本".to_string(),
            file_path: None,
        });
    }

    match install_update_via_updater(&app_handle).await {
        Ok(()) => {
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(1)).await;
                app_handle_clone.restart();
            });

            Ok(DownloadResult {
                success: true,
                message: "更新已安装，应用即将重启完成升级".to_string(),
                file_path: None,
            })
        }
        Err(error) => Ok(DownloadResult {
            success: false,
            message: format!("{error}。请前往发布页手动下载最新版"),
            file_path: None,
        }),
    }
}

/// 获取更新检查配置
#[tauri::command]
pub async fn get_update_check_settings(
    app_state: State<'_, AppState>,
) -> Result<UpdateCheckSettings, String> {
    let state = app_state.read().await;
    let update_config = &state.config.experimental.update_check;

    Ok(UpdateCheckSettings {
        enabled: update_config.enabled,
        check_interval_hours: update_config.check_interval_hours,
        show_notification: update_config.show_notification,
        last_check_timestamp: update_config.last_check_timestamp,
        skipped_version: update_config.skipped_version.clone(),
        remind_later_until: update_config.remind_later_until,
    })
}

/// 更新检查配置
#[tauri::command]
pub async fn set_update_check_settings(
    app_state: State<'_, AppState>,
    settings: UpdateCheckSettings,
) -> Result<(), String> {
    let mut state = app_state.write().await;
    let update_config = &mut state.config.experimental.update_check;

    update_config.enabled = settings.enabled;
    update_config.check_interval_hours = settings.check_interval_hours;
    update_config.show_notification = settings.show_notification;
    update_config.skipped_version = settings.skipped_version;
    update_config.remind_later_until = settings.remind_later_until;

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))
}

/// 获取更新提醒埋点指标
#[tauri::command]
pub async fn get_update_notification_metrics(
    app_state: State<'_, AppState>,
) -> Result<UpdateNotificationMetrics, String> {
    let state = app_state.read().await;
    let update_config = &state.config.experimental.update_check;

    let shown = update_config.notification_shown_count;
    let update_now = update_config.action_update_now_count;
    let remind_later = update_config.action_remind_later_count;
    let skip_version = update_config.action_skip_version_count;
    let dismiss = update_config.action_dismiss_count;

    Ok(UpdateNotificationMetrics {
        shown_count: shown,
        update_now_count: update_now,
        remind_later_count: remind_later,
        skip_version_count: skip_version,
        dismiss_count: dismiss,
        update_now_rate: rate_percent(update_now, shown),
        remind_later_rate: rate_percent(remind_later, shown),
        skip_version_rate: rate_percent(skip_version, shown),
        dismiss_rate: rate_percent(dismiss, shown),
    })
}

/// 记录更新提醒操作行为（用于埋点）
#[tauri::command]
pub async fn record_update_notification_action(
    app_state: State<'_, AppState>,
    action: String,
) -> Result<(), String> {
    let mut state = app_state.write().await;
    let update_config = &mut state.config.experimental.update_check;

    match action.as_str() {
        "update_now" => {
            update_config.action_update_now_count =
                update_config.action_update_now_count.saturating_add(1);
            update_config.dismiss_streak = 0;
            update_config.next_notify_after = None;
            update_config.remind_later_until = None;
        }
        "shown" => {
            update_config.notification_shown_count =
                update_config.notification_shown_count.saturating_add(1);
        }
        _ => return Err(format!("不支持的更新提醒操作: {action}")),
    }

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))
}

/// 跳过指定版本
#[tauri::command]
pub async fn skip_update_version(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    version: String,
) -> Result<(), String> {
    let mut state = app_state.write().await;
    let update_config = &mut state.config.experimental.update_check;
    update_config.skipped_version = Some(version);
    update_config.action_skip_version_count =
        update_config.action_skip_version_count.saturating_add(1);
    update_config.dismiss_streak = 0;
    update_config.next_notify_after = None;
    update_config.remind_later_until = None;

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))?;

    let _ = update_window::close_update_window(&app_handle);

    Ok(())
}

/// 稍后提醒（默认 24 小时）
#[tauri::command]
pub async fn remind_update_later(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    hours: Option<u32>,
) -> Result<u64, String> {
    let remind_hours = hours.unwrap_or(24).clamp(1, 24 * 30);
    let now = current_unix_timestamp();
    let remind_until = now + (remind_hours as u64 * 3600);

    let mut state = app_state.write().await;
    let update_config = &mut state.config.experimental.update_check;
    update_config.remind_later_until = Some(remind_until);
    update_config.next_notify_after = Some(remind_until);
    update_config.dismiss_streak = 0;
    update_config.action_remind_later_count =
        update_config.action_remind_later_count.saturating_add(1);

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))?;

    let _ = update_window::close_update_window(&app_handle);

    Ok(remind_until)
}

/// 关闭提醒并按连续关闭次数设置退避（1天/3天/7天）
#[tauri::command]
pub async fn dismiss_update_notification(
    app_handle: AppHandle,
    app_state: State<'_, AppState>,
    version: Option<String>,
) -> Result<u64, String> {
    let now = current_unix_timestamp();

    let mut state = app_state.write().await;
    let update_config = &mut state.config.experimental.update_check;

    let next_streak = update_config.dismiss_streak.saturating_add(1);
    let backoff_days = match next_streak {
        1 => 1_u64,
        2 => 3_u64,
        _ => 7_u64,
    };
    let next_notify_after = now + backoff_days * DAY_SECONDS;

    update_config.dismiss_streak = next_streak.min(3);
    update_config.next_notify_after = Some(next_notify_after);
    update_config.remind_later_until = None;
    update_config.action_dismiss_count = update_config.action_dismiss_count.saturating_add(1);
    if version.is_some() {
        update_config.last_notified_version = version;
    }

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))?;

    let _ = update_window::close_update_window(&app_handle);
    Ok(next_notify_after)
}

/// 关闭更新提醒窗口
#[tauri::command]
pub fn close_update_window(app_handle: AppHandle) -> Result<(), String> {
    update_window::close_update_window(&app_handle).map_err(|e| format!("关闭更新窗口失败: {e}"))
}

/// 测试更新提醒窗口（仅开发环境使用）
#[tauri::command]
pub fn test_update_window(app_handle: AppHandle) -> Result<(), String> {
    let current_version = UpdateCheckService::current_version();
    let test_info = UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: Some("0.99.0".to_string()),
        has_update: true,
        download_url: Some(release_tag_url("0.99.0")),
        release_notes_url: Some(release_tag_url("0.99.0")),
        release_notes: Some("这是用于开发环境的模拟更新提醒。".to_string()),
        pub_date: Some("2026-03-21T00:00:00Z".to_string()),
        checked_at: current_unix_timestamp(),
        error: None,
    };

    update_window::open_update_window(&app_handle, &test_info)
        .map_err(|e| format!("打开更新窗口失败: {e}"))
}

/// 更新上次检查时间
#[tauri::command]
pub async fn update_last_check_timestamp(app_state: State<'_, AppState>) -> Result<u64, String> {
    let now = current_unix_timestamp();

    let mut state = app_state.write().await;
    state.config.experimental.update_check.last_check_timestamp = now;

    config::save_config(&state.config).map_err(|e| format!("保存配置失败: {e}"))?;

    Ok(now)
}

/// 启动后台更新检查任务
///
/// 在应用启动时调用，根据配置定期检查更新。
pub async fn start_background_update_check(
    app_handle: tauri::AppHandle,
    update_service: UpdateCheckServiceState,
) {
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

        loop {
            let (
                enabled,
                interval_hours,
                show_notification,
                last_check,
                skipped_version,
                remind_later_until,
                last_notified_version,
                last_notified_at,
                next_notify_after,
            ) = {
                if let Some(app_state) = app_handle_clone.try_state::<AppState>() {
                    let state = app_state.read().await;
                    let update_config = &state.config.experimental.update_check;
                    (
                        update_config.enabled,
                        update_config.check_interval_hours,
                        update_config.show_notification,
                        update_config.last_check_timestamp,
                        update_config.skipped_version.clone(),
                        update_config.remind_later_until,
                        update_config.last_notified_version.clone(),
                        update_config.last_notified_at,
                        update_config.next_notify_after,
                    )
                } else {
                    (true, 24, true, 0, None, None, None, 0, None)
                }
            };

            if !enabled {
                tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
                continue;
            }

            let last_result = {
                let service = update_service.0.read().await;
                service.get_state().await.last_result
            };
            let latest_version = last_result
                .as_ref()
                .and_then(|result| result.latest_version.as_deref());

            if UpdateCheckService::should_check(
                last_check,
                interval_hours,
                skipped_version.as_deref(),
                latest_version,
            ) {
                let result = perform_update_check(&update_service).await;

                tracing::info!(
                    "[更新检查] 当前版本: {}, 最新版本: {:?}, 有更新: {}",
                    result.current_version,
                    result.latest_version,
                    result.has_update
                );

                if let Some(app_state) = app_handle_clone.try_state::<AppState>() {
                    let mut state = app_state.write().await;
                    state.config.experimental.update_check.last_check_timestamp = result.checked_at;
                    let _ = config::save_config(&state.config);
                }

                if result.has_update && show_notification {
                    let now = current_unix_timestamp();
                    let in_remind_later =
                        remind_later_until.is_some_and(|timestamp| timestamp > now);
                    let in_backoff = next_notify_after.is_some_and(|timestamp| timestamp > now);
                    let same_version_daily_limited =
                        result.latest_version.as_ref().is_some_and(|latest| {
                            last_notified_version.as_ref() == Some(latest)
                                && now < last_notified_at.saturating_add(DAY_SECONDS)
                        });

                    let should_notify = result
                        .latest_version
                        .as_ref()
                        .is_none_or(|latest| skipped_version.as_ref() != Some(latest))
                        && !in_remind_later
                        && !in_backoff
                        && !same_version_daily_limited;

                    if should_notify {
                        if let Some(app_state) = app_handle_clone.try_state::<AppState>() {
                            let mut state = app_state.write().await;
                            let update_config = &mut state.config.experimental.update_check;
                            update_config.last_notified_version = result.latest_version.clone();
                            update_config.last_notified_at = now;
                            update_config.notification_shown_count =
                                update_config.notification_shown_count.saturating_add(1);
                            if update_config
                                .next_notify_after
                                .is_some_and(|timestamp| timestamp <= now)
                            {
                                update_config.next_notify_after = None;
                            }
                            let _ = config::save_config(&state.config);
                        }

                        let app_handle_for_ui = app_handle_clone.clone();
                        let result_clone = result.clone();
                        let _ = app_handle_clone.run_on_main_thread(move || {
                            if let Err(error) =
                                update_window::open_update_window(&app_handle_for_ui, &result_clone)
                            {
                                tracing::error!("[更新检查] 打开更新窗口失败: {}", error);
                            }
                        });
                    }
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_update_cache_fresh() {
        let cache = UpdateCheckCache {
            latest: Some("0.92.0".to_string()),
            download_url: Some(release_tag_url("0.92.0")),
            release_notes: Some("notes".to_string()),
            pub_date: Some("2026-03-21T00:00:00Z".to_string()),
            last_checked_unix: 100,
        };

        assert!(is_update_cache_fresh(&cache, 150, 60));
        assert!(!is_update_cache_fresh(&cache, 170, 60));

        let cache_without_latest = UpdateCheckCache {
            latest: None,
            ..cache
        };
        assert!(!is_update_cache_fresh(&cache_without_latest, 120, 60));
    }

    #[test]
    fn test_build_update_info_from_manifest() {
        let manifest = StaticUpdateManifest {
            version: "v0.94.0".to_string(),
            notes: Some("bug fixes".to_string()),
            pub_date: Some("2026-03-21T00:00:00Z".to_string()),
            platforms: HashMap::from([(
                current_platform_key()
                    .unwrap_or("windows-x86_64")
                    .to_string(),
                StaticUpdatePlatform {
                    url: "https://example.com/lime.nsis.zip".to_string(),
                    signature: Some("sig".to_string()),
                },
            )]),
        };

        let info = build_update_info_from_manifest(manifest);
        assert_eq!(info.latest_version.as_deref(), Some("0.94.0"));
        assert!(info.has_update);
        assert_eq!(info.error, None);
    }
}
