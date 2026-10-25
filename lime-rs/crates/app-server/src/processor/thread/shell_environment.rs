use app_server_protocol::JsonRpcError;
use lime_core::config::{Config, ShellEnvironmentPolicyToml};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

const POLICY_FIELDS: &[&str] = &[
    "inherit",
    "ignore_default_excludes",
    "exclude",
    "set",
    "include_only",
    "filters",
    "experimental_use_profile",
];

pub(super) fn is_shell_environment_policy_override(key: &str) -> bool {
    key == "shell_environment_policy"
        || key
            .strip_prefix("shell_environment_policy.")
            .is_some_and(|field| {
                POLICY_FIELDS.contains(&field)
                    || field.starts_with("set.")
                    || field.starts_with("filters.")
            })
}

/// Desktop 的策略合并来自当前安装包；执行算法由 agent-protocol 复用 Codex 源码。
pub(super) async fn read_shell_environment_policy(
    config: &Config,
    cwd: &Path,
    previous: Option<&HashMap<String, Value>>,
    current: Option<&HashMap<String, Value>>,
) -> Result<ShellEnvironmentPolicyToml, JsonRpcError> {
    let mut policy = config.shell_environment_policy.clone();
    policy.merge(merged_shell_environment_overrides(previous, current)?);
    match lime_services::project_git_service::read_worktree_shell_environment(cwd).await {
        Ok(Some(environment)) => {
            if let Some(filters) = policy.filters.take() {
                use agent_protocol::config_types::ShellEnvironmentPolicyFilter;
                policy.exclude = Some(
                    filters
                        .iter()
                        .filter_map(|(key, action)| {
                            (*action == ShellEnvironmentPolicyFilter::Exclude)
                                .then_some(key.clone())
                        })
                        .collect(),
                );
                policy.include_only = Some(
                    filters
                        .into_iter()
                        .filter_map(|(key, action)| {
                            (action == ShellEnvironmentPolicyFilter::Include).then_some(key)
                        })
                        .collect(),
                );
            }
            let mut exclude = policy
                .exclude
                .take()
                .unwrap_or_default()
                .into_iter()
                .chain(environment.exclude().iter().cloned())
                .collect::<BTreeSet<_>>();
            let set = policy.r#set.get_or_insert_with(HashMap::new);
            set.retain(|key, _| !exclude.contains(key));
            for (key, value) in environment.set() {
                set.insert(key.clone(), value.clone());
                exclude.remove(key);
            }
            policy.exclude = Some(exclude.into_iter().collect());
        }
        Ok(None) => {}
        Err(_) => {
            tracing::warn!("Could not load worktree shell environment; using configured policy")
        }
    }
    Ok(policy)
}

pub(super) fn merged_shell_environment_overrides(
    previous: Option<&HashMap<String, Value>>,
    current: Option<&HashMap<String, Value>>,
) -> Result<ShellEnvironmentPolicyToml, JsonRpcError> {
    let mut policy = ShellEnvironmentPolicyToml::default();
    for overrides in [previous, current].into_iter().flatten() {
        policy.merge(read_override(overrides)?);
    }
    Ok(policy)
}

fn read_override(
    values: &HashMap<String, Value>,
) -> Result<ShellEnvironmentPolicyToml, JsonRpcError> {
    let mut fields = match values.get("shell_environment_policy") {
        Some(Value::Object(fields)) => fields.clone(),
        Some(Value::Null) | None => Map::new(),
        Some(_) => {
            return Err(super::invalid_params(
                "invalid shell_environment_policy: expected object",
            ))
        }
    };
    normalize_filters(&mut fields)?;
    for &field in POLICY_FIELDS {
        if let Some(value) = values.get(&format!("shell_environment_policy.{field}")) {
            if matches!(field, "set" | "filters") {
                let mut dotted = Map::from_iter([(field.to_string(), value.clone())]);
                normalize_filters(&mut dotted)?;
                if let (Some(nested), Some(dotted)) = (
                    fields.get_mut(field).and_then(Value::as_object_mut),
                    dotted.get(field).and_then(Value::as_object),
                ) {
                    nested.extend(dotted.clone());
                    continue;
                }
            }
            fields.insert(field.into(), value.clone());
        }
    }
    normalize_filters(&mut fields)?;
    let mut dotted_filters = BTreeSet::new();
    for (key, value) in values {
        for field in ["set", "filters"] {
            if let Some(name) = key.strip_prefix(&format!("shell_environment_policy.{field}.")) {
                if field == "filters" && !dotted_filters.insert(name.to_lowercase()) {
                    return Err(super::invalid_params(format!(
                        "duplicate shell environment filter `{name}` ignoring case"
                    )));
                }
                let target = fields
                    .entry(field.to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                let target = target.as_object_mut().ok_or_else(|| {
                    super::invalid_params(format!(
                        "invalid shell_environment_policy.{field}: expected object"
                    ))
                })?;
                target.insert(
                    if field == "filters" {
                        name.to_lowercase()
                    } else {
                        name.into()
                    },
                    value.clone(),
                );
            }
        }
    }
    serde_json::from_value(Value::Object(fields)).map_err(|error| {
        super::invalid_params(format!("invalid shell_environment_policy: {error}"))
    })
}

fn normalize_filters(fields: &mut Map<String, Value>) -> Result<(), JsonRpcError> {
    let Some(Value::Object(filters)) = fields.get_mut("filters") else {
        return Ok(());
    };
    let mut normalized = Map::new();
    for (key, value) in std::mem::take(filters) {
        if normalized.insert(key.to_lowercase(), value).is_some() {
            return Err(super::invalid_params(format!(
                "duplicate shell environment filter `{key}` ignoring case"
            )));
        }
    }
    *filters = normalized;
    Ok(())
}

#[cfg(test)]
mod tests;
