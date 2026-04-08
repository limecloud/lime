use crate::agents::extension_manager_extension::MANAGE_EXTENSIONS_TOOL_NAME_COMPLETE;
use crate::config::permission::PermissionLevel;
use crate::config::{AsterMode, PermissionManager};
use crate::conversation::message::{Message, ToolRequest};
use crate::permission::integration::IntegratedPermissionManager;
use crate::permission::permission_judge::PermissionCheckResult;
use crate::permission::types::PermissionContext;
use crate::tool_inspection::{InspectionAction, InspectionResult, ToolInspector};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Permission Inspector that handles tool permission checking
///
/// This inspector integrates both the legacy PermissionManager and the new
/// ToolPermissionManager for comprehensive permission checking.
///
/// Requirements: 11.1, 11.4
pub struct PermissionInspector {
    mode: Arc<Mutex<AsterMode>>,
    readonly_tools: HashSet<String>,
    regular_tools: HashSet<String>,
    pub permission_manager: Arc<Mutex<PermissionManager>>,
    /// Optional integrated permission manager for advanced permission features
    integrated_manager: Option<Arc<Mutex<IntegratedPermissionManager>>>,
    /// Working directory for permission context
    working_directory: Option<PathBuf>,
}

impl PermissionInspector {
    pub fn new(
        mode: AsterMode,
        readonly_tools: HashSet<String>,
        regular_tools: HashSet<String>,
    ) -> Self {
        Self {
            mode: Arc::new(Mutex::new(mode)),
            readonly_tools,
            regular_tools,
            permission_manager: Arc::new(Mutex::new(PermissionManager::default())),
            integrated_manager: None,
            working_directory: None,
        }
    }

    pub fn with_permission_manager(
        mode: AsterMode,
        readonly_tools: HashSet<String>,
        regular_tools: HashSet<String>,
        permission_manager: Arc<Mutex<PermissionManager>>,
    ) -> Self {
        Self {
            mode: Arc::new(Mutex::new(mode)),
            readonly_tools,
            regular_tools,
            permission_manager,
            integrated_manager: None,
            working_directory: None,
        }
    }

    /// Create with integrated permission manager for advanced features
    ///
    /// This constructor enables the new tool permission system with:
    /// - Three-tier permission architecture (Global, Project, Session)
    /// - Parameter-level restrictions
    /// - Context-based condition evaluation
    ///
    /// Requirements: 11.1, 11.4
    pub fn with_integrated_manager(
        mode: AsterMode,
        readonly_tools: HashSet<String>,
        regular_tools: HashSet<String>,
        permission_manager: Arc<Mutex<PermissionManager>>,
        integrated_manager: Arc<Mutex<IntegratedPermissionManager>>,
    ) -> Self {
        Self {
            mode: Arc::new(Mutex::new(mode)),
            readonly_tools,
            regular_tools,
            permission_manager,
            integrated_manager: Some(integrated_manager),
            working_directory: None,
        }
    }

    /// Set the working directory for permission context
    pub fn set_working_directory(&mut self, dir: PathBuf) {
        self.working_directory = Some(dir);
    }

    /// Get the integrated permission manager if configured
    pub fn integrated_manager(&self) -> Option<&Arc<Mutex<IntegratedPermissionManager>>> {
        self.integrated_manager.as_ref()
    }

    /// Update the mode of this permission inspector
    pub async fn update_mode(&self, new_mode: AsterMode) {
        let mut mode = self.mode.lock().await;
        *mode = new_mode;
    }

    /// Create a permission context for the current request
    fn create_permission_context(&self, tool_name: &str) -> PermissionContext {
        PermissionContext {
            working_directory: self
                .working_directory
                .clone()
                .unwrap_or_else(|| PathBuf::from(".")),
            session_id: uuid::Uuid::new_v4().to_string(),
            timestamp: chrono::Utc::now().timestamp(),
            user: None,
            environment: HashMap::new(),
            metadata: {
                let mut meta = HashMap::new();
                meta.insert(
                    "tool_name".to_string(),
                    serde_json::Value::String(tool_name.to_string()),
                );
                meta
            },
        }
    }

    /// Check permission using the integrated manager if available
    ///
    /// Requirements: 11.1, 11.4
    async fn check_integrated_permission(
        &self,
        tool_name: &str,
        tool_request: &ToolRequest,
    ) -> Option<InspectionAction> {
        let integrated_manager = self.integrated_manager.as_ref()?;
        let manager = integrated_manager.lock().await;

        // Extract parameters from tool request
        let params: HashMap<String, serde_json::Value> = tool_request
            .tool_call
            .as_ref()
            .ok()
            .and_then(|tc| tc.arguments.clone())
            .map(|args| args.into_iter().collect())
            .unwrap_or_default();

        let context = self.create_permission_context(tool_name);
        let result = manager.is_allowed(tool_name, &params, &context).await;

        if result.matched_rule.is_some() || !result.violations.is_empty() {
            // The integrated manager has a definitive answer
            if result.allowed {
                Some(InspectionAction::Allow)
            } else if !result.violations.is_empty() {
                // Parameter restrictions violated
                Some(InspectionAction::RequireApproval(Some(format!(
                    "Parameter restrictions: {}",
                    result.violations.join(", ")
                ))))
            } else {
                Some(InspectionAction::Deny)
            }
        } else {
            // No definitive answer from integrated manager
            None
        }
    }

    /// Process inspection results into permission decisions
    /// This method takes all inspection results and converts them into a PermissionCheckResult
    /// that can be used by the agent to determine which tools to approve, deny, or ask for approval
    pub fn process_inspection_results(
        &self,
        remaining_requests: &[ToolRequest],
        inspection_results: &[InspectionResult],
    ) -> PermissionCheckResult {
        use crate::tool_inspection::apply_inspection_results_to_permissions;

        // Start with permission inspector's decisions as the baseline
        let mut permission_check_result = PermissionCheckResult {
            approved: vec![],
            needs_approval: vec![],
            denied: vec![],
        };

        // Apply permission inspector results first (baseline behavior)
        let permission_results: Vec<_> = inspection_results
            .iter()
            .filter(|result| result.inspector_name == "permission")
            .collect();

        for request in remaining_requests {
            // Find the permission decision for this request
            if let Some(permission_result) = permission_results
                .iter()
                .find(|result| result.tool_request_id == request.id)
            {
                match permission_result.action {
                    InspectionAction::Allow => {
                        permission_check_result.approved.push(request.clone());
                    }
                    InspectionAction::Deny => {
                        permission_check_result.denied.push(request.clone());
                    }
                    InspectionAction::RequireApproval(_) => {
                        permission_check_result.needs_approval.push(request.clone());
                    }
                }
            } else {
                // If no permission result found, default to needs approval for safety
                permission_check_result.needs_approval.push(request.clone());
            }
        }

        // Apply security and other inspector results as overrides
        let non_permission_results: Vec<_> = inspection_results
            .iter()
            .filter(|result| result.inspector_name != "permission")
            .cloned()
            .collect();

        if !non_permission_results.is_empty() {
            permission_check_result = apply_inspection_results_to_permissions(
                permission_check_result,
                &non_permission_results,
            );
        }

        permission_check_result
    }
}

#[async_trait]
impl ToolInspector for PermissionInspector {
    fn name(&self) -> &'static str {
        "permission"
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn inspect(
        &self,
        tool_requests: &[ToolRequest],
        _messages: &[Message],
    ) -> Result<Vec<InspectionResult>> {
        let mut results = Vec::new();
        let permission_manager = self.permission_manager.lock().await;
        let mode = self.mode.lock().await;

        for request in tool_requests {
            if let Ok(tool_call) = &request.tool_call {
                let tool_name = &tool_call.name;

                let action = match *mode {
                    AsterMode::Chat => continue,
                    AsterMode::Auto => InspectionAction::Allow,
                    AsterMode::Approve | AsterMode::SmartApprove => {
                        // First, check the integrated permission manager if available
                        // Requirements: 11.1, 11.4
                        if let Some(integrated_action) =
                            self.check_integrated_permission(tool_name, request).await
                        {
                            integrated_action
                        }
                        // 1. Check user-defined permission first
                        else if let Some(level) =
                            permission_manager.get_user_permission(tool_name)
                        {
                            match level {
                                PermissionLevel::AlwaysAllow => InspectionAction::Allow,
                                PermissionLevel::NeverAllow => InspectionAction::Deny,
                                PermissionLevel::AskBefore => {
                                    InspectionAction::RequireApproval(None)
                                }
                            }
                        }
                        // 2. Check if it's a readonly or regular tool (both pre-approved)
                        else if self.readonly_tools.contains(tool_name.as_ref())
                            || self.regular_tools.contains(tool_name.as_ref())
                        {
                            InspectionAction::Allow
                        }
                        // 4. Special case for extension management
                        else if tool_name == MANAGE_EXTENSIONS_TOOL_NAME_COMPLETE {
                            InspectionAction::RequireApproval(Some(
                                "Extension management requires approval for security".to_string(),
                            ))
                        }
                        // 5. Default: require approval for unknown tools
                        else {
                            InspectionAction::RequireApproval(None)
                        }
                    }
                };

                let reason = match &action {
                    InspectionAction::Allow => {
                        if *mode == AsterMode::Auto {
                            "Auto mode - all tools approved".to_string()
                        } else if self.readonly_tools.contains(tool_name.as_ref()) {
                            "Tool marked as read-only".to_string()
                        } else if self.regular_tools.contains(tool_name.as_ref()) {
                            "Tool pre-approved".to_string()
                        } else {
                            "User permission allows this tool".to_string()
                        }
                    }
                    InspectionAction::Deny => "User permission denies this tool".to_string(),
                    InspectionAction::RequireApproval(_) => {
                        if tool_name == MANAGE_EXTENSIONS_TOOL_NAME_COMPLETE {
                            "Extension management requires user approval".to_string()
                        } else {
                            "Tool requires user approval".to_string()
                        }
                    }
                };

                results.push(InspectionResult {
                    tool_request_id: request.id.clone(),
                    action,
                    reason,
                    confidence: 1.0, // Permission decisions are definitive
                    inspector_name: self.name().to_string(),
                    finding_id: None,
                });
            }
        }

        Ok(results)
    }
}
