use super::*;

pub(crate) fn list_apps(
    store: &PluginStore,
    params: AppsListParams,
) -> Result<AppsListResponse, String> {
    const DEFAULT_LIMIT: u32 = 50;
    const MAX_LIMIT: u32 = 100;

    let apps = app_catalog(store)?;
    let offset = params
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| "app/list cursor 必须是非负整数。".to_string())?;
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
    let start = offset.min(apps.len());
    let end = start.saturating_add(limit).min(apps.len());

    Ok(AppsListResponse {
        data: apps[start..end].to_vec(),
        next_cursor: (end < apps.len()).then(|| end.to_string()),
    })
}

pub(crate) fn read_apps(
    store: &PluginStore,
    params: AppsReadParams,
) -> Result<AppsReadResponse, String> {
    const MAX_APP_IDS: usize = 100;

    if params.app_ids.len() > MAX_APP_IDS {
        return Err(format!(
            "app/read appIds 最多允许 {MAX_APP_IDS} 项，实际为 {}。",
            params.app_ids.len()
        ));
    }

    let catalog = app_catalog(store)?
        .into_iter()
        .map(|app| (app.id.clone(), app))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut seen = std::collections::BTreeSet::new();
    let mut apps = Vec::new();
    let mut missing_app_ids = Vec::new();

    for app_id in params.app_ids {
        if !seen.insert(app_id.clone()) {
            continue;
        }
        let Some(app) = catalog.get(&app_id) else {
            missing_app_ids.push(app_id);
            continue;
        };
        apps.push(ConnectorMetadata {
            id: app.id.clone(),
            name: app.name.clone(),
            description: app.description.clone(),
            icon_url: app.logo_url.clone(),
            icon_url_dark: app.logo_url_dark.clone(),
            distribution_channel: app.distribution_channel.clone(),
            install_url: app.install_url.clone(),
            plugin_display_names: app.plugin_display_names.clone(),
            tool_summaries: params.include_tools.then(Vec::new),
        });
    }

    Ok(AppsReadResponse {
        apps,
        missing_app_ids,
    })
}

pub(crate) fn installed_apps(
    store: &PluginStore,
    _params: AppsInstalledParams,
) -> Result<AppsInstalledResponse, String> {
    Ok(AppsInstalledResponse {
        apps: app_catalog(store)?
            .into_iter()
            .map(|app| InstalledApp {
                id: app.id,
                runtime_name: Some(app.name),
                enabled: app.is_enabled,
                // Local Plugin apps currently have no hosted connector tool snapshot.
                callable: false,
            })
            .collect(),
    })
}

pub(super) fn app_catalog(store: &PluginStore) -> Result<Vec<AppInfo>, String> {
    let mut apps = std::collections::BTreeMap::<String, AppInfo>::new();
    for record in store.installed()?.values() {
        let manifest = manifest::read_manifest_with_name(&record.root, Some(&record.id.name))?;
        let display_name =
            interface_string(&manifest, "displayName").unwrap_or_else(|| record.id.name.clone());
        for capability in build_capability_detail(&record.root, &manifest)?.apps {
            let app = apps
                .entry(capability.id.clone())
                .or_insert_with(|| AppInfo {
                    id: capability.id,
                    name: capability.name,
                    description: capability.description,
                    logo_url: None,
                    logo_url_dark: None,
                    icon_assets: None,
                    icon_dark_assets: None,
                    distribution_channel: Some(record.id.marketplace.clone()),
                    branding: None,
                    app_metadata: None,
                    labels: None,
                    install_url: capability.install_url,
                    // Package declarations do not establish hosted access or tool readiness.
                    is_accessible: false,
                    is_enabled: record.enabled,
                    plugin_display_names: Vec::new(),
                });
            app.is_enabled |= record.enabled;
            if !app.plugin_display_names.contains(&display_name) {
                app.plugin_display_names.push(display_name.clone());
            }
        }
    }

    Ok(apps.into_values().collect())
}

pub(super) fn app_capabilities(
    package_root: &Path,
    manifest: &Value,
) -> Result<Vec<AppSummary>, String> {
    if manifest::is_standard_manifest(manifest) {
        return Ok(Vec::new());
    }
    declared_app_capabilities(package_root, manifest)
}

pub(super) fn declared_app_capabilities(
    package_root: &Path,
    manifest: &Value,
) -> Result<Vec<AppSummary>, String> {
    let path = manifest_path(package_root, manifest.get("apps"));
    if !path.exists() {
        return Ok(Vec::new());
    }
    let relative = path
        .strip_prefix(package_root)
        .map_err(|_| "Lime Plugin Apps 路径越界。".to_string())?;
    let path = resource_path(package_root, &relative.to_string_lossy())?;
    let content = fs::read_to_string(&path).map_err(io_error("读取 Lime Plugin Apps 配置失败"))?;
    let value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("解析 Lime Plugin Apps 配置失败: {error}"))?;
    let apps = value
        .get("apps")
        .and_then(Value::as_object)
        .ok_or_else(|| "Lime Plugin Apps 配置必须包含 apps object。".to_string())?;
    let mut capabilities = Vec::new();
    for (name, config) in apps {
        let id = config
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| format!("Lime Plugin App `{name}` 缺少合法 id。"))?;
        if config
            .get("category")
            .is_some_and(|category| !category.is_null() && !category.is_string())
        {
            return Err(format!(
                "Lime Plugin App `{name}` 的 category 必须是 string。"
            ));
        }
        capabilities.push(AppSummary {
            id: id.to_string(),
            name: name.clone(),
            description: None,
            install_url: None,
            category: config
                .get("category")
                .and_then(Value::as_str)
                .map(str::to_string),
        });
    }
    capabilities.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(capabilities)
}

pub(super) fn manifest_path(package_root: &Path, value: Option<&Value>) -> PathBuf {
    let relative = value
        .and_then(Value::as_str)
        .and_then(|path| path.strip_prefix("./"))
        .filter(|path| {
            !path.is_empty()
                && !path.contains(['\\', ':'])
                && !path.split('/').any(|component| component == "..")
                && !Path::new(path)
                    .components()
                    .any(|component| matches!(component, Component::RootDir | Component::Prefix(_)))
        });
    if value.and_then(Value::as_str).is_some() && relative.is_none() {
        tracing::warn!("忽略非法 Plugin Apps 路径，使用默认 .app.json");
    }
    package_root.join(relative.unwrap_or(".app.json"))
}
