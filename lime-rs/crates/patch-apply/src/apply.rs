use std::fs;
use std::io;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

use thiserror::Error;

use crate::parse_patch;
use crate::seek_sequence;
use crate::text_file::Replacement;
use crate::text_file::SourceFile;
use crate::Hunk;
use crate::ParseError;
use crate::UpdateFileChunk;

#[derive(Debug, Error)]
pub enum ApplyPatchError {
    #[error(transparent)]
    ParseError(#[from] ParseError),
    #[error("no files were modified")]
    NoFilesModified,
    #[error("{context}: {source}")]
    Io {
        context: String,
        #[source]
        source: io::Error,
    },
    #[error("invalid patch path '{}': {reason}", path.display())]
    InvalidPath { path: PathBuf, reason: String },
    #[error("patch path '{}' escapes workdir '{}'", path.display(), workdir.display())]
    PathEscapesWorkdir { path: PathBuf, workdir: PathBuf },
    #[error("{0}")]
    ComputeReplacements(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct ApplyPatchReport {
    pub added: Vec<PathBuf>,
    pub modified: Vec<PathBuf>,
    pub deleted: Vec<PathBuf>,
    pub changes: Vec<AppliedPatchChange>,
}

impl ApplyPatchReport {
    fn empty() -> Self {
        Self {
            added: Vec::new(),
            modified: Vec::new(),
            deleted: Vec::new(),
            changes: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppliedPatchChange {
    pub path: PathBuf,
    pub change: AppliedPatchFileChange,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AppliedPatchFileChange {
    Add {
        content: String,
        overwritten_content: Option<String>,
    },
    Delete {
        content: String,
    },
    Update {
        move_path: Option<PathBuf>,
        old_content: String,
        overwritten_move_content: Option<String>,
        new_content: String,
    },
}

pub fn apply_patch_to_workdir(
    patch: &str,
    workdir: impl AsRef<Path>,
) -> Result<ApplyPatchReport, ApplyPatchError> {
    let parsed = parse_patch(patch)?;
    apply_hunks_to_workdir(&parsed.hunks, workdir)
}

pub fn apply_hunks_to_workdir(
    hunks: &[Hunk],
    workdir: impl AsRef<Path>,
) -> Result<ApplyPatchReport, ApplyPatchError> {
    if hunks.is_empty() {
        return Err(ApplyPatchError::NoFilesModified);
    }

    let workdir = canonical_workdir(workdir.as_ref())?;
    let mut report = ApplyPatchReport::empty();

    for hunk in hunks {
        match hunk {
            Hunk::AddFile { path, contents } => {
                let path_abs = resolve_patch_path(&workdir, path)?;
                let overwritten_content = read_optional_text(&path_abs)?;
                write_text_with_missing_parent_retry(&path_abs, contents)?;
                report.added.push(path.clone());
                report.changes.push(AppliedPatchChange {
                    path: path_abs,
                    change: AppliedPatchFileChange::Add {
                        content: contents.clone(),
                        overwritten_content,
                    },
                });
            }
            Hunk::DeleteFile { path } => {
                let path_abs = resolve_patch_path(&workdir, path)?;
                ensure_not_directory(&path_abs, "delete")?;
                let content = read_text(&path_abs, "read file to delete")?;
                fs::remove_file(&path_abs).map_err(|source| ApplyPatchError::Io {
                    context: format!("failed to delete file {}", path_abs.display()),
                    source,
                })?;
                report.deleted.push(path.clone());
                report.changes.push(AppliedPatchChange {
                    path: path_abs,
                    change: AppliedPatchFileChange::Delete { content },
                });
            }
            Hunk::UpdateFile {
                path,
                move_path,
                chunks,
            } => {
                let path_abs = resolve_patch_path(&workdir, path)?;
                let AppliedPatch {
                    original_contents,
                    new_contents,
                } = derive_new_contents_from_chunks(&path_abs, chunks)?;

                let resolved_move_path = move_path
                    .as_ref()
                    .map(|path| resolve_patch_path(&workdir, path))
                    .transpose()?;

                match resolved_move_path {
                    Some(dest_abs) if dest_abs != path_abs => {
                        let overwritten_move_content = read_optional_text(&dest_abs)?;
                        write_text_with_missing_parent_retry(&dest_abs, &new_contents)?;
                        ensure_not_directory(&path_abs, "remove original")?;
                        fs::remove_file(&path_abs).map_err(|source| ApplyPatchError::Io {
                            context: format!("failed to remove original {}", path_abs.display()),
                            source,
                        })?;
                        report.modified.push(
                            move_path
                                .as_ref()
                                .map_or_else(|| path.clone(), PathBuf::from),
                        );
                        report.changes.push(AppliedPatchChange {
                            path: path_abs,
                            change: AppliedPatchFileChange::Update {
                                move_path: Some(dest_abs),
                                old_content: original_contents,
                                overwritten_move_content,
                                new_content: new_contents,
                            },
                        });
                    }
                    Some(dest_abs) => {
                        write_text(&path_abs, &new_contents)?;
                        report.modified.push(path.clone());
                        report.changes.push(AppliedPatchChange {
                            path: path_abs,
                            change: AppliedPatchFileChange::Update {
                                move_path: Some(dest_abs),
                                old_content: original_contents,
                                overwritten_move_content: None,
                                new_content: new_contents,
                            },
                        });
                    }
                    None => {
                        write_text(&path_abs, &new_contents)?;
                        report.modified.push(path.clone());
                        report.changes.push(AppliedPatchChange {
                            path: path_abs,
                            change: AppliedPatchFileChange::Update {
                                move_path: None,
                                old_content: original_contents,
                                overwritten_move_content: None,
                                new_content: new_contents,
                            },
                        });
                    }
                }
            }
        }
    }

    Ok(report)
}

struct AppliedPatch {
    original_contents: String,
    new_contents: String,
}

fn derive_new_contents_from_chunks(
    path: &Path,
    chunks: &[UpdateFileChunk],
) -> Result<AppliedPatch, ApplyPatchError> {
    let original_contents = read_text(path, "read file to update")?;
    let mut source_file = SourceFile::parse(&original_contents);
    let original_lines = source_file.line_texts();
    let replacements = compute_replacements(&original_lines, path, chunks)?;
    source_file.apply_replacements(&replacements);

    Ok(AppliedPatch {
        original_contents,
        new_contents: source_file.into_contents(),
    })
}

fn compute_replacements(
    original_lines: &[String],
    path: &Path,
    chunks: &[UpdateFileChunk],
) -> Result<Vec<Replacement>, ApplyPatchError> {
    let mut replacements: Vec<Replacement> = Vec::new();
    let mut line_index: usize = 0;

    for chunk in chunks {
        if let Some(context_line) = &chunk.change_context {
            if let Some(index) = seek_sequence(
                original_lines,
                std::slice::from_ref(context_line),
                line_index,
                false,
            ) {
                line_index = index + 1;
            } else {
                return Err(ApplyPatchError::ComputeReplacements(format!(
                    "failed to find context '{}' in {}",
                    context_line,
                    path.display()
                )));
            }
        }

        if chunk.old_lines.is_empty() {
            replacements.push((original_lines.len(), 0, chunk.new_lines.clone()));
            continue;
        }

        let mut pattern: &[String] = &chunk.old_lines;
        let mut new_slice: &[String] = &chunk.new_lines;
        let mut found = seek_sequence(original_lines, pattern, line_index, chunk.is_end_of_file);

        if found.is_none() && pattern.last().is_some_and(String::is_empty) {
            pattern = &pattern[..pattern.len() - 1];
            if new_slice.last().is_some_and(String::is_empty) {
                new_slice = &new_slice[..new_slice.len() - 1];
            }
            found = seek_sequence(original_lines, pattern, line_index, chunk.is_end_of_file);
        }

        if let Some(start_index) = found {
            // Context lines occur in both sides of a patch chunk. Keep those
            // original lines in place so their exact contents and terminators
            // survive, especially when the file has mixed line endings.
            let mut old_start = 0;
            let mut new_start = 0;
            for &(old_context, new_context) in &chunk.context_line_indices {
                if old_context >= pattern.len() || new_context >= new_slice.len() {
                    break;
                }
                if old_start != old_context || new_start != new_context {
                    replacements.push((
                        start_index + old_start,
                        old_context - old_start,
                        new_slice[new_start..new_context].to_vec(),
                    ));
                }
                old_start = old_context + 1;
                new_start = new_context + 1;
            }
            if old_start != pattern.len() || new_start != new_slice.len() {
                replacements.push((
                    start_index + old_start,
                    pattern.len() - old_start,
                    new_slice[new_start..].to_vec(),
                ));
            }
            line_index = start_index + pattern.len();
        } else {
            return Err(ApplyPatchError::ComputeReplacements(format!(
                "failed to find expected lines in {}:\n{}",
                path.display(),
                chunk.old_lines.join("\n")
            )));
        }
    }

    replacements.sort_by_key(|(index, _, _)| *index);
    Ok(replacements)
}

fn canonical_workdir(workdir: &Path) -> Result<PathBuf, ApplyPatchError> {
    let canonical = fs::canonicalize(workdir).map_err(|source| ApplyPatchError::Io {
        context: format!("failed to resolve workdir {}", workdir.display()),
        source,
    })?;
    if !canonical.is_dir() {
        return Err(ApplyPatchError::InvalidPath {
            path: workdir.to_path_buf(),
            reason: "workdir is not a directory".to_string(),
        });
    }
    Ok(canonical)
}

fn resolve_patch_path(workdir: &Path, path: &Path) -> Result<PathBuf, ApplyPatchError> {
    let lexical_path = if path.is_absolute() {
        normalize_path_lexically(path)?
    } else {
        normalize_path_lexically(&workdir.join(path))?
    };
    let candidate = canonicalize_existing_prefix(&lexical_path)?;

    if !candidate.starts_with(workdir) {
        return Err(ApplyPatchError::PathEscapesWorkdir {
            path: candidate,
            workdir: workdir.to_path_buf(),
        });
    }

    Ok(candidate)
}

fn canonicalize_existing_prefix(path: &Path) -> Result<PathBuf, ApplyPatchError> {
    let mut existing = path;
    let mut missing_parts: Vec<PathBuf> = Vec::new();

    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return Ok(path.to_path_buf());
        };
        let Some(file_name) = existing.file_name() else {
            return Ok(path.to_path_buf());
        };
        missing_parts.push(PathBuf::from(file_name));
        existing = parent;
    }

    let mut canonical = fs::canonicalize(existing).map_err(|source| ApplyPatchError::Io {
        context: format!("failed to resolve path {}", existing.display()),
        source,
    })?;
    for part in missing_parts.iter().rev() {
        canonical.push(part);
    }
    Ok(canonical)
}

fn normalize_path_lexically(path: &Path) -> Result<PathBuf, ApplyPatchError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(ApplyPatchError::InvalidPath {
                        path: path.to_path_buf(),
                        reason: "path traversal above root is not allowed".to_string(),
                    });
                }
            }
        }
    }
    Ok(normalized)
}

fn read_text(path: &Path, action: &str) -> Result<String, ApplyPatchError> {
    fs::read_to_string(path).map_err(|source| ApplyPatchError::Io {
        context: format!("failed to {action} {}", path.display()),
        source,
    })
}

fn read_optional_text(path: &Path) -> Result<Option<String>, ApplyPatchError> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(source) if source.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(ApplyPatchError::Io {
            context: format!("failed to read existing file {}", path.display()),
            source,
        }),
    }
}

fn write_text(path: &Path, contents: &str) -> Result<(), ApplyPatchError> {
    fs::write(path, contents).map_err(|source| ApplyPatchError::Io {
        context: format!("failed to write file {}", path.display()),
        source,
    })
}

fn write_text_with_missing_parent_retry(
    path: &Path,
    contents: &str,
) -> Result<(), ApplyPatchError> {
    match fs::write(path, contents) {
        Ok(()) => Ok(()),
        Err(source) if source.kind() == io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|source| ApplyPatchError::Io {
                    context: format!("failed to create parent directories for {}", path.display()),
                    source,
                })?;
            }
            write_text(path, contents)
        }
        Err(source) => Err(ApplyPatchError::Io {
            context: format!("failed to write file {}", path.display()),
            source,
        }),
    }
}

fn ensure_not_directory(path: &Path, action: &str) -> Result<(), ApplyPatchError> {
    let metadata = fs::metadata(path).map_err(|source| ApplyPatchError::Io {
        context: format!("failed to inspect file before {action} {}", path.display()),
        source,
    })?;
    if metadata.is_dir() {
        return Err(ApplyPatchError::InvalidPath {
            path: path.to_path_buf(),
            reason: "path is a directory".to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn wrap_patch(body: &str) -> String {
        format!("*** Begin Patch\n{body}\n*** End Patch")
    }

    #[test]
    fn add_file_creates_file_and_parent_dir() {
        let dir = tempdir().unwrap();
        let patch = wrap_patch(
            "*** Add File: nested/add.txt\n\
             +hello\n\
             +world",
        );

        let report = apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("nested/add.txt")).unwrap(),
            "hello\nworld\n"
        );
        assert_eq!(report.added, vec![PathBuf::from("nested/add.txt")]);
        assert!(report.modified.is_empty());
        assert!(report.deleted.is_empty());
    }

    #[test]
    fn update_file_modifies_content() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("update.txt"), "foo\nbar\n").unwrap();
        let patch = wrap_patch("*** Update File: update.txt\n@@\n foo\n-bar\n+baz");

        let report = apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("update.txt")).unwrap(),
            "foo\nbaz\n"
        );
        assert_eq!(report.modified, vec![PathBuf::from("update.txt")]);
    }

    #[test]
    fn update_file_preserves_context_line_endings_in_mixed_file() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("mixed.txt"),
            "alpha\r\nbeta\r\ngamma\n",
        )
        .unwrap();
        let patch = wrap_patch(
            "*** Update File: mixed.txt\n@@\n alpha\n-beta\n+BETA\n gamma",
        );

        apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("mixed.txt")).unwrap(),
            "alpha\r\nBETA\r\ngamma\n"
        );
    }

    #[test]
    fn update_file_preserves_crlf_line_endings() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("crlf.txt"), "foo\r\nbar\r\n").unwrap();
        let patch = wrap_patch("*** Update File: crlf.txt\n@@\n foo\n-bar\n+baz");

        apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(
            fs::read_to_string(dir.path().join("crlf.txt")).unwrap(),
            "foo\r\nbaz\r\n"
        );
    }

    #[test]
    fn delete_file_removes_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("delete.txt");
        let expected_path = fs::canonicalize(dir.path()).unwrap().join("delete.txt");
        fs::write(&path, "delete me\n").unwrap();
        let patch = wrap_patch("*** Delete File: delete.txt");

        let report = apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert!(!path.exists());
        assert_eq!(report.deleted, vec![PathBuf::from("delete.txt")]);
        assert_eq!(
            report.changes,
            vec![AppliedPatchChange {
                path: expected_path,
                change: AppliedPatchFileChange::Delete {
                    content: "delete me\n".to_string(),
                },
            }]
        );
    }

    #[test]
    fn move_update_writes_destination_and_removes_source() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("src.txt");
        let destination = dir.path().join("out/dst.txt");
        fs::write(&source, "line\n").unwrap();
        let patch = wrap_patch(
            "*** Update File: src.txt\n\
             *** Move to: out/dst.txt\n\
             @@\n\
             -line\n\
             +line2",
        );

        let report = apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert!(!source.exists());
        assert_eq!(fs::read_to_string(destination).unwrap(), "line2\n");
        assert_eq!(report.modified, vec![PathBuf::from("out/dst.txt")]);
    }

    #[test]
    fn missing_expected_old_lines_returns_compute_replacements_error() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("update.txt"), "actual\n").unwrap();
        let patch = wrap_patch(
            "*** Update File: update.txt\n\
             @@\n\
             -missing\n\
             +new",
        );

        let error = apply_patch_to_workdir(&patch, dir.path()).unwrap_err();

        assert!(matches!(error, ApplyPatchError::ComputeReplacements(_)));
    }

    #[test]
    fn unicode_punctuation_fuzzy_match_updates_line() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("unicode.txt");
        fs::write(&path, "alpha\u{2014}beta\n").unwrap();
        let patch = wrap_patch(
            "*** Update File: unicode.txt\n\
             @@\n\
             -alpha-beta\n\
             +done",
        );

        apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "done\n");
    }

    #[test]
    fn path_traversal_is_rejected() {
        let dir = tempdir().unwrap();
        let patch = wrap_patch(
            "*** Add File: ../outside.txt\n\
             +blocked",
        );

        let error = apply_patch_to_workdir(&patch, dir.path()).unwrap_err();

        assert!(matches!(error, ApplyPatchError::PathEscapesWorkdir { .. }));
        assert!(!dir.path().join("../outside.txt").exists());
    }

    #[test]
    fn absolute_path_inside_workdir_is_allowed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("absolute.txt");
        let patch = wrap_patch(&format!("*** Add File: {}\n+absolute", path.display()));

        let report = apply_patch_to_workdir(&patch, dir.path()).unwrap();

        assert_eq!(fs::read_to_string(path).unwrap(), "absolute\n");
        assert_eq!(report.added.len(), 1);
    }
}
