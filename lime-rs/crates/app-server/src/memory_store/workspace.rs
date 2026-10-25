//! Codex phase-2 workspace: immutable extraction inputs, bounded diff, validated artifacts
//! and a fresh baseline after the internal Agent has fully shut down.

use super::*;
#[cfg(windows)]
use std::os::windows::fs::FileTypeExt;
use std::process::Command;

const DIFF_FILE: &str = "phase2_workspace_diff.md";

pub(super) fn git(root: &Path, args: &[&str]) -> Result<String, RuntimeCoreError> {
    let mut command = Command::new("git");
    // Do not inherit a user's repository, index, hooks or configuration in this private repo.
    for (name, _) in std::env::vars_os() {
        if name.to_string_lossy().starts_with("GIT_") {
            command.env_remove(name);
        }
    }
    command.env("GIT_CONFIG_NOSYSTEM", "1");
    command.env(
        "GIT_CONFIG_GLOBAL",
        if cfg!(windows) { "NUL" } else { "/dev/null" },
    );
    let output = command
        .arg("--git-dir")
        .arg(root.join(".git"))
        .arg("--work-tree")
        .arg(root)
        .args([
            "-c",
            "core.hooksPath=",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.autocrlf=false",
            "-c",
            "user.name=Memory",
            "-c",
            "user.email=memory@localhost",
        ])
        .args(args)
        .current_dir(root)
        .output()
        .map_err(io_error)?;
    if !output.status.success() {
        return Err(backend_error(format!(
            "memory workspace git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

pub(super) async fn prepare(root: &Path) -> Result<(), RuntimeCoreError> {
    reject_symlink_chain(root, &root.join(".git"))?;
    for name in [".lime", ".agents"] {
        reject_symlink_chain(root, &root.join(name))?;
        fs::create_dir_all(root.join(name)).map_err(io_error)?;
    }
    remove_diff(root)?;
    if git(root, &["rev-parse", "--verify", "HEAD"]).is_err() {
        reset_baseline(root).await?;
    }
    Ok(())
}

pub(super) fn sync_inputs(
    root: &Path,
    inputs: &[state::StageTwoInput],
) -> Result<(), RuntimeCoreError> {
    let summaries = root.join(ROLLOUT_SUMMARIES_DIR).join("phase2");
    reject_symlink_chain(root, &summaries)?;
    fs::create_dir_all(&summaries).map_err(io_error)?;
    let selected = inputs
        .iter()
        .map(|input| format!("{}.md", state::hash_content(&input.source_path)))
        .collect::<std::collections::HashSet<_>>();
    for entry in fs::read_dir(&summaries).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name();
        if !selected.contains(&name.to_string_lossy().into_owned()) {
            reject_symlink_chain(root, &entry.path())?;
            if entry.file_type().map_err(io_error)?.is_file() {
                fs::remove_file(entry.path()).map_err(io_error)?;
            }
        }
    }
    let mut raw = String::from(
        "# Raw memories\n\nThese are immutable phase-1 snapshots selected for this run.\n\n",
    );
    for input in inputs {
        let summary_path =
            summaries.join(format!("{}.md", state::hash_content(&input.source_path)));
        reject_symlink_chain(root, &summary_path)?;
        fs::write(
            summary_path,
            format!(
                "source_path: {}\nsource_updated_at: {}\n\n{}\n",
                input.source_path,
                input.source_updated_at,
                input.rollout_summary.as_deref().unwrap_or_default()
            ),
        )
        .map_err(io_error)?;
        raw.push_str(&format!(
            "## {}\nsource_updated_at: {}\n\n",
            input.source_path, input.source_updated_at
        ));
        if let Some(memory) = &input.raw_memory {
            raw.push_str(memory);
            raw.push_str("\n\n");
        }
        if let Some(summary) = &input.rollout_summary {
            raw.push_str(summary);
            raw.push_str("\n\n");
        }
    }
    let path = root.join("raw_memories.md");
    reject_symlink_chain(root, &path)?;
    fs::write(path, raw).map_err(io_error)
}

pub(super) async fn write_diff(root: &Path) -> Result<bool, RuntimeCoreError> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        remove_diff(&root)?;
        let status = git(&root, &["status", "--porcelain", "--untracked-files=all"])?;
        // Include newly generated extraction files in the diff, as Codex's
        // head/current-tree comparison does. This index belongs only to this workspace.
        git(
            &root,
            &["add", "--intent-to-add", "--all", "--force", "--", "."],
        )?;
        let diff = git(
            &root,
            &["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."],
        )?;
        let mut text = format!("# Memory workspace changes\n\n{status}\n{diff}");
        if text.len() > 64 * 1024 {
            let mut end = 64 * 1024;
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            text.truncate(end);
            text.push_str("\n[diff truncated]\n");
        }
        fs::write(root.join(DIFF_FILE), text).map_err(io_error)?;
        Ok(!status.trim().is_empty())
    })
    .await
    .map_err(|e| backend_error(e.to_string()))?
}

pub(super) fn remove_symlinks(root: &Path) -> Result<usize, RuntimeCoreError> {
    let mut directories = vec![root.to_path_buf()];
    let mut links = 0;
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let ty = entry.file_type().map_err(io_error)?;
            if ty.is_symlink() {
                #[cfg(windows)]
                if ty.is_symlink_dir() {
                    fs::remove_dir(entry.path()).map_err(io_error)?;
                } else {
                    fs::remove_file(entry.path()).map_err(io_error)?;
                }
                #[cfg(not(windows))]
                fs::remove_file(entry.path()).map_err(io_error)?;
                links += 1;
            } else if ty.is_dir() {
                directories.push(entry.path());
            }
        }
    }
    Ok(links)
}

pub(super) fn validate(root: &Path) -> Result<(), RuntimeCoreError> {
    let links = remove_symlinks(root)?;
    if links > 0 {
        return Err(backend_error(format!(
            "removed {links} symbolic links from memory workspace"
        )));
    }
    let summary = fs::read_to_string(root.join(SUMMARY_FILE)).map_err(io_error)?;
    if !is_valid_memory_summary(&summary) {
        return Err(backend_error("invalid consolidated memory summary"));
    }
    Ok(())
}

pub(super) async fn reset_baseline(root: &Path) -> Result<(), RuntimeCoreError> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        remove_diff(&root)?;
        reject_symlink_chain(&root, &root.join(".git"))?;
        let metadata = root.join(".git");
        if metadata.is_dir() {
            fs::remove_dir_all(&metadata).map_err(io_error)?;
        } else if metadata.exists() {
            fs::remove_file(&metadata).map_err(io_error)?;
        }
        git(&root, &["init", "--template="])?;
        git(&root, &["add", "--all", "--force", "--", "."])?;
        git(
            &root,
            &[
                "commit",
                "--allow-empty",
                "--no-verify",
                "-m",
                "Initialize memory baseline",
            ],
        )?;
        Ok(())
    })
    .await
    .map_err(|e| backend_error(e.to_string()))?
}

fn remove_diff(root: &Path) -> Result<(), RuntimeCoreError> {
    let path = root.join(DIFF_FILE);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error(e)),
    }
}

pub(super) fn prompt(root: &Path) -> String {
    include_str!("consolidation_prompt.md")
        .replace("{{ memory_root }}", &root.display().to_string())
        .replace("{{ phase2_workspace_diff_file }}", DIFF_FILE)
        .replace("{{ memory_extensions_folder_structure }}", "Memory extensions are under extensions/. Read each extension's instructions.md before interpreting that source.")
        .replace("{{ memory_extensions_primary_inputs }}", "Use raw_memories.md for the exact immutable extraction snapshots in this run. Preserve exact source paths and evidence boundaries.")
}
