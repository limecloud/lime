use std::path::Path;

pub(crate) fn configured_language(path: &Path) -> Result<String, String> {
    let language = lime_core::config::ConfigManager::load(path)
        .map_err(|_| "account_config_invalid")?
        .config()
        .language
        .clone();
    let language = if language == "auto" {
        std::env::var("LANG")
            .ok()
            .map(|v| v.split('.').next().unwrap_or("en-US").replace('_', "-"))
            .filter(|v| v.len() > 1 && super::oauth::validate_language(v).is_ok())
            .unwrap_or_else(|| "en-US".into())
    } else {
        language
    };
    super::oauth::validate_language(&language)?;
    Ok(language)
}
