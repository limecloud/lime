use super::*;
use std::path::PathBuf;

fn config(project: &Path, file: &str) -> PathBuf {
    project.join(".codex").join("environments").join(file)
}

fn raw(name: &str) -> String {
    format!("version = 1\nname = {name:?}\n[setup]\nscript = ''\n")
}

fn save(
    path: &Path,
    raw: String,
    expected_revision: Option<String>,
) -> LocalEnvironmentsSaveConfigParams {
    LocalEnvironmentsSaveConfigParams {
        config_path: path.to_string_lossy().into_owned(),
        expected_revision,
        raw,
        host_id: None,
    }
}

fn read(path: &Path) -> LocalEnvironmentsReadConfigResponse {
    read_config(LocalEnvironmentsReadConfigParams {
        config_path: path.to_string_lossy().into_owned(),
        host_id: None,
    })
    .unwrap()
}

#[test]
fn passive_reads_do_not_create_environment_directories() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    let response = read(&path);
    assert!(!response.exists);
    assert_eq!(response.revision, None);
    assert_eq!(response.environment, None);
    assert_eq!(response.raw, None);
    assert!(!temp.path().join(".codex").exists());
    let response = list(LocalEnvironmentsListParams {
        workspace_root: temp.path().to_string_lossy().into_owned(),
        host_id: None,
    })
    .unwrap();
    assert!(response.environments.is_empty());
    assert!(!temp.path().join(".codex").exists());
}

#[test]
fn saves_are_revision_checked_idempotent_and_survive_independent_reads() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    let first = raw("First");
    let created = save_config(save(&path, first.clone(), None)).unwrap();
    assert_eq!(created.status, LocalEnvironmentSaveStatus::Success);
    assert_eq!(created.revision, Some(revision(&first)));
    let loaded = read(&path);
    assert_eq!(loaded.raw, Some(first.clone()));
    assert_eq!(loaded.revision, created.revision);
    let idempotent = save_config(save(&path, first.clone(), Some("stale".into()))).unwrap();
    assert_eq!(idempotent.status, LocalEnvironmentSaveStatus::Success);
    let second = raw("Second");
    let conflict = save_config(save(&path, second.clone(), None)).unwrap();
    assert_eq!(conflict.status, LocalEnvironmentSaveStatus::Conflict);
    assert_eq!(fs::read_to_string(&path).unwrap(), first);
    let updated = save_config(save(&path, second.clone(), loaded.revision)).unwrap();
    assert_eq!(updated.status, LocalEnvironmentSaveStatus::Success);
    assert_eq!(read(&path).raw, Some(second));
}

#[test]
fn stale_revision_cannot_recreate_a_deleted_config() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    let created = save_config(save(&path, raw("Original"), None)).unwrap();
    fs::remove_file(&path).unwrap();
    let conflict = save_config(save(&path, raw("Stale"), created.revision)).unwrap();
    assert_eq!(conflict.status, LocalEnvironmentSaveStatus::Conflict);
    assert_eq!(conflict.revision, None);
    assert!(!path.exists());
}

#[test]
fn competing_saves_with_one_revision_cannot_overwrite_each_other() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    let created = save_config(save(&path, raw("Original"), None)).unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let writers = ["One", "Two"].map(|name| {
        let barrier = barrier.clone();
        let params = save(&path, raw(name), created.revision.clone());
        std::thread::spawn(move || {
            barrier.wait();
            save_config(params).unwrap().status
        })
    });
    let statuses = writers.map(|writer| writer.join().unwrap());
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == LocalEnvironmentSaveStatus::Success)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == LocalEnvironmentSaveStatus::Conflict)
            .count(),
        1
    );
}

#[test]
fn projection_defaults_version_trims_scripts_and_filters_incomplete_actions() {
    let environment = parse_environment(
        r#"
name = "  Project  "
[setup]
script = "  npm install  "
[setup.win32]
script = "  npm.cmd install  "
[cleanup]
script = "  rm -rf build  "
[[actions]]
name = "  Run  "
command = "  npm start  "
icon = "unknown"
[[actions]]
name = ""
command = "ignored"
[[actions]]
name = "Ignored"
[[actions]]
name = "Windows"
command = "npm.cmd test"
platform = "win32"
icon = "test"
"#,
    )
    .unwrap();
    assert_eq!(environment.version, 1);
    assert_eq!(environment.name, "Project");
    assert_eq!(environment.setup.script, "npm install");
    assert_eq!(environment.setup.win32.unwrap().script, "npm.cmd install");
    assert_eq!(environment.cleanup.unwrap().script, "rm -rf build");
    let actions = environment.actions.unwrap();
    assert_eq!(actions.len(), 2);
    assert_eq!(actions[0].name, "Run");
    assert_eq!(actions[0].command, "npm start");
    assert_eq!(actions[0].icon, None);
    assert_eq!(actions[1].platform, Some(LocalEnvironmentPlatform::Win32));
}

#[test]
fn invalid_config_remains_visible_as_an_error_and_cannot_be_saved() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "name = [").unwrap();
    let loaded = read(&path);
    assert!(loaded.exists);
    assert!(matches!(
        loaded.environment,
        Some(LocalEnvironmentResult::Error { .. })
    ));
    assert_eq!(loaded.raw.as_deref(), Some("name = ["));
    for invalid in [
        "name = [",
        "version = 0\nname='X'\n[setup]\nscript=''",
        "name='X'",
        "name='X'\n[setup]\nscript=12",
    ] {
        assert!(save_config(save(&path, invalid.into(), loaded.revision.clone())).is_err());
    }
    assert_eq!(fs::read_to_string(path).unwrap(), "name = [");
}

#[test]
fn inherited_environments_keep_default_first_then_distance_and_path_order() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let nested = project.join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::create_dir(project.join(".git")).unwrap();
    for (root, name) in [
        (project.as_path(), "environment.toml"),
        (nested.as_path(), "alpha.toml"),
        (project.as_path(), "zeta.toml"),
        (project.as_path(), "alpha.toml"),
    ] {
        let path = config(root, name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, raw(name)).unwrap();
    }
    let response = list(LocalEnvironmentsListParams {
        workspace_root: nested.to_string_lossy().into_owned(),
        host_id: Some("local".into()),
    })
    .unwrap();
    let projected = response
        .environments
        .iter()
        .map(|result| match result {
            LocalEnvironmentResult::Success {
                config_path,
                cwd_relative_to_git_root,
                ..
            } => (
                Path::new(config_path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                cwd_relative_to_git_root.clone(),
            ),
            _ => panic!("expected valid environment"),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        projected,
        vec![
            ("environment.toml".into(), ".".into()),
            ("alpha.toml".into(), "nested".into()),
            ("alpha.toml".into(), ".".into()),
            ("zeta.toml".into(), ".".into())
        ]
    );
}

#[test]
fn remote_relative_and_outside_paths_fail_without_creating_files() {
    let temp = tempfile::tempdir().unwrap();
    for path in [
        "environment.toml".into(),
        temp.path()
            .join("wrong.toml")
            .to_string_lossy()
            .into_owned(),
        format!(
            "{}/.codex/environments/../wrong.toml",
            temp.path().display()
        ),
    ] {
        assert!(save_config(LocalEnvironmentsSaveConfigParams {
            config_path: path,
            expected_revision: None,
            raw: raw("X"),
            host_id: None
        })
        .is_err());
    }
    let mut params = save(&config(temp.path(), "environment.toml"), raw("X"), None);
    params.host_id = Some("remote".into());
    assert!(save_config(params).is_err());
    assert!(!temp.path().join(".codex").exists());
}

#[cfg(unix)]
#[test]
fn symlinked_directories_and_files_cannot_redirect_reads_or_writes() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let outside = temp.path().join("outside");
    fs::create_dir_all(project.join(".codex")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, project.join(".codex/environments")).unwrap();
    let path = config(&project, "environment.toml");
    assert!(save_config(save(&path, raw("X"), None)).is_err());
    assert!(!outside.join("environment.toml").exists());
    fs::remove_file(project.join(".codex/environments")).unwrap();
    fs::create_dir(project.join(".codex/environments")).unwrap();
    let target = outside.join("environment.toml");
    fs::write(&target, raw("Original")).unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    assert!(read_config(LocalEnvironmentsReadConfigParams {
        config_path: path.to_string_lossy().into_owned(),
        host_id: None
    })
    .is_err());
    assert!(save_config(save(&path, raw("X"), None)).is_err());
    assert_eq!(fs::read_to_string(target).unwrap(), raw("Original"));
}

#[test]
fn oversized_documents_are_rejected_before_directory_creation() {
    let temp = tempfile::tempdir().unwrap();
    let path = config(temp.path(), "environment.toml");
    assert!(save_config(save(&path, " ".repeat(MAX_CONFIG_BYTES as usize + 1), None)).is_err());
    assert!(!temp.path().join(".codex").exists());
}
