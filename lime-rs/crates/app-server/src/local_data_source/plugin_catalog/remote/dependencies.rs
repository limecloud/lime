use super::*;
use crate::market::resource;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::local_data_source::plugin_catalog) struct InstalledDependency {
    pub release: wire::Release,
    pub acquisition_id: String,
}

impl std::fmt::Debug for InstalledDependency {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InstalledDependency")
            .field("release_id", &self.release.id)
            .finish()
    }
}

pub(super) fn validate_metadata(dependencies: &[InstalledDependency]) -> Result<(), String> {
    if dependencies.len() > 32 {
        return Err("invalid plugin dependencies".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut files = 0;
    let mut bytes = 0u64;
    for dependency in dependencies {
        dependency.release.validate().map_err(|e| e.to_string())?;
        if !matches!(dependency.release.manifest.kind.as_str(), "skill" | "mcp")
            || !wire::identifier(&dependency.acquisition_id)
            || !ids.insert(&dependency.release.id)
        {
            return Err("invalid plugin dependency".into());
        }
        files += dependency.release.manifest.files.len();
        bytes += dependency
            .release
            .manifest
            .files
            .iter()
            .map(|file| file.size)
            .sum::<u64>();
    }
    if files > MAX_PACKAGE_FILES || bytes > MAX_PACKAGE_BYTES {
        return Err("invalid plugin dependencies".into());
    }
    Ok(())
}

pub(in crate::local_data_source::plugin_catalog) fn validate_entry(
    root: &Path,
    release: &wire::Release,
) -> Result<(), String> {
    match release.manifest.kind.as_str() {
        "skill" => {
            resource::skill(root, release)?;
        }
        "mcp" => {
            resource::mcp_config(root, release, "staging")?;
        }
        _ => return Err("invalid plugin dependency type".into()),
    }
    Ok(())
}

pub(in crate::local_data_source::plugin_catalog) fn load(
    record: &Installation,
) -> Result<Vec<(PathBuf, wire::Release)>, String> {
    let Some(metadata) = &record.remote else {
        return Ok(Vec::new());
    };
    if metadata.dependencies.is_empty() {
        return Ok(Vec::new());
    }
    let base = record
        .root
        .parent()
        .ok_or("invalid plugin dependency root")?
        .join(".dependencies");
    let info = fs::symlink_metadata(&base).map_err(|_| "plugin dependencies unavailable")?;
    if !info.is_dir() || info.file_type().is_symlink() {
        return Err("invalid plugin dependency root".into());
    }
    let mut result = Vec::new();
    for dependency in &metadata.dependencies {
        let root = base.join(&dependency.release.id);
        crate::market::archive::verify_directory(&root, &dependency.release)?;
        validate_entry(&root, &dependency.release)?;
        result.push((root, dependency.release.clone()));
    }
    Ok(result)
}

pub(in crate::local_data_source::plugin_catalog) fn skill(
    record: &Installation,
    root: &Path,
    release: &wire::Release,
) -> Result<lime_skills::AgentSkillMetadata, String> {
    let mut skill = resource::skill(root, release)?;
    skill.skill_id = format!("plugin:{}:{}", record.id.key(), release.id);
    skill.name = format!("{}:{}", record.id.name, release.manifest.name);
    Ok(skill)
}

pub(in crate::local_data_source::plugin_catalog) fn mcp(
    record: &Installation,
    root: &Path,
    release: &wire::Release,
) -> Result<McpRuntimeServerSpec, String> {
    let metadata = record.remote.as_ref().ok_or("plugin provenance missing")?;
    let name = resource::mcp_name(
        &format!("{}:{}", metadata.account_id, record.id.key()),
        release,
    );
    Ok(McpRuntimeServerSpec {
        config: resource::mcp_config(root, release, &name)?,
        name,
        plugin_id: Some(record.id.key()),
    })
}
