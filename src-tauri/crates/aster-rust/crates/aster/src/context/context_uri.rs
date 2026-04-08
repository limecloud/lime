use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::{Component, PathBuf};
use std::str::FromStr;

const ASTER_URI_SCHEME: &str = "aster://";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextNamespace {
    Resources,
    Memories,
    Skills,
}

impl ContextNamespace {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Resources => "resources",
            Self::Memories => "memories",
            Self::Skills => "skills",
        }
    }
}

impl FromStr for ContextNamespace {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "resources" => Ok(Self::Resources),
            "memories" => Ok(Self::Memories),
            "skills" => Ok(Self::Skills),
            _ => Err(anyhow!(
                "未知命名空间 `{}`，仅支持 resources/memories/skills",
                value
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContextUri {
    pub namespace: ContextNamespace,
    pub relative_path: PathBuf,
}

impl ContextUri {
    pub fn parse(uri: &str) -> Result<Self> {
        Self::from_str(uri)
    }

    pub fn to_storage_path(&self, root_dir: impl Into<PathBuf>) -> PathBuf {
        let mut path = root_dir.into();
        path.push(self.namespace.as_str());
        path.push(&self.relative_path);
        path
    }
}

impl FromStr for ContextUri {
    type Err = anyhow::Error;

    fn from_str(uri: &str) -> Result<Self> {
        let body = uri
            .strip_prefix(ASTER_URI_SCHEME)
            .ok_or_else(|| anyhow!("URI 必须以 `aster://` 开头: {}", uri))?;

        let (namespace_raw, path_raw) = body
            .split_once('/')
            .ok_or_else(|| anyhow!("URI 必须包含命名空间和路径: {}", uri))?;

        let namespace = ContextNamespace::from_str(namespace_raw)?;
        if path_raw.is_empty() {
            return Err(anyhow!("URI 路径不能为空: {}", uri));
        }

        let relative_path = PathBuf::from(path_raw);
        for component in relative_path.components() {
            match component {
                Component::Normal(_) => {}
                Component::CurDir | Component::ParentDir => {
                    return Err(anyhow!("URI 路径不允许 `.` 或 `..`: {}", uri));
                }
                _ => return Err(anyhow!("URI 路径包含非法组件: {}", uri)),
            }
        }

        Ok(Self {
            namespace,
            relative_path,
        })
    }
}

impl std::fmt::Display for ContextUri {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let normalized = self.relative_path.to_string_lossy().replace('\\', "/");
        write!(
            f,
            "{}{}/{}",
            ASTER_URI_SCHEME,
            self.namespace.as_str(),
            normalized
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_context_uri() {
        let uri = ContextUri::parse("aster://resources/docs/getting-started.md").unwrap();
        assert_eq!(uri.namespace, ContextNamespace::Resources);
        assert_eq!(
            uri.relative_path,
            PathBuf::from("docs").join("getting-started.md")
        );
    }

    #[test]
    fn test_parse_invalid_scheme() {
        let result = ContextUri::parse("file://resources/test.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_namespace() {
        let result = ContextUri::parse("aster://unknown/test.md");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_path_traversal_rejected() {
        let result = ContextUri::parse("aster://resources/../secrets.txt");
        assert!(result.is_err());
    }
}
