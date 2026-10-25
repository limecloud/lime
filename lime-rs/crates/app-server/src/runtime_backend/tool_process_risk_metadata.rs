use super::tool_process_metadata::ToolProcessMetadataInput;
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ToolProcessRiskMetadata {
    pub(crate) risk_level: &'static str,
    pub(crate) risk_category: Option<&'static str>,
    pub(crate) risk_reason: Option<&'static str>,
}

impl ToolProcessRiskMetadata {
    fn normal() -> Self {
        Self {
            risk_level: "normal",
            risk_category: None,
            risk_reason: None,
        }
    }

    fn high(category: &'static str, reason: &'static str) -> Self {
        Self {
            risk_level: "high",
            risk_category: Some(category),
            risk_reason: Some(reason),
        }
    }

    pub(crate) fn apply_to_lifecycle(&self, lifecycle: &mut Map<String, Value>) {
        lifecycle.insert(
            "riskLevel".to_string(),
            Value::String(self.risk_level.to_string()),
        );
    }

    pub(crate) fn insert_fact_fields(&self, facts: &mut Map<String, Value>) {
        if let Some(category) = self.risk_category {
            facts.insert(
                "riskCategory".to_string(),
                Value::String(category.to_string()),
            );
        }
        if let Some(reason) = self.risk_reason {
            facts.insert("riskReason".to_string(), Value::String(reason.to_string()));
        }
    }

    pub(crate) fn insert_metadata_fields(&self, metadata: &mut Map<String, Value>) {
        if let Some(category) = self.risk_category {
            metadata.insert(
                "risk_category".to_string(),
                Value::String(category.to_string()),
            );
        }
        if let Some(reason) = self.risk_reason {
            metadata.insert("risk_reason".to_string(), Value::String(reason.to_string()));
        }
    }
}

pub(crate) fn classify_tool_process_risk(
    input: &ToolProcessMetadataInput<'_>,
) -> ToolProcessRiskMetadata {
    if let Some(risk) = risk_from_result_metadata(input) {
        return risk;
    }
    if let Some(risk) = risk_from_result_text(input) {
        return risk;
    }
    if let Some(risk) = risk_from_tool_operation(input) {
        return risk;
    }
    ToolProcessRiskMetadata::normal()
}

fn risk_from_result_metadata(
    input: &ToolProcessMetadataInput<'_>,
) -> Option<ToolProcessRiskMetadata> {
    let metadata = input.result?.metadata.as_ref()?;
    let event_class = metadata_string(metadata, &["eventClass", "event_class"]);
    match event_class.as_deref() {
        Some("sandbox.blocked") => {
            return Some(ToolProcessRiskMetadata::high("sandbox", "sandbox_blocked"));
        }
        Some("permission.denied") => {
            return Some(ToolProcessRiskMetadata::high(
                "permission",
                "permission_denied",
            ));
        }
        _ => {}
    }

    let code = metadata_string(
        metadata,
        &[
            "failureCategory",
            "failure_category",
            "reasonCode",
            "reason_code",
            "code",
        ],
    )
    .unwrap_or_default()
    .to_ascii_lowercase();
    if code.contains("sandbox") {
        return Some(ToolProcessRiskMetadata::high("sandbox", "sandbox_blocked"));
    }
    if code.contains("permission") || code.contains("denied") || code.contains("policy") {
        return Some(ToolProcessRiskMetadata::high(
            "permission",
            "permission_denied",
        ));
    }
    if code.contains("danger") || code.contains("destructive") {
        return Some(ToolProcessRiskMetadata::high(
            "destructive_operation",
            "policy_flagged_destructive_operation",
        ));
    }
    None
}

fn risk_from_result_text(input: &ToolProcessMetadataInput<'_>) -> Option<ToolProcessRiskMetadata> {
    let result = input.result?;
    let text = format!(
        "{}\n{}",
        result.error.as_deref().unwrap_or_default(),
        result.output
    )
    .to_ascii_lowercase();
    if text.contains("sandbox") && (text.contains("block") || text.contains("denied")) {
        return Some(ToolProcessRiskMetadata::high("sandbox", "sandbox_blocked"));
    }
    if text.contains("permission denied")
        || text.contains("access denied")
        || text.contains("policy denied")
        || text.contains("not allowed")
    {
        return Some(ToolProcessRiskMetadata::high(
            "permission",
            "permission_denied",
        ));
    }
    None
}

fn risk_from_tool_operation(
    input: &ToolProcessMetadataInput<'_>,
) -> Option<ToolProcessRiskMetadata> {
    let tool_name = input.tool_name.unwrap_or_default().to_ascii_lowercase();
    if tool_name.contains("delete")
        || tool_name.contains("remove")
        || tool_name.contains("destroy")
        || tool_name.contains("drop")
        || tool_name.contains("truncate")
    {
        return Some(ToolProcessRiskMetadata::high(
            "destructive_operation",
            "destructive_tool_name",
        ));
    }

    let arguments = input.arguments?.as_object()?;
    let command = command_like_text(arguments, &tool_name)?;
    risk_from_command_text(&command)
}

fn command_like_text(arguments: &Map<String, Value>, tool_name: &str) -> Option<String> {
    for key in [
        "command",
        "cmd",
        "script",
        "shell",
        "powershell",
        "sql",
        "operation",
        "action",
    ] {
        if let Some(value) = arguments.get(key).and_then(value_to_text) {
            return Some(value);
        }
    }
    if tool_name.contains("sql") || tool_name.contains("database") || tool_name.contains("db") {
        return arguments
            .get("query")
            .or_else(|| arguments.get("statement"))
            .and_then(value_to_text);
    }
    None
}

fn risk_from_command_text(command: &str) -> Option<ToolProcessRiskMetadata> {
    let normalized = normalize_command(command);
    if normalized.contains("rm -rf")
        || normalized.contains("rm -fr")
        || normalized.contains("remove-item -recurse")
        || normalized.contains("del /s")
        || normalized.contains("rmdir /s")
    {
        return Some(ToolProcessRiskMetadata::high(
            "deletion",
            "recursive_delete_command",
        ));
    }
    if normalized.contains("git reset --hard")
        || normalized.contains("git clean -fd")
        || normalized.contains("git push --force")
        || normalized.contains("git push -f")
    {
        return Some(ToolProcessRiskMetadata::high(
            "destructive_operation",
            "destructive_vcs_command",
        ));
    }
    if normalized.contains("drop database")
        || normalized.contains("drop table")
        || normalized.contains("truncate table")
        || normalized.contains("delete from")
    {
        return Some(ToolProcessRiskMetadata::high(
            "data_mutation",
            "destructive_database_command",
        ));
    }
    if normalized.contains("terraform destroy")
        || normalized.contains("kubectl delete")
        || normalized.contains("aws ") && normalized.contains(" delete")
        || normalized.contains("gcloud ") && normalized.contains(" delete")
        || normalized.contains("npm publish")
        || normalized.contains("vercel --prod")
    {
        return Some(ToolProcessRiskMetadata::high(
            "production_api",
            "production_or_infra_mutation",
        ));
    }
    if normalized.contains("chmod -r 777")
        || normalized.contains("chown -r")
        || normalized.starts_with("sudo ")
        || normalized.contains(" sudo ")
    {
        return Some(ToolProcessRiskMetadata::high(
            "permission",
            "privileged_or_permission_mutation",
        ));
    }
    None
}

fn metadata_string(
    metadata: &std::collections::HashMap<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| metadata.get(*key)?.as_str().and_then(non_empty_str))
        .map(str::to_string)
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => non_empty_str(value).map(str::to_string),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn normalize_command(command: &str) -> String {
    command
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn non_empty_str(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_backend::tool_process_metadata::{
        build_tool_process_metadata, ToolProcessStatus,
    };
    use lime_agent::AgentToolResult;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn destructive_command_forces_l4_tool_lifecycle() {
        let arguments = json!({ "command": "rm -rf important" });
        let metadata = build_tool_process_metadata(ToolProcessMetadataInput {
            tool_id: "tool-danger",
            tool_name: Some("Bash"),
            status: ToolProcessStatus::Started,
            arguments: Some(&arguments),
            result: None,
        });

        assert_eq!(
            metadata["tool_process_facts"]["riskLevel"].as_str(),
            Some("high")
        );
        assert_eq!(
            metadata["tool_process_facts"]["riskCategory"].as_str(),
            Some("deletion")
        );
        assert_eq!(
            metadata["tool_process_facts"]["riskReason"].as_str(),
            Some("recursive_delete_command")
        );
    }

    #[test]
    fn policy_failure_metadata_forces_l4_tool_lifecycle() {
        let result = AgentToolResult {
            success: false,
            output: String::new(),
            error: Some("policy denied this command".to_string()),
            structured_content: None,
            images: None,
            metadata: Some(HashMap::from([(
                "reasonCode".to_string(),
                json!("dangerous_command"),
            )])),
        };
        let metadata = build_tool_process_metadata(ToolProcessMetadataInput {
            tool_id: "tool-denied",
            tool_name: Some("Bash"),
            status: ToolProcessStatus::Failed,
            arguments: None,
            result: Some(&result),
        });

        assert_eq!(metadata["risk_level"].as_str(), Some("high"));
        assert_eq!(
            metadata["tool_process_facts"]["riskCategory"].as_str(),
            Some("destructive_operation")
        );
    }

    #[test]
    fn ordinary_search_stays_normal_risk() {
        let arguments = json!({ "query": "how to delete a branch safely" });
        let metadata = build_tool_process_metadata(ToolProcessMetadataInput {
            tool_id: "tool-search",
            tool_name: Some("web_search"),
            status: ToolProcessStatus::Started,
            arguments: Some(&arguments),
            result: None,
        });

        assert_eq!(
            metadata["tool_process_facts"]["riskLevel"].as_str(),
            Some("normal")
        );
        assert!(metadata["tool_process_facts"]["riskCategory"].is_null());
    }
}
