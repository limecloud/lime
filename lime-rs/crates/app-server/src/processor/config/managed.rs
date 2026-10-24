use super::*;
use lime_core::config::managed::{ManagedConfig, CONFIG_KEY, PREFERENCES_DOMAIN};

pub(super) fn metadata(config: &ManagedConfig) -> ConfigLayerMetadata {
    ConfigLayerMetadata {
        name: ConfigLayerSource::Mdm {
            domain: PREFERENCES_DOMAIN.into(),
            key: CONFIG_KEY.into(),
        },
        version: hex::encode(Sha256::digest(config.source.as_bytes())),
    }
}

pub(super) fn check_edits(edits: &[ConfigEdit]) -> Result<(), JsonRpcError> {
    let managed = lime_core::config::managed::read_config().map_err(config_runtime_error)?;
    check_managed_edits(managed.as_ref(), edits)
}

fn check_managed_edits(
    managed: Option<&ManagedConfig>,
    edits: &[ConfigEdit],
) -> Result<(), JsonRpcError> {
    let Some(managed) = managed else {
        return Ok(());
    };
    for edit in edits {
        let path = parse_key_path(&edit.key_path).map_err(|message| {
            config_write_error(ConfigWriteErrorCode::ConfigValidationError, message)
        })?;
        if managed.contains_path(&path) {
            return Err(config_write_error(
                ConfigWriteErrorCode::ConfigLayerReadonly,
                format!("{} is managed by your system administrator", edit.key_path),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lime_core::config::layers::ConfigLayers;

    fn managed() -> ManagedConfig {
        ManagedConfig {
            config: json!({"model_verbosity":"high", "desktop":{"enabled-reasoning-efforts":["max"]}}),
            source: "model_verbosity = 'high'\n[desktop]\nenabled-reasoning-efforts = ['max']\n"
                .into(),
        }
    }

    #[test]
    fn managed_origins_and_raw_user_layer_are_projected_without_cwd() {
        let user: Config = serde_json::from_value(json!({
            "model_verbosity":"low", "desktop":{"enabled-reasoning-efforts":["max","ultra"]}
        }))
        .unwrap();
        let snapshot = snapshot_from_config(user.clone(), Path::new("/user/config.yaml")).unwrap();
        let stack = ConfigLayers::from_user_with_managed(user, None, Some(managed())).unwrap();
        let response = projects::read_layers_from_stack(
            snapshot,
            ConfigReadParams {
                include_layers: true,
                ..Default::default()
            },
            None,
            stack,
        )
        .unwrap();
        assert_eq!(response.config["model_verbosity"], "high");
        let layers = response.layers.unwrap();
        assert_eq!(layers.len(), 2);
        assert_eq!(layers[0].config["model_verbosity"], "low");
        assert!(matches!(layers[0].name, ConfigLayerSource::User { .. }));
        assert!(matches!(layers[1].name, ConfigLayerSource::Mdm { .. }));
        assert_eq!(response.origins["model_verbosity"].name, layers[1].name);
        assert_eq!(
            response.origins["desktop.enabled-reasoning-efforts.0"].name,
            layers[1].name
        );
        assert!(!response
            .origins
            .contains_key("desktop.enabled-reasoning-efforts.1"));
        assert!(matches!(
            response.origins["approval_policy"].name,
            ConfigLayerSource::User { .. }
        ));
    }

    #[test]
    fn managed_parent_child_and_batch_edits_are_rejected_before_writing() {
        for key in [
            "model_verbosity",
            "desktop",
            "desktop.enabled-reasoning-efforts",
            "desktop.enabled-reasoning-efforts.0",
        ] {
            let error = check_managed_edits(
                Some(&managed()),
                &[ConfigEdit {
                    key_path: key.into(),
                    value: json!(null),
                    merge_strategy: MergeStrategy::Replace,
                }],
            )
            .unwrap_err();
            assert_eq!(
                error.data.unwrap()["config_write_error_code"],
                "configLayerReadonly"
            );
        }
        check_managed_edits(
            Some(&managed()),
            &[ConfigEdit {
                key_path: "model_reasoning_summary".into(),
                value: json!("auto"),
                merge_strategy: MergeStrategy::Replace,
            }],
        )
        .unwrap();
    }
}
