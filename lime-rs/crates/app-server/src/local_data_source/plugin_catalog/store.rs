use super::*;
use lime_core::config::{ConfigManager, PluginConfig};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub(crate) struct PluginStore {
    pub root: PathBuf,
    pub config_path: PathBuf,
    pub home: Option<PathBuf>,
    pub bundled_marketplace: Option<PathBuf>,
    pub account: Option<std::sync::Arc<crate::account::AccountManager>>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct PluginId {
    pub name: String,
    pub marketplace: String,
}

impl PluginId {
    pub fn new(name: &str, marketplace: &str) -> Result<Self, String> {
        validate_plugin_id(name)?;
        if marketplace.is_empty()
            || !marketplace
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        {
            return Err(format!("Plugin marketplace name 不合法: {marketplace}"));
        }
        Ok(Self {
            name: name.to_string(),
            marketplace: marketplace.to_string(),
        })
    }

    pub fn parse(key: &str) -> Result<Self, String> {
        let (name, marketplace) = key
            .rsplit_once('@')
            .ok_or_else(|| "Plugin ID 必须是 name@marketplace。".to_string())?;
        Self::new(name, marketplace)
    }

    pub fn key(&self) -> String {
        format!("{}@{}", self.name, self.marketplace)
    }
}

#[derive(Debug, Clone)]
pub(super) struct Installation {
    pub id: PluginId,
    pub root: PathBuf,
    pub version: String,
    pub enabled: bool,
    pub remote: Option<remote::InstallMetadata>,
}

impl PluginStore {
    pub fn new(root: PathBuf, config_path: PathBuf) -> Self {
        Self {
            root,
            config_path,
            home: dirs::home_dir(),
            bundled_marketplace: discovery::bundled_marketplace_path_from_env(),
            account: None,
        }
    }

    pub(super) fn base_root(&self, id: &PluginId) -> PathBuf {
        self.root.join("cache").join(&id.marketplace).join(&id.name)
    }

    pub(super) fn installed(&self) -> Result<BTreeMap<String, Installation>, String> {
        self.installations()
    }

    fn installations(&self) -> Result<BTreeMap<String, Installation>, String> {
        // Unreadable credentials hide remote packages; local packages remain usable.
        let identity = self.remote_identity().unwrap_or_else(|error| {
            tracing::warn!(%error, "remote plugin identity unavailable");
            None
        });
        let config = {
            let _guard = lime_core::config::config_file_lock();
            ConfigManager::load(&self.config_path).map_err(|error| error.to_string())?
        };
        let mut installed = BTreeMap::new();
        let cache = self.root.join("cache");
        if !cache.exists() {
            return Ok(installed);
        }
        for marketplace in fs::read_dir(&cache).map_err(io_error("读取 Plugin cache 失败"))? {
            let marketplace = marketplace.map_err(io_error("读取 Plugin marketplace 失败"))?;
            if !marketplace
                .file_type()
                .map_err(io_error("读取 Plugin marketplace 元数据失败"))?
                .is_dir()
            {
                continue;
            }
            for plugin in
                fs::read_dir(marketplace.path()).map_err(io_error("读取 Plugin cache 失败"))?
            {
                let plugin = plugin.map_err(io_error("读取 Plugin cache 条目失败"))?;
                if plugin.file_name().to_string_lossy().starts_with('.')
                    || !plugin
                        .file_type()
                        .map_err(io_error("读取 Plugin cache 元数据失败"))?
                        .is_dir()
                {
                    continue;
                }
                let id = PluginId::new(
                    &plugin.file_name().to_string_lossy(),
                    &marketplace.file_name().to_string_lossy(),
                )?;
                let remote = remote::metadata(&plugin.path())?;
                if remote::is_marketplace(&id.marketplace)
                    && !remote
                        .as_ref()
                        .is_some_and(|metadata| Some(&metadata.account_id) == identity.as_ref())
                {
                    continue;
                }
                if remote.is_some() && !remote::is_marketplace(&id.marketplace) {
                    return Err("Remote Plugin provenance 不属于远端市场。".into());
                }
                let mut versions = Vec::new();
                for version in
                    fs::read_dir(plugin.path()).map_err(io_error("读取 Plugin versions 失败"))?
                {
                    let version = version.map_err(io_error("读取 Plugin version 失败"))?;
                    if version
                        .file_type()
                        .map_err(io_error("读取 Plugin version 元数据失败"))?
                        .is_dir()
                    {
                        let name = version.file_name().to_string_lossy().into_owned();
                        if valid_version(&name) {
                            versions.push(name);
                        }
                    }
                }
                versions.sort_by(|a, b| {
                    match (semver::Version::parse(a), semver::Version::parse(b)) {
                        (Ok(a), Ok(b)) => a.cmp(&b),
                        _ => a.cmp(b),
                    }
                });
                let version = if versions.iter().any(|version| version == "local") {
                    Some("local".to_string())
                } else {
                    versions.pop()
                };
                let Some(version) = version else {
                    continue;
                };
                let root = fs::canonicalize(plugin.path().join(&version))
                    .map_err(io_error("解析 Plugin cache root 失败"))?;
                let manifest = manifest::read_manifest_with_name(&root, Some(&id.name))?;
                if manifest_name(&manifest)? != id.name {
                    return Err(format!("Plugin cache identity 不一致: {}", id.key()));
                }
                let enabled = config.config().plugins.enabled(&id.key());
                installed.insert(
                    id.key(),
                    Installation {
                        id,
                        root,
                        version,
                        enabled,
                        remote,
                    },
                );
            }
        }
        if self.remote_identity().unwrap_or(None) != identity {
            return Err("account changed while reading installed plugins".into());
        }
        Ok(installed)
    }

    pub(super) fn remote_identity(&self) -> Result<Option<String>, String> {
        self.account
            .as_ref()
            .map(|account| account.plugin_identity())
            .transpose()
            .map(Option::flatten)
    }

    pub(super) fn set_enabled(&self, id: &PluginId, enabled: bool) -> Result<(), String> {
        self.update_config(|plugins| {
            plugins
                .plugins
                .entry(id.key())
                .or_insert_with(PluginConfig::default)
                .enabled = Some(enabled);
        })
    }

    pub(super) fn clear_config(&self, id: &PluginId) -> Result<(), String> {
        self.update_config(|plugins| {
            plugins.plugins.remove(&id.key());
        })
    }

    fn update_config(
        &self,
        edit: impl FnOnce(&mut lime_core::config::PluginsConfig),
    ) -> Result<(), String> {
        let _guard = lime_core::config::config_file_lock();
        let mut manager =
            ConfigManager::load(&self.config_path).map_err(|error| error.to_string())?;
        edit(&mut manager.config_mut().plugins);
        manager.save().map_err(|error| error.to_string())
    }

    pub(super) fn data_root(&self, id: &PluginId, standard: bool) -> Result<PathBuf, String> {
        let data = if remote::is_marketplace(&id.marketplace) {
            let metadata =
                remote::metadata(&self.base_root(id))?.ok_or("Remote Plugin provenance 缺失。")?;
            if self.remote_identity()?.as_deref() != Some(metadata.account_id.as_str()) {
                return Err("Remote Plugin data 不属于当前账号。".into());
            }
            self.root.join("data/remote").join(metadata.account_id)
        } else {
            self.root.join("data")
        };
        if standard {
            let mut hash = Sha256::new();
            hash.update(id.marketplace.as_bytes());
            hash.update([0]);
            hash.update(id.name.as_bytes());
            Ok(data
                .join("agent-plugins")
                .join(hex::encode(hash.finalize())))
        } else {
            Ok(data.join(format!("{}-{}", id.name, id.marketplace)))
        }
    }
}

pub(super) fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && !matches!(version, "." | "..")
        && version
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
}
