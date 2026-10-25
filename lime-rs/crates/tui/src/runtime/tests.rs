use super::actions::{merge_export_entries, open_link_with};
use super::connection::{stdio_config, validate_model_route};
use super::history::clear_history_page_error;
use super::*;
use crate::app::App;
use crate::projection::TranscriptEntry;
use crate::projection::{EntryKind, EntryStatus};
use std::cell::RefCell;
use std::ffi::OsString;
use std::path::PathBuf;

fn transcript_entry(id: &str, text: &str, status: Option<EntryStatus>) -> TranscriptEntry {
    TranscriptEntry {
        id: id.to_string(),
        kind: EntryKind::Assistant,
        text: text.to_string(),
        streaming: status == Some(EntryStatus::Running),
        status,
        summary: Vec::new(),
        activity_group: None,
        activity_detail: None,
    }
}

#[test]
fn export_merge_keeps_persisted_order_and_latest_live_entries() {
    let persisted = vec![
        transcript_entry("history", "older", Some(EntryStatus::Completed)),
        transcript_entry("shared", "persisted", Some(EntryStatus::Completed)),
    ];
    let live = vec![
        transcript_entry("shared", "streaming", Some(EntryStatus::Running)),
        transcript_entry("live", "new", Some(EntryStatus::Running)),
    ];

    let merged = merge_export_entries(persisted, &live);

    assert_eq!(
        merged
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["history", "shared", "live"]
    );
    assert_eq!(merged[1].text, "streaming");
    assert_eq!(merged[1].status, Some(EntryStatus::Running));
    assert_eq!(merged[2], live[1]);
}

#[test]
fn model_route_requires_model_and_provider_together() {
    let options = TuiOptions {
        computer_use_targets: Vec::new(),
        app_server_bin: PathBuf::from("app-server"),
        app_server_args: Vec::new(),
        remote: None,
        cwd: Some(PathBuf::from(".")),
        model: Some("gpt-test".to_string()),
        model_provider: None,
        reasoning_effort: None,
        permissions: None,
        approval_policy: None,
        approvals_reviewer: None,
        sandbox_policy: None,
        locale: None,
        resume_thread: None,
    };

    assert_eq!(
        validate_model_route(&options)
            .expect_err("partial route must fail")
            .to_string(),
        "--model and --provider must be specified together"
    );
}

#[test]
fn successful_history_retry_clears_only_the_history_page_error() {
    let mut app = App::default();
    app.projection
        .set_status("history page failed: transport unavailable");

    clear_history_page_error(&mut app);

    assert_eq!(app.projection.status(), "ready");

    app.projection.set_status("running");
    clear_history_page_error(&mut app);
    assert_eq!(app.projection.status(), "running");
}

#[test]
fn stdio_config_appends_host_arguments_after_the_current_runtime_default() {
    let options = TuiOptions {
        computer_use_targets: Vec::new(),
        app_server_bin: PathBuf::from("custom-app-server"),
        app_server_args: vec![OsString::from("--backend"), OsString::from("external")],
        remote: None,
        cwd: Some(PathBuf::from(".")),
        model: Some("fixture-model".to_string()),
        model_provider: Some("fixture-provider".to_string()),
        reasoning_effort: None,
        permissions: None,
        approval_policy: None,
        approvals_reviewer: None,
        sandbox_policy: None,
        locale: None,
        resume_thread: None,
    };

    let config = stdio_config(&options).expect("stdio config");
    assert_eq!(
        config.args,
        vec![
            OsString::from("--stdio"),
            OsString::from("--backend"),
            OsString::from("runtime"),
            OsString::from("--backend"),
            OsString::from("external"),
        ]
    );
}

#[test]
fn transcript_link_opening_validates_destination_and_propagates_failure() {
    let opened = RefCell::new(String::new());
    open_link_with("https://example.com/docs", |destination| {
        opened.replace(destination.to_string());
        Ok(())
    })
    .expect("valid destination");
    assert_eq!(opened.into_inner(), "https://example.com/docs");

    assert_eq!(
        open_link_with("file:///tmp/private", |_| panic!("must fail closed")),
        Err("link destination must be a valid HTTP(S) URL".to_string())
    );
    assert_eq!(
        open_link_with("https://example.com", |_| Err(
            "browser unavailable".to_string()
        )),
        Err("browser unavailable".to_string())
    );
}
