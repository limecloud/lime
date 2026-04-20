pub mod classification_client;
pub mod patterns;
pub mod policy;
pub mod scanner;
pub mod security_inspector;

use crate::config::Config;
use crate::conversation::message::{Message, ToolRequest};
use crate::permission::permission_judge::PermissionCheckResult;
use anyhow::Result;
use scanner::PromptInjectionScanner;
use std::sync::OnceLock;
use uuid::Uuid;

pub(crate) const LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY: &str =
    "SECURITY_PROMPT_CLASSIFIER_ENABLED";
const CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY: &str = "classifierPermissionsEnabled";

pub struct SecurityManager {
    scanner: OnceLock<PromptInjectionScanner>,
}

#[derive(Debug, Clone)]
pub struct SecurityResult {
    pub is_malicious: bool,
    pub confidence: f32,
    pub explanation: String,
    pub should_ask_user: bool,
    pub finding_id: String,
    pub tool_request_id: String,
}

impl SecurityManager {
    pub fn new() -> Self {
        Self {
            scanner: OnceLock::new(),
        }
    }

    pub fn is_prompt_injection_detection_enabled(&self) -> bool {
        let config = Config::global();

        config
            .get_param::<bool>("SECURITY_PROMPT_ENABLED")
            .unwrap_or(false)
    }

    fn is_ml_scanning_enabled(&self) -> bool {
        let config = Config::global();
        read_classifier_permissions_enabled(config).unwrap_or(false)
    }

    pub async fn analyze_tool_requests(
        &self,
        tool_requests: &[ToolRequest],
        messages: &[Message],
    ) -> Result<Vec<SecurityResult>> {
        if !self.is_prompt_injection_detection_enabled() {
            tracing::debug!(
                counter.aster.prompt_injection_scanner_disabled = 1,
                "Security scanning disabled"
            );
            return Ok(vec![]);
        }

        let scanner = self.scanner.get_or_init(|| {
            let ml_enabled = self.is_ml_scanning_enabled();

            let scanner = if ml_enabled {
                match PromptInjectionScanner::with_ml_detection() {
                    Ok(s) => {
                        tracing::info!(
                            counter.aster.prompt_injection_scanner_enabled = 1,
                            "🔓 Security scanner initialized with ML-based detection"
                        );
                        s
                    }
                    Err(e) => {
                        let error_chain = format!("{:#}", e);
                        tracing::warn!(
                            "⚠️ ML scanning requested but failed to initialize. Falling back to pattern-only scanning.\n\nError details:\n{}",
                            error_chain
                        );
                        PromptInjectionScanner::new()
                    }
                }
            } else {
                tracing::info!(
                    counter.aster.prompt_injection_scanner_enabled = 1,
                    "🔓 Security scanner initialized with pattern-based detection only"
                );
                PromptInjectionScanner::new()
            };

            scanner
        });

        let mut results = Vec::new();

        tracing::info!(
            "🔍 Starting security analysis - {} tool requests, {} messages",
            tool_requests.len(),
            messages.len()
        );

        for tool_request in tool_requests.iter() {
            if let Ok(tool_call) = &tool_request.tool_call {
                let analysis_result = scanner
                    .analyze_tool_call_with_context(tool_call, messages)
                    .await?;

                let config_threshold = scanner.get_threshold_from_config();
                let sanitized_explanation = analysis_result.explanation.replace('\n', " | ");

                if analysis_result.is_malicious {
                    let above_threshold = analysis_result.confidence > config_threshold;
                    let finding_id = format!("SEC-{}", Uuid::new_v4().simple());

                    tracing::warn!(
                        counter.aster.prompt_injection_finding = 1,
                        above_threshold = above_threshold,
                        tool_name = %tool_call.name,
                        tool_request_id = %tool_request.id,
                        confidence = analysis_result.confidence,
                        explanation = %sanitized_explanation,
                        finding_id = %finding_id,
                        threshold = config_threshold,
                        "{}",
                        if above_threshold {
                            "Current tool call flagged as malicious after security analysis (above threshold)"
                        } else {
                            "Security finding below threshold - logged but not blocking execution"
                        }
                    );
                    if above_threshold {
                        results.push(SecurityResult {
                            is_malicious: analysis_result.is_malicious,
                            confidence: analysis_result.confidence,
                            explanation: analysis_result.explanation,
                            should_ask_user: true, // Always ask user for threats above threshold
                            finding_id,
                            tool_request_id: tool_request.id.clone(),
                        });
                    }
                } else {
                    tracing::info!(
                        tool_name = %tool_call.name,
                        tool_request_id = %tool_request.id,
                        confidence = analysis_result.confidence,
                        explanation = %sanitized_explanation,
                        "✅ Current tool call passed security analysis"
                    );
                }
            }
        }

        tracing::info!(
            counter.aster.prompt_injection_analysis_performed = 1,
            security_issues_found = results.len(),
            "Security analysis complete"
        );
        Ok(results)
    }

    pub async fn filter_malicious_tool_calls(
        &self,
        messages: &[Message],
        permission_check_result: &PermissionCheckResult,
        _system_prompt: Option<&str>,
    ) -> Result<Vec<SecurityResult>> {
        let tool_requests: Vec<_> = permission_check_result
            .approved
            .iter()
            .chain(permission_check_result.needs_approval.iter())
            .cloned()
            .collect();

        self.analyze_tool_requests(&tool_requests, messages).await
    }
}

impl Default for SecurityManager {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn read_classifier_permissions_enabled(
    config: &Config,
) -> Result<bool, crate::config::ConfigError> {
    match config.get_param::<bool>(CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY) {
        Ok(enabled) => Ok(enabled),
        Err(crate::config::ConfigError::NotFound(_)) => config
            .get_param::<bool>(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY)
            .or_else(|error| match error {
                crate::config::ConfigError::NotFound(_) => Ok(false),
                other => Err(other),
            }),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use env_lock::lock_env;
    use std::sync::Arc;
    use tempfile::tempdir;

    fn create_test_config() -> Arc<Config> {
        let root = tempdir().expect("temp dir").keep();
        let config_path = root.join("config.yaml");
        let secrets_path = root.join("secrets.yaml");
        Arc::new(
            Config::new_with_file_secrets(&config_path, &secrets_path)
                .expect("test config should be created"),
        )
    }

    #[test]
    fn test_read_classifier_permissions_enabled_defaults_false() {
        let _guard = lock_env([
            ("CLASSIFIERPERMISSIONSENABLED", None::<&str>),
            (
                LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
                None::<&str>,
            ),
        ]);
        let config = create_test_config();

        assert!(!read_classifier_permissions_enabled(config.as_ref())
            .expect("default classifier setting should resolve"));
    }

    #[test]
    fn test_read_classifier_permissions_enabled_falls_back_to_legacy_key() {
        let _guard = lock_env([
            ("CLASSIFIERPERMISSIONSENABLED", None::<&str>),
            (
                LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
                None::<&str>,
            ),
        ]);
        let config = create_test_config();
        config
            .set_param(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY, true)
            .expect("legacy key should be written");

        assert!(read_classifier_permissions_enabled(config.as_ref())
            .expect("legacy classifier setting should resolve"));
    }

    #[test]
    fn test_read_classifier_permissions_enabled_prefers_current_key() {
        let _guard = lock_env([
            ("CLASSIFIERPERMISSIONSENABLED", None::<&str>),
            (
                LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY,
                None::<&str>,
            ),
        ]);
        let config = create_test_config();
        config
            .set_param(LEGACY_CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY, true)
            .expect("legacy key should be written");
        config
            .set_param(CLASSIFIER_PERMISSIONS_ENABLED_CONFIG_KEY, false)
            .expect("current key should be written");

        assert!(!read_classifier_permissions_enabled(config.as_ref())
            .expect("current classifier setting should win"));
    }
}
