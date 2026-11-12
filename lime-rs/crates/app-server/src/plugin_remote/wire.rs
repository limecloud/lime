use super::RuntimeCoreError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub id: String,
    pub publisher_application_id: String,
    pub environment: String,
    pub kind: String,
    pub name: String,
    pub published_release_id: String,
    pub revision: u64,
    pub release: Release,
    pub compatibility: Compatibility,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Compatibility {
    pub status: String,
    pub reasons: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Release {
    pub id: String,
    pub item_id: String,
    pub manifest: Manifest,
    pub manifest_sha256: String,
    pub archive_sha256: String,
    pub archive_size: u64,
    pub status: String,
    pub revision: u64,
}

// The field order and omission rules are the canonical Cloud manifest contract.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Manifest {
    pub schema_version: u8,
    pub kind: String,
    pub name: String,
    pub version: String,
    pub title: Text,
    pub description: Text,
    pub license: String,
    pub hosts: Vec<HostRequirement>,
    pub files: Vec<File>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<Skill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp: Option<Mcp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<Plugin>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Text {
    pub source: String,
    pub translations: BTreeMap<String, String>,
}
impl Text {
    pub fn value(&self, language: &str) -> String {
        self.translations
            .get(language)
            .cloned()
            .unwrap_or_else(|| self.source.clone())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HostRequirement {
    pub id: String,
    pub min_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_version: Option<String>,
    pub capabilities: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct File {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Skill {
    pub entry: String,
    pub actions: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Mcp {
    pub transport: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arguments: Vec<String>,
    pub auth: Authentication,
    pub tools: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Authentication {
    pub r#type: String,
    pub scopes: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Plugin {
    pub entry: String,
    pub dependencies: Vec<Dependency>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Dependency {
    pub release_id: String,
    pub sha256: String,
    pub kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Directory {
    pub items: Vec<Item>,
    pub next_cursor: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Acquisition {
    pub id: String,
    pub release_id: String,
    pub status: String,
    pub revision: u64,
}
#[derive(Deserialize)]
pub(crate) struct Ticket {
    pub sha256: String,
    pub size: u64,
    pub download: Download,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Download {
    pub url: String,
    pub method: String,
    pub headers: BTreeMap<String, String>,
    pub expires_at: String,
}

pub(crate) const CAPABILITIES: &[&str] = &["plugins", "skills", "mcp"];
pub(crate) fn host() -> serde_json::Value {
    serde_json::json!({"id":"lime","version":env!("CARGO_PKG_VERSION"),"capabilities":CAPABILITIES})
}
pub(crate) fn is_marketplace(name: &str) -> bool {
    name.strip_prefix("lime-cloud-").is_some_and(identifier)
}
pub(crate) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
pub(crate) fn validate_remote_id(value: &str) -> Result<(), RuntimeCoreError> {
    if identifier(value) {
        Ok(())
    } else {
        Err(invalid())
    }
}
pub(crate) fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn invalid() -> RuntimeCoreError {
    RuntimeCoreError::Backend("invalid shared market resource".into())
}

impl Manifest {
    pub(crate) fn sha256(&self) -> Result<String, RuntimeCoreError> {
        use sha2::{Digest, Sha256};
        // Go's canonical encoder escapes HTML and Unicode line separators.
        let canonical = serde_json::to_string(self)
            .map_err(|_| invalid())?
            .replace('&', "\\u0026")
            .replace('<', "\\u003c")
            .replace('>', "\\u003e")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029");
        Ok(hex::encode(Sha256::digest(canonical.as_bytes())))
    }
}

impl Item {
    pub(crate) fn marketplace(&self) -> String {
        format!("lime-cloud-{}", self.publisher_application_id)
    }
    pub(crate) fn validate(&self) -> Result<(), RuntimeCoreError> {
        if !identifier(&self.id)
            || !identifier(&self.publisher_application_id)
            || self.name.trim().is_empty()
            || self
                .compatibility
                .reasons
                .iter()
                .any(|r| r.is_empty() || r.len() > 128)
            || self.kind != "plugin"
            || self.kind != self.release.manifest.kind
            || self.published_release_id != self.release.id
            || self.id != self.release.item_id
            || self.revision == 0
            || !matches!(self.environment.as_str(), "sandbox" | "production")
            || !matches!(
                self.compatibility.status.as_str(),
                "supported" | "unsupported" | "unknown"
            )
        {
            return Err(invalid());
        }
        self.release.validate()
    }
}

impl Release {
    pub(crate) fn validate(&self) -> Result<(), RuntimeCoreError> {
        let m = &self.manifest;
        if !identifier(&self.id)
            || !identifier(&self.item_id)
            || self.revision == 0
            || self.status != "approved"
            || !digest(&self.manifest_sha256)
            || m.sha256()? != self.manifest_sha256
            || !digest(&self.archive_sha256)
            || self.archive_size == 0
            || self.archive_size > 8 * 1024 * 1024
            || m.schema_version != 1
            || m.kind != "plugin"
            || m.plugin.is_none()
            || m.skill.is_some()
            || m.mcp.is_some()
            || !valid_name(&m.name)
            || semver::Version::parse(&m.version).is_err()
            || m.files.is_empty()
            || m.files.len() > 10000
        {
            return Err(invalid());
        }
        let mut seen = BTreeSet::new();
        let mut bytes = 0u64;
        for file in &m.files {
            bytes = bytes.checked_add(file.size).ok_or_else(invalid)?;
            if !safe_path(&file.path)
                || !digest(&file.sha256)
                || !seen.insert(&file.path)
                || bytes > 512 * 1024 * 1024
            {
                return Err(invalid());
            }
        }
        let entry = &m.plugin.as_ref().ok_or_else(invalid)?.entry;
        if !safe_path(entry) || !seen.contains(entry) {
            return Err(invalid());
        }
        Ok(())
    }

    pub(crate) fn compatible(&self) -> bool {
        let Ok(current) = semver::Version::parse(env!("CARGO_PKG_VERSION")) else {
            return false;
        };
        self.manifest.hosts.iter().any(|h| {
            h.id == "lime"
                && semver::Version::parse(&h.min_version).is_ok_and(|v| current >= v)
                && h.max_version
                    .as_ref()
                    .is_none_or(|max| semver::Version::parse(max).is_ok_and(|v| current <= v))
                && h.capabilities
                    .iter()
                    .all(|c| CAPABILITIES.contains(&c.as_str()))
        })
    }
}
fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_ .".contains(&b) && b != b' ')
}
pub(crate) fn safe_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains(['\\', ':'])
        && !value.starts_with('/')
        && !value.chars().any(char::is_control)
        && value
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}

#[cfg(test)]
mod tests;
