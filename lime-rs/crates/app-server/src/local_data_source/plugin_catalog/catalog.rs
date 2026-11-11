use super::*;

pub(crate) fn list(
    store: &PluginStore,
    params: PluginListParams,
) -> Result<PluginListResponse, String> {
    let mut response = PluginListResponse::default();
    if params
        .marketplace_kinds
        .as_ref()
        .is_some_and(|kinds| !kinds.contains(&PluginListMarketplaceKind::Local))
    {
        return Ok(response);
    }
    let records = store.installed()?;
    for path in implicit_marketplace_paths(store, params.cwds.as_deref())? {
        let entry = load_marketplace(&path).and_then(|marketplace| {
            let plugins = marketplace
                .plugins
                .iter()
                .map(|plugin| {
                    build_summary(
                        &plugin.root,
                        &plugin.id,
                        records.get(&plugin.id.key()),
                        plugin.install_policy,
                        plugin.auth_policy,
                    )
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(PluginMarketplaceEntry {
                name: marketplace.name,
                path: Some(marketplace.path),
                interface: marketplace.interface,
                plugins,
            })
        });
        match entry {
            Ok(entry) => response.marketplaces.push(entry),
            Err(message) => response
                .marketplace_load_errors
                .push(MarketplaceLoadErrorInfo {
                    marketplace_path: path,
                    message,
                }),
        }
    }
    Ok(response)
}

pub(crate) fn installed(
    store: &PluginStore,
    params: PluginInstalledParams,
) -> Result<PluginInstalledResponse, String> {
    let response = list(
        store,
        PluginListParams {
            cwds: params.cwds,
            ..Default::default()
        },
    )?;
    let names = params.install_suggestion_plugin_names.unwrap_or_default();
    let mut marketplaces: Vec<PluginMarketplaceEntry> = response
        .marketplaces
        .into_iter()
        .filter_map(|mut marketplace| {
            marketplace
                .plugins
                .retain(|plugin| plugin.installed || names.contains(&plugin.name));
            (!marketplace.plugins.is_empty()).then_some(marketplace)
        })
        .collect();
    let mut remote_markets = std::collections::BTreeMap::<String, Vec<PluginSummary>>::new();
    let records = store.installed()?;
    let identity = store.remote_identity().unwrap_or(None);
    let state = identity
        .as_deref()
        .map(|identity| remote::state::read(store, identity))
        .transpose()?
        .flatten();
    for record in records.values().filter(|record| record.remote.is_some()) {
        if state.is_some() {
            continue;
        }
        remote_markets
            .entry(record.id.marketplace.clone())
            .or_default()
            .push(remote::installed_summary(record)?);
    }
    if let Some(state) = state {
        let config = {
            let _guard = lime_core::config::config_file_lock();
            lime_core::config::ConfigManager::load(&store.config_path)
                .map_err(|error| error.to_string())?
        };
        for mut summary in state.plugins.into_values() {
            let id = PluginId::parse(&summary.id)?;
            summary.local_version = records
                .get(&summary.id)
                .map(|record| record.version.clone());
            summary.enabled &= config.config().plugins.enabled(&summary.id);
            remote_markets
                .entry(id.marketplace)
                .or_default()
                .push(summary);
        }
    }
    if store.remote_identity().unwrap_or(None) != identity {
        return Err("account changed while reading installed plugins".into());
    }
    marketplaces.extend(
        remote_markets
            .into_iter()
            .map(|(name, plugins)| PluginMarketplaceEntry {
                name,
                path: None,
                interface: None,
                plugins,
            }),
    );
    Ok(PluginInstalledResponse {
        marketplaces,
        marketplace_load_errors: response.marketplace_load_errors,
    })
}

pub(crate) fn search(
    store: &PluginStore,
    params: PluginSearchParams,
) -> Result<PluginSearchResponse, String> {
    const DEFAULT_LIMIT: u32 = 16;
    const MAX_LIMIT: u32 = 1_000;
    let term = params.search_term.trim().to_lowercase();
    if term.is_empty() {
        return Ok(PluginSearchResponse {
            data: Vec::new(),
            next_cursor: None,
        });
    }
    let cwds = params
        .cwds
        .map(|paths| paths.into_iter().map(PathBuf::from).collect::<Vec<_>>());
    let response = list(
        store,
        PluginListParams {
            cwds: cwds.clone(),
            ..Default::default()
        },
    )?;
    let home = &store.home;
    let bundled = store
        .bundled_marketplace
        .as_ref()
        .and_then(|path| fs::canonicalize(path).ok());
    let mut results = Vec::new();
    for marketplace in response.marketplaces {
        let path = marketplace.path.as_deref();
        let in_scope = match params.scope {
            Some(PluginSearchScope::Global) => path == bundled.as_deref(),
            Some(PluginSearchScope::Workspace) => path.is_some_and(|path| {
                cwds.as_deref().unwrap_or_default().iter().any(|cwd| {
                    fs::canonicalize(cwd)
                        .ok()
                        .is_some_and(|cwd| path.starts_with(cwd))
                })
            }),
            Some(PluginSearchScope::Personal) => path.is_some_and(|path| {
                home.as_ref().is_some_and(|home| path.starts_with(home))
                    && Some(path) != bundled.as_deref()
                    && !cwds
                        .as_deref()
                        .unwrap_or_default()
                        .iter()
                        .any(|cwd| path.starts_with(cwd))
            }),
            None => true,
        };
        if !in_scope {
            continue;
        }
        for plugin in marketplace.plugins {
            if matches_query(&plugin, &term) {
                results.push(PluginSearchResult {
                    marketplace_name: marketplace.name.clone(),
                    marketplace_path: marketplace
                        .path
                        .as_ref()
                        .map(|path| path.to_string_lossy().into_owned()),
                    plugin,
                });
            }
        }
    }
    let offset = params
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| "plugin/search cursor 必须是非负整数。".to_string())?;
    let start = offset.min(results.len());
    let end = start
        .saturating_add(params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize)
        .min(results.len());
    Ok(PluginSearchResponse {
        data: results[start..end].to_vec(),
        next_cursor: (end < results.len()).then(|| end.to_string()),
    })
}

pub(crate) fn read(
    store: &PluginStore,
    params: PluginReadParams,
) -> Result<PluginReadResponse, String> {
    if params.marketplace_path.is_none() && params.remote_marketplace_name.is_some() {
        return remote::read(store, &params);
    }
    let (marketplace, index) = resolve_plugin(
        params.marketplace_path.as_deref(),
        params.remote_marketplace_name.as_deref(),
        &params.plugin_name,
    )?;
    let entry = &marketplace.plugins[index];
    let records = store.installed()?;
    let record = records.get(&entry.id.key());
    let summary = build_summary(
        &entry.root,
        &entry.id,
        record,
        entry.install_policy,
        entry.auth_policy,
    )?;
    let root = record
        .map(|record| record.root.as_path())
        .unwrap_or(&entry.root);
    let manifest = manifest::read_manifest_with_name(root, Some(&entry.id.name))?;
    let detail = build_capability_detail(root, &manifest)?;
    let enabled = summary.enabled;
    Ok(PluginReadResponse {
        plugin: PluginDetail {
            marketplace_name: marketplace.name,
            marketplace_path: Some(marketplace.path),
            summary,
            share_url: None,
            description: interface_string(&manifest, "longDescription")
                .or_else(|| manifest_string(&manifest, "description")),
            skills: detail
                .skills
                .into_iter()
                .map(|mut skill| {
                    skill.enabled &= enabled;
                    skill
                })
                .collect(),
            onboarding_skill: None,
            mcp_servers: detail.mcp_servers,
            apps: detail.apps,
            hooks: hooks::declarations(store, root, &entry.id, &manifest),
            app_templates: Vec::new(),
            scheduled_tasks: None,
        },
    })
}

pub(super) fn build_summary(
    package_root: &Path,
    id: &PluginId,
    record: Option<&Installation>,
    install_policy: PluginInstallPolicy,
    auth_policy: PluginAuthPolicy,
) -> Result<PluginSummary, String> {
    let manifest = manifest::read_manifest_with_name(package_root, Some(&id.name))?;
    let interface_value = manifest
        .get("interface")
        .cloned()
        .or_else(|| {
            manifest
                .pointer("/extensions/com.openai/interface")
                .cloned()
        })
        .unwrap_or_else(|| serde_json::json!({}));
    let mut interface: PluginInterface = serde_json::from_value(interface_value)
        .map_err(|error| format!("Plugin interface 不合法: {error}"))?;
    interface
        .display_name
        .get_or_insert_with(|| id.name.clone());
    if interface.short_description.is_none() {
        interface.short_description = manifest_string(&manifest, "description");
    }
    Ok(PluginSummary {
        id: id.key(),
        remote_plugin_id: None,
        version: Some(manifest_version(&manifest)?),
        local_version: record.map(|record| record.version.clone()),
        name: id.name.clone(),
        share_context: None,
        source: PluginSource::Local {
            path: package_root.to_string_lossy().into_owned(),
        },
        installed: record.is_some(),
        installed_at: None,
        enabled: record.is_some_and(|record| record.enabled),
        install_policy,
        install_policy_source: None,
        must_show_installation_interstitial: None,
        auth_policy,
        availability: PluginAvailability::Available,
        disabled_reason: None,
        eligible_plan_types: None,
        interface: Some(interface),
        keywords: manifest
            .get("keywords")
            .and_then(Value::as_array)
            .map(|keywords| {
                keywords
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

fn matches_query(plugin: &PluginSummary, query: &str) -> bool {
    let interface = plugin.interface.as_ref();
    [
        Some(plugin.id.as_str()),
        Some(plugin.name.as_str()),
        interface.and_then(|value| value.display_name.as_deref()),
        interface.and_then(|value| value.short_description.as_deref()),
    ]
    .into_iter()
    .flatten()
    .any(|value| value.to_lowercase().contains(query))
        || plugin
            .keywords
            .iter()
            .any(|value| value.to_lowercase().contains(query))
}
