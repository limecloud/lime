//! Resolves the host's symlink opt-out from its already-loaded user config.

use crate::ConfigLayerSource;
use crate::ConfigLayerStack;
use lime_utils_absolute_path::AbsolutePathBuf;

/// Returns the opted-in home without consulting project config or rereading config files.
pub fn allowed_symlinked_lime_home(
    config_layer_stack: &ConfigLayerStack,
    lime_home: &AbsolutePathBuf,
) -> Option<AbsolutePathBuf> {
    let enabled = config_layer_stack
        .layers_low_to_high()
        .find(|layer| matches!(layer.name, ConfigLayerSource::User { profile: None, .. }))?
        .config
        .get("allow_symlinked_lime_home")?
        .as_bool()?;
    if !enabled {
        return None;
    }

    // Preserve a configured alias only when lexical normalization did not change its target.
    let alias = std::env::var_os("LIME_HOME")
        .filter(|path| !path.is_empty())
        .and_then(|path| AbsolutePathBuf::from_absolute_path(path).ok())
        .filter(|path| path.canonicalize().ok().as_ref() == Some(lime_home));
    Some(alias.unwrap_or_else(|| lime_home.clone()))
}
