use super::*;

#[test]
fn windows_wrappers_capture_before_setup_and_only_capture_after_success() {
    let script = Path::new("C:/fixture's directory/setup_script.ps1");
    let powershell = powershell_wrapper(script, script.parent().unwrap());
    assert!(powershell.contains("& 'C:/fixture''s directory/setup_script.ps1'"));
    assert!(powershell.contains("if ($exitCode -eq 0)"));
    assert!(powershell.find("before_env.txt").unwrap() < powershell.find("try {").unwrap());
    assert!(powershell.find("finally {").unwrap() < powershell.find("captured_env.txt").unwrap());
    assert!(powershell.contains("-Encoding utf8"));
    assert!(powershell.ends_with("exit $exitCode\n"));
    let script = Path::new("C:/fixture directory/setup_script.cmd");
    let cmd = cmd_wrapper(script, script.parent().unwrap());
    assert!(cmd.contains("call \"C:/fixture directory/setup_script.cmd\""));
    assert!(cmd.find("before_env.txt").unwrap() < cmd.find("call ").unwrap());
    assert!(cmd.contains("if \"%LIME_SETUP_EXIT_CODE%\"==\"0\" set >"));
    assert!(cmd.ends_with("exit /b %LIME_SETUP_EXIT_CODE%\r\n"));
}

#[cfg(unix)]
struct Fixture {
    _temporary: tempfile::TempDir,
    root: std::path::PathBuf,
    runtime: RuntimeCore,
}

#[cfg(unix)]
impl Fixture {
    fn new() -> Self {
        let temporary = tempfile::Builder::new()
            .prefix("setup' capture ")
            .tempdir()
            .unwrap();
        let root = std::fs::canonicalize(temporary.path()).unwrap();
        let output = std::process::Command::new("git")
            .arg("init")
            .arg("--template=")
            .arg(&root)
            .output()
            .unwrap();
        assert!(output.status.success());
        let config_path = root.join("app-config.yaml");
        lime_core::config::ConfigManager::with_config(
            lime_core::config::Config {
                default_permissions: Some(":danger-full-access".into()),
                ..Default::default()
            },
            config_path.clone(),
        )
        .save()
        .unwrap();
        let runtime = RuntimeCore::with_backend(std::sync::Arc::new(crate::MockBackend))
            .with_app_config_path(config_path);
        Self {
            _temporary: temporary,
            root,
            runtime,
        }
    }

    fn config(&self, script: &str, cleanup: bool) -> LocalEnvironmentResult {
        let config_path = self.root.join(".lime/environments/environment.toml");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        let raw = format!(
            "name='Fixture'\n[setup]\nscript='''{script}'''\n{}",
            if cleanup {
                format!("[cleanup]\nscript='''{script}'''\n")
            } else {
                String::new()
            }
        );
        std::fs::write(&config_path, raw).unwrap();
        load(config_path.to_str().unwrap()).unwrap()
    }

    async fn run(&self, script: &str, cleanup: bool) -> Option<LocalEnvironmentScriptResult> {
        run(
            &self.runtime,
            &self.root,
            &self.config(script, cleanup),
            cleanup,
            HashMap::new(),
            ConnectionId(1),
            &|| false,
        )
        .await
    }

    async fn seed(&self) -> git::WorktreeShellEnvironment {
        let old = git::WorktreeShellEnvironment::from_captures("", "LIME_SETUP_TEST=confirmed\n")
            .unwrap();
        git::write_worktree_shell_environment(&self.root, &old)
            .await
            .unwrap();
        old
    }
}

#[cfg(unix)]
#[tokio::test]
async fn setup_exports_and_removals_are_persisted_without_wrapper_noise() {
    let fixture = Fixture::new();
    let result = fixture
        .run(
            "export LIME_SETUP_TEST='from setup'\nunset HOME\nprintf setup-done",
            false,
        )
        .await
        .unwrap();
    assert_eq!(
        result.status,
        LocalEnvironmentScriptStatus::Succeeded,
        "{result:?}"
    );
    assert!(result.log.contains("setup-done"));
    let diff = git::read_worktree_shell_environment(&fixture.root)
        .await
        .unwrap()
        .unwrap();
    let mut environment = HashMap::from([
        ("HOME".into(), "inherited".into()),
        ("KEEP".into(), "kept".into()),
    ]);
    diff.apply_to(&mut environment);
    assert_eq!(
        environment.get("LIME_SETUP_TEST").map(String::as_str),
        Some("from setup")
    );
    assert!(!environment.contains_key("HOME"));
    assert_eq!(environment.get("KEEP").map(String::as_str), Some("kept"));
    let json = serde_json::to_value(diff).unwrap();
    assert!(json["set"].get("PWD").is_none());
    assert!(json["set"].get("SHLVL").is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn successful_empty_or_uncaptured_setup_clears_the_previous_diff() {
    let fixture = Fixture::new();
    for script in [":", "", "trap - EXIT"] {
        fixture.seed().await;
        let result = fixture.run(script, false).await;
        if !script.is_empty() {
            assert_eq!(
                result.unwrap().status,
                LocalEnvironmentScriptStatus::Succeeded
            );
        } else {
            assert!(result.is_none());
        }
        assert!(
            git::read_worktree_shell_environment(&fixture.root)
                .await
                .unwrap()
                .is_none(),
            "{script}"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn failure_and_cleanup_preserve_the_last_confirmed_environment() {
    let fixture = Fixture::new();
    let old = fixture.seed().await;
    let failed = fixture
        .run("export LIME_SETUP_TEST=failed\nexit 17", false)
        .await
        .unwrap();
    assert_eq!(failed.status, LocalEnvironmentScriptStatus::Failed);
    assert!(failed.error.unwrap().contains("17"));
    assert_eq!(
        git::read_worktree_shell_environment(&fixture.root)
            .await
            .unwrap(),
        Some(old.clone())
    );
    let cleanup = fixture
        .run("export LIME_SETUP_TEST=cleanup", true)
        .await
        .unwrap();
    assert_eq!(cleanup.status, LocalEnvironmentScriptStatus::Succeeded);
    assert_eq!(
        git::read_worktree_shell_environment(&fixture.root)
            .await
            .unwrap(),
        Some(old)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_terminates_setup_without_overwriting_the_confirmed_diff() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    let fixture = Fixture::new();
    let old = fixture.seed().await;
    let config = fixture.config(
        "export LIME_SETUP_TEST=cancelled\nprintf started > started\nwhile true; do sleep 1; done",
        false,
    );
    let cancelled = AtomicBool::new(false);
    let is_cancelled = || cancelled.load(Ordering::SeqCst);
    let execution = run(
        &fixture.runtime,
        &fixture.root,
        &config,
        false,
        HashMap::new(),
        ConnectionId(2),
        &is_cancelled,
    );
    let cancellation = async {
        while !fixture.root.join("started").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        cancelled.store(true, Ordering::SeqCst);
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(execution, cancellation)
    })
    .await
    .unwrap();
    assert_eq!(result.unwrap().status, LocalEnvironmentScriptStatus::Failed);
    assert_eq!(
        git::read_worktree_shell_environment(&fixture.root)
            .await
            .unwrap(),
        Some(old)
    );
}
