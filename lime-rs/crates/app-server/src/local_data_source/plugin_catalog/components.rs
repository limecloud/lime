use super::*;

pub(crate) fn enabled_plugin_turn_snapshots(
    store: &PluginStore,
) -> Result<Vec<crate::runtime::PluginTurnSnapshot>, String> {
    let mut snapshots = Vec::new();
    for record in store.installed()?.values() {
        if !record.enabled {
            continue;
        }
        let package_root = record.root.clone();
        let manifest = manifest::read_manifest_with_name(&package_root, Some(&record.id.name))?;
        let id = record.id.name.clone();
        let config_name = record.id.key();
        let display_name = interface_string(&manifest, "displayName").unwrap_or_else(|| id.clone());
        let skills = plugin_skills(&package_root, &manifest, &config_name)?;
        let skill_roots = manifest::skill_paths(&package_root, &manifest)?;
        let mcp_server_names =
            plugin_mcp_server_descriptors(store, &package_root, &record.id, true)
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        plugin_id = %id,
                        %error,
                        "禁用包含非法 mcp.json 的 Agent Plugin MCP 组件"
                    );
                    Vec::new()
                })
                .into_iter()
                .map(|server| server.runtime_name)
                .collect::<Vec<_>>();
        snapshots.push(crate::runtime::PluginTurnSnapshot {
            id,
            config_name,
            display_name,
            package_root,
            skills,
            skill_roots,
            mcp_server_names,
        });
    }
    snapshots.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(snapshots)
}

pub(crate) fn list_plugin_mcp_runtime_server_specs(
    store: &PluginStore,
) -> Result<Vec<McpRuntimeServerSpec>, String> {
    let mut specs = Vec::new();
    for record in store.installed()?.values() {
        if !record.enabled {
            continue;
        }
        let package_root = record.root.clone();
        let plugin_id = record.id.key();
        let servers = match plugin_mcp_server_descriptors(store, &package_root, &record.id, true) {
            Ok(servers) => servers,
            Err(error) => {
                tracing::warn!(
                    plugin_id,
                    %error,
                    "禁用包含非法 mcp.json 的 Agent Plugin MCP 组件"
                );
                continue;
            }
        };
        for server in servers {
            specs.push(McpRuntimeServerSpec {
                name: server.runtime_name,
                plugin_id: Some(plugin_id.clone()),
                config: server.config,
            });
        }
    }
    specs.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(specs)
}

pub(super) struct PluginMcpServerDescriptor {
    id: String,
    runtime_name: String,
    config: McpServerConfig,
}

pub(super) fn plugin_mcp_server_descriptors(
    store: &PluginStore,
    package_root: &Path,
    id: &PluginId,
    prepare_data: bool,
) -> Result<Vec<PluginMcpServerDescriptor>, String> {
    let package_root = canonical_package_root(package_root)?;
    let manifest = manifest::read_manifest_with_name(&package_root, Some(&id.name))?;
    parse_mcp_server_descriptors(store, &package_root, id, &manifest, prepare_data)
}

fn parse_mcp_server_descriptors(
    store: &PluginStore,
    package_root: &Path,
    id: &PluginId,
    manifest: &Value,
    prepare_data: bool,
) -> Result<Vec<PluginMcpServerDescriptor>, String> {
    let standard = manifest::is_standard_manifest(&manifest);
    let plugin_id = id.key();
    let data_root = store.data_root(id, standard)?;
    let fallback = Value::String("./.mcp.json".to_string());
    let declaration = manifest
        .get("mcpServers")
        .filter(|value| {
            value.is_object() || value.as_str().is_some_and(|path| path.starts_with("./"))
        })
        .unwrap_or(&fallback);
    let mut outcome = match declaration {
        Value::String(relative) if relative.starts_with("./") => {
            let path = match resource_path(&package_root, relative) {
                Ok(path) if path.is_file() => path,
                _ => return Ok(Vec::new()),
            };
            let content = fs::read_to_string(path).map_err(io_error("读取 Plugin MCP 配置失败"))?;
            if standard {
                parse_agent_plugin_mcp_config(&package_root, &data_root, &content)
                    .map_err(|error| error.to_string())?
            } else {
                lime_mcp::parse_plugin_mcp_config(&package_root, &content)
                    .map_err(|error| error.to_string())?
            }
        }
        Value::Object(servers) if !standard => lime_mcp::parse_plugin_mcp_config(
            &package_root,
            &Value::Object(servers.clone()).to_string(),
        )
        .map_err(|error| error.to_string())?,
        _ => return Ok(Vec::new()),
    };
    let has_stdio = standard
        && outcome
            .servers
            .values()
            .any(|config| matches!(&config.transport, McpServerTransport::Stdio { .. }));
    if has_stdio && prepare_data {
        if let Err(error) = fs::create_dir_all(&data_root) {
            tracing::warn!(
                plugin_id,
                path = %data_root.display(),
                %error,
                "创建 Agent Plugins PLUGIN_DATA 目录失败，隔离 stdio MCP server"
            );
            outcome
                .servers
                .retain(|_, config| !matches!(&config.transport, McpServerTransport::Stdio { .. }));
        }
    }
    let mut descriptors = Vec::new();
    for (id, config) in outcome.servers {
        let runtime_name = id.clone();
        descriptors.push(PluginMcpServerDescriptor {
            id: id.clone(),
            runtime_name,
            config,
        });
    }
    for error in outcome.errors {
        tracing::warn!(
            plugin_id,
            server_id = error.name,
            message = error.message,
            "跳过非法 Agent Plugins MCP server 配置"
        );
    }
    descriptors.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(descriptors)
}

pub(super) struct CapabilityDetail {
    pub(super) skills: Vec<SkillSummary>,
    pub(super) mcp_servers: Vec<String>,
    pub(super) apps: Vec<AppSummary>,
}

pub(super) fn build_capability_detail(
    package_root: &Path,
    manifest: &Value,
) -> Result<CapabilityDetail, String> {
    let skills = skill_capabilities(package_root, manifest)?;
    let mcp_servers = mcp_capabilities(package_root, manifest).unwrap_or_else(|error| {
        tracing::warn!(%error, "禁用包含非法配置的 Plugin MCP 组件");
        Vec::new()
    });
    let apps = match app_capabilities(package_root, manifest) {
        Ok(apps) => apps,
        Err(error) => {
            tracing::warn!(
                path = %package_root.display(),
                %error,
                "禁用包含非法配置的 Lime Plugin Apps 组件"
            );
            Vec::new()
        }
    };
    Ok(CapabilityDetail {
        skills,
        mcp_servers,
        apps,
    })
}

pub(super) fn skill_capabilities(
    package_root: &Path,
    manifest: &Value,
) -> Result<Vec<SkillSummary>, String> {
    let name = manifest_name(&manifest)?;
    Ok(plugin_skills(package_root, &manifest, &name)?
        .into_iter()
        .map(|skill| SkillSummary {
            name: skill.name,
            description: skill.description,
            short_description: None,
            interface: None,
            path: Some(skill.skill_file_path.to_string_lossy().into_owned()),
            enabled: skill.enabled,
        })
        .collect())
}

pub(crate) fn plugin_skills(
    package_root: &Path,
    manifest: &Value,
    plugin_id: &str,
) -> Result<Vec<lime_skills::AgentSkillMetadata>, String> {
    let mut directories = std::collections::BTreeSet::new();
    for root in manifest::skill_paths(package_root, manifest)? {
        discover_skills(
            &root,
            !manifest::is_standard_manifest(manifest),
            &mut directories,
        )?;
    }
    let roots = directories
        .iter()
        .filter_map(|directory| directory.parent())
        .map(|path| lime_skills::AgentSkillRoot {
            path: path.to_path_buf(),
            scope: lime_skills::AgentSkillScope::App,
        });
    let mut skills = lime_skills::build_agent_skill_snapshot_from_roots(roots).skills;
    skills.retain(|skill| directories.contains(&skill.directory));
    let namespace = manifest_name(manifest)?;
    for skill in &mut skills {
        skill.skill_id = format!("plugin:{plugin_id}:{}", skill.name);
        skill.name = format!("{namespace}:{}", skill.name);
    }
    skills.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then(left.skill_file_path.cmp(&right.skill_file_path))
    });
    Ok(skills)
}

fn discover_skills(
    root: &Path,
    recursive: bool,
    directories: &mut std::collections::BTreeSet<PathBuf>,
) -> Result<(), String> {
    if root.join("SKILL.md").is_file() && recursive {
        directories.insert(root.to_path_buf());
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(io_error("读取 Plugin skills 目录失败"))? {
        let entry = entry.map_err(io_error("读取 Plugin skill 条目失败"))?;
        if !entry
            .file_type()
            .map_err(io_error("读取 Plugin skill 元数据失败"))?
            .is_dir()
            || entry.file_name().to_string_lossy().starts_with('.')
        {
            continue;
        }
        let child = entry.path();
        if child.join("SKILL.md").is_file() {
            directories.insert(child);
        } else if recursive {
            discover_skills(&child, true, directories)?;
        }
    }
    Ok(())
}

pub(super) fn mcp_capabilities(
    package_root: &Path,
    manifest: &Value,
) -> Result<Vec<String>, String> {
    let name = manifest_name(&manifest)?;
    let store = PluginStore::new(
        package_root.join(".plugin-data"),
        package_root.join(".unused-config"),
    );
    Ok(parse_mcp_server_descriptors(
        &store,
        package_root,
        &PluginId::new(&name, "local")?,
        manifest,
        false,
    )?
    .into_iter()
    .map(|server| server.id)
    .collect())
}
