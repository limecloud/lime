use super::*;

/// 只刷新已升级市场中的配置键；disabled 也是配置事实，不能调用会启用插件的安装入口。
pub(super) fn configured_plugins(
    store: &PluginStore,
    roots: &[PathBuf],
) -> Result<Vec<MarketplaceUpgradeErrorInfo>, String> {
    let configured = {
        let _guard = lime_core::config::config_file_lock();
        ConfigManager::load(&store.config_path)
            .map_err(|error| error.to_string())?
            .config()
            .plugins
            .plugins
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
    };
    let mut errors = Vec::new();
    if configured.is_empty() {
        return Ok(errors);
    }
    for root in roots {
        let market = manifest_path(root)
            .ok_or_else(|| "upgraded marketplace manifest is missing".to_string())
            .and_then(|path| load_marketplace(&path));
        let market = match market {
            Ok(market) => market,
            Err(message) => {
                errors.push(MarketplaceUpgradeErrorInfo {
                    marketplace_name: root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    message,
                });
                continue;
            }
        };
        // Curated bundles are refreshed through the remote reconcile owner in Lime.
        if matches!(
            market.name.as_str(),
            "openai-curated" | "openai-api-curated"
        ) {
            continue;
        }
        for entry in market.plugins {
            let key = entry.id.key();
            if !configured.contains(&key) {
                continue;
            }
            if let Err(error) = install::materialize(store, &entry.root, &entry.id, || Ok(())) {
                errors.push(MarketplaceUpgradeErrorInfo {
                    marketplace_name: market.name.clone(),
                    message: format!("failed to refresh plugin cache for {key}: {error}"),
                });
            }
        }
    }
    Ok(errors)
}
