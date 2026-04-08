use crate::config::paths::Paths;
use crate::context::context_uri::{ContextNamespace, ContextUri};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const ABSTRACT_FALLBACK_CHARS: usize = 280;
const OVERVIEW_FALLBACK_CHARS: usize = 2200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContextLayer {
    Abstract,
    Overview,
    Detail,
}

impl ContextLayer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Abstract => "abstract",
            Self::Overview => "overview",
            Self::Detail => "detail",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDocument {
    pub uri: String,
    pub layer: ContextLayer,
    pub content: String,
    pub source_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTraceStep {
    pub stage: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextReadResult {
    pub document: ContextDocument,
    pub trace: Vec<ContextTraceStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextNamespaceStatus {
    pub namespace: String,
    pub path: PathBuf,
    pub exists: bool,
    pub file_count: usize,
    pub dir_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextServiceStatus {
    pub root_dir: PathBuf,
    pub root_exists: bool,
    pub namespaces: Vec<ContextNamespaceStatus>,
}

#[derive(Debug, Clone)]
pub struct ContextService {
    root_dir: PathBuf,
}

impl Default for ContextService {
    fn default() -> Self {
        Self::new(Paths::data_dir().join("context"))
    }
}

impl ContextService {
    pub fn new(root_dir: impl Into<PathBuf>) -> Self {
        Self {
            root_dir: root_dir.into(),
        }
    }

    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    pub fn abstract_content(&self, uri: &str) -> Result<ContextDocument> {
        self.read_layer(uri, ContextLayer::Abstract)
    }

    pub fn overview_content(&self, uri: &str) -> Result<ContextDocument> {
        self.read_layer(uri, ContextLayer::Overview)
    }

    pub fn detail_content(&self, uri: &str) -> Result<ContextDocument> {
        self.read_layer(uri, ContextLayer::Detail)
    }

    pub fn read_layer(&self, uri: &str, layer: ContextLayer) -> Result<ContextDocument> {
        Ok(self.read_layer_with_trace(uri, layer)?.document)
    }

    pub fn abstract_content_with_trace(&self, uri: &str) -> Result<ContextReadResult> {
        self.read_layer_with_trace(uri, ContextLayer::Abstract)
    }

    pub fn overview_content_with_trace(&self, uri: &str) -> Result<ContextReadResult> {
        self.read_layer_with_trace(uri, ContextLayer::Overview)
    }

    pub fn detail_content_with_trace(&self, uri: &str) -> Result<ContextReadResult> {
        self.read_layer_with_trace(uri, ContextLayer::Detail)
    }

    pub fn read_layer_with_trace(
        &self,
        uri: &str,
        layer: ContextLayer,
    ) -> Result<ContextReadResult> {
        let mut trace = vec![ContextTraceStep {
            stage: "request".to_string(),
            detail: format!("uri={}, layer={}", uri, layer.as_str()),
        }];

        let context_uri = ContextUri::parse(uri)?;
        trace.push(ContextTraceStep {
            stage: "uri_parse".to_string(),
            detail: format!(
                "namespace={}, relative_path={}",
                context_uri.namespace.as_str(),
                context_uri.relative_path.display()
            ),
        });

        let target = context_uri.to_storage_path(self.root_dir.clone());
        trace.push(ContextTraceStep {
            stage: "storage_path".to_string(),
            detail: target.display().to_string(),
        });

        let (resolved, content) = self.resolve_content_for_layer(&target, layer, &mut trace)?;
        trace.push(ContextTraceStep {
            stage: "content_loaded".to_string(),
            detail: format!(
                "path={}, chars={}",
                resolved.display(),
                content.chars().count()
            ),
        });

        Ok(ContextReadResult {
            document: ContextDocument {
                uri: context_uri.to_string(),
                layer,
                content,
                source_path: resolved,
            },
            trace,
        })
    }

    pub fn status(&self) -> Result<ContextServiceStatus> {
        let root_exists = self.root_dir.exists();
        let mut namespaces = Vec::new();

        for namespace in [
            ContextNamespace::Resources,
            ContextNamespace::Memories,
            ContextNamespace::Skills,
        ] {
            let namespace_path = self.root_dir.join(namespace.as_str());
            let (file_count, dir_count) = Self::count_entries(&namespace_path)?;
            namespaces.push(ContextNamespaceStatus {
                namespace: namespace.as_str().to_string(),
                path: namespace_path.clone(),
                exists: namespace_path.exists(),
                file_count,
                dir_count,
            });
        }

        Ok(ContextServiceStatus {
            root_dir: self.root_dir.clone(),
            root_exists,
            namespaces,
        })
    }

    fn count_entries(path: &Path) -> Result<(usize, usize)> {
        if !path.exists() {
            return Ok((0, 0));
        }

        if path.is_file() {
            return Ok((1, 0));
        }

        let mut file_count = 0usize;
        let mut dir_count = 1usize;

        for entry in
            fs::read_dir(path).with_context(|| format!("无法读取目录: {}", path.display()))?
        {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let (child_files, child_dirs) = Self::count_entries(&entry_path)?;
                file_count += child_files;
                dir_count += child_dirs;
            } else {
                file_count += 1;
            }
        }

        Ok((file_count, dir_count))
    }

    fn resolve_content_for_layer(
        &self,
        target: &Path,
        layer: ContextLayer,
        trace: &mut Vec<ContextTraceStep>,
    ) -> Result<(PathBuf, String)> {
        match layer {
            ContextLayer::Detail => {
                let resolved = self.resolve_detail_path(target, trace)?;
                let content = fs::read_to_string(&resolved).with_context(|| {
                    format!(
                        "读取上下文内容失败（layer={}, path={}）",
                        layer.as_str(),
                        resolved.display()
                    )
                })?;
                Ok((resolved, content))
            }
            ContextLayer::Abstract => self.resolve_semantic_content(
                target,
                ".abstract.md",
                ABSTRACT_FALLBACK_CHARS,
                trace,
            ),
            ContextLayer::Overview => self.resolve_semantic_content(
                target,
                ".overview.md",
                OVERVIEW_FALLBACK_CHARS,
                trace,
            ),
        }
    }

    fn resolve_detail_path(
        &self,
        target: &Path,
        trace: &mut Vec<ContextTraceStep>,
    ) -> Result<PathBuf> {
        if target.is_file() {
            trace.push(ContextTraceStep {
                stage: "detail_resolve".to_string(),
                detail: format!("direct_file={}", target.display()),
            });
            return Ok(target.to_path_buf());
        }

        if target.is_dir() {
            for fallback in ["content.md", "README.md", "readme.md"] {
                let candidate = target.join(fallback);
                if candidate.is_file() {
                    trace.push(ContextTraceStep {
                        stage: "detail_resolve".to_string(),
                        detail: format!("directory_fallback={}", candidate.display()),
                    });
                    return Ok(candidate);
                }
            }
        }

        Err(anyhow!("未找到可读取的详情文件: {}", target.display()))
    }

    fn resolve_semantic_content(
        &self,
        target: &Path,
        sidecar: &str,
        fallback_chars: usize,
        trace: &mut Vec<ContextTraceStep>,
    ) -> Result<(PathBuf, String)> {
        if target.is_dir() {
            let sidecar_path = target.join(sidecar);
            if sidecar_path.is_file() {
                let content = fs::read_to_string(&sidecar_path)
                    .with_context(|| format!("读取语义文件失败: {}", sidecar_path.display()))?;
                trace.push(ContextTraceStep {
                    stage: "semantic_resolve".to_string(),
                    detail: format!("directory_sidecar={}", sidecar_path.display()),
                });
                return Ok((sidecar_path, content));
            }
        }

        if target.is_file() {
            let file_name = target
                .file_name()
                .ok_or_else(|| anyhow!("无效文件路径: {}", target.display()))?
                .to_string_lossy()
                .to_string();
            let file_sidecar = target.with_file_name(format!("{file_name}{sidecar}"));
            if file_sidecar.is_file() {
                let content = fs::read_to_string(&file_sidecar)
                    .with_context(|| format!("读取语义文件失败: {}", file_sidecar.display()))?;
                trace.push(ContextTraceStep {
                    stage: "semantic_resolve".to_string(),
                    detail: format!("file_sidecar={}", file_sidecar.display()),
                });
                return Ok((file_sidecar, content));
            }
        }

        let detail_path = self.resolve_detail_path(target, trace)?;
        let content = fs::read_to_string(&detail_path).with_context(|| {
            format!(
                "读取详情内容失败，无法生成 fallback: {}",
                detail_path.display()
            )
        })?;
        let normalized = content.trim();
        let truncated: String = normalized.chars().take(fallback_chars).collect();
        trace.push(ContextTraceStep {
            stage: "semantic_resolve".to_string(),
            detail: format!(
                "fallback_from_detail={}, fallback_chars={}",
                detail_path.display(),
                fallback_chars
            ),
        });
        Ok((detail_path, truncated))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_service() -> (tempfile::TempDir, ContextService) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("context");
        fs::create_dir_all(root.join("resources/docs")).unwrap();
        let service = ContextService::new(root);
        (temp, service)
    }

    #[test]
    fn test_read_detail_with_file_uri() {
        let (_temp, service) = setup_service();
        let file_path = service.root_dir().join("resources/docs/intro.md");
        fs::write(&file_path, "hello detail").unwrap();

        let doc = service
            .detail_content("aster://resources/docs/intro.md")
            .unwrap();
        assert_eq!(doc.layer, ContextLayer::Detail);
        assert_eq!(doc.content, "hello detail");
    }

    #[test]
    fn test_read_abstract_uses_sidecar() {
        let (_temp, service) = setup_service();
        let dir_path = service.root_dir().join("resources/docs");
        fs::write(dir_path.join(".abstract.md"), "this is abstract").unwrap();
        fs::write(dir_path.join("content.md"), "detail content").unwrap();

        let doc = service.abstract_content("aster://resources/docs").unwrap();
        assert_eq!(doc.content, "this is abstract");
    }

    #[test]
    fn test_overview_fallback_generated() {
        let (_temp, service) = setup_service();
        let file_path = service.root_dir().join("resources/docs/intro.md");
        fs::write(&file_path, "overview source").unwrap();

        let doc = service
            .overview_content("aster://resources/docs/intro.md")
            .unwrap();
        assert!(doc.content.contains("overview source"));
        assert_eq!(doc.source_path, file_path);
    }

    #[test]
    fn test_status_counts_namespace_entries() {
        let (_temp, service) = setup_service();
        let resources_dir = service.root_dir().join("resources/docs");
        let skills_dir = service.root_dir().join("skills");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(resources_dir.join("a.md"), "a").unwrap();
        fs::write(resources_dir.join("b.md"), "b").unwrap();
        fs::write(skills_dir.join("skill.md"), "skill").unwrap();

        let status = service.status().unwrap();
        assert!(status.root_exists);
        let resources = status
            .namespaces
            .iter()
            .find(|n| n.namespace == "resources")
            .unwrap();
        assert_eq!(resources.file_count, 2);
        let skills = status
            .namespaces
            .iter()
            .find(|n| n.namespace == "skills")
            .unwrap();
        assert_eq!(skills.file_count, 1);
    }

    #[test]
    fn test_trace_includes_resolution_steps() {
        let (_temp, service) = setup_service();
        let file_path = service.root_dir().join("resources/docs/trace.md");
        fs::write(&file_path, "trace source").unwrap();

        let result = service
            .overview_content_with_trace("aster://resources/docs/trace.md")
            .unwrap();
        assert!(!result.trace.is_empty());
        assert!(result
            .trace
            .iter()
            .any(|step| step.stage == "semantic_resolve"));
    }
}
