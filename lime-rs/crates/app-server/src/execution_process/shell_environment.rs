use super::{ExecutionProcessError, ExecutionProcessServer};
use agent_protocol::shell_environment::{
    create_env_from_vars, is_non_inheritable_env_var, set_tool_call_id_env_var,
};
use lime_core::config::ShellEnvironmentPolicyToml;
use serde_json::Value;
use std::collections::HashMap;

impl ExecutionProcessServer {
    pub(super) fn build_shell_environment(
        &self,
        overrides: HashMap<String, String>,
        metadata: Option<&Value>,
        thread_id: Option<&str>,
        call_id: &str,
    ) -> Result<(HashMap<String, String>, bool), ExecutionProcessError> {
        let policy = metadata.and_then(|value| value.pointer("/metadata/shell_environment_policy"));
        let Some(policy) = policy else {
            let mut environment = overrides;
            self.expose_primary_runtime(&mut environment)?;
            return Ok((environment, false));
        };
        let policy: ShellEnvironmentPolicyToml =
            serde_json::from_value(policy.clone()).map_err(|_| {
                ExecutionProcessError::Start("Invalid thread shell environment policy".into())
            })?;
        let mut inherited = std::env::vars().collect::<HashMap<_, _>>();
        self.expose_primary_runtime(&mut inherited)?;
        let mut environment = create_env_from_vars(inherited, &policy.into(), thread_id);
        for (key, value) in overrides {
            if cfg!(windows) {
                environment.retain(|name, _| !name.eq_ignore_ascii_case(&key));
            }
            environment.insert(key, value);
        }
        environment.retain(|key, _| !is_non_inheritable_env_var(key));
        set_tool_call_id_env_var(&mut environment, Some(call_id));
        Ok((environment, true))
    }
}

#[cfg(test)]
mod tests;
