//! 语音本地模型管理命令
//!
//! 只管理用户显式下载到应用数据目录的模型文件，不把大模型随安装包内置。

use bzip2::read::BzDecoder;
use futures::StreamExt;
use lime_core::app_paths;
use lime_services::voice_asr_service::AsrService;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter, Runtime};
use tokio::io::AsyncWriteExt;

use crate::config::{
    load_config, save_config, AsrCredentialEntry, AsrProviderType, SenseVoiceLocalConfig,
};

const SENSEVOICE_MODEL_ID: &str = "sensevoice-small-int8-2024-07-17";
const SILERO_VAD_MODEL_ID: &str = "silero-vad-onnx";
const MODEL_ARCHIVE_FILE_NAME: &str =
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
const MODEL_ARCHIVE_DOWNLOAD_PATH: &str = concat!(
    "voice/sensevoice-small-int8-2024-07-17/",
    "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2"
);
const VAD_FILE_NAME: &str = "silero_vad.onnx";
const VAD_DOWNLOAD_PATH: &str = "voice/silero-vad-onnx/silero_vad.onnx";
const MODEL_ONNX_FILE: &str = "model.int8.onnx";
const TOKENS_FILE: &str = "tokens.txt";
const MANIFEST_FILE: &str = "lime-model.json";
const DEFAULT_VOICE_MODEL_ASSET_BASE_URL: &str =
    "https://pub-fa568bd8496349bcafe04091e2b02e1e.r2.dev";
const DEFAULT_MODEL_BYTES: u64 = 163_002_883;
const DEFAULT_MODEL_ARCHIVE_SHA256: &str =
    "7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e";
const VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "voice-model-download-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceModelCatalogEntry {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub description: String,
    pub version: String,
    pub languages: Vec<String>,
    pub size_bytes: u64,
    pub download_url: String,
    pub vad_model_id: Option<String>,
    pub vad_download_url: Option<String>,
    pub runtime: String,
    pub bundled: bool,
    pub checksum_sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VoiceModelCatalogEnvelope {
    data: Option<LimecoreVoiceModelCatalogResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimecoreVoiceModelCatalogResponse {
    #[serde(default, rename = "assetBaseURL")]
    asset_base_url: String,
    #[serde(default)]
    items: Vec<LimecoreVoiceModelCatalogItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimecoreVoiceModelCatalogItem {
    id: String,
    name: String,
    provider: String,
    description: String,
    version: String,
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    runtime: String,
    #[serde(default)]
    bundled: bool,
    #[serde(default)]
    size_bytes: u64,
    checksum_sha256: Option<String>,
    download: LimecoreVoiceModelDownloadBundle,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimecoreVoiceModelDownloadBundle {
    archive: LimecoreVoiceModelDownloadAsset,
    vad: Option<LimecoreVoiceModelDownloadAsset>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LimecoreVoiceModelDownloadAsset {
    model_id: Option<String>,
    download_path: Option<String>,
    download_url: Option<String>,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceModelInstallState {
    pub model_id: String,
    pub installed: bool,
    pub installing: bool,
    pub install_dir: String,
    pub model_file: Option<String>,
    pub tokens_file: Option<String>,
    pub vad_file: Option<String>,
    pub installed_bytes: u64,
    pub last_verified_at: Option<u64>,
    pub missing_files: Vec<String>,
    pub default_credential_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceModelDownloadResult {
    pub state: VoiceModelInstallState,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceModelDownloadProgressEvent {
    pub model_id: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub overall_progress: f32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceModelTestTranscribeResult {
    pub text: String,
    pub duration_secs: f32,
    pub sample_rate: u32,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VoiceModelManifest {
    model_id: String,
    installed_at: u64,
    source_url: String,
    vad_url: String,
    archive_sha256: String,
    checksum_verified: bool,
    checksum_note: String,
}

#[command]
pub async fn voice_models_list_catalog() -> Result<Vec<VoiceModelCatalogEntry>, String> {
    if let Some(entries) = fetch_configured_voice_model_catalog().await? {
        return Ok(entries);
    }

    Ok(vec![sensevoice_catalog_entry()])
}

#[command]
pub async fn voice_models_get_install_state(
    model_id: String,
) -> Result<VoiceModelInstallState, String> {
    ensure_supported_model(&model_id)?;
    build_install_state(&model_id)
}

#[command]
pub async fn voice_models_download<R: Runtime>(
    app_handle: AppHandle<R>,
    model_id: String,
    catalog_entry: Option<VoiceModelCatalogEntry>,
) -> Result<VoiceModelDownloadResult, String> {
    voice_models_download_with_progress(Some(app_handle), model_id, catalog_entry).await
}

pub async fn voice_models_download_with_progress<R: Runtime>(
    app_handle: Option<AppHandle<R>>,
    model_id: String,
    catalog_entry: Option<VoiceModelCatalogEntry>,
) -> Result<VoiceModelDownloadResult, String> {
    ensure_supported_model(&model_id)?;
    let catalog_entry = resolve_voice_model_catalog_entry(&model_id, catalog_entry).await?;
    let archive_url = require_download_url(&catalog_entry.download_url, "SenseVoice Small 归档")?;
    let vad_url = require_download_url(
        catalog_entry
            .vad_download_url
            .as_deref()
            .unwrap_or_default(),
        "Silero VAD",
    )?;

    let install_dir = model_install_dir(&model_id)?;
    let progress = VoiceModelDownloadProgressEmitter::new(app_handle, model_id.clone());
    let expected_archive_bytes = (catalog_entry.size_bytes > 0).then_some(catalog_entry.size_bytes);
    progress.emit("preparing", 0, expected_archive_bytes, 0.0, "准备下载模型");

    let temp_root = models_root()?.join(".downloads").join(format!(
        "{}-{}",
        model_id,
        current_unix_secs().unwrap_or_default()
    ));
    let extract_dir = temp_root.join("extract");
    fs::create_dir_all(&extract_dir)
        .map_err(|error| format!("创建模型临时目录失败 {}: {error}", extract_dir.display()))?;

    let archive_path = temp_root.join(MODEL_ARCHIVE_FILE_NAME);
    let archive_sha256 = download_file(&archive_url, &archive_path, |downloaded, total| {
        let total_bytes = total.or(expected_archive_bytes);
        let phase_progress = progress_ratio(downloaded, total_bytes);
        progress.emit(
            "archive",
            downloaded,
            total_bytes,
            0.9 * phase_progress,
            "正在下载模型包",
        );
    })
    .await?;
    let checksum_verified =
        verify_optional_sha256(&archive_sha256, catalog_entry.checksum_sha256.as_deref())?;
    progress.emit("extracting", 0, None, 0.92, "正在校验并解压");
    extract_tar_bz2(&archive_path, &extract_dir)?;

    let model_source_dir = find_sensevoice_model_dir(&extract_dir)?;
    let staging_dir = temp_root.join("staging");
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|error| format!("清理模型暂存目录失败 {}: {error}", staging_dir.display()))?;
    }
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("创建模型暂存目录失败 {}: {error}", staging_dir.display()))?;

    copy_required_file(&model_source_dir, &staging_dir, MODEL_ONNX_FILE)?;
    copy_required_file(&model_source_dir, &staging_dir, TOKENS_FILE)?;
    let vad_path = staging_dir.join(VAD_FILE_NAME);
    let _vad_sha256 = download_file(&vad_url, &vad_path, |downloaded, total| {
        let phase_progress = progress_ratio(downloaded, total);
        progress.emit(
            "vad",
            downloaded,
            total,
            0.92 + 0.05 * phase_progress,
            "正在下载 VAD",
        );
    })
    .await?;

    let manifest = VoiceModelManifest {
        model_id: model_id.clone(),
        installed_at: current_unix_secs().unwrap_or_default(),
        source_url: archive_url,
        vad_url,
        archive_sha256,
        checksum_verified,
        checksum_note: if checksum_verified {
            "后端目录提供 sha256，已完成归档内容校验".to_string()
        } else {
            "后端目录未提供 sha256，当前记录下载内容摘要但不声明已完成可信校验".to_string()
        },
    };
    write_manifest(&staging_dir, &manifest)?;
    progress.emit("installing", 0, None, 0.98, "正在安装");

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("替换旧模型目录失败 {}: {error}", install_dir.display()))?;
    }
    fs::create_dir_all(
        install_dir
            .parent()
            .ok_or_else(|| format!("模型目录没有父路径: {}", install_dir.display()))?,
    )
    .map_err(|error| format!("创建模型父目录失败: {error}"))?;
    fs::rename(&staging_dir, &install_dir)
        .map_err(|error| format!("安装模型目录失败 {}: {error}", install_dir.display()))?;

    let _ = fs::remove_dir_all(&temp_root);
    progress.emit("done", 0, None, 1.0, "安装完成");
    Ok(VoiceModelDownloadResult {
        state: build_install_state(&model_id)?,
    })
}

#[command]
pub async fn voice_models_delete(model_id: String) -> Result<VoiceModelInstallState, String> {
    ensure_supported_model(&model_id)?;
    let install_dir = model_install_dir(&model_id)?;
    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("删除模型目录失败 {}: {error}", install_dir.display()))?;
    }
    Ok(build_install_state(&model_id)?)
}

#[command]
pub async fn voice_models_set_default(model_id: String) -> Result<AsrCredentialEntry, String> {
    ensure_supported_model(&model_id)?;
    let state = build_install_state(&model_id)?;
    if !state.installed {
        return Err(format!(
            "SenseVoice Small 尚未安装，缺失文件: {}",
            state.missing_files.join(", ")
        ));
    }

    let mut config = load_config().map_err(|error| error.to_string())?;
    let credentials = &mut config.experimental.voice_input.asr_credentials;
    for credential in credentials.iter_mut() {
        credential.is_default = false;
    }

    let install_dir = model_install_dir(&model_id)?;
    let credential = match credentials.iter_mut().find(|credential| {
        credential.provider == AsrProviderType::SenseVoiceLocal
            && credential
                .sensevoice_config
                .as_ref()
                .map(|config| config.model_id.as_str() == model_id)
                .unwrap_or(false)
    }) {
        Some(existing) => {
            existing.name = Some("SenseVoice Small 本地".to_string());
            existing.disabled = false;
            existing.is_default = true;
            existing.language = "auto".to_string();
            existing.sensevoice_config = Some(SenseVoiceLocalConfig {
                model_id: model_id.clone(),
                model_dir: Some(install_dir.to_string_lossy().to_string()),
                use_itn: true,
                num_threads: 4,
                vad_model_id: Some(SILERO_VAD_MODEL_ID.to_string()),
            });
            existing.clone()
        }
        None => {
            let entry = AsrCredentialEntry {
                id: format!("sensevoice-local-{model_id}"),
                provider: AsrProviderType::SenseVoiceLocal,
                name: Some("SenseVoice Small 本地".to_string()),
                is_default: true,
                disabled: false,
                language: "auto".to_string(),
                whisper_config: None,
                sensevoice_config: Some(SenseVoiceLocalConfig {
                    model_id: model_id.clone(),
                    model_dir: Some(install_dir.to_string_lossy().to_string()),
                    use_itn: true,
                    num_threads: 4,
                    vad_model_id: Some(SILERO_VAD_MODEL_ID.to_string()),
                }),
                xunfei_config: None,
                baidu_config: None,
                openai_config: None,
            };
            credentials.push(entry.clone());
            entry
        }
    };

    save_config(&config).map_err(|error| error.to_string())?;
    Ok(credential)
}

#[command]
pub async fn voice_models_test_transcribe_file(
    model_id: String,
    file_path: String,
) -> Result<VoiceModelTestTranscribeResult, String> {
    ensure_supported_model(&model_id)?;
    let state = build_install_state(&model_id)?;
    if !state.installed {
        return Err(format!(
            "请先在设置 -> 语音模型中下载 SenseVoice Small；缺失文件: {}",
            state.missing_files.join(", ")
        ));
    }

    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err("请提供本机 WAV 文件路径".to_string());
    }

    let audio = read_pcm16_wav(Path::new(file_path))?;
    let install_dir = model_install_dir(&model_id)?;
    let credential = AsrCredentialEntry {
        id: format!("sensevoice-local-test-{model_id}"),
        provider: AsrProviderType::SenseVoiceLocal,
        name: Some("SenseVoice Small 本地测试".to_string()),
        is_default: false,
        disabled: false,
        language: "auto".to_string(),
        whisper_config: None,
        sensevoice_config: Some(SenseVoiceLocalConfig {
            model_id: model_id.clone(),
            model_dir: Some(install_dir.to_string_lossy().to_string()),
            use_itn: true,
            num_threads: 4,
            vad_model_id: Some(SILERO_VAD_MODEL_ID.to_string()),
        }),
        xunfei_config: None,
        baidu_config: None,
        openai_config: None,
    };

    let text = AsrService::transcribe(&credential, &audio.pcm16le, audio.sample_rate).await?;

    Ok(VoiceModelTestTranscribeResult {
        text,
        duration_secs: audio.duration_secs,
        sample_rate: audio.sample_rate,
        language: Some("auto".to_string()),
    })
}

fn sensevoice_catalog_entry() -> VoiceModelCatalogEntry {
    let asset_base_url = first_non_empty_env(&[
        "LIME_VOICE_MODEL_ASSET_BASE_URL",
        "VOICE_MODEL_ASSET_BASE_URL",
        "SERVER_VOICE_MODEL_ASSET_BASE_URL",
    ])
    .unwrap_or_else(|| DEFAULT_VOICE_MODEL_ASSET_BASE_URL.to_string());
    VoiceModelCatalogEntry {
        id: SENSEVOICE_MODEL_ID.to_string(),
        name: "SenseVoice Small INT8".to_string(),
        provider: "FunAudioLLM / sherpa-onnx".to_string(),
        description: "本地离线 ASR，支持中文、英文、日文、韩文和粤语；模型按需下载到用户数据目录。"
            .to_string(),
        version: "2024-07-17".to_string(),
        languages: vec![
            "zh".to_string(),
            "en".to_string(),
            "ja".to_string(),
            "ko".to_string(),
            "yue".to_string(),
        ],
        size_bytes: DEFAULT_MODEL_BYTES,
        download_url: join_url(&asset_base_url, MODEL_ARCHIVE_DOWNLOAD_PATH).unwrap_or_default(),
        vad_model_id: Some(SILERO_VAD_MODEL_ID.to_string()),
        vad_download_url: join_url(&asset_base_url, VAD_DOWNLOAD_PATH),
        runtime: "sherpa-onnx".to_string(),
        bundled: false,
        checksum_sha256: Some(DEFAULT_MODEL_ARCHIVE_SHA256.to_string()),
    }
}

async fn resolve_voice_model_catalog_entry(
    model_id: &str,
    provided_entry: Option<VoiceModelCatalogEntry>,
) -> Result<VoiceModelCatalogEntry, String> {
    if let Some(entry) = provided_entry {
        if entry.id != model_id {
            return Err(format!(
                "语音模型目录 ID 不匹配: expected={model_id}, actual={}",
                entry.id
            ));
        }
        return Ok(entry);
    }

    if let Some(entries) = fetch_configured_voice_model_catalog().await? {
        if let Some(entry) = entries.into_iter().find(|entry| entry.id == model_id) {
            return Ok(entry);
        }
        return Err(format!("后端语音模型目录缺少模型: {model_id}"));
    }

    Ok(sensevoice_catalog_entry())
}

async fn fetch_configured_voice_model_catalog(
) -> Result<Option<Vec<VoiceModelCatalogEntry>>, String> {
    let Some(catalog_url) = resolve_voice_model_catalog_url() else {
        return Ok(None);
    };

    let mut client_builder = reqwest::Client::builder();
    if is_loopback_voice_model_catalog_url(&catalog_url) {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {error}"))?;
    let payload = client
        .get(&catalog_url)
        .send()
        .await
        .map_err(|error| format!("拉取后端语音模型目录失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("后端语音模型目录响应异常: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析后端语音模型目录失败: {error}"))?;

    parse_limecore_voice_model_catalog(payload).map(Some)
}

fn parse_limecore_voice_model_catalog(
    payload: serde_json::Value,
) -> Result<Vec<VoiceModelCatalogEntry>, String> {
    if let Ok(envelope) = serde_json::from_value::<VoiceModelCatalogEnvelope>(payload.clone()) {
        if let Some(data) = envelope.data {
            return map_limecore_voice_model_catalog(data);
        }
    }

    let response = serde_json::from_value::<LimecoreVoiceModelCatalogResponse>(payload)
        .map_err(|error| format!("后端语音模型目录格式非法: {error}"))?;
    map_limecore_voice_model_catalog(response)
}

fn is_loopback_voice_model_catalog_url(catalog_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(catalog_url) else {
        return false;
    };

    let Some(host) = url.host_str() else {
        return false;
    };

    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|addr| addr.is_loopback())
            .unwrap_or(false)
}

fn map_limecore_voice_model_catalog(
    response: LimecoreVoiceModelCatalogResponse,
) -> Result<Vec<VoiceModelCatalogEntry>, String> {
    let asset_base_url = response.asset_base_url;
    response
        .items
        .into_iter()
        .map(|item| map_limecore_voice_model_item(item, &asset_base_url))
        .collect()
}

fn map_limecore_voice_model_item(
    item: LimecoreVoiceModelCatalogItem,
    asset_base_url: &str,
) -> Result<VoiceModelCatalogEntry, String> {
    let archive_download_url =
        resolve_asset_download_url(&item.download.archive, asset_base_url).unwrap_or_default();
    let vad_download_url = item
        .download
        .vad
        .as_ref()
        .and_then(|asset| resolve_asset_download_url(asset, asset_base_url));
    let vad_model_id = item
        .download
        .vad
        .as_ref()
        .and_then(|asset| asset.model_id.clone())
        .or_else(|| Some(SILERO_VAD_MODEL_ID.to_string()));

    Ok(VoiceModelCatalogEntry {
        id: item.id,
        name: item.name,
        provider: item.provider,
        description: item.description,
        version: item.version,
        languages: item.languages,
        size_bytes: item.size_bytes,
        download_url: archive_download_url,
        vad_model_id,
        vad_download_url,
        runtime: if item.runtime.trim().is_empty() {
            "sherpa-onnx".to_string()
        } else {
            item.runtime
        },
        bundled: item.bundled,
        checksum_sha256: item
            .download
            .archive
            .sha256
            .filter(|value| !value.trim().is_empty())
            .or(item.checksum_sha256),
    })
}

fn resolve_asset_download_url(
    asset: &LimecoreVoiceModelDownloadAsset,
    asset_base_url: &str,
) -> Option<String> {
    asset
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            let download_path = asset
                .download_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            join_url(asset_base_url, download_path)
        })
}

fn resolve_voice_model_catalog_url() -> Option<String> {
    if let Some(catalog_url) = first_non_empty_env(&[
        "LIME_VOICE_MODEL_CATALOG_URL",
        "VOICE_MODEL_CATALOG_URL",
        "SERVER_VOICE_MODEL_CATALOG_URL",
    ]) {
        return Some(catalog_url);
    }

    let base_url = first_non_empty_env(&[
        "LIME_OEM_CLOUD_BASE_URL",
        "VITE_OEM_CLOUD_BASE_URL",
        "OEM_CLOUD_BASE_URL",
    ])?;
    let tenant_id =
        first_non_empty_env(&["LIME_OEM_TENANT_ID", "VITE_OEM_TENANT_ID", "OEM_TENANT_ID"])?;
    join_url(
        &base_url,
        &format!("api/v1/public/tenants/{tenant_id}/client/voice-model-catalog"),
    )
}

fn require_download_url(url: &str, label: &str) -> Result<String, String> {
    let normalized = url.trim();
    if normalized.is_empty() {
        return Err(format!(
            "{label} 下载地址未配置。请在 limecore 设置 server.voiceModelAssetBaseUrl 指向对象存储或 CDN 公开域名（例如阿里云 OSS、Cloudflare R2），或通过前端传入后端语音模型目录。"
        ));
    }
    Ok(normalized.to_string())
}

fn verify_optional_sha256(actual: &str, expected: Option<&str>) -> Result<bool, String> {
    let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(false);
    };

    if actual.eq_ignore_ascii_case(expected) {
        return Ok(true);
    }

    Err(format!(
        "模型归档 sha256 校验失败: expected={expected}, actual={actual}"
    ))
}

fn first_non_empty_env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn join_url(base_url: &str, path: &str) -> Option<String> {
    let base = base_url.trim().trim_end_matches('/');
    let path = path.trim().trim_start_matches('/');
    if base.is_empty() || path.is_empty() {
        return None;
    }
    Some(format!("{base}/{path}"))
}

#[derive(Debug, Clone)]
struct VoiceModelDownloadProgressEmitter<R: Runtime> {
    app_handle: Option<AppHandle<R>>,
    model_id: String,
}

impl<R: Runtime> VoiceModelDownloadProgressEmitter<R> {
    fn new(app_handle: Option<AppHandle<R>>, model_id: String) -> Self {
        Self {
            app_handle,
            model_id,
        }
    }

    fn emit(
        &self,
        phase: &str,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        overall_progress: f32,
        message: &str,
    ) {
        let Some(app_handle) = self.app_handle.as_ref() else {
            return;
        };

        let payload = VoiceModelDownloadProgressEvent {
            model_id: self.model_id.clone(),
            phase: phase.to_string(),
            downloaded_bytes,
            total_bytes,
            overall_progress: overall_progress.clamp(0.0, 1.0),
            message: message.to_string(),
        };

        if let Err(error) = app_handle.emit(VOICE_MODEL_DOWNLOAD_PROGRESS_EVENT, &payload) {
            tracing::warn!("发送语音模型下载进度事件失败: {error}");
        }
    }
}

fn progress_ratio(downloaded_bytes: u64, total_bytes: Option<u64>) -> f32 {
    let Some(total_bytes) = total_bytes.filter(|value| *value > 0) else {
        return 0.0;
    };

    (downloaded_bytes as f32 / total_bytes as f32).clamp(0.0, 1.0)
}

#[derive(Debug)]
struct PcmWavAudio {
    pcm16le: Vec<u8>,
    sample_rate: u32,
    duration_secs: f32,
}

#[derive(Debug, Clone, Copy)]
struct WavFormat {
    audio_format: u16,
    channels: u16,
    sample_rate: u32,
    bits_per_sample: u16,
}

fn read_pcm16_wav(path: &Path) -> Result<PcmWavAudio, String> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("wav"))
        .unwrap_or(true)
    {
        return Err("当前测试转写仅支持 .wav 文件".to_string());
    }

    let bytes =
        fs::read(path).map_err(|error| format!("读取 WAV 文件失败 {}: {error}", path.display()))?;
    parse_pcm16_wav_bytes(&bytes)
}

fn parse_pcm16_wav_bytes(bytes: &[u8]) -> Result<PcmWavAudio, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("不是有效的 RIFF/WAVE 文件".to_string());
    }

    let mut offset = 12_usize;
    let mut wav_format = None;
    let mut data_chunk = None;

    while offset + 8 <= bytes.len() {
        let chunk_id = &bytes[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        ]) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start
            .checked_add(chunk_size)
            .ok_or_else(|| "WAV chunk 长度溢出".to_string())?;
        if chunk_end > bytes.len() {
            return Err("WAV chunk 长度异常".to_string());
        }

        match chunk_id {
            b"fmt " => {
                if chunk_size < 16 {
                    return Err("WAV fmt chunk 不完整".to_string());
                }
                wav_format = Some(WavFormat {
                    audio_format: read_le_u16(bytes, chunk_start)?,
                    channels: read_le_u16(bytes, chunk_start + 2)?,
                    sample_rate: read_le_u32(bytes, chunk_start + 4)?,
                    bits_per_sample: read_le_u16(bytes, chunk_start + 14)?,
                });
            }
            b"data" => {
                data_chunk = Some(&bytes[chunk_start..chunk_end]);
            }
            _ => {}
        }

        offset = chunk_end + (chunk_size % 2);
    }

    let wav_format = wav_format.ok_or_else(|| "WAV 文件缺少 fmt chunk".to_string())?;
    if wav_format.audio_format != 1 {
        return Err("当前测试转写仅支持 16-bit PCM WAV（audio_format=1）".to_string());
    }
    if wav_format.channels == 0 {
        return Err("WAV 声道数无效".to_string());
    }
    if wav_format.sample_rate == 0 {
        return Err("WAV 采样率无效".to_string());
    }
    if wav_format.bits_per_sample != 16 {
        return Err("当前测试转写仅支持 16-bit PCM WAV".to_string());
    }

    let data = data_chunk.ok_or_else(|| "WAV 文件缺少 data chunk".to_string())?;
    let frame_size = usize::from(wav_format.channels) * 2;
    if data.len() < frame_size {
        return Err("WAV 音频数据为空".to_string());
    }
    if data.len() % frame_size != 0 {
        return Err("WAV PCM 数据长度与声道数不匹配".to_string());
    }

    let frame_count = data.len() / frame_size;
    let mut pcm16le = Vec::with_capacity(frame_count * 2);
    if wav_format.channels == 1 {
        pcm16le.extend_from_slice(data);
    } else {
        for frame in data.chunks_exact(frame_size) {
            pcm16le.extend_from_slice(&frame[0..2]);
        }
    }

    Ok(PcmWavAudio {
        pcm16le,
        sample_rate: wav_format.sample_rate,
        duration_secs: frame_count as f32 / wav_format.sample_rate as f32,
    })
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    if offset + 2 > bytes.len() {
        return Err("WAV 字段越界".to_string());
    }
    Ok(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    if offset + 4 > bytes.len() {
        return Err("WAV 字段越界".to_string());
    }
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn ensure_supported_model(model_id: &str) -> Result<(), String> {
    if model_id == SENSEVOICE_MODEL_ID {
        Ok(())
    } else {
        Err(format!("不支持的语音模型: {model_id}"))
    }
}

fn models_root() -> Result<PathBuf, String> {
    Ok(app_paths::preferred_data_dir()?
        .join("models")
        .join("voice"))
}

fn model_install_dir(model_id: &str) -> Result<PathBuf, String> {
    Ok(models_root()?.join(model_id))
}

fn build_install_state(model_id: &str) -> Result<VoiceModelInstallState, String> {
    let install_dir = model_install_dir(model_id)?;
    let model_file = install_dir.join(MODEL_ONNX_FILE);
    let tokens_file = install_dir.join(TOKENS_FILE);
    let vad_file = install_dir.join(VAD_FILE_NAME);

    let required_files = [
        (MODEL_ONNX_FILE, &model_file),
        (TOKENS_FILE, &tokens_file),
        (VAD_FILE_NAME, &vad_file),
    ];
    let missing_files = required_files
        .iter()
        .filter_map(|(name, path)| {
            if path.exists() {
                None
            } else {
                Some((*name).to_string())
            }
        })
        .collect::<Vec<_>>();

    let default_credential_id = load_config().ok().and_then(|config| {
        config
            .experimental
            .voice_input
            .asr_credentials
            .into_iter()
            .find(|credential| {
                credential.is_default
                    && !credential.disabled
                    && credential.provider == AsrProviderType::SenseVoiceLocal
                    && credential
                        .sensevoice_config
                        .as_ref()
                        .map(|config| config.model_id.as_str() == model_id)
                        .unwrap_or(false)
            })
            .map(|credential| credential.id)
    });

    Ok(VoiceModelInstallState {
        model_id: model_id.to_string(),
        installed: missing_files.is_empty(),
        installing: false,
        install_dir: install_dir.to_string_lossy().to_string(),
        model_file: model_file
            .exists()
            .then(|| model_file.to_string_lossy().to_string()),
        tokens_file: tokens_file
            .exists()
            .then(|| tokens_file.to_string_lossy().to_string()),
        vad_file: vad_file
            .exists()
            .then(|| vad_file.to_string_lossy().to_string()),
        installed_bytes: directory_size(&install_dir).unwrap_or(0),
        last_verified_at: current_unix_secs(),
        missing_files,
        default_credential_id,
    })
}

async fn download_file<F>(
    url: &str,
    destination: &Path,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(u64, Option<u64>),
{
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("创建下载目录失败 {}: {error}", parent.display()))?;
    }

    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("下载模型失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("下载模型响应异常: {error}"))?;
    let total_bytes = response.content_length();
    on_progress(0, total_bytes);

    let temp_path = destination.with_extension("download");
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|error| format!("创建下载文件失败 {}: {error}", temp_path.display()))?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let mut downloaded_bytes = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("读取下载数据失败: {error}"))?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("写入下载文件失败: {error}"))?;
        on_progress(downloaded_bytes, total_bytes);
    }
    file.flush()
        .await
        .map_err(|error| format!("刷新下载文件失败: {error}"))?;
    drop(file);

    tokio::fs::rename(&temp_path, destination)
        .await
        .map_err(|error| format!("保存下载文件失败 {}: {error}", destination.display()))?;

    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_tar_bz2(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive_path)
        .map_err(|error| format!("打开模型归档失败 {}: {error}", archive_path.display()))?;
    let decoder = BzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);

    for entry in archive
        .entries()
        .map_err(|error| format!("读取模型归档失败: {error}"))?
    {
        let mut entry = entry.map_err(|error| format!("读取模型归档条目失败: {error}"))?;
        entry
            .unpack_in(destination)
            .map_err(|error| format!("解包模型归档失败: {error}"))?;
    }
    Ok(())
}

fn find_sensevoice_model_dir(root: &Path) -> Result<PathBuf, String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        if path.join(MODEL_ONNX_FILE).exists() && path.join(TOKENS_FILE).exists() {
            return Ok(path);
        }

        let entries = fs::read_dir(&path)
            .map_err(|error| format!("读取模型解包目录失败 {}: {error}", path.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("读取模型解包目录项失败: {error}"))?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            }
        }
    }

    Err("模型归档中未找到 model.int8.onnx 和 tokens.txt".to_string())
}

fn copy_required_file(source_dir: &Path, target_dir: &Path, file_name: &str) -> Result<(), String> {
    let source = source_dir.join(file_name);
    if !source.exists() {
        return Err(format!("模型归档缺少文件: {file_name}"));
    }
    fs::copy(&source, target_dir.join(file_name))
        .map_err(|error| format!("复制模型文件失败 {}: {error}", source.display()))?;
    Ok(())
}

fn write_manifest(dir: &Path, manifest: &VoiceModelManifest) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("序列化模型清单失败: {error}"))?;
    fs::write(dir.join(MANIFEST_FILE), content)
        .map_err(|error| format!("写入模型清单失败 {}: {error}", dir.display()))
}

fn directory_size(path: &Path) -> Result<u64, String> {
    if !path.exists() {
        return Ok(0);
    }

    let mut total = 0_u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current)
            .map_err(|error| format!("读取目录大小失败 {}: {error}", current.display()))?
        {
            let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
            let metadata = entry.metadata().map_err(|error| {
                format!("读取文件元数据失败 {}: {error}", entry.path().display())
            })?;
            if metadata.is_dir() {
                stack.push(entry.path());
            } else {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}

fn current_unix_secs() -> Option<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Mutex, OnceLock};

    #[test]
    fn parse_pcm16_wav_bytes_reads_mono_audio() {
        let wav = build_test_wav(1, 16_000, &[100, -100, 200]);

        let audio = parse_pcm16_wav_bytes(&wav).expect("parse wav");

        assert_eq!(audio.sample_rate, 16_000);
        assert!((audio.duration_secs - 0.0001875).abs() < f32::EPSILON);
        assert_eq!(audio.pcm16le, samples_to_pcm16le(&[100, -100, 200]));
    }

    #[test]
    fn parse_pcm16_wav_bytes_uses_first_channel_for_stereo() {
        let wav = build_test_wav(2, 16_000, &[100, 900, -100, -900]);

        let audio = parse_pcm16_wav_bytes(&wav).expect("parse wav");

        assert_eq!(audio.pcm16le, samples_to_pcm16le(&[100, -100]));
    }

    #[test]
    fn parse_pcm16_wav_bytes_rejects_non_pcm_format() {
        let mut wav = build_test_wav(1, 16_000, &[100]);
        wav[20..22].copy_from_slice(&3_u16.to_le_bytes());

        let error = parse_pcm16_wav_bytes(&wav).expect_err("float wav should fail");

        assert!(error.contains("16-bit PCM WAV"));
    }

    #[test]
    fn parse_limecore_voice_model_catalog_maps_object_storage_urls() {
        let payload = serde_json::json!({
            "code": 200,
            "message": "success",
            "data": {
                "assetBaseURL": "https://models.example.com",
                "items": [
                    {
                        "id": SENSEVOICE_MODEL_ID,
                        "name": "SenseVoice Small INT8",
                        "provider": "FunAudioLLM / sherpa-onnx",
                        "description": "后端下发",
                        "version": "2024-07-17",
                        "languages": ["zh", "en"],
                        "runtime": "sherpa-onnx",
                        "bundled": false,
                        "sizeBytes": 262144000,
                        "download": {
                            "archive": {
                                "downloadPath": MODEL_ARCHIVE_DOWNLOAD_PATH,
                                "sha256": "abc123"
                            },
                            "vad": {
                                "modelId": SILERO_VAD_MODEL_ID,
                                "downloadPath": VAD_DOWNLOAD_PATH
                            }
                        }
                    }
                ]
            }
        });

        let entries = parse_limecore_voice_model_catalog(payload).expect("parse catalog");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, SENSEVOICE_MODEL_ID);
        assert_eq!(
            entries[0].download_url,
            "https://models.example.com/voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2"
        );
        assert_eq!(
            entries[0].vad_download_url.as_deref(),
            Some("https://models.example.com/voice/silero-vad-onnx/silero_vad.onnx")
        );
        assert_eq!(entries[0].checksum_sha256.as_deref(), Some("abc123"));
    }

    #[tokio::test]
    async fn voice_models_list_catalog_fetches_configured_limecore_url() {
        let _env_guard = env_test_lock().lock().expect("lock env");
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind catalog fixture");
        let addr = listener.local_addr().expect("fixture addr");
        let catalog_url_guard = EnvVarGuard::set(
            "LIME_VOICE_MODEL_CATALOG_URL",
            format!("http://{addr}/api/v1/public/tenants/tenant-0001/client/voice-model-catalog"),
        );

        let payload = serde_json::json!({
            "code": 200,
            "message": "success",
            "data": {
                "assetBaseURL": "https://catalog.example.com",
                "items": [
                    {
                        "id": SENSEVOICE_MODEL_ID,
                        "name": "SenseVoice Small INT8",
                        "provider": "FunAudioLLM / sherpa-onnx",
                        "description": "服务端目录",
                        "version": "2024-07-17",
                        "languages": ["zh"],
                        "runtime": "sherpa-onnx",
                        "bundled": false,
                        "sizeBytes": 123,
                        "download": {
                            "archive": {
                                "downloadPath": MODEL_ARCHIVE_DOWNLOAD_PATH,
                                "sha256": "server-sha"
                            },
                            "vad": {
                                "modelId": SILERO_VAD_MODEL_ID,
                                "downloadPath": VAD_DOWNLOAD_PATH
                            }
                        }
                    }
                ]
            }
        })
        .to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                payload.len(),
                payload
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
        });

        let entries = voice_models_list_catalog().await.expect("fetch catalog");

        drop(catalog_url_guard);
        server.join().expect("fixture server");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].description, "服务端目录");
        assert_eq!(
            entries[0].download_url,
            "https://catalog.example.com/voice/sensevoice-small-int8-2024-07-17/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2"
        );
        assert_eq!(entries[0].checksum_sha256.as_deref(), Some("server-sha"));
    }

    #[test]
    fn verify_optional_sha256_rejects_mismatch() {
        let error = verify_optional_sha256("actual", Some("expected"))
            .expect_err("sha mismatch should fail");

        assert!(error.contains("sha256 校验失败"));
    }

    fn build_test_wav(channels: u16, sample_rate: u32, samples: &[i16]) -> Vec<u8> {
        let data = samples_to_pcm16le(samples);
        let fmt_chunk_size = 16_u32;
        let data_chunk_size = data.len() as u32;
        let riff_size = 4 + 8 + fmt_chunk_size + 8 + data_chunk_size;
        let byte_rate = sample_rate * u32::from(channels) * 2;
        let block_align = channels * 2;

        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&riff_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&fmt_chunk_size.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_chunk_size.to_le_bytes());
        wav.extend_from_slice(&data);
        wav
    }

    fn samples_to_pcm16le(samples: &[i16]) -> Vec<u8> {
        samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }

    fn env_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: String) -> Self {
            let previous = env::var(key).ok();
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                env::set_var(self.key, previous);
            } else {
                env::remove_var(self.key);
            }
        }
    }
}
