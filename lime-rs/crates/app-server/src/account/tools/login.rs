use super::{intent::tool_call, journal::CallJournal};
use crate::account::{
    configured_language,
    continuation::{cancelled, check_cancelled, tool_thread_id, wait},
    store, AccountManager,
};
use app_server_protocol::protocol::v2::{
    Account, AccountAuthorizationStatus as Status, CloudResource, GetAccountParams,
    LoginAccountParams,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tool_runtime::tool_executor::RuntimeToolExecutionRequest;

/// The anonymous call is durable before any login I/O. It can adopt only its
/// exact default authorization's verified identity, then keeps that epoch.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LoginTask {
    pub key: String,
    session_id: String,
    tool: String,
    arguments: Value,
    path: String,
    input: Value,
    epoch: String,
    service_url: String,
    language: String,
    authorization_id: String,
    authenticated_epoch: Option<String>,
}

impl LoginTask {
    fn matches_authorization(&self, authorization: &store::Authorization) -> bool {
        authorization.parent_epoch == self.epoch
            && authorization.base_url == self.service_url
            && authorization.public.id == self.authorization_id
    }
}

impl AccountManager {
    pub(super) async fn login_for_tool(
        &self,
        request: &RuntimeToolExecutionRequest<'_>,
        path: &str,
        input: &Value,
    ) -> Result<(String, Option<crate::host_request::HostConnection>), String> {
        let (key, arguments) = tool_call(request)?;
        let (task, epoch) = store::update(&self.path, |state| {
            let journal = CallJournal::new(&self.path)?;
            if let Some(task) = journal.login(&key)? {
                if task.session_id != request.context.session_id()
                    || task.tool != request.tool_name
                    || task.arguments != arguments
                    || task.path != path
                    || &task.input != input
                {
                    return Err("operation_key_conflict".into());
                }
                return Ok((Some(task), state.epoch.clone()));
            }
            if state.account.is_some() {
                return Ok((None, state.epoch.clone()));
            }
            // Old signed calls and explicit recovery keys cannot sign into a
            // different identity after logout in order to replay an operation.
            if request.params.get("operation_key").is_some()
                || journal.binding(&key)?.is_some()
                || journal.intent(&key)?.is_some()
            {
                return Err("account_changed".into());
            }
            let service_url = self
                .service_url(state)?
                .ok_or("account_service_unconfigured")?;
            if state
                .tool_login
                .as_ref()
                .is_none_or(|claim| claim.base_url != service_url)
            {
                state.tool_login = Some(store::ToolLogin {
                    id: uuid::Uuid::new_v4().to_string(),
                    base_url: service_url.clone(),
                });
            }
            let authorization_id = state
                .tool_login
                .as_ref()
                .ok_or("account_store_invalid")?
                .id
                .clone();
            let task = LoginTask {
                key: key.clone(),
                session_id: request.context.session_id().into(),
                tool: request.tool_name.into(),
                arguments: arguments.clone(),
                path: path.into(),
                input: input.clone(),
                epoch: state.epoch.clone(),
                service_url,
                language: configured_language(&self.config_path)?,
                authorization_id,
                authenticated_epoch: None,
            };
            journal.save_login(&task)?;
            Ok((Some(task), state.epoch.clone()))
        })?;
        let Some(task) = task else {
            return Ok((epoch, None));
        };
        if let Some(epoch) = self.login_task_epoch(&key)? {
            return Ok((epoch, None));
        }
        if let Some(authorization) = store::load(&self.path)?
            .authorizations
            .get(&CloudResource::Default)
        {
            if !task.matches_authorization(authorization) {
                return Err("account_changed".into());
            }
            // Recover a saved exchange result before requiring a browser host.
            // Terminal transactions need no new handoff or code submission.
            let read = self
                .read_verified(GetAccountParams {
                    authorization_id: Some(authorization.public.id.clone()),
                })
                .await?;
            if let Some(epoch) = self.login_task_epoch(&key)? {
                return Ok((epoch, None));
            }
            match read
                .authorizations
                .iter()
                .find(|a| a.id == task.authorization_id)
                .ok_or("account_changed")?
                .status
            {
                Status::Pending | Status::Exchanging => {}
                Status::Denied => return Err("authorization_rejected".into()),
                Status::Expired => return Err("authorization_expired".into()),
                Status::Cancelled => return Err("cloud_tool_cancelled".into()),
                Status::Failed => return Err("authorization_failed".into()),
                Status::OutcomeUnknown => return Err("outcome_unknown".into()),
                Status::Completed => return Err("account_changed".into()),
            }
        }
        let host = self.tool_host(request).await?;
        let cancel = request.context.cancel_token();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
        let _lease = loop {
            if let Some(epoch) = self.login_task_epoch(&key)? {
                return Ok((epoch, Some(host)));
            }
            check_cancelled(cancel, host.disconnect.as_ref())?;
            if !host.is_available() {
                return Err("account_host_unavailable".into());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("authorization_expired".into());
            }
            if let Some(lease) =
                store::try_lock(&self.path.with_file_name("oauth-task-default.lock"))?
            {
                break lease;
            }
            wait(cancel, host.disconnect.as_ref()).await?;
        };
        if let Some(epoch) = self.login_task_epoch(&key)? {
            return Ok((epoch, Some(host)));
        }
        if store::load(&self.path)?
            .authorizations
            .get(&CloudResource::Default)
            .is_none()
        {
            if let Err(error) = self
                .login_bound(
                    LoginAccountParams::Cloud {
                        resource: CloudResource::Default,
                        language: task.language.clone(),
                        installation: None,
                    },
                    Some((&task.epoch, &task.service_url, &task.authorization_id)),
                )
                .await
            {
                if error != "authorization_in_progress" {
                    return Err(error);
                }
            }
        }
        let state = store::load(&self.path)?;
        let authorization = state
            .authorizations
            .get(&CloudResource::Default)
            .ok_or("authorization_not_found")?;
        if !task.matches_authorization(authorization) {
            return Err("account_changed".into());
        }
        self.open_authorization(
            authorization,
            tool_thread_id(request)?,
            &host,
            cancel,
            || self.login_task_epoch(&key).map(|_| ()),
        )
        .await?;
        loop {
            check_cancelled(cancel, host.disconnect.as_ref())?;
            if !host.is_available() {
                return Err("account_host_unavailable".into());
            }
            if let Some(epoch) = self.login_task_epoch(&key)? {
                self.credential(CloudResource::Default, &task.language)
                    .await?;
                if self.login_task_epoch(&key)?.as_deref() != Some(&epoch) {
                    return Err("account_changed".into());
                }
                return Ok((epoch, Some(host)));
            }
            let read = tokio::select! {
                biased;
                _ = cancelled(cancel) => return Err("cloud_tool_cancelled".into()),
                _ = host.closed() => return Err("account_host_unavailable".into()),
                result = self.read_verified(GetAccountParams { authorization_id: Some(authorization.public.id.clone()) }) => result?,
            };
            match read
                .authorizations
                .iter()
                .find(|a| a.id == authorization.public.id)
                .ok_or("account_changed")?
                .status
            {
                Status::Pending | Status::Exchanging | Status::Completed => {
                    wait(cancel, host.disconnect.as_ref()).await?
                }
                Status::Denied => return Err("authorization_rejected".into()),
                Status::Expired => return Err("authorization_expired".into()),
                Status::Cancelled => return Err("cloud_tool_cancelled".into()),
                Status::Failed => return Err("authorization_failed".into()),
                Status::OutcomeUnknown => return Err("outcome_unknown".into()),
            }
        }
    }

    fn login_task_epoch(&self, key: &str) -> Result<Option<String>, String> {
        store::with_lock(&self.path, || {
            let state = store::load(&self.path)?;
            let journal = CallJournal::new(&self.path)?;
            let mut task = journal.login(key)?.ok_or("operation_store_invalid")?;
            if let Some(epoch) = &task.authenticated_epoch {
                return if &state.epoch == epoch && state.account.is_some() {
                    Ok(Some(epoch.clone()))
                } else {
                    Err("account_changed".into())
                };
            }
            if state.epoch == task.epoch && state.account.is_none() {
                return Ok(None);
            }
            let authorization = state
                .authorizations
                .get(&CloudResource::Default)
                .ok_or("account_changed")?;
            if !task.matches_authorization(authorization)
                || authorization.public.status != Status::Completed
                || !matches!(&state.account, Some(Account::Cloud {generation, ..}) if generation == &state.epoch)
            {
                return Err("account_changed".into());
            }
            task.authenticated_epoch = Some(state.epoch.clone());
            journal.save_login(&task)?;
            Ok(Some(state.epoch))
        })
    }
}
