use super::*;
use lime_core::config::layers::{
    edit_project, merge_defaults, parse_project, save_project, ConfigLayers, PROJECT_CONFIG_FILE,
    PROJECT_CONFIG_FOLDER, PROJECT_DEFAULT_KEYS,
};

pub(super) fn read_layers(
    snapshot: ConfigSnapshot,
    params: ConfigReadParams,
    requirements: Option<&lime_core::config::requirements::ConfigRequirements>,
) -> Result<ConfigReadResponse, JsonRpcError> {
    let user = serde_json::from_value(snapshot.config.clone()).map_err(config_runtime_error)?;
    let stack = ConfigLayers::from_user(user, params.cwd.as_deref().map(Path::new))
        .map_err(config_runtime_error)?;
    read_layers_from_stack(snapshot, params, requirements, stack)
}

pub(super) fn read_layers_from_stack(
    snapshot: ConfigSnapshot,
    params: ConfigReadParams,
    requirements: Option<&lime_core::config::requirements::ConfigRequirements>,
    stack: ConfigLayers,
) -> Result<ConfigReadResponse, JsonRpcError> {
    let metadata = snapshot.metadata();
    let mut origins = BTreeMap::new();
    collect_origins(&snapshot.config, "", &metadata, &mut origins);
    let mut layers = vec![ConfigLayer {
        name: metadata.name,
        version: snapshot.version,
        config: snapshot.config.clone(),
        disabled_reason: None,
    }];
    let mut effective = serde_json::to_value(stack.effective).map_err(config_runtime_error)?;
    for project in stack.projects {
        let metadata = ConfigLayerMetadata {
            name: ConfigLayerSource::Project {
                dot_codex_folder: project.folder.to_string_lossy().into_owned(),
            },
            version: source_version(&project.source),
        };
        if project.disabled_reason.is_none() {
            for key in PROJECT_DEFAULT_KEYS {
                if let Some(value) = project.config.get(key) {
                    collect_origins(value, key, &metadata, &mut origins);
                }
            }
        }
        layers.push(ConfigLayer {
            name: metadata.name,
            version: metadata.version,
            config: project.config,
            disabled_reason: project.disabled_reason,
        });
    }
    if let Some(managed) = stack.managed {
        let metadata = super::managed::metadata(&managed);
        collect_origins(&managed.config, "", &metadata, &mut origins);
        layers.push(ConfigLayer {
            name: metadata.name,
            version: metadata.version,
            config: managed.config,
            disabled_reason: None,
        });
    }
    if let Some(requirements) = requirements {
        let mut typed: Config = serde_json::from_value(effective).map_err(config_runtime_error)?;
        requirements.constrain_defaults(&mut typed);
        effective = serde_json::to_value(typed).map_err(config_runtime_error)?;
    }
    Ok(ConfigReadResponse {
        config: project_search_access(&effective)?,
        origins,
        layers: params.include_layers.then_some(layers),
    })
}

fn source_version(source: &str) -> String {
    hex::encode(Sha256::digest(source.as_bytes()))
}

pub(super) fn write_project_edits(
    user_file: &Path,
    file_path: &str,
    expected_version: Option<String>,
    edits: Vec<ConfigEdit>,
) -> Result<ConfigWriteResponse, JsonRpcError> {
    let path = Path::new(file_path);
    let readonly = |message| config_write_error(ConfigWriteErrorCode::ConfigLayerReadonly, message);
    if !path.is_absolute() {
        return Err(config_write_error(
            ConfigWriteErrorCode::ConfigPathNotFound,
            "config filePath must be absolute",
        ));
    }
    let folder = path
        .parent()
        .filter(|folder| {
            folder
                .file_name()
                .is_some_and(|name| name == PROJECT_CONFIG_FOLDER)
        })
        .filter(|_| {
            path.file_name()
                .is_some_and(|name| name == PROJECT_CONFIG_FILE)
        })
        .ok_or_else(|| {
            readonly("Only user or trusted project configuration files can be written")
        })?;
    let cwd = folder
        .parent()
        .ok_or_else(|| readonly("Project root is missing"))?;
    let stack = ConfigLayers::load(user_file, Some(cwd)).map_err(config_runtime_error)?;
    let project = stack
        .projects
        .last()
        .filter(|project| project.folder == folder)
        .ok_or_else(|| readonly("Project path must be canonical"))?;
    if let Some(reason) = &project.disabled_reason {
        return Err(readonly(reason));
    }
    if expected_version
        .as_deref()
        .is_some_and(|expected| expected != source_version(&project.source))
    {
        return Err(config_write_error(
            ConfigWriteErrorCode::ConfigVersionConflict,
            "Project configuration changed. Fetch latest version and retry.",
        ));
    }
    let mut source = project.source.clone();
    for edit in edits {
        source = edit_project(&source, &edit.key_path, &edit.value).map_err(|error| {
            config_write_error(
                ConfigWriteErrorCode::ConfigValidationError,
                error.to_string(),
            )
        })?;
    }
    let mut effective = serde_json::to_value(stack.user).map_err(config_runtime_error)?;
    for layer in stack
        .projects
        .iter()
        .take(stack.projects.len().saturating_sub(1))
    {
        if layer.disabled_reason.is_none() {
            merge_defaults(&mut effective, &layer.config);
        }
    }
    merge_defaults(
        &mut effective,
        &parse_project(&source).map_err(config_runtime_error)?,
    );
    serde_json::from_value::<Config>(effective).map_err(|error| {
        config_write_error(
            ConfigWriteErrorCode::ConfigValidationError,
            format!("Invalid project configuration: {error}"),
        )
    })?;
    save_project(path, &source).map_err(config_runtime_error)?;
    Ok(ConfigWriteResponse {
        status: WriteStatus::Ok,
        version: source_version(&source),
        file_path: file_path.to_owned(),
        overridden_metadata: None,
    })
}
