//! 两种固定装配操作共用云助手提交、精确查询与未知结果恢复。
use super::*;

pub(super) fn invocation_ids(value: &Value) -> Result<(String, String), String> {
    let invoke = value["InvokeId"]
        .as_str()
        .ok_or("Missing Cloud Assistant invocation ID")?;
    let command = value["CommandId"]
        .as_str()
        .ok_or("Missing Cloud Assistant command ID")?;
    validate_id(invoke)?;
    validate_id(command)?;
    Ok((invoke.into(), command.into()))
}

impl CloudDesktopService {
    pub(super) async fn submit_ecs_command(
        &self,
        resource: &CloudDesktopResource,
        script: &str,
        token: &str,
        tag: &str,
        name_prefix: &str,
        timeout: u32,
    ) -> Result<Value, String> {
        self.call(
            resource,
            &[
                "RunCommand".into(),
                "--InstanceId.1".into(),
                resource.resource_id.clone(),
                "--Type".into(),
                "RunShellScript".into(),
                "--CommandContent".into(),
                script.into(),
                "--ContentEncoding".into(),
                "PlainText".into(),
                "--EnableParameter".into(),
                "false".into(),
                "--Name".into(),
                format!("{name_prefix}-{token}"),
                "--Tag.1.Key".into(),
                tag.into(),
                "--Tag.1.Value".into(),
                token.into(),
                "--ClientToken".into(),
                token.into(),
                "--Username".into(),
                "root".into(),
                "--WorkingDir".into(),
                "/".into(),
                "--RepeatMode".into(),
                "Once".into(),
                "--KeepCommand".into(),
                "false".into(),
                "--Timeout".into(),
                timeout.to_string(),
                "--TerminationMode".into(),
                "ProcessTree".into(),
            ],
        )
        .await
    }

    pub(super) async fn query_ecs_command_result(
        &self,
        operation_id: &str,
        resource: &CloudDesktopResource,
        receipt: &mut Value,
        tag: &str,
        name_prefix: &str,
    ) -> Result<Option<Value>, String> {
        if receipt["invokeId"].is_null() {
            let token = receipt["clientToken"]
                .as_str()
                .ok_or("Invalid Cloud Assistant operation")?;
            let response = self
                .call(
                    resource,
                    &[
                        "DescribeInvocations".into(),
                        "--InstanceId".into(),
                        resource.resource_id.clone(),
                        "--Tag.1.Key".into(),
                        tag.into(),
                        "--Tag.1.Value".into(),
                        token.into(),
                        "--MaxResults".into(),
                        "2".into(),
                        "--IncludeOutput".into(),
                        "false".into(),
                    ],
                )
                .await?;
            let entries = response
                .pointer("/Invocations/Invocation")
                .and_then(Value::as_array)
                .ok_or("Invalid Cloud Assistant invocation response")?;
            if response["NextToken"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
                || entries.len() > 1
            {
                return Err("Cloud Assistant invocation identity is ambiguous".into());
            }
            let Some(entry) = entries.first() else {
                return Ok(None);
            };
            let instances = entry
                .pointer("/InvokeInstances/InvokeInstance")
                .and_then(Value::as_array)
                .ok_or("Invalid Cloud Assistant invocation targets")?;
            if entry["CommandName"] != format!("{name_prefix}-{token}")
                || instances.len() != 1
                || instances[0]["InstanceId"] != resource.resource_id
            {
                return Err(
                    "Cloud Assistant invocation does not match the original operation".into(),
                );
            }
            let (invoke, command) = invocation_ids(entry)?;
            receipt["invokeId"] = json!(invoke);
            receipt["commandId"] = json!(command);
            receipt["outcome"] = json!("accepted");
            receipt
                .as_object_mut()
                .ok_or("Invalid Cloud Assistant receipt")?
                .remove("diagnostic");
            self.finalize_receipt(operation_id, receipt);
        }
        let response = self
            .call(
                resource,
                &[
                    "DescribeInvocationResults".into(),
                    "--InvokeId".into(),
                    receipt["invokeId"]
                        .as_str()
                        .ok_or("Missing original invocation")?
                        .into(),
                    "--InstanceId".into(),
                    resource.resource_id.clone(),
                    "--CommandId".into(),
                    receipt["commandId"]
                        .as_str()
                        .ok_or("Missing original command")?
                        .into(),
                    "--ContentEncoding".into(),
                    "PlainText".into(),
                    "--IncludeHistory".into(),
                    "false".into(),
                    "--MaxResults".into(),
                    "2".into(),
                ],
            )
            .await?;
        let invocation = &response["Invocation"];
        let entries = invocation
            .pointer("/InvocationResults/InvocationResult")
            .and_then(Value::as_array)
            .ok_or("Invalid Cloud Assistant result response")?;
        if invocation["NextToken"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
            || entries.len() > 1
        {
            return Err("Cloud Assistant result identity is ambiguous".into());
        }
        let Some(entry) = entries.first() else {
            return Ok(None);
        };
        if entry["InstanceId"] != resource.resource_id
            || entry["InvokeId"] != receipt["invokeId"]
            || entry["CommandId"] != receipt["commandId"]
        {
            return Err("Cloud Assistant result does not match the original operation".into());
        }
        Ok(Some(entry.clone()))
    }
}
