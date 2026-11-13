mod connections;
pub(super) mod intent;
mod journal;
mod login;
mod web;

use super::{billing, AccountManager};
use app_server_protocol::protocol::v2::{
    CloudRequestMethod, CloudRequestParams, CloudRequestResponse, CloudResource,
};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tool_runtime::{
    gateway_dispatch_execution::RuntimeGatewayToolExecutionRegistration,
    tool_executor::{
        RuntimeToolExecutionError, RuntimeToolExecutionFuture, RuntimeToolExecutionRequest,
        RuntimeToolExecutionResult, RuntimeToolExecutor, RuntimeToolExecutorHandle,
        RuntimeToolPolicyErrorKind,
    },
};

impl AccountManager {
    pub(crate) fn tool_registrations(
        self: &Arc<Self>,
    ) -> Vec<RuntimeGatewayToolExecutionRegistration> {
        let executor = RuntimeToolExecutorHandle::new(self.clone());
        vec![
            RuntimeGatewayToolExecutionRegistration::new(
                billing::tool_definition(tool_runtime::web_search::web_search_tool_definition()),
                executor.clone(),
                &["WebSearchTool", "mcp__system__web_search"],
            ),
            RuntimeGatewayToolExecutionRegistration::new(
                billing::tool_definition(tool_runtime::web_fetch::web_fetch_tool_definition()),
                executor.clone(),
                &["WebFetchTool", "mcp__system__web_fetch"],
            ),
            RuntimeGatewayToolExecutionRegistration::new(
                billing::tool_definition(
                    tool_runtime::connection_file::connected_file_tool_definition(),
                ),
                executor,
                &[],
            ),
        ]
    }

    async fn execute_account_tool(
        &self,
        request: RuntimeToolExecutionRequest<'_>,
    ) -> Result<RuntimeToolExecutionResult, String> {
        check_cancelled(&request)?;
        if request.tool_name == tool_runtime::connection_file::READ_CONNECTED_FILE_TOOL_NAME {
            return self.execute_connection_tool(request).await;
        }
        // Cached/indexed access never silently becomes a live, possibly billable request.
        if request
            .turn_context
            .and_then(|c| c.web_search_mode)
            .unwrap_or_default()
            != agent_protocol::WebSearchMode::Live
        {
            return Err("web_live_access_required".into());
        }
        let prepared = web::prepare(&request)?;
        let (epoch, login_host) = self
            .login_for_tool(&request, prepared.path, &prepared.input)
            .await?;
        let intent = self.bind_tool_call(
            &request,
            CloudResource::Web,
            prepared.path,
            prepared.input,
            &epoch,
        )?;
        let result = self
            .web_tool_result(&intent, &request, login_host.as_ref())
            .await;
        check_cancelled(&request)?;
        self.check_tool_epoch(&intent)?;
        let result = result.and_then(|body| {
            if matches!(body["status"].as_str(), Some("completed" | "failed"))
                || body["executionStarted"] == false
            {
                self.finish_tool_call(&intent)?;
            }
            Ok(body)
        });
        let mut body = match result {
            Ok(body) => body,
            Err(error) => {
                if error == "operation_key_conflict" {
                    return Err(error);
                }
                let account = self
                    .read(Default::default())?
                    .account
                    .ok_or("account_login_required")?;
                if self.operation(&account, &intent.key)?.is_none() {
                    return Err(error);
                }
                // A broken recovery read must not hide the key of a dispatched command.
                json!({"status":"outcome_unknown","errorCode":recovery_error(&error)})
            }
        };
        if body["executionStarted"] != false {
            body["operationKey"] = json!(intent.key);
            body["recoveryPath"] = json!(format!("/web/operations/{}", intent.key));
        }
        let success = body["status"] == "completed";
        let output = serde_json::to_string(&body).map_err(|_| "cloud_response_invalid")?;
        Ok(RuntimeToolExecutionResult::new(
            success,
            output,
            None,
            HashMap::from([
                ("tool_family".into(), json!("web")),
                ("operation_key".into(), json!(intent.key)),
                ("source".into(), json!("lime-cloud")),
            ]),
        ))
    }

    async fn web_tool_result(
        &self,
        intent: &intent::ToolIntent,
        request: &RuntimeToolExecutionRequest<'_>,
        login_host: Option<&crate::host_request::HostConnection>,
    ) -> Result<Value, String> {
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        let previous = self.operation(&account, &intent.key)?;
        let (mut response, mut recovery_only) = if let Some(original) = previous {
            if original.task_id != intent.task_id
                || original.path != intent.path
                || original.input != intent.input
            {
                return Err("operation_key_conflict".into());
            }
            if original.status == "rejected" {
                let code = original
                    .rejection_code
                    .as_deref()
                    .filter(|code| billing::budget_error(code))
                    .ok_or("operation_store_invalid")?;
                return Ok(json!({"status":"failed","errorCode":code,"executionStarted":false}));
            }
            self.tool_request(
                intent,
                CloudRequestMethod::Get,
                &original.recovery_path,
                None,
                request,
                login_host,
            )
            .await?
        } else {
            if request.params.get("operation_key").is_some() {
                return Err("outcome_unknown".into());
            }
            let (prices, recovery_only) = self
                .tool_request(
                    intent,
                    CloudRequestMethod::Get,
                    "/web/prices",
                    None,
                    request,
                    login_host,
                )
                .await?;
            if recovery_only {
                return Ok(restricted_result(prices));
            }
            if prices.status != 200 {
                return Err(http_error(&prices).into());
            }
            if let Some(acceptance) = billing::acceptance(&intent.path, &intent.input, prices.body)?
            {
                return Ok(acceptance);
            }
            self.tool_request(
                intent,
                CloudRequestMethod::Post,
                &intent.path,
                Some(intent.input.clone()),
                request,
                login_host,
            )
            .await?
        };
        if let Some(code) = billing::rejection(&intent.path, response.status, &response.body) {
            return Ok(json!({"status":"failed","errorCode":code,"executionStarted":false}));
        }
        // Only read the original operation. Missing/unknown reads never authorize another POST.
        for _ in 0..4 {
            check_cancelled(request)?;
            if recovery_only {
                break;
            }
            if response.status == 200
                && !matches!(
                    response.body["status"].as_str(),
                    Some("running" | "outcome_unknown")
                )
            {
                break;
            }
            if response.status != 502 && response.status != 409 && response.status != 200 {
                break;
            }
            wait_for_poll(request).await?;
            (response, recovery_only) = self
                .tool_request(
                    intent,
                    CloudRequestMethod::Get,
                    &format!("/web/operations/{}", intent.key),
                    None,
                    request,
                    login_host,
                )
                .await?;
        }
        if recovery_only {
            Ok(restricted_result(response))
        } else if response.status == 200 {
            web::project(request, response.body)
        } else {
            // HTTP status and stable codes are sufficient for recovery. Do not surface arbitrary error bodies.
            Ok(
                json!({"status":"outcome_unknown","errorCode":http_error(&response),"httpStatus":response.status}),
            )
        }
    }

    async fn tool_request(
        &self,
        intent: &intent::ToolIntent,
        method: CloudRequestMethod,
        path: &str,
        body: Option<Value>,
        request: &RuntimeToolExecutionRequest<'_>,
        login_host: Option<&crate::host_request::HostConnection>,
    ) -> Result<(CloudRequestResponse, bool), String> {
        self.check_tool_epoch(intent)?;
        if login_host.is_some_and(|host| !host.is_available()) {
            return Err("account_host_unavailable".into());
        }
        let authorization_host = self
            .authorize_tool_resource(intent, CloudResource::Web, request, login_host)
            .await?;
        check_cancelled(request)?;
        match self
            .ensure_product_user(&intent.language, &intent.epoch)
            .await
        {
            Ok(()) => {}
            Err(error) if error == "product_user_disabled" => {
                return self
                    .recover_tool_request(intent, &intent.key, request)
                    .await
                    .map(|response| (response, true));
            }
            Err(error) => return Err(error),
        }
        check_cancelled(request)?;
        if login_host.is_some_and(|host| !host.is_available())
            || authorization_host
                .as_ref()
                .is_some_and(|host| !host.is_available())
        {
            return Err("account_host_unavailable".into());
        }
        let response = self
            .dispatch_with_cancel(
                CloudRequestParams {
                    path: path.into(),
                    method,
                    body,
                    language: intent.language.clone(),
                    operation_key: (method == CloudRequestMethod::Post).then(|| intent.key.clone()),
                    task_id: (method == CloudRequestMethod::Post).then(|| intent.task_id.clone()),
                },
                &intent.epoch,
                request.context.cancel_token(),
            )
            .await?;
        if product_disabled(&response) {
            return self
                .recover_tool_request(intent, &intent.key, request)
                .await
                .map(|response| (response, true));
        }
        Ok((response, false))
    }

    async fn recover_tool_request(
        &self,
        intent: &intent::ToolIntent,
        key: &str,
        request: &RuntimeToolExecutionRequest<'_>,
    ) -> Result<CloudRequestResponse, String> {
        check_cancelled(request)?;
        self.check_tool_epoch(intent)?;
        let account = self
            .read(Default::default())?
            .account
            .ok_or("account_login_required")?;
        let original = self
            .operation(&account, key)?
            .ok_or("product_user_disabled")?;
        if original.task_id != intent.task_id {
            return Err("operation_key_conflict".into());
        }
        if key == intent.key {
            let expected = if intent.path == "/connection-requests" {
                journal::CallJournal::new(&self.path)?
                    .connection(key)?
                    .ok_or("operation_store_invalid")?
                    .request
            } else {
                intent.input.clone()
            };
            if original.path != intent.path || original.input != expected {
                return Err("operation_key_conflict".into());
            }
        }
        self.dispatch_with_cancel(
            CloudRequestParams {
                path: super::recovery::summary_path(&original)?,
                method: CloudRequestMethod::Get,
                body: None,
                language: intent.language.clone(),
                operation_key: None,
                task_id: None,
            },
            &intent.epoch,
            request.context.cancel_token(),
        )
        .await
    }
}

fn product_disabled(response: &CloudRequestResponse) -> bool {
    response.status == 403 && response.body["error"] == "product_user_disabled"
}

fn restricted_result(response: CloudRequestResponse) -> Value {
    if response.status == 200 {
        json!({"status":"outcome_unknown","recoveryOnly":true,"summary":response.body})
    } else {
        json!({"status":"outcome_unknown","recoveryOnly":true,"errorCode":http_error(&response),"httpStatus":response.status})
    }
}

impl RuntimeToolExecutor for AccountManager {
    fn execute<'a>(
        &'a self,
        request: RuntimeToolExecutionRequest<'a>,
    ) -> RuntimeToolExecutionFuture<'a> {
        Box::pin(async move {
            self.execute_account_tool(request).await.map_err(|code| {
                let kind = if code == "cloud_tool_cancelled" {
                    RuntimeToolPolicyErrorKind::Canceled(code.clone())
                } else {
                    RuntimeToolPolicyErrorKind::ExecutionFailed(code.clone())
                };
                RuntimeToolExecutionError::new(code, Some(kind))
            })
        })
    }
}

fn check_cancelled(request: &RuntimeToolExecutionRequest<'_>) -> Result<(), String> {
    if request
        .context
        .cancel_token()
        .is_some_and(|t| t.is_cancelled())
    {
        Err("cloud_tool_cancelled".into())
    } else {
        Ok(())
    }
}

async fn wait_for_poll(request: &RuntimeToolExecutionRequest<'_>) -> Result<(), String> {
    if let Some(token) = request.context.cancel_token() {
        tokio::select! {
            _ = token.cancelled() => Err("cloud_tool_cancelled".into()),
            _ = tokio::time::sleep(Duration::from_secs(1)) => Ok(()),
        }
    } else {
        tokio::time::sleep(Duration::from_secs(1)).await;
        Ok(())
    }
}

fn http_error(response: &CloudRequestResponse) -> &'static str {
    match response.status {
        401 => "account_authorization_required",
        403 => "cloud_access_denied",
        404 => "operation_not_found",
        429 => "cloud_rate_limited",
        _ => "outcome_unknown",
    }
}

fn recovery_error(code: &str) -> &'static str {
    match code {
        "cloud_response_invalid" => "cloud_response_invalid",
        "cloud_unavailable" => "cloud_unavailable",
        "resource_login_required" => "account_authorization_required",
        "product_user_disabled" => "product_user_disabled",
        _ => "outcome_unknown",
    }
}
