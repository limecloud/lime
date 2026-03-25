use super::api::{get_config, get_updates, send_typing};
use super::media::{
    body_from_item_list, download_media_from_item, find_media_item, resolve_account_data_dir,
    send_text_message, WechatInboundMedia,
};
use super::types::{
    TypingStatus, WechatMessage, DEFAULT_BASE_URL, DEFAULT_CDN_BASE_URL, SESSION_EXPIRED_ERRCODE,
};
use chrono::Utc;
use lime_agent::{AgentActionRequiredScope, AsterAgentState};
use lime_core::config::{
    Config, ConfigManager, WechatAccountConfig, WechatBotConfig, WechatGroupConfig,
};
use lime_core::database::DbConnection;
use lime_core::logger::LogStore;
use lime_websocket::handlers::{RpcHandler, RpcHandlerState};
use lime_websocket::protocol::{
    AgentInputBlock, AgentInputMedia, AgentInputSourceType, AgentRunResult, AgentWaitResult,
    GatewayRpcRequest, RpcMethod,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const DEFAULT_POLL_TIMEOUT_MS: u64 = 35_000;
const RUN_WAIT_TIMEOUT_MS: u64 = 1_200;
const RUN_WAIT_MAX_ROUNDS: usize = 180;
const MESSAGE_DEDUP_TTL_MS: i64 = 5 * 60 * 1_000;
const MESSAGE_DEDUP_MAX_ENTRIES: usize = 2_048;
const PROGRESS_ACK_THRESHOLD_MS: u64 = 900;
const PROGRESS_MESSAGE_LIMIT: usize = 2;

type LogState = Arc<RwLock<LogStore>>;
type SessionRouteState = Arc<RwLock<HashMap<String, String>>>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WechatGatewayAccountStatus {
    pub account_id: String,
    pub running: bool,
    pub started_at: Option<String>,
    pub last_error: Option<String>,
    pub last_update_at: Option<String>,
    pub last_message_at: Option<String>,
    pub sync_buf_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WechatGatewayStatus {
    pub running_accounts: usize,
    pub accounts: Vec<WechatGatewayAccountStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatProbeResult {
    pub account_id: String,
    pub ok: bool,
    pub message: String,
}

pub struct WechatGatewayState {
    inner: Arc<RwLock<WechatGatewayRuntime>>,
}

struct WechatGatewayRuntime {
    accounts: HashMap<String, AccountRuntimeHandle>,
}

struct AccountRuntimeHandle {
    stop_token: CancellationToken,
    task: JoinHandle<()>,
    status: Arc<RwLock<WechatGatewayAccountStatus>>,
}

impl Default for WechatGatewayState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(WechatGatewayRuntime {
                accounts: HashMap::new(),
            })),
        }
    }
}

#[derive(Debug, Clone)]
struct ResolvedWechatAccount {
    account_id: String,
    base_url: String,
    cdn_base_url: String,
    bot_token: String,
    scanner_user_id: Option<String>,
    default_provider: Option<String>,
    default_model: Option<String>,
    dm_policy: String,
    allow_from: HashSet<String>,
    group_policy: String,
    group_allow_from: HashSet<String>,
    groups: HashMap<String, WechatGroupConfig>,
}

#[derive(Debug, Clone)]
struct InboundMessage {
    from_user_id: String,
    group_id: Option<String>,
    text: String,
    context_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingWechatActionType {
    ToolConfirmation,
    AskUser,
    Elicitation,
}

impl PendingWechatActionType {
    fn as_str(self) -> &'static str {
        match self {
            Self::ToolConfirmation => "tool_confirmation",
            Self::AskUser => "ask_user",
            Self::Elicitation => "elicitation",
        }
    }
}

#[derive(Debug, Clone)]
struct PendingWechatAction {
    session_id: String,
    run_id: String,
    request_id: String,
    action_type: PendingWechatActionType,
    prompt: String,
    options: Vec<String>,
    scope: Option<AgentActionRequiredScope>,
}

enum WechatAgentOutcome {
    Completed(String),
    ActionRequired(PendingWechatAction),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WechatProgressStage {
    Received,
    Searching,
    Tooling,
}

impl WechatProgressStage {
    fn message(self) -> &'static str {
        match self {
            Self::Received => "已收到，正在处理中，请稍等。",
            Self::Searching => "正在查询资料，请稍等。",
            Self::Tooling => "正在执行工具，请稍等。",
        }
    }

    fn log_label(self) -> &'static str {
        match self {
            Self::Received => "received",
            Self::Searching => "searching",
            Self::Tooling => "tooling",
        }
    }
}

struct WechatProgressState {
    started_at: std::time::Instant,
    sent_stages: Vec<WechatProgressStage>,
}

impl WechatProgressState {
    fn new() -> Self {
        Self {
            started_at: std::time::Instant::now(),
            sent_stages: Vec::new(),
        }
    }

    fn message_count(&self) -> usize {
        self.sent_stages.len()
    }

    fn has_sent(&self, stage: WechatProgressStage) -> bool {
        self.sent_stages.contains(&stage)
    }

    fn can_send_more(&self) -> bool {
        self.message_count() < PROGRESS_MESSAGE_LIMIT
    }

    fn ack_due(&self) -> bool {
        self.started_at.elapsed() >= Duration::from_millis(PROGRESS_ACK_THRESHOLD_MS)
    }

    fn mark_sent(&mut self, stage: WechatProgressStage) {
        if !self.has_sent(stage) {
            self.sent_stages.push(stage);
        }
    }
}

fn select_progress_stage(
    progress: &WechatProgressState,
    detected_stage: Option<WechatProgressStage>,
) -> Option<WechatProgressStage> {
    if !progress.can_send_more() {
        return None;
    }

    if !progress.has_sent(WechatProgressStage::Received) {
        if !progress.ack_due() || detected_stage.is_none() {
            return None;
        }
        return Some(WechatProgressStage::Received);
    }

    let stage = detected_stage?;
    if progress.has_sent(stage) {
        return None;
    }

    Some(stage)
}

#[derive(Default)]
struct WechatMessageDedupCache {
    seen: HashMap<String, i64>,
}

impl WechatMessageDedupCache {
    fn check_and_record(&mut self, message: &WechatMessage) -> Option<(String, bool)> {
        let key = build_wechat_message_dedup_key(message)?.into_owned();
        let now_ms = message
            .create_time_ms
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        self.prune(now_ms);
        if self.seen.contains_key(key.as_str()) {
            return Some((key, true));
        }
        self.seen.insert(key.clone(), now_ms);
        if self.seen.len() > MESSAGE_DEDUP_MAX_ENTRIES {
            self.prune(now_ms);
        }
        Some((key, false))
    }

    fn prune(&mut self, now_ms: i64) {
        self.seen
            .retain(|_, created_ms| now_ms.saturating_sub(*created_ms) <= MESSAGE_DEDUP_TTL_MS);
    }
}

fn preview_inbound_text(text: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 120;
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return "<empty>".to_string();
    }
    let preview = trimmed.chars().take(MAX_PREVIEW_CHARS).collect::<String>();
    if trimmed.chars().count() > MAX_PREVIEW_CHARS {
        format!("{preview}...")
    } else {
        preview
    }
}

fn normalize_message_text_for_dedup(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_wechat_message_dedup_key(message: &WechatMessage) -> Option<Cow<'_, str>> {
    if let Some(message_id) = message.message_id {
        return Some(Cow::Owned(format!("message_id:{message_id}")));
    }
    if let Some(client_id) = message
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(Cow::Owned(format!("client_id:{client_id}")));
    }

    let from_user_id = message
        .from_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let created_ms = message.create_time_ms?;
    let normalized_text =
        normalize_message_text_for_dedup(&body_from_item_list(message.item_list.as_deref()));
    let context_token = message.context_token.as_deref().unwrap_or_default();
    let group_id = message.group_id.as_deref().unwrap_or_default();

    Some(Cow::Owned(format!(
        "fallback:{from_user_id}:{group_id}:{created_ms}:{context_token}:{normalized_text}"
    )))
}

pub async fn start_gateway(
    state: &WechatGatewayState,
    db: DbConnection,
    aster_state: AsterAgentState,
    logs: LogState,
    config: Config,
    account_filter: Option<String>,
    poll_timeout_secs: Option<u64>,
) -> Result<WechatGatewayStatus, String> {
    let state_inner = state.inner.clone();
    let accounts = resolve_wechat_accounts(&config, account_filter.as_deref())?;
    if accounts.is_empty() {
        return Err("没有可启动的微信账号，请检查 channels.wechat 配置".to_string());
    }
    let poll_timeout_ms = poll_timeout_secs
        .map(|value| value.saturating_mul(1_000))
        .unwrap_or(DEFAULT_POLL_TIMEOUT_MS)
        .clamp(5_000, 60_000);

    for account in accounts {
        let existing = {
            let runtime = state_inner.read().await;
            runtime.accounts.contains_key(&account.account_id)
        };
        if existing {
            continue;
        }
        let sync_buf_present = load_sync_buf(&account.account_id).is_some();
        let status = Arc::new(RwLock::new(WechatGatewayAccountStatus {
            account_id: account.account_id.clone(),
            running: true,
            started_at: Some(Utc::now().to_rfc3339()),
            last_error: None,
            last_update_at: None,
            last_message_at: None,
            sync_buf_present,
        }));
        let state_for_task = state_inner.clone();
        let status_for_task = status.clone();
        let db_for_task = db.clone();
        let aster_state_for_task = aster_state.clone();
        let logs_for_task = logs.clone();
        let stop_token = CancellationToken::new();
        let stop_for_task = stop_token.clone();
        let account_for_task = account.clone();
        let task = tokio::spawn(async move {
            run_account_loop(
                state_for_task,
                status_for_task,
                db_for_task,
                aster_state_for_task,
                logs_for_task,
                account_for_task,
                poll_timeout_ms,
                stop_for_task,
            )
            .await;
        });
        let mut runtime = state_inner.write().await;
        runtime.accounts.insert(
            account.account_id.clone(),
            AccountRuntimeHandle {
                stop_token,
                task,
                status,
            },
        );
    }

    snapshot_status(state_inner).await
}

pub async fn stop_gateway(
    state: &WechatGatewayState,
    account_filter: Option<String>,
) -> Result<WechatGatewayStatus, String> {
    let state_inner = state.inner.clone();
    let mut handles = Vec::new();
    {
        let mut runtime = state_inner.write().await;
        if let Some(account_id) = account_filter {
            if let Some(handle) = runtime.accounts.remove(&account_id) {
                handles.push(handle);
            }
        } else {
            handles = runtime.accounts.drain().map(|(_, handle)| handle).collect();
        }
    }

    for handle in handles {
        handle.stop_token.cancel();
        let _ = handle.task.await;
    }

    snapshot_status(state_inner).await
}

pub async fn status_gateway(state: &WechatGatewayState) -> Result<WechatGatewayStatus, String> {
    snapshot_status(state.inner.clone()).await
}

pub async fn probe_gateway_account(
    config: &Config,
    account_filter: Option<String>,
) -> Result<WechatProbeResult, String> {
    let account = resolve_wechat_accounts(config, account_filter.as_deref())?
        .into_iter()
        .next()
        .ok_or_else(|| "没有可探测的微信账号".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1_500))
        .build()
        .map_err(|e| e.to_string())?;

    match get_updates(&client, &account.base_url, &account.bot_token, None, 1_500).await {
        Ok(resp)
            if resp.ret.unwrap_or(0) == 0 && resp.errcode.unwrap_or(0) == 0
                || resp.errcode == Some(SESSION_EXPIRED_ERRCODE) =>
        {
            Ok(WechatProbeResult {
                account_id: account.account_id,
                ok: true,
                message: "微信账号连通性正常。".to_string(),
            })
        }
        Ok(resp) => Ok(WechatProbeResult {
            account_id: account.account_id,
            ok: false,
            message: format!(
                "微信探测失败: ret={:?} errcode={:?} errmsg={}",
                resp.ret,
                resp.errcode,
                resp.errmsg.unwrap_or_default()
            ),
        }),
        Err(error) => Ok(WechatProbeResult {
            account_id: account.account_id,
            ok: false,
            message: format!("微信探测异常: {error}"),
        }),
    }
}

async fn snapshot_status(
    state: Arc<RwLock<WechatGatewayRuntime>>,
) -> Result<WechatGatewayStatus, String> {
    let handles = {
        let runtime = state.read().await;
        runtime
            .accounts
            .values()
            .map(|handle| handle.status.clone())
            .collect::<Vec<_>>()
    };
    let mut accounts = Vec::with_capacity(handles.len());
    for handle in handles {
        accounts.push(handle.read().await.clone());
    }
    Ok(WechatGatewayStatus {
        running_accounts: accounts.len(),
        accounts,
    })
}

async fn run_account_loop(
    state: Arc<RwLock<WechatGatewayRuntime>>,
    status: Arc<RwLock<WechatGatewayAccountStatus>>,
    db: DbConnection,
    aster_state: AsterAgentState,
    logs: LogState,
    account: ResolvedWechatAccount,
    poll_timeout_ms: u64,
    stop_token: CancellationToken,
) {
    logs.write().await.add(
        "info",
        &format!("[WechatGateway] account={} 开始轮询", account.account_id),
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(poll_timeout_ms + 10_000))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let rpc_state = RpcHandlerState::new(Some(db.clone()), None, logs.clone());
    let rpc_handler = Arc::new(RpcHandler::new(rpc_state));
    let session_route_state = Arc::new(RwLock::new(HashMap::new()));
    let mut get_updates_buf = load_sync_buf(&account.account_id).unwrap_or_default();
    let mut pending_actions = HashMap::<String, PendingWechatAction>::new();
    let mut message_dedup = WechatMessageDedupCache::default();

    loop {
        if stop_token.is_cancelled() {
            break;
        }
        match get_updates(
            &client,
            &account.base_url,
            &account.bot_token,
            if get_updates_buf.is_empty() {
                None
            } else {
                Some(get_updates_buf.as_str())
            },
            poll_timeout_ms,
        )
        .await
        {
            Ok(resp) => {
                if resp.errcode == Some(SESSION_EXPIRED_ERRCODE)
                    || resp.ret == Some(SESSION_EXPIRED_ERRCODE)
                {
                    set_last_error(&status, "微信会话已过期，等待下次重试。".to_string()).await;
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    continue;
                }
                if resp.ret.unwrap_or(0) != 0 || resp.errcode.unwrap_or(0) != 0 {
                    set_last_error(
                        &status,
                        format!(
                            "微信拉取失败: ret={:?} errcode={:?} errmsg={}",
                            resp.ret,
                            resp.errcode,
                            resp.errmsg.unwrap_or_default()
                        ),
                    )
                    .await;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
                if let Some(buf) = resp.get_updates_buf.filter(|value| !value.is_empty()) {
                    save_sync_buf(&account.account_id, &buf);
                    get_updates_buf = buf;
                    status.write().await.sync_buf_present = true;
                }
                status.write().await.last_update_at = Some(Utc::now().to_rfc3339());
                let messages = resp.msgs.unwrap_or_default();
                for message in messages {
                    if stop_token.is_cancelled() {
                        break;
                    }
                    if let Some((dedup_key, true)) = message_dedup.check_and_record(&message) {
                        logs.write().await.add(
                            "info",
                            &format!(
                                "[WechatGateway] account={} 跳过重复消息: dedup_key={} sender={}",
                                account.account_id,
                                dedup_key,
                                message.from_user_id.as_deref().unwrap_or("<unknown>")
                            ),
                        );
                        continue;
                    }
                    if let Err(error) = process_message(
                        &client,
                        &account,
                        &db,
                        &aster_state,
                        rpc_handler.as_ref(),
                        &logs,
                        &session_route_state,
                        &mut pending_actions,
                        &message,
                    )
                    .await
                    {
                        set_last_error(&status, error.clone()).await;
                        logs.write().await.add(
                            "warn",
                            &format!(
                                "[WechatGateway] account={} 处理消息失败: {}",
                                account.account_id, error
                            ),
                        );
                    } else {
                        status.write().await.last_message_at = Some(Utc::now().to_rfc3339());
                    }
                }
            }
            Err(error) => {
                set_last_error(&status, error.clone()).await;
                logs.write().await.add(
                    "warn",
                    &format!(
                        "[WechatGateway] account={} 拉取更新失败: {}",
                        account.account_id, error
                    ),
                );
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }

    {
        let mut runtime = state.write().await;
        runtime.accounts.remove(&account.account_id);
    }
    status.write().await.running = false;
    logs.write().await.add(
        "info",
        &format!("[WechatGateway] account={} 已停止轮询", account.account_id),
    );
}

async fn set_last_error(status: &Arc<RwLock<WechatGatewayAccountStatus>>, error: String) {
    status.write().await.last_error = Some(error);
}

async fn process_message(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    aster_state: &AsterAgentState,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_route_state: &SessionRouteState,
    pending_actions: &mut HashMap<String, PendingWechatAction>,
    message: &WechatMessage,
) -> Result<(), String> {
    let from_user_id = message
        .from_user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "微信消息缺少 from_user_id".to_string())?
        .to_string();
    let inbound = InboundMessage {
        from_user_id: from_user_id.clone(),
        group_id: message.group_id.clone(),
        text: body_from_item_list(message.item_list.as_deref()),
        context_token: message.context_token.clone(),
    };
    if !is_sender_allowed(account, &inbound) {
        logs.write().await.add(
            "info",
            &format!(
                "[WechatGateway] account={} sender={} 未通过策略，忽略消息",
                account.account_id, inbound.from_user_id
            ),
        );
        return Ok(());
    }

    if let Some(reply) = handle_local_command(account, &inbound, session_route_state).await? {
        return send_text_message(
            client,
            &account.base_url,
            &account.bot_token,
            &inbound.from_user_id,
            &reply,
            inbound.context_token.as_deref(),
        )
        .await;
    }

    let session_id = resolve_active_session_id(account, &inbound, session_route_state).await;
    let (rpc_model, rpc_model_source) = resolve_runtime_rpc_model(account);
    let text_preview = preview_inbound_text(&inbound.text);

    if let Some(pending) = pending_actions.remove(&session_id) {
        logs.write().await.add(
            "info",
            &format!(
                "[WechatGateway] account={} 收到补充信息: session={} run_id={} request_id={} action_type={} text_preview=\"{}\"",
                account.account_id,
                session_id,
                pending.run_id,
                pending.request_id,
                pending.action_type.as_str(),
                text_preview
            ),
        );
        let outcome = match resume_pending_action_for_message(
            client,
            account,
            db,
            aster_state,
            rpc_handler,
            logs,
            &pending,
            &inbound,
            rpc_model.as_deref(),
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => {
                let fallback = format_gateway_error_for_user(&error);
                match send_text_message(
                    client,
                    &account.base_url,
                    &account.bot_token,
                    &inbound.from_user_id,
                    &fallback,
                    inbound.context_token.as_deref(),
                )
                .await
                {
                    Ok(()) => return Ok(()),
                    Err(send_error) => {
                        return Err(format!("{}；且回传错误提示失败: {}", error, send_error));
                    }
                }
            }
        };
        return dispatch_wechat_outcome(client, account, logs, pending_actions, &inbound, outcome)
            .await;
    }

    let media = match find_media_item(message.item_list.as_deref()) {
        Some(item) => {
            download_media_from_item(client, &account.account_id, &account.cdn_base_url, &item)
                .await?
        }
        None => None,
    };

    let media_count = usize::from(media.is_some());
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] account={} 收到消息: sender={} group={} session={} text_preview=\"{}\" media_count={} model={} model_source={}",
            account.account_id,
            inbound.from_user_id,
            inbound.group_id.as_deref().unwrap_or("<dm>"),
            session_id,
            preview_inbound_text(&inbound.text),
            media_count,
            rpc_model.as_deref().unwrap_or("<rpc-default>"),
            rpc_model_source
        ),
    );
    let outcome = match run_agent_for_message(
        client,
        account,
        db,
        rpc_handler,
        logs,
        &session_id,
        &inbound,
        media.as_ref(),
        rpc_model.as_deref(),
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(error) => {
            let fallback = format_gateway_error_for_user(&error);
            match send_text_message(
                client,
                &account.base_url,
                &account.bot_token,
                &inbound.from_user_id,
                &fallback,
                inbound.context_token.as_deref(),
            )
            .await
            {
                Ok(()) => return Ok(()),
                Err(send_error) => {
                    return Err(format!("{}；且回传错误提示失败: {}", error, send_error));
                }
            }
        }
    };
    dispatch_wechat_outcome(client, account, logs, pending_actions, &inbound, outcome).await
}

async fn run_agent_for_message(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_id: &str,
    inbound: &InboundMessage,
    media: Option<&WechatInboundMedia>,
    rpc_model: Option<&str>,
) -> Result<WechatAgentOutcome, String> {
    let mut inputs = Vec::new();
    let trimmed_text = inbound.text.trim();
    if !trimmed_text.is_empty() {
        inputs.push(AgentInputBlock::Text {
            text: trimmed_text.to_string(),
        });
    }
    if let Some(media) = media {
        inputs.push(AgentInputBlock::Media(AgentInputMedia {
            media_type: media.media_type.clone(),
            source_type: AgentInputSourceType::LocalPath,
            path_or_data: media.file_path.clone(),
            mime_type: Some(media.mime_type.clone()),
            file_name: media.file_name.clone(),
            metadata: None,
        }));
    }
    if inputs.is_empty() {
        return Ok(WechatAgentOutcome::Completed(
            "收到消息，但没有可处理的文本或附件。".to_string(),
        ));
    }

    if let Ok(config_resp) = get_config(
        client,
        &account.base_url,
        &account.bot_token,
        &inbound.from_user_id,
        inbound.context_token.as_deref(),
    )
    .await
    {
        if let Some(ticket) = config_resp
            .typing_ticket
            .filter(|value| !value.trim().is_empty())
        {
            let _ = send_typing(
                client,
                &account.base_url,
                &account.bot_token,
                super::types::SendTypingReq {
                    ilink_user_id: inbound.from_user_id.clone(),
                    typing_ticket: ticket.clone(),
                    status: TypingStatus::Typing as i32,
                },
            )
            .await;
            let result = run_agent_wait_loop(
                client,
                account,
                db,
                rpc_handler,
                logs,
                session_id,
                &inbound.from_user_id,
                inbound.context_token.as_deref(),
                inputs,
                rpc_model,
                preview_inbound_text(&inbound.text),
                usize::from(media.is_some()),
            )
            .await;
            let _ = send_typing(
                client,
                &account.base_url,
                &account.bot_token,
                super::types::SendTypingReq {
                    ilink_user_id: inbound.from_user_id.clone(),
                    typing_ticket: ticket,
                    status: TypingStatus::Cancel as i32,
                },
            )
            .await;
            return result;
        }
    }

    run_agent_wait_loop(
        client,
        account,
        db,
        rpc_handler,
        logs,
        session_id,
        &inbound.from_user_id,
        inbound.context_token.as_deref(),
        inputs,
        rpc_model,
        preview_inbound_text(&inbound.text),
        usize::from(media.is_some()),
    )
    .await
}

async fn run_agent_wait_loop(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_id: &str,
    to_user_id: &str,
    context_token: Option<&str>,
    inputs: Vec<AgentInputBlock>,
    rpc_model: Option<&str>,
    text_preview: String,
    media_count: usize,
) -> Result<WechatAgentOutcome, String> {
    let request = GatewayRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Uuid::new_v4().to_string(),
        method: RpcMethod::AgentRun,
        params: Some(json!({
            "session_id": session_id,
            "message": "",
            "inputs": inputs,
            "stream": false,
            "web_search": true,
            "model": rpc_model,
        })),
    };
    let response = rpc_handler.handle_request(request).await;
    let run_value = response.result.ok_or_else(|| {
        response
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| "agent.run 返回空结果".to_string())
    })?;
    let run_result: AgentRunResult =
        serde_json::from_value(run_value).map_err(|e| format!("解析 agent.run 失败: {e}"))?;
    logs.write().await.add(
        "info",
        &format!(
            "[WechatGateway] account={} agent.run 已受理: run_id={} session={} model={} text_preview=\"{}\" media_count={}",
            account.account_id,
            run_result.run_id,
            session_id,
            rpc_model.unwrap_or("<rpc-default>"),
            text_preview,
            media_count
        ),
    );

    wait_for_run_outcome(
        client,
        account,
        db,
        rpc_handler,
        logs,
        session_id,
        &run_result.run_id,
        to_user_id,
        context_token,
        rpc_model,
        text_preview,
        media_count,
        None,
    )
    .await
}

async fn wait_for_run_outcome(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    session_id: &str,
    run_id: &str,
    to_user_id: &str,
    context_token: Option<&str>,
    rpc_model: Option<&str>,
    text_preview: String,
    media_count: usize,
    ignored_request_id: Option<&str>,
) -> Result<WechatAgentOutcome, String> {
    let mut progress = WechatProgressState::new();
    for _ in 0..RUN_WAIT_MAX_ROUNDS {
        let wait_response = rpc_handler
            .handle_request(GatewayRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Uuid::new_v4().to_string(),
                method: RpcMethod::AgentWait,
                params: Some(json!({
                    "run_id": run_id,
                    "timeout": RUN_WAIT_TIMEOUT_MS,
                })),
            })
            .await;
        if let Some(error) = wait_response.error {
            return Err(format!("agent.wait 失败: {}", error.message));
        }
        let wait_result: AgentWaitResult = serde_json::from_value(
            wait_response
                .result
                .ok_or_else(|| "agent.wait 返回空结果".to_string())?,
        )
        .map_err(|e| format!("解析 agent.wait 失败: {e}"))?;
        if wait_result.completed {
            let content = wait_result
                .content
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "任务已完成，但没有文本输出。".to_string());
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} agent.wait 完成: run_id={} reply_chars={}",
                    account.account_id,
                    run_id,
                    content.chars().count()
                ),
            );
            return Ok(WechatAgentOutcome::Completed(content));
        }

        if let Some(action) = load_latest_pending_action(db, session_id, run_id)? {
            if ignored_request_id == Some(action.request_id.as_str()) {
                tokio::time::sleep(Duration::from_millis(120)).await;
                continue;
            }
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} agent.wait 进入待补充输入: run_id={} session={} request_id={} action_type={}",
                    account.account_id,
                    run_id,
                    session_id,
                    action.request_id,
                    action.action_type.as_str()
                ),
            );
            return Ok(WechatAgentOutcome::ActionRequired(action));
        }

        maybe_emit_progress_update(
            client,
            account,
            db,
            logs,
            session_id,
            run_id,
            to_user_id,
            context_token,
            &mut progress,
        )
        .await;
    }

    logs.write().await.add(
        "warn",
        &format!(
            "[WechatGateway] account={} agent.wait 超时: run_id={} session={} model={} text_preview=\"{}\" media_count={}",
            account.account_id,
            run_id,
            session_id,
            rpc_model.unwrap_or("<rpc-default>"),
            text_preview,
            media_count
        ),
    );
    Err("等待 Agent 执行超时，请稍后重试。".to_string())
}

async fn maybe_emit_progress_update(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    logs: &LogState,
    session_id: &str,
    run_id: &str,
    to_user_id: &str,
    context_token: Option<&str>,
    progress: &mut WechatProgressState,
) {
    let Ok(detected_stage) = load_tool_progress_stage(db, session_id) else {
        return;
    };
    let Some(stage) = select_progress_stage(progress, detected_stage) else {
        return;
    };

    emit_progress_message(
        client,
        account,
        logs,
        run_id,
        to_user_id,
        context_token,
        stage,
        progress,
    )
    .await;
}

async fn emit_progress_message(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    logs: &LogState,
    run_id: &str,
    to_user_id: &str,
    context_token: Option<&str>,
    stage: WechatProgressStage,
    progress: &mut WechatProgressState,
) {
    if !progress.can_send_more() || progress.has_sent(stage) {
        return;
    }

    match send_text_message(
        client,
        &account.base_url,
        &account.bot_token,
        to_user_id,
        stage.message(),
        context_token,
    )
    .await
    {
        Ok(()) => {
            progress.mark_sent(stage);
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} 发送过程回执: run_id={} stage={} sent_count={}",
                    account.account_id,
                    run_id,
                    stage.log_label(),
                    progress.message_count()
                ),
            );
        }
        Err(error) => {
            logs.write().await.add(
                "warn",
                &format!(
                    "[WechatGateway] account={} 发送过程回执失败: run_id={} stage={} error={}",
                    account.account_id,
                    run_id,
                    stage.log_label(),
                    error
                ),
            );
        }
    }
}

fn load_tool_progress_stage(
    db: &DbConnection,
    session_id: &str,
) -> Result<Option<WechatProgressStage>, String> {
    let conn = lime_core::database::lock_db(db)?;
    let mut turn_stmt = conn
        .prepare(
            "SELECT id
             FROM agent_thread_turns
             WHERE session_id = ?1 AND status = 'running'
             ORDER BY updated_at DESC, started_at DESC, id DESC
             LIMIT 1",
        )
        .map_err(|e| format!("查询运行中 turn 失败: {e}"))?;
    let running_turn_id = turn_stmt
        .query_row([session_id], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|e| format!("读取运行中 turn 失败: {e}"))?;
    let Some(turn_id) = running_turn_id else {
        return Ok(None);
    };

    let mut item_stmt = conn
        .prepare(
            "SELECT item_type
             FROM agent_thread_items
             WHERE session_id = ?1
               AND turn_id = ?2
               AND status = 'in_progress'
               AND item_type IN ('tool_call', 'web_search', 'command_execution')
             ORDER BY updated_at DESC, sequence DESC, id DESC
             LIMIT 1",
        )
        .map_err(|e| format!("查询过程阶段 item 失败: {e}"))?;
    let item_type = item_stmt
        .query_row([session_id, turn_id.as_str()], |row| {
            row.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| format!("读取过程阶段 item 失败: {e}"))?;

    Ok(item_type.and_then(|item_type| match item_type.as_str() {
        "web_search" => Some(WechatProgressStage::Searching),
        "tool_call" | "command_execution" => Some(WechatProgressStage::Tooling),
        _ => None,
    }))
}

async fn dispatch_wechat_outcome(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    logs: &LogState,
    pending_actions: &mut HashMap<String, PendingWechatAction>,
    inbound: &InboundMessage,
    outcome: WechatAgentOutcome,
) -> Result<(), String> {
    match outcome {
        WechatAgentOutcome::Completed(reply) => {
            send_text_message(
                client,
                &account.base_url,
                &account.bot_token,
                &inbound.from_user_id,
                &reply,
                inbound.context_token.as_deref(),
            )
            .await
        }
        WechatAgentOutcome::ActionRequired(action) => {
            let prompt = format_pending_action_prompt(&action);
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} 回传待补充问题: session={} run_id={} request_id={} action_type={}",
                    account.account_id,
                    action.session_id,
                    action.run_id,
                    action.request_id,
                    action.action_type.as_str()
                ),
            );
            pending_actions.insert(action.session_id.clone(), action);
            send_text_message(
                client,
                &account.base_url,
                &account.bot_token,
                &inbound.from_user_id,
                &prompt,
                inbound.context_token.as_deref(),
            )
            .await
        }
    }
}

async fn resume_pending_action_for_message(
    client: &reqwest::Client,
    account: &ResolvedWechatAccount,
    db: &DbConnection,
    aster_state: &AsterAgentState,
    rpc_handler: &RpcHandler,
    logs: &LogState,
    pending: &PendingWechatAction,
    inbound: &InboundMessage,
    rpc_model: Option<&str>,
) -> Result<WechatAgentOutcome, String> {
    let answer = inbound.text.trim();
    if answer.is_empty() {
        return Ok(WechatAgentOutcome::ActionRequired(pending.clone()));
    }

    match pending.action_type {
        PendingWechatActionType::ToolConfirmation => {
            let Some(confirmed) = parse_tool_confirmation_reply(answer) else {
                return Ok(WechatAgentOutcome::ActionRequired(pending.clone()));
            };
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} 提交工具确认: session={} run_id={} request_id={} confirmed={}",
                    account.account_id,
                    pending.session_id,
                    pending.run_id,
                    pending.request_id,
                    confirmed
                ),
            );
            aster_state
                .confirm_tool_action(&pending.request_id, confirmed)
                .await?;
        }
        PendingWechatActionType::AskUser | PendingWechatActionType::Elicitation => {
            logs.write().await.add(
                "info",
                &format!(
                    "[WechatGateway] account={} 提交补充信息: session={} run_id={} request_id={} answer_preview=\"{}\"",
                    account.account_id,
                    pending.session_id,
                    pending.run_id,
                    pending.request_id,
                    preview_inbound_text(answer)
                ),
            );
            aster_state
                .submit_elicitation_response(
                    &pending.session_id,
                    &pending.request_id,
                    json!({ "answer": answer }),
                    pending.scope.clone(),
                )
                .await?;
        }
    }

    wait_for_run_outcome(
        client,
        account,
        db,
        rpc_handler,
        logs,
        &pending.session_id,
        &pending.run_id,
        &inbound.from_user_id,
        inbound.context_token.as_deref(),
        rpc_model,
        preview_inbound_text(answer),
        0,
        Some(pending.request_id.as_str()),
    )
    .await
}

fn load_latest_pending_action(
    db: &DbConnection,
    session_id: &str,
    run_id: &str,
) -> Result<Option<PendingWechatAction>, String> {
    let conn = lime_core::database::lock_db(db)?;
    let mut stmt = conn
        .prepare(
            "SELECT role, content_json
             FROM agent_messages
             WHERE session_id = ?1
             ORDER BY id DESC
             LIMIT 1",
        )
        .map_err(|e| format!("查询最新会话消息失败: {e}"))?;
    let latest = stmt
        .query_row([session_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .optional()
        .map_err(|e| format!("读取最新会话消息失败: {e}"))?;
    let Some((role, content_json)) = latest else {
        return Ok(None);
    };
    if role != "assistant" {
        return Ok(None);
    }

    let content: serde_json::Value =
        serde_json::from_str(&content_json).map_err(|e| format!("解析最新会话消息失败: {e}"))?;
    Ok(extract_pending_action_from_content(
        session_id, run_id, &content,
    ))
}

fn extract_pending_action_from_content(
    session_id: &str,
    run_id: &str,
    content: &serde_json::Value,
) -> Option<PendingWechatAction> {
    let items = content.as_array()?;
    for item in items.iter().rev() {
        let kind = item.get("type").and_then(|value| value.as_str())?;
        if kind == "text" {
            let has_text = item
                .get("text")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_some();
            if has_text {
                return None;
            }
            continue;
        }
        if kind != "action_required" {
            continue;
        }

        let action_type_value = item.get("action_type").and_then(|value| value.as_str())?;
        let action_type = parse_pending_action_type(action_type_value)?;
        let request_id = item
            .get("id")
            .or_else(|| item.get("request_id"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        let data = item.get("data").cloned().unwrap_or_else(|| json!({}));
        let prompt = extract_pending_action_prompt(action_type, &data);
        let options = extract_pending_action_options(&data);
        let scope = item
            .get("scope")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok());
        return Some(PendingWechatAction {
            session_id: session_id.to_string(),
            run_id: run_id.to_string(),
            request_id: request_id.to_string(),
            action_type,
            prompt,
            options,
            scope,
        });
    }
    None
}

fn parse_pending_action_type(value: &str) -> Option<PendingWechatActionType> {
    match value.trim().to_ascii_lowercase().as_str() {
        "tool_confirmation" => Some(PendingWechatActionType::ToolConfirmation),
        "ask_user" => Some(PendingWechatActionType::AskUser),
        "elicitation" => Some(PendingWechatActionType::Elicitation),
        _ => None,
    }
}

fn extract_pending_action_prompt(
    action_type: PendingWechatActionType,
    data: &serde_json::Value,
) -> String {
    match action_type {
        PendingWechatActionType::ToolConfirmation => data
            .get("prompt")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| {
                data.get("tool_name")
                    .and_then(|value| value.as_str())
                    .map(|tool_name| format!("需要确认是否执行工具：{tool_name}"))
            })
            .unwrap_or_else(|| "需要确认是否继续执行当前操作。".to_string()),
        PendingWechatActionType::AskUser | PendingWechatActionType::Elicitation => data
            .get("message")
            .or_else(|| data.get("prompt"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "请补充必要信息后继续执行。".to_string()),
    }
}

fn extract_pending_action_options(data: &serde_json::Value) -> Vec<String> {
    data.get("requested_schema")
        .and_then(|value| value.get("properties"))
        .and_then(|value| value.get("answer"))
        .and_then(|value| value.get("enum"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::trim))
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn format_pending_action_prompt(action: &PendingWechatAction) -> String {
    let mut lines = vec![action.prompt.trim().to_string()];
    if !action.options.is_empty() {
        lines.push(format!("可选项：{}", action.options.join(" / ")));
    }
    if action.action_type == PendingWechatActionType::ToolConfirmation {
        lines.push("请回复：确认 / 继续 / 是，或 取消 / 否。".to_string());
    }
    lines
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_tool_confirmation_reply(text: &str) -> Option<bool> {
    let normalized = text.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }

    let positive = [
        "y", "yes", "ok", "okay", "confirm", "允许", "确认", "继续", "同意", "可以", "是", "好的",
        "好",
    ];
    if positive
        .iter()
        .any(|value| normalized == *value || normalized.starts_with(value))
    {
        return Some(true);
    }

    let negative = [
        "n",
        "no",
        "cancel",
        "deny",
        "拒绝",
        "取消",
        "不同意",
        "不要",
        "否",
        "不",
    ];
    if negative
        .iter()
        .any(|value| normalized == *value || normalized.starts_with(value))
    {
        return Some(false);
    }

    None
}

fn format_gateway_error_for_user(error: &str) -> String {
    let normalized = error.trim();
    let lowered = normalized.to_ascii_lowercase();

    if lowered.contains("authentication error")
        || lowered.contains("invalid api key")
        || lowered.contains("api key not found")
        || lowered.contains("401 unauthorized")
    {
        return "当前机器人调用模型失败：Provider 鉴权未通过，请在 Lime 的 Provider 设置里检查 API Key、模型绑定和默认模型配置。".to_string();
    }

    if lowered.contains("timeout") || normalized.contains("超时") {
        return "当前机器人处理消息超时，请稍后重试。".to_string();
    }

    format!("当前机器人处理消息失败：{}", normalized)
}

async fn handle_local_command(
    account: &ResolvedWechatAccount,
    inbound: &InboundMessage,
    session_route_state: &SessionRouteState,
) -> Result<Option<String>, String> {
    let text = inbound.text.trim();
    if text.eq_ignore_ascii_case("/help") {
        return Ok(Some("可用命令：/new [首条消息]、/help".to_string()));
    }
    if let Some(rest) = text.strip_prefix("/new") {
        let new_session_id = rotate_active_session_id(account, inbound, session_route_state).await;
        let first_prompt = rest.trim();
        if first_prompt.is_empty() {
            return Ok(Some(format!(
                "已开启新会话：{new_session_id}\n后续消息将进入新上下文。"
            )));
        }
        return Ok(Some(format!(
            "已开启新会话：{new_session_id}\n请继续发送消息：{}",
            first_prompt
        )));
    }
    Ok(None)
}

fn build_session_scope(account: &ResolvedWechatAccount, inbound: &InboundMessage) -> String {
    if let Some(group_id) = inbound
        .group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!(
            "wechat:group:{}:{}:{}",
            account.account_id, group_id, inbound.from_user_id
        );
    }
    format!("wechat:dm:{}:{}", account.account_id, inbound.from_user_id)
}

async fn resolve_active_session_id(
    account: &ResolvedWechatAccount,
    inbound: &InboundMessage,
    session_route_state: &SessionRouteState,
) -> String {
    let scope = build_session_scope(account, inbound);
    let state = session_route_state.read().await;
    state.get(&scope).cloned().unwrap_or(scope)
}

async fn rotate_active_session_id(
    account: &ResolvedWechatAccount,
    inbound: &InboundMessage,
    session_route_state: &SessionRouteState,
) -> String {
    let scope = build_session_scope(account, inbound);
    let rotated = format!("{scope}:new:{}", &Uuid::new_v4().to_string()[..8]);
    session_route_state
        .write()
        .await
        .insert(scope, rotated.clone());
    rotated
}

fn is_sender_allowed(account: &ResolvedWechatAccount, inbound: &InboundMessage) -> bool {
    let is_group = inbound
        .group_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if !is_group {
        return policy_allows(
            &account.dm_policy,
            &account.allow_from,
            &inbound.from_user_id,
            account.scanner_user_id.as_deref(),
        );
    }

    let group_config = inbound
        .group_id
        .as_deref()
        .and_then(|group_id| account.groups.get(group_id))
        .or_else(|| account.groups.get("*"));
    let policy = group_config
        .and_then(|config| config.group_policy.as_deref())
        .unwrap_or(&account.group_policy);
    let allow_from = if let Some(config) = group_config {
        if !config.allow_from.is_empty() {
            config.allow_from.iter().cloned().collect::<HashSet<_>>()
        } else if !account.group_allow_from.is_empty() {
            account.group_allow_from.clone()
        } else {
            account.allow_from.clone()
        }
    } else if !account.group_allow_from.is_empty() {
        account.group_allow_from.clone()
    } else {
        account.allow_from.clone()
    };
    policy_allows(
        policy,
        &allow_from,
        &inbound.from_user_id,
        account.scanner_user_id.as_deref(),
    )
}

fn policy_allows(
    policy: &str,
    allow_from: &HashSet<String>,
    sender_id: &str,
    scanner_user_id: Option<&str>,
) -> bool {
    match policy.trim().to_ascii_lowercase().as_str() {
        "disabled" => false,
        "open" | "pairing" => true,
        "allowlist" => {
            allow_from.contains("*")
                || allow_from.contains(sender_id)
                || scanner_user_id == Some(sender_id)
        }
        _ => false,
    }
}

fn resolve_wechat_accounts(
    config: &Config,
    account_filter: Option<&str>,
) -> Result<Vec<ResolvedWechatAccount>, String> {
    let wechat = &config.channels.wechat;
    let mut resolved = Vec::new();
    if !wechat.accounts.is_empty() {
        for (account_id, account) in &wechat.accounts {
            if !account.enabled {
                continue;
            }
            if let Some(filter) = account_filter {
                if filter != account_id {
                    continue;
                }
            }
            resolved.push(resolve_account_config(account_id, account, wechat, config)?);
        }
        return Ok(resolved);
    }

    if !wechat.bot_token.trim().is_empty() || !wechat.base_url.trim().is_empty() {
        let legacy_account_id = wechat
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("default");
        if account_filter
            .map(|filter| filter == legacy_account_id)
            .unwrap_or(true)
        {
            resolved.push(ResolvedWechatAccount {
                account_id: legacy_account_id.to_string(),
                base_url: if wechat.base_url.trim().is_empty() {
                    DEFAULT_BASE_URL.to_string()
                } else {
                    wechat.base_url.trim().to_string()
                },
                cdn_base_url: if wechat.cdn_base_url.trim().is_empty() {
                    DEFAULT_CDN_BASE_URL.to_string()
                } else {
                    wechat.cdn_base_url.trim().to_string()
                },
                bot_token: wechat.bot_token.trim().to_string(),
                scanner_user_id: wechat.scanner_user_id.clone(),
                default_provider: resolve_default_provider(config),
                default_model: wechat
                    .default_model
                    .clone()
                    .or_else(|| normalize_optional_text(Some(config.agent.default_model.as_str()))),
                dm_policy: wechat.dm_policy.clone(),
                allow_from: wechat.allow_from.iter().cloned().collect(),
                group_policy: wechat.group_policy.clone(),
                group_allow_from: wechat.group_allow_from.iter().cloned().collect(),
                groups: wechat.groups.clone(),
            });
        }
    }

    Ok(resolved)
}

fn resolve_account_config(
    account_id: &str,
    account: &WechatAccountConfig,
    root: &WechatBotConfig,
    config: &Config,
) -> Result<ResolvedWechatAccount, String> {
    let base_url = account
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if root.base_url.trim().is_empty() {
                DEFAULT_BASE_URL
            } else {
                root.base_url.trim()
            }
        })
        .to_string();
    let cdn_base_url = account
        .cdn_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if root.cdn_base_url.trim().is_empty() {
                DEFAULT_CDN_BASE_URL
            } else {
                root.cdn_base_url.trim()
            }
        })
        .to_string();
    let bot_token = account
        .bot_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            root.bot_token
                .trim()
                .is_empty()
                .then_some("")
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| root.bot_token.trim());
    if bot_token.is_empty() {
        return Err(format!("微信账号 {} 缺少 bot_token", account_id));
    }
    Ok(ResolvedWechatAccount {
        account_id: account_id.to_string(),
        base_url,
        cdn_base_url,
        bot_token: bot_token.to_string(),
        scanner_user_id: account
            .scanner_user_id
            .clone()
            .or_else(|| root.scanner_user_id.clone()),
        default_provider: resolve_default_provider(config),
        default_model: account
            .default_model
            .clone()
            .or_else(|| root.default_model.clone())
            .or_else(|| normalize_optional_text(Some(config.agent.default_model.as_str()))),
        dm_policy: account
            .dm_policy
            .clone()
            .unwrap_or_else(|| root.dm_policy.clone()),
        allow_from: if account.allow_from.is_empty() {
            root.allow_from.iter().cloned().collect()
        } else {
            account.allow_from.iter().cloned().collect()
        },
        group_policy: account
            .group_policy
            .clone()
            .unwrap_or_else(|| root.group_policy.clone()),
        group_allow_from: if account.group_allow_from.is_empty() {
            root.group_allow_from.iter().cloned().collect()
        } else {
            account.group_allow_from.iter().cloned().collect()
        },
        groups: if account.groups.is_empty() {
            root.groups.clone()
        } else {
            account.groups.clone()
        },
    })
}

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_default_provider(config: &Config) -> Option<String> {
    normalize_optional_text(Some(config.routing.default_provider.as_str()))
        .or_else(|| normalize_optional_text(Some(config.default_provider.as_str())))
}

fn build_rpc_model(default_provider: Option<&str>, default_model: Option<&str>) -> Option<String> {
    let model = normalize_optional_text(default_model)?;
    if model.contains('/') {
        return Some(model);
    }
    match normalize_optional_text(default_provider) {
        Some(provider) => Some(format!("{provider}/{model}")),
        None => Some(model),
    }
}

fn resolve_runtime_rpc_model(account: &ResolvedWechatAccount) -> (Option<String>, &'static str) {
    let cached = build_rpc_model(
        account.default_provider.as_deref(),
        account.default_model.as_deref(),
    );
    let has_cached = cached.is_some();
    let cached_source = if has_cached {
        "startup_cache"
    } else {
        "rpc_default"
    };
    let config_path = ConfigManager::default_config_path();
    let live_manager = match ConfigManager::load(&config_path) {
        Ok(manager) => manager,
        Err(_) => return (cached, cached_source),
    };

    let live_account = resolve_wechat_accounts(live_manager.config(), Some(&account.account_id))
        .ok()
        .and_then(|accounts| accounts.into_iter().next());
    let live_model = live_account.and_then(|resolved| {
        build_rpc_model(
            resolved.default_provider.as_deref(),
            resolved.default_model.as_deref(),
        )
    });

    if live_model.is_some() {
        (live_model, "config_live")
    } else if has_cached {
        (cached, "startup_cache")
    } else {
        (None, "rpc_default")
    }
}

fn sync_buf_path(account_id: &str) -> Result<PathBuf, String> {
    Ok(resolve_account_data_dir(account_id)?
        .join("cache")
        .join("get_updates_buf.txt"))
}

fn load_sync_buf(account_id: &str) -> Option<String> {
    let path = sync_buf_path(account_id).ok()?;
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn save_sync_buf(account_id: &str, value: &str) {
    if let Ok(path) = sync_buf_path(account_id) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::database::schema::create_tables;
    use rusqlite::params;
    use std::sync::{Arc, Mutex};

    #[test]
    fn build_wechat_message_dedup_key_prefers_message_id() {
        let message = WechatMessage {
            message_id: Some(42),
            client_id: Some("client-1".to_string()),
            from_user_id: Some("user-1".to_string()),
            create_time_ms: Some(1_700_000_000_000),
            ..WechatMessage::default()
        };

        let key = build_wechat_message_dedup_key(&message).unwrap();
        assert_eq!(key.as_ref(), "message_id:42");
    }

    #[test]
    fn build_wechat_message_dedup_key_falls_back_to_body_signature() {
        let message = WechatMessage {
            from_user_id: Some("user-1".to_string()),
            group_id: Some("group-1".to_string()),
            create_time_ms: Some(1_700_000_000_000),
            context_token: Some("ctx-1".to_string()),
            item_list: Some(vec![super::super::types::MessageItem {
                r#type: Some(super::super::types::MessageItemType::Text as i32),
                text_item: Some(super::super::types::TextItem {
                    text: Some(" 今天 的 天气 怎么样 ".to_string()),
                }),
                ..super::super::types::MessageItem::default()
            }]),
            ..WechatMessage::default()
        };

        let key = build_wechat_message_dedup_key(&message).unwrap();
        assert_eq!(
            key.as_ref(),
            "fallback:user-1:group-1:1700000000000:ctx-1:今天 的 天气 怎么样"
        );
    }

    #[test]
    fn parse_tool_confirmation_reply_supports_common_inputs() {
        assert_eq!(parse_tool_confirmation_reply("确认"), Some(true));
        assert_eq!(parse_tool_confirmation_reply("继续执行"), Some(true));
        assert_eq!(parse_tool_confirmation_reply("取消"), Some(false));
        assert_eq!(parse_tool_confirmation_reply("不要执行"), Some(false));
        assert_eq!(parse_tool_confirmation_reply("帮我看一下"), None);
    }

    #[test]
    fn extract_pending_action_from_content_reads_elicitation() {
        let content = json!([
            {
                "type": "action_required",
                "id": "req-1",
                "action_type": "elicitation",
                "data": {
                    "message": "请问你所在的城市是哪里？",
                    "requested_schema": {
                        "type": "object",
                        "properties": {
                            "answer": {
                                "type": "string",
                                "enum": ["北京", "上海"]
                            }
                        }
                    }
                },
                "scope": {
                    "session_id": "session-1",
                    "thread_id": "thread-1",
                    "turn_id": "turn-1"
                }
            }
        ]);

        let action = extract_pending_action_from_content("session-1", "run-1", &content).unwrap();
        assert_eq!(action.session_id, "session-1");
        assert_eq!(action.run_id, "run-1");
        assert_eq!(action.request_id, "req-1");
        assert_eq!(action.action_type, PendingWechatActionType::Elicitation);
        assert_eq!(action.prompt, "请问你所在的城市是哪里？");
        assert_eq!(action.options, vec!["北京", "上海"]);
        let scope = action.scope.expect("scope should exist");
        assert_eq!(scope.session_id.as_deref(), Some("session-1"));
        assert_eq!(scope.thread_id.as_deref(), Some("thread-1"));
        assert_eq!(scope.turn_id.as_deref(), Some("turn-1"));
    }

    #[test]
    fn extract_pending_action_from_content_ignores_assistant_text_tail() {
        let content = json!([
            {
                "type": "action_required",
                "id": "req-1",
                "action_type": "elicitation",
                "data": {
                    "message": "请补充城市"
                }
            },
            {
                "type": "text",
                "text": "收到，继续处理中。"
            }
        ]);

        assert!(extract_pending_action_from_content("session-1", "run-1", &content).is_none());
    }

    #[test]
    fn progress_state_respects_threshold_and_limit() {
        let mut progress = WechatProgressState::new();
        assert!(!progress.ack_due());
        assert!(progress.can_send_more());

        progress.started_at = std::time::Instant::now() - Duration::from_millis(1_500);
        assert!(progress.ack_due());

        progress.mark_sent(WechatProgressStage::Received);
        progress.mark_sent(WechatProgressStage::Searching);
        assert_eq!(progress.message_count(), 2);
        assert!(!progress.can_send_more());
    }

    #[test]
    fn select_progress_stage_requires_slow_tool_path() {
        let mut progress = WechatProgressState::new();
        progress.started_at = std::time::Instant::now() - Duration::from_millis(1_500);

        assert_eq!(select_progress_stage(&progress, None), None);
        assert_eq!(
            select_progress_stage(&progress, Some(WechatProgressStage::Searching)),
            Some(WechatProgressStage::Received)
        );

        progress.mark_sent(WechatProgressStage::Received);
        assert_eq!(
            select_progress_stage(&progress, Some(WechatProgressStage::Searching)),
            Some(WechatProgressStage::Searching)
        );

        progress.mark_sent(WechatProgressStage::Searching);
        assert_eq!(
            select_progress_stage(&progress, Some(WechatProgressStage::Searching)),
            None
        );
    }

    #[test]
    fn load_tool_progress_stage_resolves_searching_and_tooling() {
        let db: DbConnection =
            Arc::new(Mutex::new(rusqlite::Connection::open_in_memory().unwrap()));
        {
            let conn = db.lock().unwrap();
            create_tables(&conn).unwrap();
            conn.execute(
                "INSERT INTO agent_sessions (id, model, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params!["session-1", "agent:test", "2026-03-22T00:00:00Z", "2026-03-22T00:00:00Z"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO agent_thread_turns (id, session_id, prompt_text, status, started_at, completed_at, error_message, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?5, ?5)",
                params!["turn-1", "session-1", "hello", "running", "2026-03-22T00:00:01Z"],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO agent_thread_items (id, session_id, turn_id, sequence, item_type, status, started_at, completed_at, updated_at, payload_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?7, ?8)",
                params![
                    "item-1",
                    "session-1",
                    "turn-1",
                    1_i64,
                    "web_search",
                    "in_progress",
                    "2026-03-22T00:00:02Z",
                    "{\"type\":\"web_search\"}"
                ],
            )
            .unwrap();
        }

        let stage = load_tool_progress_stage(&db, "session-1").unwrap();
        assert_eq!(stage, Some(WechatProgressStage::Searching));

        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE agent_thread_items
                 SET item_type = 'tool_call', updated_at = '2026-03-22T00:00:03Z'
                 WHERE id = 'item-1'",
                [],
            )
            .unwrap();
        }

        let stage = load_tool_progress_stage(&db, "session-1").unwrap();
        assert_eq!(stage, Some(WechatProgressStage::Tooling));
    }
}
