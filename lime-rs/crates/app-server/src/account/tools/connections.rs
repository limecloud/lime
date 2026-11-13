mod types;

use super::{check_cancelled, intent::ToolIntent, journal::CallJournal};
use crate::account::{
    billing,
    continuation::{cancelled, tool_thread_id, wait, HOST_TIMEOUT},
    store, AccountManager,
};
use app_server_protocol::protocol::v2::{
    Account, AuthorizationAction, CloudRequestMethod, CloudRequestParams, CloudRequestResponse,
    CloudResource, ConnectionAuthorizeParams, ConnectionAuthorizeResponse,
    METHOD_CONNECTION_AUTHORIZE,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, time::Duration};
use tool_runtime::connection_file::ReadConnectedFileInput;
use tool_runtime::tool_executor::{RuntimeToolExecutionRequest, RuntimeToolExecutionResult};
use types::Approval;

/// Only immutable command input is saved. Cloud remains the decision and result owner.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ConnectionTask {
    pub key: String,
    pub request: Value,
}

fn file_read_key(key: &str) -> String {
    format!(
        "tool_{}",
        hex::encode(Sha256::digest(format!("connection-file-read.v1:{key}")))
    )
}

fn file_input(intent: &ToolIntent, grant: &str) -> Result<Value, String> {
    let mut body = json!({"contractRevision":types::CONTRACT,"grantId":grant,"fileId":intent.input["fileId"],"maxCharacters":intent.input["maxCharacters"]});
    if let Some(budget) = billing::Budget::parse(&intent.input, "priceVersion", "maxCredits")? {
        body["priceVersion"] = json!(budget.version);
        body["maxCredits"] = json!(budget.maximum.to_string());
    }
    Ok(body)
}

fn tool_result(
    intent: &ToolIntent,
    mut body: Value,
    read_key: Option<&str>,
    recovery_path: &str,
) -> RuntimeToolExecutionResult {
    body["operationKey"] = json!(intent.key);
    body["recoveryPath"] = json!(recovery_path);
    if let Some(key) = read_key {
        body["readOperationKey"] = json!(key);
    }
    RuntimeToolExecutionResult::new(
        body["status"] == "completed",
        body.to_string(),
        None,
        HashMap::from([
            ("tool_family".into(), json!("connection")),
            ("operation_key".into(), json!(intent.key)),
            ("source".into(), json!("lime-cloud")),
        ]),
    )
}

impl AccountManager {
    pub(super) async fn execute_connection_tool(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, String> {
        let (input, file) = ReadConnectedFileInput::parse(request.params)?;
        let budget = billing::Budget::parse(request.params, "price_version", "max_credits")?;
        // Sharing parameters and an explicit default limit identify the same document request.
        let mut params = json!({
            "url":format!("https://docs.google.com/document/d/{file}/edit"),
            "max_characters":input.max_characters,
        });
        if let Some(key) = &input.operation_key {
            params["operation_key"] = json!(key);
        }
        let mut prepared = json!({"fileId":file,"maxCharacters":input.max_characters});
        if let Some(budget) = budget {
            params["price_version"] = json!(budget.version);
            params["max_credits"] = json!(budget.maximum.to_string());
            prepared["priceVersion"] = params["price_version"].clone();
            prepared["maxCredits"] = params["max_credits"].clone();
        }
        let request = RuntimeToolExecutionRequest {
            tool_name: request.tool_name,
            params: &params,
            context: request.context,
            turn_context: request.turn_context,
        };
        let (epoch, login_host) = self
            .login_for_tool(&request, "/connection-requests", &prepared)
            .await?;
        let intent = self.bind_tool_call(
            &request,
            CloudResource::Connections,
            "/connection-requests",
            prepared,
            &epoch,
        )?;
        let result = self
            .connection_tool_result(&intent, &input, &file, &request, login_host.as_ref())
            .await;
        match result {
            Ok(result) => Ok(result),
            Err(error) => {
                self.check_tool_epoch(&intent)?;
                if matches!(
                    error.as_str(),
                    "cloud_tool_cancelled" | "operation_key_conflict"
                ) {
                    return Err(error);
                }
                let account = self
                    .read(Default::default())?
                    .account
                    .ok_or("account_login_required")?;
                if self.operation(&account, &intent.key)?.is_none() {
                    return Err(error);
                }
                let error = match error.as_str() {
                    "connection_authorization_rejected"
                    | "connection_request_expired"
                    | "connection_authorization_unavailable"
                    | "connection_response_invalid"
                    | "account_host_unavailable"
                    | "product_user_disabled"
                    | "outcome_unknown"
                    | "operation_store_invalid" => error,
                    _ => "cloud_unavailable".into(),
                };
                let read_key = file_read_key(&intent.key);
                let read = self.operation(&account, &read_key)?;
                let summary = if error == "product_user_disabled" {
                    let key = if read.is_some() {
                        &read_key
                    } else {
                        &intent.key
                    };
                    let response = self.recover_tool_request(&intent, key, &request).await;
                    check_cancelled(&request)?;
                    self.check_tool_epoch(&intent)?;
                    Some(match response {
                        Ok(response) => super::restricted_result(response),
                        Err(error) => {
                            json!({"status":"outcome_unknown","recoveryOnly":true,"errorCode":super::recovery_error(&error)})
                        }
                    })
                } else {
                    None
                };
                let recovery_path = read
                    .as_ref()
                    .map(|record| record.recovery_path.clone())
                    .unwrap_or_else(|| format!("/connection-requests/operations/{}", intent.key));
                let body = summary
                    .unwrap_or_else(|| json!({"status":"outcome_unknown","errorCode":error}));
                Ok(tool_result(
                    &intent,
                    body,
                    read.as_ref().map(|_| read_key.as_str()),
                    &recovery_path,
                ))
            }
        }
    }

    async fn connection_tool_result(
        &self,
        intent: &ToolIntent,
        input: &ReadConnectedFileInput,
        file: &str,
        request: &RuntimeToolExecutionRequest<'_>,
        login_host: Option<&crate::host_request::HostConnection>,
    ) -> Result<RuntimeToolExecutionResult, String> {
        let authorization_host = self
            .authorize_tool_resource(intent, CloudResource::Connections, request, login_host)
            .await?;
        let host = login_host.or(authorization_host.as_ref());
        self.check_connection_tool(&intent, &request, host)?;
        self.ensure_product_user(&intent.language, &intent.epoch)
            .await?;
        self.check_connection_tool(&intent, &request, host)?;
        // A task lease serializes two model calls which resolve to the same original input.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
        let _lease = loop {
            self.check_connection_tool(&intent, &request, host)?;
            if tokio::time::Instant::now() >= deadline {
                return Err("connection_request_expired".into());
            }
            if let Some(lease) = store::try_lock(
                &self
                    .path
                    .with_file_name(format!("connection-{}.lock", intent.key)),
            )? {
                break lease;
            }
            wait(
                request.context.cancel_token(),
                host.and_then(|h| h.disconnect.as_ref()),
            )
            .await?;
        };
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        let read_key = file_read_key(&intent.key);
        if let Some(original) = self
            .operation(&account, &read_key)?
            .filter(|record| record.status == "rejected")
        {
            let code = original
                .rejection_code
                .as_deref()
                .ok_or("operation_store_invalid")?;
            let body = json!({"error":code});
            let grant = original.input["grantId"]
                .as_str()
                .filter(|value| crate::account::cloud::identifier(value))
                .ok_or("operation_store_invalid")?;
            if original.key != read_key
                || original.task_id != intent.task_id
                || original.input != file_input(intent, grant)?
                || original.recovery_path
                    != format!("/connection-file-operations/operations/{read_key}")
                || billing::rejection(&original.path, 409, &body).is_none()
            {
                return Err("operation_store_invalid".into());
            }
            self.finish_tool_call(intent)?;
            return Ok(tool_result(
                intent,
                json!({"status":"failed","errorCode":code,"executionStarted":false}),
                Some(&read_key),
                &original.recovery_path,
            ));
        }
        if self.operation(&account, &intent.key)?.is_none() {
            if request.params.get("operation_key").is_some() {
                return Err("outcome_unknown".into());
            }
            let prices = self
                .connection_dispatch(
                    intent,
                    CloudRequestMethod::Get,
                    "/connection-file-prices",
                    None,
                    None,
                    request,
                    host,
                )
                .await?;
            if prices.status != 200 {
                return Err(super::http_error(&prices).into());
            }
            if let Some(acceptance) = billing::file_acceptance(&intent.input, prices.body)? {
                self.finish_tool_call(intent)?;
                return Ok(RuntimeToolExecutionResult::new(
                    false,
                    acceptance.to_string(),
                    None,
                    HashMap::from([
                        ("tool_family".into(), json!("connection")),
                        ("source".into(), json!("lime-cloud")),
                    ]),
                ));
            }
        }
        let task = self.connection_task(&intent, &file)?;
        let expires = DateTime::parse_from_rfc3339(
            task.request["expiresAt"]
                .as_str()
                .ok_or("operation_store_invalid")?,
        )
        .map_err(|_| "operation_store_invalid")?
        .with_timezone(&Utc);
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        let Account::Cloud { environment, .. } = account;
        let response = self
            .connection_step(
                &intent,
                &intent.key,
                "/connection-requests",
                task.request.clone(),
                &request,
                host,
            )
            .await?;
        let mut approval = self.connection_approval(response, &file, &expires, &environment)?;
        let request_id = approval.id.clone();
        let approval_host;
        if approval.status == "pending" {
            if approval.expires_at <= Utc::now() {
                return Err("connection_request_expired".into());
            }
            approval_host = if host.is_none() {
                Some(self.tool_host(&request).await?)
            } else {
                None
            };
            let host = host
                .or(approval_host.as_ref())
                .ok_or("account_host_unavailable")?;
            self.open_connection_approval(&intent, &approval, &environment, &request, host)
                .await?;
            loop {
                self.check_connection_tool(&intent, &request, Some(host))?;
                if tokio::time::Instant::now() >= deadline || approval.expires_at <= Utc::now() {
                    return Err("connection_request_expired".into());
                }
                wait(request.context.cancel_token(), host.disconnect.as_ref()).await?;
                let response = self
                    .connection_dispatch(
                        &intent,
                        CloudRequestMethod::Get,
                        &format!("/connection-requests/{request_id}"),
                        None,
                        None,
                        &request,
                        Some(host),
                    )
                    .await?;
                approval = self.connection_approval(response, &file, &expires, &environment)?;
                if approval.id != request_id {
                    return Err("connection_response_invalid".into());
                }
                if approval.status != "pending" {
                    break;
                }
            }
        } else {
            approval_host = None;
        }
        let host = host.or(approval_host.as_ref());
        match approval.status.as_str() {
            "approved" => {}
            "denied" | "expired" | "consumer_unavailable" => {
                let error = match approval.status.as_str() {
                    "denied" => "connection_authorization_rejected",
                    "expired" => "connection_request_expired",
                    _ => "connection_authorization_unavailable",
                };
                // Only a validated Cloud decision releases the pending binding.
                // Local timeouts and authorization failures retain the original operation.
                self.finish_tool_call(intent)?;
                return Ok(tool_result(
                    intent,
                    json!({"status":"failed","errorCode":error,"requestId":request_id}),
                    None,
                    &format!("/connection-requests/operations/{}", intent.key),
                ));
            }
            _ => return Err("connection_response_invalid".into()),
        }
        let read_key = file_read_key(&intent.key);
        let path = format!(
            "/connections/{}/file-reads",
            approval
                .connection_id
                .as_deref()
                .ok_or("connection_response_invalid")?
        );
        let body = file_input(
            intent,
            approval
                .grant_id
                .as_deref()
                .ok_or("connection_response_invalid")?,
        )?;
        let mut response = self
            .connection_step(&intent, &read_key, &path, body, &request, host)
            .await?;
        if let Some(code) = billing::rejection(&path, response.status, &response.body) {
            self.finish_tool_call(intent)?;
            return Ok(tool_result(
                intent,
                json!({"status":"failed","errorCode":code,"executionStarted":false}),
                Some(&read_key),
                &format!("/connection-file-operations/operations/{read_key}"),
            ));
        }
        // Poll only the original key. Unknown, malformed and missing reads never permit another POST.
        for _ in 0..4 {
            if response.status != 502
                && response.status != 409
                && !(response.status == 200
                    && matches!(
                        response.body["status"].as_str(),
                        Some("running" | "outcome_unknown")
                    ))
            {
                break;
            }
            wait(
                request.context.cancel_token(),
                host.and_then(|h| h.disconnect.as_ref()),
            )
            .await?;
            response = self
                .connection_dispatch(
                    &intent,
                    CloudRequestMethod::Get,
                    &format!("/connection-file-operations/operations/{read_key}"),
                    None,
                    None,
                    &request,
                    host,
                )
                .await?;
        }
        self.check_connection_tool(&intent, &request, host)?;
        let mut result = if response.status == 200 {
            types::file_result(
                response.body,
                &approval,
                &file,
                input.max_characters,
                &intent.input,
            )?
        } else {
            json!({"status":"outcome_unknown","errorCode":super::http_error(&response),"httpStatus":response.status})
        };
        // Definite terminal file outcomes allow a later new user request; the original binding never changes.
        if matches!(
            result["status"].as_str(),
            Some("completed" | "failed" | "result_expired")
        ) {
            self.finish_tool_call(&intent)?;
        }
        result["requestId"] = json!(request_id);
        Ok(tool_result(
            intent,
            result,
            Some(&read_key),
            &format!("/connection-file-operations/operations/{read_key}"),
        ))
    }

    fn connection_task(&self, intent: &ToolIntent, file: &str) -> Result<ConnectionTask, String> {
        store::with_lock(&self.path, || {
            self.check_tool_epoch(intent)?;
            let journal = CallJournal::new(&self.path)?;
            if let Some(task) = journal.connection(&intent.key)? {
                if task.request["connector"] != "google-drive"
                    || task.request["actions"] != json!(["drive.files.read"])
                    || task.request["fileIds"] != json!([file])
                    || task.request.as_object().is_none_or(|o| o.len() != 4)
                    || !task.request["expiresAt"]
                        .as_str()
                        .is_some_and(|at| DateTime::parse_from_rfc3339(at).is_ok())
                {
                    return Err("operation_store_invalid".into());
                }
                return Ok(task);
            }
            let snapshot = store::load(&self.path)?;
            let Account::Cloud { environment, .. } =
                snapshot.account.as_ref().ok_or("account_login_required")?;
            let now = Utc::now();
            let mut expires = now + chrono::Duration::minutes(30);
            if environment == "sandbox" {
                let limit = snapshot
                    .credentials
                    .get(&CloudResource::Connections)
                    .and_then(|credential| credential.authorization_expires_at)
                    .and_then(|expires| DateTime::from_timestamp(expires, 0))
                    .ok_or("connection_authorization_unavailable")?;
                expires = expires.min(limit);
            }
            if expires <= now {
                return Err("connection_request_expired".into());
            }
            let expires = expires.to_rfc3339_opts(SecondsFormat::Secs, true);
            let task = ConnectionTask {
                key: intent.key.clone(),
                request: json!({"connector":"google-drive","actions":["drive.files.read"],"fileIds":[file],"expiresAt":expires}),
            };
            journal.save_connection(&task)?;
            Ok(task)
        })
    }

    fn check_connection_tool(
        &self,
        intent: &ToolIntent,
        request: &RuntimeToolExecutionRequest<'_>,
        host: Option<&crate::host_request::HostConnection>,
    ) -> Result<(), String> {
        check_cancelled(request)?;
        if host.is_some_and(|h| !h.is_available()) {
            return Err("account_host_unavailable".into());
        }
        self.check_tool_epoch(intent)
    }

    async fn connection_step(
        &self,
        intent: &ToolIntent,
        key: &str,
        path: &str,
        body: Value,
        request: &RuntimeToolExecutionRequest<'_>,
        host: Option<&crate::host_request::HostConnection>,
    ) -> Result<CloudRequestResponse, String> {
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        if let Some(original) = self.operation(&account, key)? {
            if original.task_id != intent.task_id || original.path != path || original.input != body
            {
                return Err("operation_key_conflict".into());
            }
            if original.status == "rejected" {
                let code = original
                    .rejection_code
                    .as_deref()
                    .filter(|code| billing::budget_error(code))
                    .ok_or("operation_store_invalid")?;
                let body = json!({"error":code});
                if billing::rejection(path, 409, &body).is_none() {
                    return Err("operation_store_invalid".into());
                }
                return Ok(CloudRequestResponse {
                    account,
                    status: 409,
                    body,
                    operation: None,
                });
            }
            self.connection_dispatch(
                intent,
                CloudRequestMethod::Get,
                &original.recovery_path,
                None,
                None,
                request,
                host,
            )
            .await
        } else {
            if key == intent.key && request.params.get("operation_key").is_some() {
                return Err("outcome_unknown".into());
            }
            if path == "/connection-requests"
                && !body["expiresAt"]
                    .as_str()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .is_some_and(|at| at > Utc::now())
            {
                return Err("connection_request_expired".into());
            }
            self.connection_dispatch(
                intent,
                CloudRequestMethod::Post,
                path,
                Some(body),
                Some(key),
                request,
                host,
            )
            .await
        }
    }

    async fn connection_dispatch(
        &self,
        intent: &ToolIntent,
        method: CloudRequestMethod,
        path: &str,
        body: Option<Value>,
        key: Option<&str>,
        request: &RuntimeToolExecutionRequest<'_>,
        host: Option<&crate::host_request::HostConnection>,
    ) -> Result<CloudRequestResponse, String> {
        self.check_connection_tool(intent, request, host)?;
        let result = self
            .dispatch_with_cancel(
                CloudRequestParams {
                    path: path.into(),
                    method,
                    body,
                    language: intent.language.clone(),
                    operation_key: key.map(str::to_owned),
                    task_id: key.map(|_| intent.task_id.clone()),
                },
                &intent.epoch,
                request.context.cancel_token(),
            )
            .await?;
        self.check_connection_tool(intent, request, host)?;
        if super::product_disabled(&result) {
            return Err("product_user_disabled".into());
        }
        Ok(result)
    }

    fn connection_approval(
        &self,
        response: CloudRequestResponse,
        file: &str,
        expires: &DateTime<Utc>,
        environment: &str,
    ) -> Result<Approval, String> {
        if response.status != 200 {
            return Err(if matches!(response.status, 401 | 403) {
                "connection_authorization_unavailable"
            } else {
                "outcome_unknown"
            }
            .into());
        }
        Approval::parse(response.body, file, expires, environment)
    }

    async fn open_connection_approval(
        &self,
        intent: &ToolIntent,
        approval: &Approval,
        environment: &str,
        request: &RuntimeToolExecutionRequest<'_>,
        host: &crate::host_request::HostConnection,
    ) -> Result<(), String> {
        self.check_connection_tool(intent, request, Some(host))?;
        let params = ConnectionAuthorizeParams {
            thread_id: tool_thread_id(request)?.into(),
            request_id: approval.id.clone(),
            approval_url: approval
                .approval_url
                .clone()
                .ok_or("connection_response_invalid")?,
            expires_at: approval.expires_at.to_rfc3339(),
            environment: environment.into(),
        };
        let response = tokio::select! {
            biased;
            _ = cancelled(request.context.cancel_token()) => return Err("cloud_tool_cancelled".into()),
            _ = host.closed() => return Err("account_host_unavailable".into()),
            result = tokio::time::timeout(HOST_TIMEOUT,host.request(METHOD_CONNECTION_AUTHORIZE,serde_json::to_value(params).map_err(|_|"connection_response_invalid")?)) => result.map_err(|_|"account_host_unavailable")?.map_err(|_|"account_host_unavailable")?,
        };
        self.check_connection_tool(intent, request, Some(host))?;
        let response: ConnectionAuthorizeResponse =
            serde_json::from_value(response).map_err(|_| "account_host_invalid_response")?;
        match response.action {
            AuthorizationAction::Opened => Ok(()),
            AuthorizationAction::Cancelled => Err("cloud_tool_cancelled".into()),
            AuthorizationAction::Unavailable => Err("account_host_unavailable".into()),
        }
    }
}
