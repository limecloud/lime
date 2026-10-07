//! Complete, Markdown-preserving conversation exports.
//!
//! Export consumes the same canonical `TranscriptEntry` projection rendered by the TUI. It does
//! not read a second history store or reconstruct runtime state locally.

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::history_cell::sanitize_user_text;
use crate::locale::Locale;
use crate::projection::{EntryKind, TranscriptEntry};

pub(crate) fn render_markdown_transcript(entries: &[TranscriptEntry]) -> Result<String, String> {
    let mut markdown = String::from("# Lime conversation\n");
    for entry in entries {
        let image_labels = if entry.kind == EntryKind::User {
            entry
                .summary
                .iter()
                .filter_map(|detail| detail.strip_prefix("image: "))
                .filter(|index| !index.is_empty())
                .map(|index| Locale::EnUs.numbered_image_label(index))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        if entry.text.trim().is_empty() && image_labels.is_empty() && entry.summary.is_empty() {
            continue;
        }
        let heading = match entry.kind {
            EntryKind::User => "User",
            EntryKind::Assistant => "Assistant",
            EntryKind::Reasoning => "Reasoning",
            EntryKind::Plan => "Plan",
            EntryKind::Command
            | EntryKind::Patch
            | EntryKind::Mcp
            | EntryKind::MultiAgent
            | EntryKind::Tool
            | EntryKind::Warning
            | EntryKind::Error
            | EntryKind::System => "Activity",
        };
        markdown.push_str(&format!("\n## {heading}\n\n"));
        let text = sanitize_user_text(entry.text.as_str().into());
        if matches!(
            entry.kind,
            EntryKind::Command | EntryKind::Patch | EntryKind::Mcp
        ) {
            if let Some(header) = patch_export_header(entry) {
                markdown.push_str("    ");
                markdown.push_str(&header);
                markdown.push('\n');
            }
            for line in text.lines() {
                markdown.push_str("    ");
                markdown.push_str(line);
                markdown.push('\n');
            }
        } else if !text.trim().is_empty() {
            markdown.push_str(&text);
            if !text.ends_with('\n') {
                markdown.push('\n');
            }
        }
        if !image_labels.is_empty() {
            if !text.trim().is_empty() {
                markdown.push('\n');
            }
            for label in image_labels {
                markdown.push_str(&label);
                markdown.push('\n');
            }
        }
        for detail in entry
            .summary
            .iter()
            .filter(|detail| entry.kind != EntryKind::User || !detail.starts_with("image: "))
        {
            markdown.push_str("    - ");
            markdown.push_str(detail);
            markdown.push('\n');
        }
    }
    if markdown == "# Lime conversation\n" {
        Err("No conversation content to export.".to_string())
    } else {
        Ok(markdown)
    }
}

fn patch_export_header(entry: &TranscriptEntry) -> Option<String> {
    if entry.kind != EntryKind::Patch {
        return None;
    }
    let status = entry.status?;
    let file_count = entry.summary.iter().find_map(|detail| {
        detail
            .strip_prefix("files: ")
            .and_then(|value| value.trim().parse::<usize>().ok())
    });
    Some(match file_count {
        Some(file_count) => {
            format!("file changes: {} · {file_count} changes", status.label())
        }
        None => format!("file changes: {}", status.label()),
    })
}

pub(crate) fn write_transcript(
    cwd: &Path,
    requested_path: &Path,
    markdown: &str,
) -> Result<PathBuf, String> {
    let path = if let Ok(relative) = requested_path.strip_prefix("~") {
        home_dir()
            .ok_or_else(|| "could not determine the home directory".to_string())?
            .join(relative)
    } else if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        cwd.join(requested_path)
    };
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(cwd))
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    file.write_all(markdown.as_bytes())
        .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    file.persist_noclobber(&path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    Ok(path)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::EntryStatus;

    fn entry(kind: EntryKind, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            id: format!("{kind:?}"),
            kind,
            text: text.to_string(),
            streaming: false,
            status: None,
            summary: Vec::new(),
            activity_group: None,
            activity_detail: None,
        }
    }

    #[test]
    fn markdown_transcript_preserves_messages_and_formats_activity() {
        let markdown = render_markdown_transcript(&[
            entry(EntryKind::User, "Explain the change"),
            entry(EntryKind::Assistant, "**done** with `cargo test`"),
            entry(EntryKind::Command, "$ cargo test\nok"),
        ])
        .expect("exported transcript");

        assert!(markdown.starts_with("# Lime conversation\n"));
        assert!(markdown.contains("## User"));
        assert!(markdown.contains("## Assistant"));
        assert!(markdown.contains("    $ cargo test"));
        assert!(markdown.contains("    ok"));
    }

    #[test]
    fn markdown_transcript_preserves_numbered_images_without_internal_tokens() {
        let mut with_text = entry(EntryKind::User, "describe these");
        with_text.summary = vec!["image: 1".to_string(), "image: 2".to_string()];
        let mut image_only = entry(EntryKind::User, "");
        image_only.summary = vec!["image: 1".to_string()];

        let markdown = render_markdown_transcript(&[with_text, image_only])
            .expect("exported image transcript");

        assert!(markdown.contains("describe these\n\n[Image #1]\n[Image #2]"));
        assert!(markdown.contains("## User\n\n[Image #1]"));
        assert!(!markdown.contains("image: 1"));
    }

    #[test]
    fn empty_transcript_is_rejected() {
        assert!(render_markdown_transcript(&[]).is_err());
        assert!(render_markdown_transcript(&[entry(EntryKind::Assistant, "  \n")]).is_err());
    }

    #[test]
    fn transcript_file_resolves_relative_paths_and_refuses_to_overwrite() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = write_transcript(
            directory.path(),
            Path::new("conversation.md"),
            "# First export\n",
        )
        .expect("write first export");

        assert_eq!(path, directory.path().join("conversation.md"));
        assert!(write_transcript(directory.path(), &path, "# Second export\n").is_err());
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "# First export\n"
        );
    }

    #[test]
    fn markdown_transcript_includes_activity_details_without_terminal_controls() {
        let mut file = entry(EntryKind::Patch, "\x1b[31m+src/lib.rs\x1b[0m");
        file.summary = vec!["file changes: completed · 1 changes".to_string()];
        let mut mcp = entry(EntryKind::Mcp, "\x1b[32mmatching docs\x1b[0m");
        mcp.summary = vec![
            "mcp tool: docs/search({\"query\":\"export\"}) · completed".to_string(),
            "<image content>".to_string(),
            "embedded resource: file:///report.md".to_string(),
            "structured result: {\"count\":1}".to_string(),
        ];
        let markdown = render_markdown_transcript(&[file, mcp]).expect("exported transcript");

        assert!(markdown.contains("+src/lib.rs"));
        assert!(markdown.contains("matching docs"));
        assert!(markdown.contains("mcp tool: docs/search"));
        assert!(markdown.contains("<image content>"));
        assert!(markdown.contains("embedded resource: file:///report.md"));
        assert!(!markdown.contains('\x1b'));
    }

    #[test]
    fn markdown_transcript_exports_patch_status_and_file_count() {
        let mut patch = entry(EntryKind::Patch, "updated src/lib.rs\n+new");
        patch.status = Some(EntryStatus::Completed);
        patch.summary = vec!["files: 1".to_string(), "updated: 1".to_string()];

        let markdown = render_markdown_transcript(&[patch]).expect("exported patch");

        assert!(markdown.contains("file changes: completed · 1 changes"));
        assert!(markdown.contains("updated src/lib.rs"));
        assert!(markdown.contains("    - files: 1"));
    }

    #[test]
    fn markdown_transcript_keeps_summary_only_activity() {
        let mut patch = entry(EntryKind::Patch, "");
        patch.status = Some(EntryStatus::Failed);
        patch.summary = vec!["files: 0".to_string()];

        let markdown = render_markdown_transcript(&[patch]).expect("summary-only patch");

        assert!(markdown.contains("file changes: failed · 0 changes"));
        assert!(markdown.contains("    - files: 0"));
    }
}
