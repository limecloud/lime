use super::*;
use serde::Deserialize;
use tool_runtime::hook_config::HooksFile;
use tool_runtime::hook_source::{PluginHookLoadOutcome, PluginHookSource};

#[derive(Deserialize)]
#[serde(untagged)]
enum Declaration {
    Path(String),
    Paths(Vec<String>),
    Inline(HooksFile),
    InlineList(Vec<HooksFile>),
    Invalid(Value),
}

pub(crate) fn load(store: &PluginStore) -> Result<PluginHookLoadOutcome, String> {
    let mut outcome = PluginHookLoadOutcome::default();
    for record in store.installed()?.values().filter(|record| record.enabled) {
        match manifest::read_manifest_with_name(&record.root, Some(&record.id.name)) {
            Ok(manifest) => {
                let loaded = load_from_manifest(store, &record.root, &record.id, &manifest, true);
                outcome.sources.extend(loaded.sources);
                outcome.warnings.extend(loaded.warnings);
            }
            Err(error) => outcome
                .warnings
                .push(format!("{}: {error}", record.id.key())),
        }
    }
    Ok(outcome)
}

pub(super) fn declarations(
    store: &PluginStore,
    root: &Path,
    id: &PluginId,
    manifest: &Value,
) -> Vec<PluginHookSummary> {
    load_from_manifest(store, root, id, manifest, false)
        .sources
        .iter()
        .flat_map(PluginHookSource::declarations)
        .map(|(key, event_name)| PluginHookSummary {
            key,
            event_name: event_name.into(),
        })
        .collect()
}

fn load_from_manifest(
    store: &PluginStore,
    root: &Path,
    id: &PluginId,
    manifest: &Value,
    prepare_data: bool,
) -> PluginHookLoadOutcome {
    let mut outcome = PluginHookLoadOutcome::default();
    // Lime's AgentPlugin load scope excludes Hooks, including client extensions.
    if manifest::is_standard_manifest(manifest) {
        return outcome;
    }
    let data_root = match store.data_root(id, false) {
        Ok(root) => root,
        Err(error) => {
            outcome.warnings.push(error);
            return outcome;
        }
    };
    let source = |path: PathBuf, relative: String, hooks: HooksFile| {
        (!hooks.hooks.is_empty()).then(|| PluginHookSource {
            plugin_id: id.key(),
            plugin_root: root.to_path_buf(),
            plugin_data_root: data_root.clone(),
            source_path: path,
            source_relative_path: relative,
            hooks: hooks.hooks,
        })
    };
    let declaration = manifest.get("hooks").cloned().map(|value| {
        serde_json::from_value::<Declaration>(value).expect("invalid declaration captures any JSON")
    });
    let (paths, inline) = match declaration {
        Some(Declaration::Path(path)) => (vec![path], None),
        Some(Declaration::Paths(paths)) => (paths, None),
        Some(Declaration::Inline(hooks)) => (Vec::new(), Some(vec![hooks])),
        Some(Declaration::InlineList(hooks)) if !hooks.is_empty() => (Vec::new(), Some(hooks)),
        Some(Declaration::Invalid(_value)) => {
            tracing::warn!(plugin_id = %id.key(), "忽略不合法的 Plugin Hooks 声明");
            (Vec::new(), None)
        }
        _ => (Vec::new(), None),
    };
    if let Some(inline) = inline {
        match manifest::find_manifest_path(root) {
            Ok(path) => {
                for (index, hooks) in inline.into_iter().enumerate() {
                    outcome.sources.extend(source(
                        path.clone(),
                        format!("plugin.json#hooks[{index}]"),
                        hooks,
                    ));
                }
            }
            Err(error) => outcome.warnings.push(error),
        }
    } else {
        let mut paths = paths
            .into_iter()
            .filter(|path| valid_path(path))
            .collect::<Vec<_>>();
        if paths.is_empty() && root.join("hooks/hooks.json").is_file() {
            paths.push("./hooks/hooks.json".to_string());
        }
        for relative in paths {
            let result = resource_path(root, &relative).and_then(|path| {
                let text = fs::read_to_string(&path).map_err(io_error("读取 Plugin Hooks 失败"))?;
                let hooks = serde_json::from_str::<HooksFile>(&text)
                    .map_err(|error| format!("解析 Plugin Hooks 失败: {error}"))?;
                Ok((path, hooks))
            });
            match result {
                Ok((path, hooks)) => outcome.sources.extend(source(
                    path.clone(),
                    path.strip_prefix(root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .replace('\\', "/"),
                    hooks,
                )),
                Err(error) => outcome
                    .warnings
                    .push(format!("{} {relative}: {error}", id.key())),
            }
        }
    }
    if prepare_data && !outcome.sources.is_empty() {
        if let Err(error) = fs::create_dir_all(&data_root) {
            outcome.warnings.push(format!(
                "{}: 创建 Plugin Hook data 目录失败: {error}",
                id.key()
            ));
            outcome.sources.clear();
        }
    }
    outcome
}

fn valid_path(path: &str) -> bool {
    path.strip_prefix("./").is_some_and(|path| {
        !path.is_empty()
            && !Path::new(path).is_absolute()
            && !Path::new(path).components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
    })
}

#[cfg(test)]
mod tests;
