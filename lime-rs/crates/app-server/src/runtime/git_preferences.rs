//! Git 偏好只为实际 Git 工作目录的后续用户回合提供工作流指令。

use super::turn_start::TurnStartRequest;
use super::{RuntimeCore, RuntimeCoreError};
use lime_core::config::ConfigManager;
use std::path::Path;

impl RuntimeCore {
    pub(super) fn prepare_git_prompt_context(
        &self,
        params: &mut TurnStartRequest,
    ) -> Result<(), RuntimeCoreError> {
        if self
            .state
            .lock()
            .expect("runtime core state mutex poisoned")
            .internal_agents
            .contains_key(&params.session_id)
        {
            return Ok(());
        }
        let Some(request) = params
            .runtime_options
            .as_mut()
            .and_then(|options| options.runtime_request.as_mut())
        else {
            return Ok(());
        };
        let Some(directory) = request.working_dir.as_deref() else {
            return Ok(());
        };
        if !Path::new(directory)
            .ancestors()
            .any(|root| root.join(".git").exists())
        {
            return Ok(());
        }
        let config = ConfigManager::load(&self.app_config_path)
            .map_err(|error| RuntimeCoreError::Backend(format!("read Git preferences: {error}")))?;
        let preferences = serde_json::to_string(&config.config().git)
            .map_err(|error| RuntimeCoreError::Backend(error.to_string()))?;
        let block = format!(
            "<git_workflow_preferences>\n\
             Apply these user defaults only when performing a requested Git task. They do not authorize creating branches, committing, pushing, or changing a pull request. Explicit task instructions take precedence.\n\
             Prefix automatically generated new branch names with branch-prefix; an empty prefix disables this. For authorized pushes, always-force-push=true means use --force-with-lease, never --force; false means a normal push by default. Use create-draft-pull-requests when creating a pull request and pull-request-merge-method when merging it. Apply commit-instructions only when generating commit messages and pull-request-instructions only when generating PR titles/descriptions. These are workflow defaults, not evidence that any operation ran.\n\
             {preferences}\n</git_workflow_preferences>"
        );
        let prompt = request.system_prompt.get_or_insert_with(String::new);
        if !prompt.is_empty() {
            prompt.push_str("\n\n");
        }
        prompt.push_str(&block);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use app_server_protocol::{RuntimeOptions, RuntimeRequest};

    #[test]
    fn preferences_are_fresh_and_scoped_to_git_workspaces() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.yaml");
        std::fs::write(&config, "git:\n  commit-instructions: 'Use Chinese'\n").unwrap();
        let core = RuntimeCore::default().with_app_config_path(config.clone());
        let make_request = || TurnStartRequest {
            session_id: "git-preferences".into(),
            turn_id: None,
            input: Vec::new(),
            runtime_options: Some(RuntimeOptions {
                runtime_request: Some(RuntimeRequest {
                    working_dir: Some(temp.path().to_string_lossy().into()),
                    system_prompt: Some("Keep existing instructions".into()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            queue_if_busy: false,
            skip_pre_submit_resume: false,
        };
        let mut non_git = make_request();
        core.prepare_git_prompt_context(&mut non_git).unwrap();
        assert_eq!(
            non_git
                .runtime_options
                .unwrap()
                .runtime_request
                .unwrap()
                .system_prompt
                .as_deref(),
            Some("Keep existing instructions")
        );
        std::fs::create_dir(temp.path().join(".git")).unwrap();
        let mut git = make_request();
        core.prepare_git_prompt_context(&mut git).unwrap();
        let prompt = git
            .runtime_options
            .unwrap()
            .runtime_request
            .unwrap()
            .system_prompt
            .unwrap();
        assert!(prompt.starts_with("Keep existing instructions\n\n"));
        assert!(prompt.contains("Use Chinese"));
        assert!(prompt.contains("--force-with-lease, never --force"));
        std::fs::write(&config, "git:\n  commit-instructions: 'Use Japanese'\n").unwrap();
        let mut next = make_request();
        core.prepare_git_prompt_context(&mut next).unwrap();
        let prompt = next
            .runtime_options
            .unwrap()
            .runtime_request
            .unwrap()
            .system_prompt
            .unwrap();
        assert!(prompt.contains("Use Japanese"));
        assert!(!prompt.contains("Use Chinese"));
    }
}
