//! Storage requirements retain the upstream shape but are rejected at admission.
//! Desktop workspace path enforcement must exist before these can be accepted.

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ApplicationStorageRequirementsToml {
    #[serde(default, deserialize_with = "deserialize_absolute_path")]
    pub default_project_parent: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_absolute_path")]
    pub projectless_workspace_root: Option<PathBuf>,
}

fn deserialize_absolute_path<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<PathBuf>, D::Error> {
    let path = PathBuf::deserialize(deserializer)?;
    if !path.is_absolute() {
        return Err(serde::de::Error::custom(
            "expected an absolute storage path",
        ));
    }
    Ok(Some(path))
}
