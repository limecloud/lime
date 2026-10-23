use super::*;

pub(super) fn validate_thread_settings(
    params: &ThreadSettingsUpdateParams,
    has_workspace_roots: bool,
) -> Result<(), RuntimeCoreError> {
    normalized_identity(&params.thread_id, "thread/settings/update threadId")?;
    if !params.has_updates() && !has_workspace_roots {
        return Err(RuntimeCoreError::InvalidRequest(
            "thread/settings/update requires at least one setting".to_string(),
        ));
    }
    if params.sandbox_policy.is_some() && params.permissions.is_some() {
        return Err(RuntimeCoreError::InvalidRequest(
            "permissions cannot be combined with sandboxPolicy".to_string(),
        ));
    }
    if let Some(cwd) = params.cwd.as_deref() {
        let cwd = normalized_value(cwd, "cwd")?;
        if !Path::new(cwd).is_absolute() {
            return Err(RuntimeCoreError::InvalidRequest(
                "thread/settings/update cwd must be absolute".to_string(),
            ));
        }
    }
    validate_optional_string(params.model.as_deref(), "model")?;
    validate_optional_string(params.model_provider.as_deref(), "modelProvider")?;
    if params.model_provider.is_some() && params.model.is_none() {
        return Err(RuntimeCoreError::InvalidRequest(
            "thread/settings/update modelProvider requires model".to_string(),
        ));
    }
    validate_optional_string(params.effort.as_deref(), "effort")?;
    if let Some(Some(service_tier)) = params.service_tier.as_ref() {
        normalized_value(service_tier, "serviceTier")?;
    }
    if let Some(summary) = params.summary.as_ref() {
        serde_json::from_value::<lime_core::config::ReasoningSummary>(summary.clone()).map_err(
            |error| RuntimeCoreError::InvalidRequest(format!("invalid reasoning summary: {error}")),
        )?;
    }
    for (name, value) in [
        ("approvalPolicy", params.approval_policy.as_ref()),
        ("sandboxPolicy", params.sandbox_policy.as_ref()),
        ("personality", params.personality.as_ref()),
        ("toolPreferences", params.tool_preferences.as_ref()),
    ] {
        if let Some(value) = value {
            validate_setting_value(value, name)?;
        }
    }
    if let Some(mode) = params.collaboration_mode.as_ref() {
        normalized_value(&mode.settings.model, "collaborationMode.settings.model")?;
        if params
            .model
            .as_ref()
            .is_some_and(|model| model != &mode.settings.model)
        {
            return Err(RuntimeCoreError::InvalidRequest(
                "thread/settings/update model must match collaborationMode.settings.model"
                    .to_string(),
            ));
        }
        validate_optional_string(
            mode.settings.reasoning_effort.as_deref(),
            "collaborationMode.settings.reasoning_effort",
        )?;
    }
    Ok(())
}

pub(in crate::runtime) fn apply_thread_settings_patch(
    metadata: &mut Map<String, Value>,
    params: ThreadSettingsUpdateParams,
    resolved_permission_profile: Option<ResolvedPermissionProfile>,
) -> Result<(), String> {
    let current_model = metadata_string(metadata, &["modelName", "model"]);
    let current_provider = metadata_string(
        metadata,
        &["providerSelector", "providerName", "modelProvider"],
    );
    let target_model = params
        .collaboration_mode
        .as_ref()
        .map(|mode| mode.settings.model.as_str())
        .or(params.model.as_deref())
        .or(current_model.as_deref());
    let target_provider = params
        .model_provider
        .as_deref()
        .or(current_provider.as_deref());
    let model_identity_changed =
        target_model != current_model.as_deref() || target_provider != current_provider.as_deref();
    let model_update = params.model.clone();
    let effort_update = params.effort.clone();
    let collaboration_model_update = params.collaboration_mode.is_some();
    let reset_effort_for_model =
        model_identity_changed && effort_update.is_none() && !collaboration_model_update;
    let reset_service_tier_for_model = model_identity_changed && params.service_tier.is_none();
    let clears_permission_profile = params.sandbox_policy.is_some();
    let permission_profile = params.permissions.clone();
    if let Some(cwd) = params.cwd {
        metadata.insert("workingDir".into(), Value::String(cwd));
        metadata.remove("cwd");
        metadata.remove("working_dir");
    }
    insert_value(metadata, "approvalPolicy", params.approval_policy);
    if let Some(reviewer) = params.approvals_reviewer {
        metadata.insert(
            "approvalsReviewer".into(),
            Value::String(reviewer.as_str().into()),
        );
        metadata.remove("approvals_reviewer");
    }
    insert_value(metadata, "sandboxPolicy", params.sandbox_policy);
    if clears_permission_profile {
        metadata.remove("permissions");
        metadata.remove("activePermissionProfile");
    }
    if let Some(profile) = resolved_permission_profile {
        apply_resolved_permission_profile_to_metadata(metadata, profile)?;
    } else if let Some(profile_id) = permission_profile {
        // Direct unit callers may omit policy resolution; preserve the builtin
        // profile fallback while public request paths always pass a resolved
        // profile from RuntimeCore.
        apply_permission_profile_to_metadata(metadata, &profile_id)?;
    }
    insert_string(metadata, "modelName", params.model);
    if let Some(model_provider) = params.model_provider {
        metadata.insert(
            "providerSelector".to_string(),
            Value::String(model_provider.clone()),
        );
        metadata.insert("providerName".to_string(), Value::String(model_provider));
    }
    if model_identity_changed {
        metadata.remove("agentControlRoute");
    }
    if let Some(service_tier) = params.service_tier {
        match service_tier {
            Some(service_tier) => {
                metadata.insert("serviceTier".to_string(), Value::String(service_tier));
            }
            None => {
                metadata.remove("serviceTier");
                metadata.remove("service_tier");
            }
        }
    } else if reset_service_tier_for_model {
        metadata.remove("serviceTier");
        metadata.remove("service_tier");
    }
    insert_string(metadata, "reasoningEffort", params.effort);
    if reset_effort_for_model {
        metadata.remove("reasoningEffort");
        metadata.remove("effort");
    }
    insert_value(metadata, "reasoningSummary", params.summary);
    if let Some(mode) = params.collaboration_mode {
        metadata.insert(
            "modelName".to_string(),
            Value::String(mode.settings.model.clone()),
        );
        match mode.settings.reasoning_effort.as_ref() {
            Some(effort) => {
                metadata.insert("reasoningEffort".to_string(), Value::String(effort.clone()));
            }
            None => {
                metadata.remove("reasoningEffort");
                metadata.remove("effort");
            }
        }
        persist_collaboration_mode(metadata, mode)?;
    } else if model_update.is_some() || effort_update.is_some() {
        let model = metadata_string(metadata, &["modelName", "model"])
            .ok_or_else(|| "thread settings require a persisted model".to_string())?;
        let effort = metadata_string(metadata, &["reasoningEffort", "effort"]);
        let mut mode =
            persisted_collaboration_mode(metadata)?.unwrap_or_else(|| CollaborationMode {
                mode: ModeKind::Default,
                settings: CollaborationModeSettings {
                    model: model.clone(),
                    reasoning_effort: effort.clone(),
                    developer_instructions: None,
                },
            });
        if let Some(model) = model_update {
            mode.settings.model = model;
        }
        if reset_effort_for_model {
            mode.settings.reasoning_effort = None;
        } else if let Some(effort) = effort_update {
            mode.settings.reasoning_effort = Some(effort);
        }
        persist_collaboration_mode(metadata, mode)?;
    }
    insert_value(metadata, "personality", params.personality);
    insert_value(metadata, "toolPreferences", params.tool_preferences);
    Ok(())
}

pub(super) fn thread_settings_from_metadata(
    metadata: &Map<String, Value>,
) -> Result<ThreadSettings, String> {
    let model = metadata_string(metadata, &["modelName", "model"])
        .ok_or_else(|| "thread settings require a persisted model".to_string())?;
    let model_provider = metadata_string(
        metadata,
        &["providerSelector", "providerName", "modelProvider"],
    )
    .ok_or_else(|| "thread settings require a persisted model provider".to_string())?;
    let effort = metadata_string(metadata, &["reasoningEffort", "effort"]);
    let collaboration_mode =
        persisted_collaboration_mode(metadata)?.unwrap_or_else(|| CollaborationMode {
            mode: ModeKind::Default,
            settings: CollaborationModeSettings {
                model: model.clone(),
                reasoning_effort: effort.clone(),
                developer_instructions: None,
            },
        });
    Ok(ThreadSettings {
        cwd: metadata_string(metadata, &["workingDir", "cwd"]).unwrap_or_default(),
        approval_policy: metadata_value(metadata, &["approvalPolicy"]),
        approvals_reviewer: agent_protocol::ApprovalsReviewer::parse(
            metadata
                .get("approvalsReviewer")
                .or_else(|| metadata.get("approvals_reviewer")),
        )?
        .unwrap_or_default(),
        sandbox_policy: metadata_value(metadata, &["sandboxPolicy", "sandbox"]),
        active_permission_profile: metadata_alias(metadata, &["activePermissionProfile"]),
        model,
        model_provider,
        service_tier: metadata_string(metadata, &["serviceTier"]),
        effort,
        summary: metadata_alias(metadata, &["reasoningSummary", "summary"]),
        collaboration_mode,
        personality: metadata_alias(metadata, &["personality"]),
        tool_preferences: metadata_alias(metadata, &["toolPreferences"]),
    })
}

pub(super) fn persisted_collaboration_mode(
    metadata: &Map<String, Value>,
) -> Result<Option<CollaborationMode>, String> {
    metadata
        .get("collaborationMode")
        .cloned()
        .map(serde_json::from_value::<CollaborationMode>)
        .transpose()
        .map_err(|error| format!("invalid persisted collaborationMode: {error}"))
}

fn persist_collaboration_mode(
    metadata: &mut Map<String, Value>,
    mode: CollaborationMode,
) -> Result<(), String> {
    metadata.insert(
        "collaborationMode".to_string(),
        serde_json::to_value(mode)
            .map_err(|error| format!("serialize collaboration mode: {error}"))?,
    );
    Ok(())
}
