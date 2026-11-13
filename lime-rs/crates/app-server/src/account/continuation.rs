use super::{oauth, store, tools::intent::ToolIntent, AccountManager};
use app_server_protocol::protocol::v2::{
    AccountAuthorizationStatus as Status, AccountAuthorizeParams, AccountAuthorizeResponse,
    AuthorizationAction, CloudResource, GetAccountParams, LoginAccountParams,
    METHOD_ACCOUNT_AUTHORIZE,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tool_runtime::tool_executor::RuntimeToolExecutionRequest;

pub(super) const HOST_TIMEOUT: Duration = Duration::from_secs(10);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

impl AccountManager {
    pub(super) async fn authorize_tool_resource(
        &self,
        intent: &ToolIntent,
        resource: CloudResource,
        request: &RuntimeToolExecutionRequest<'_>,
        login_host: Option<&crate::host_request::HostConnection>,
    ) -> Result<Option<crate::host_request::HostConnection>, String> {
        self.check_tool_epoch(intent)?;
        match self.credential(resource, &intent.language).await {
            Ok(_) => return self.check_tool_epoch(intent).map(|_| None),
            Err(error) if error == "resource_login_required" => {}
            Err(error) => return Err(error),
        }
        let thread_id = tool_thread_id(request)?;
        let cancel = request.context.cancel_token();
        let owned_host = if login_host.is_none() {
            Some(self.tool_host(request).await?)
        } else {
            None
        };
        let host = login_host
            .or(owned_host.as_ref())
            .ok_or("account_host_unavailable")?;
        let disconnect = host.disconnect.clone();
        let wait_deadline = tokio::time::Instant::now() + Duration::from_secs(600);
        // This independent OS lease serializes browser handoffs across tools and
        // processes. It never holds the account store lock over network I/O.
        let name = match resource {
            CloudResource::Web => "web",
            CloudResource::Connections => "connections",
            _ => return Err("resource_unavailable".into()),
        };
        let lock_path = self.path.with_file_name(format!("oauth-task-{name}.lock"));
        let _lease = loop {
            self.check_tool_epoch(intent)?;
            check_cancelled(cancel, disconnect.as_ref())?;
            if !host.is_available() {
                return Err("account_host_unavailable".into());
            }
            if tokio::time::Instant::now() >= wait_deadline {
                return Err("authorization_expired".into());
            }
            if let Some(lease) = store::try_lock(&lock_path)? {
                break lease;
            }
            if store::load(&self.path)?.credentials.contains_key(&resource) {
                match self.credential(resource, &intent.language).await {
                    Ok(_) => return self.check_tool_epoch(intent).map(|_| owned_host),
                    Err(error) if error == "resource_login_required" => {}
                    Err(error) => return Err(error),
                }
            }
            wait(cancel, disconnect.as_ref()).await?;
        };
        self.check_tool_epoch(intent)?;
        match self.credential(resource, &intent.language).await {
            Ok(_) => return self.check_tool_epoch(intent).map(|_| owned_host),
            Err(error) if error == "resource_login_required" => {}
            Err(error) => return Err(error),
        }
        check_cancelled(cancel, disconnect.as_ref())?;
        let state = store::load(&self.path)?;
        if state
            .authorizations
            .get(&resource)
            .is_none_or(|a| a.public.status == Status::Completed)
        {
            // A concurrent explicit login may win while configuration is read.
            // Re-read its original transaction instead of replacing it.
            if let Err(error) = self
                .login(LoginAccountParams::Cloud {
                    resource,
                    language: intent.language.clone(),
                    installation: None,
                })
                .await
            {
                if error != "authorization_in_progress" {
                    return Err(error);
                }
            }
        }
        self.check_tool_epoch(intent)?;
        let state = store::load(&self.path)?;
        let authorization = state
            .authorizations
            .get(&resource)
            .ok_or("authorization_not_found")?;
        let id = authorization.public.id.clone();
        self.open_authorization(authorization, thread_id, host, cancel, || {
            self.check_tool_epoch(intent)
        })
        .await?;
        loop {
            check_cancelled(cancel, disconnect.as_ref())?;
            if !host.is_available() {
                return Err("account_host_unavailable".into());
            }
            self.check_tool_epoch(intent)?;
            let read = tokio::select! {
                biased;
                _ = cancelled(cancel) => return Err("cloud_tool_cancelled".into()),
                _ = host.closed() => return Err("account_host_unavailable".into()),
                result = self.read_verified(GetAccountParams { authorization_id: Some(id.clone()) }) => result?,
            };
            self.check_tool_epoch(intent)?;
            let authorization = read
                .authorizations
                .iter()
                .find(|a| a.id == id)
                .ok_or("account_changed")?;
            match authorization.status {
                Status::Completed => {
                    self.credential(resource, &intent.language).await?;
                    check_cancelled(cancel, disconnect.as_ref())?;
                    if !host.is_available() {
                        return Err("account_host_unavailable".into());
                    }
                    return self.check_tool_epoch(intent).map(|_| owned_host);
                }
                Status::Pending | Status::Exchanging => wait(cancel, disconnect.as_ref()).await?,
                Status::Denied => return Err("authorization_rejected".into()),
                Status::Expired => return Err("authorization_expired".into()),
                Status::Cancelled => return Err("cloud_tool_cancelled".into()),
                Status::Failed => return Err("authorization_failed".into()),
                Status::OutcomeUnknown => return Err("outcome_unknown".into()),
            }
        }
    }

    pub(super) async fn tool_host(
        &self,
        request: &RuntimeToolExecutionRequest<'_>,
    ) -> Result<crate::host_request::HostConnection, String> {
        let host = self.host_requests.get().ok_or("account_host_unavailable")?;
        let thread_id = tool_thread_id(request)?;
        tokio::select! {
            biased;
            _ = cancelled(request.context.cancel_token()) => Err("cloud_tool_cancelled".into()),
            result = tokio::time::timeout(HOST_TIMEOUT, host.connection(thread_id)) =>
                result.map_err(|_| "account_host_unavailable")?
                    .map_err(|_| "account_host_unavailable".into()),
        }
    }

    pub(super) async fn open_authorization(
        &self,
        authorization: &store::Authorization,
        thread_id: &str,
        host: &crate::host_request::HostConnection,
        cancel: Option<&CancellationToken>,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        let read = self
            .read_verified(GetAccountParams {
                authorization_id: Some(authorization.public.id.clone()),
            })
            .await?;
        check()?;
        check_cancelled(cancel, host.disconnect.as_ref())?;
        let public = read
            .authorizations
            .into_iter()
            .find(|a| a.id == authorization.public.id)
            .ok_or("account_changed")?;
        if public.status != Status::Pending {
            return Ok(());
        }
        let auth_url = oauth::authorization_url(authorization, None)?;
        let response = tokio::select! {
            biased;
            _ = cancelled(cancel) => return Err("cloud_tool_cancelled".into()),
            _ = host.closed() => return Err("account_host_unavailable".into()),
            result = tokio::time::timeout(HOST_TIMEOUT, host.request(
                METHOD_ACCOUNT_AUTHORIZE,
                serde_json::to_value(AccountAuthorizeParams {
                    thread_id: thread_id.into(), authorization: public, auth_url,
                }).map_err(|_| "cloud_response_invalid")?,
            )) => result.map_err(|_| "account_host_unavailable")?
                .map_err(|_| "account_host_unavailable")?,
        };
        check()?;
        let value: AccountAuthorizeResponse =
            serde_json::from_value(response).map_err(|_| "account_host_invalid_response")?;
        match value.action {
            AuthorizationAction::Opened => Ok(()),
            AuthorizationAction::Cancelled => Err("cloud_tool_cancelled".into()),
            AuthorizationAction::Unavailable => Err("account_host_unavailable".into()),
        }
    }
}

pub(super) fn check_cancelled(
    cancel: Option<&CancellationToken>,
    disconnect: Option<&CancellationToken>,
) -> Result<(), String> {
    if cancel.is_some_and(CancellationToken::is_cancelled) {
        Err("cloud_tool_cancelled".into())
    } else if disconnect.is_some_and(CancellationToken::is_cancelled) {
        Err("account_host_unavailable".into())
    } else {
        Ok(())
    }
}

pub(super) async fn cancelled(token: Option<&CancellationToken>) {
    match token {
        Some(token) => token.cancelled().await,
        None => std::future::pending().await,
    }
}

pub(super) async fn wait(
    cancel: Option<&CancellationToken>,
    disconnect: Option<&CancellationToken>,
) -> Result<(), String> {
    tokio::select! {
        biased;
        _ = cancelled(cancel) => Err("cloud_tool_cancelled".into()),
        _ = cancelled(disconnect) => Err("account_host_unavailable".into()),
        _ = tokio::time::sleep(POLL_INTERVAL) => Ok(()),
    }
}

pub(super) fn tool_thread_id<'a>(
    request: &'a RuntimeToolExecutionRequest<'_>,
) -> Result<&'a str, String> {
    request
        .turn_context
        .and_then(|c| c.metadata.get("app_server_runtime_backend"))
        .and_then(|v| v.get("threadId"))
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "account_host_unavailable".into())
}
