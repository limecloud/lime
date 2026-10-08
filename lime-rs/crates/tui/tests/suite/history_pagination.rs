use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{ensure, Context, Result};
use app_server_protocol::{JsonRpcError, JsonRpcMessage, JsonRpcResponse};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};

use super::focus_palette::PtyLime;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSCRIPT_TIMEOUT: Duration = Duration::from_secs(30);
const HISTORY_FAILURE_THREAD_ID: &str = "thread-history-failure-1";
const HISTORY_FAILURE_TURN_ID: &str = "turn-history-failure-1";
const HISTORY_FAILURE_CURSOR: &str = "history-cursor";
const HISTORY_RACE_THREAD_ID: &str = "thread-history-race-current";
const HISTORY_RACE_TARGET_THREAD_ID: &str = "thread-history-race-target";
const HISTORY_RACE_CURSOR: &str = "history-race-cursor";
const HISTORY_SEARCH_QUERY: &str = "older-history";
const HISTORY_SEARCH_RACE_QUERY: &str = "current-history";

struct ResumeFixture {
    cli_bin: PathBuf,
    app_server_bin: PathBuf,
    backend_path: PathBuf,
    ledger_path: PathBuf,
    cwd: PathBuf,
    node_bin: PathBuf,
}

impl ResumeFixture {
    fn from_env() -> Self {
        Self {
            cli_bin: required_path("LIME_TEST_CLI_BIN"),
            app_server_bin: required_path("LIME_TEST_APP_SERVER_BIN"),
            backend_path: required_path("LIME_TEST_TERMINAL_BACKEND"),
            ledger_path: required_path("LIME_TEST_TERMINAL_LEDGER"),
            cwd: required_path("LIME_TEST_TERMINAL_CWD"),
            node_bin: required_path("LIME_TEST_NODE_BIN"),
        }
    }
}

struct TranscriptExpectation<'a> {
    thread_id: &'a str,
    oldest: &'a str,
    newest: &'a str,
    hidden_prompt: Option<&'a str>,
}

/// Exercise complete paginated and legacy transcripts through real `lime resume` PTYs.
///
/// The paginated fixture spans at least three item pages, so reaching its oldest item also covers
/// Codex's `transcript_home_loads_every_older_history_page` contract. Lime additionally keeps its
/// bounded resume preview unit-tested, while this Gate B binds the complete transcript loader to
/// public App Server JSON-RPC, canonical identities, alternate-screen input, and terminal restore.
#[test]
fn resume_picker_loads_complete_paginated_and_legacy_transcripts() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let fixture = ResumeFixture::from_env();
    let paginated_thread_id = required_path("LIME_TEST_TUI_HISTORY_THREAD_ID")
        .to_string_lossy()
        .into_owned();
    let legacy_thread_id = required_path("LIME_TEST_TUI_LEGACY_THREAD_ID")
        .to_string_lossy()
        .into_owned();
    assert_complete_transcript(
        &fixture,
        TranscriptExpectation {
            thread_id: &paginated_thread_id,
            oldest: "SEED_000",
            newest: "SEED_100",
            hidden_prompt: Some("NESTED_REVIEW_PROMPT"),
        },
    )?;
    assert_complete_transcript(
        &fixture,
        TranscriptExpectation {
            thread_id: &legacy_thread_id,
            oldest: "LEGACY_000",
            newest: "LEGACY_050",
            hidden_prompt: None,
        },
    )?;
    Ok(())
}

/// Match Codex's main-scrollback contract without relying on transcript-overlay navigation.
#[test]
fn underfilled_scrollback_fetches_older_pages_without_opening_the_transcript() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let fixture = ResumeFixture::from_env();
    let thread_id = required_path("LIME_TEST_TUI_HISTORY_THREAD_ID")
        .to_string_lossy()
        .into_owned();
    let mut terminal = PtyLime::start_resume(
        &fixture.cli_bin,
        &fixture.app_server_bin,
        &fixture.backend_path,
        &fixture.ledger_path,
        &fixture.cwd,
        &fixture.node_bin,
        &thread_id,
    )?;
    terminal.resize(400, 120)?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("SEED_000", TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("SEED_100", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contents().contains("TRANSCRIPT"),
        "main scrollback top-up unexpectedly opened the transcript overlay"
    );

    exit_and_assert_terminal_restored(terminal, &thread_id)
}

/// Exercise the transcript pager's failed-page footer and retry through a public remote transport.
///
/// The first request for the existing older-history cursor returns a JSON-RPC error. The same
/// cursor succeeds on Home retry, proving that the pager preserves the canonical pagination state
/// and that the user-visible failure/retry surface is wired through the real PTY.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_history_failure_keeps_anchor_and_home_retry_recovers() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    for fail_turn_metadata in [false, true] {
        let cli_bin = required_path("LIME_TEST_CLI_BIN");
        let cwd = required_path("LIME_TEST_TERMINAL_CWD");
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let address = listener.local_addr()?;
        let failed_once = Arc::new(AtomicBool::new(false));
        let server_failed_once = failed_once.clone();
        let turn_enrichment_failed = Arc::new(AtomicBool::new(false));
        let server_turn_enrichment_failed = turn_enrichment_failed.clone();
        let server = tokio::spawn(async move {
            run_history_failure_server(
                listener,
                server_failed_once,
                server_turn_enrichment_failed,
                fail_turn_metadata,
            )
            .await
        });

        let remote_url = format!("ws://{address}/rpc");
        let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
            &cli_bin,
            &remote_url,
            &cwd,
            HISTORY_FAILURE_THREAD_ID,
        )?;
        terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
        terminal.write_input(&[0x14])?;
        terminal.wait_for_screen_compact_contains("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
        terminal.wait_for_screen_compact_contains("recent-history-user-0", TRANSCRIPT_TIMEOUT)?;

        terminal.write_input(b"\x1b[H")?;
        terminal.wait_for_screen_compact_contains("History load failed", TRANSCRIPT_TIMEOUT)?;
        ensure!(
            terminal.screen_contains("Home retry"),
            "failed transcript page did not expose Home retry footer:\n{}",
            terminal.screen_contents()
        );

        terminal.write_input(b"\x1b[H")?;
        terminal.wait_for_screen_compact_contains("older-history", TRANSCRIPT_TIMEOUT)?;
        ensure!(
            !terminal.screen_contains("History load failed"),
            "successful history retry kept the failed footer:\n{}",
            terminal.screen_contents()
        );

        terminal.write_input(&[0x14])?;
        terminal.wait_for_screen_without("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
        terminal.write_input(&[0x04])?;
        terminal.wait_for_exit()?;
        ensure!(
            terminal.output_contains(b"\x1b[?1049l"),
            "alternate screen was not restored after history failure/retry"
        );
        ensure!(
            failed_once.load(Ordering::SeqCst),
            "remote history fixture never observed the injected failure"
        );
        ensure!(
            turn_enrichment_failed.load(Ordering::SeqCst) == fail_turn_metadata,
            "remote history fixture did not exercise its declared failure boundary"
        );

        let server_result = tokio::time::timeout(Duration::from_secs(5), server)
            .await
            .context("history failure fixture did not finish")??;
        server_result?;
    }
    Ok(())
}

/// Exercise the main transcript Find surface against the same public history transport. The
/// failed page must leave the query and match cursor visible so Home can retry the exact cursor;
/// a successful retry must then project the older match without closing Find.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_search_history_failure_keeps_query_and_home_retry_recovers() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let cli_bin = required_path("LIME_TEST_CLI_BIN");
    let cwd = required_path("LIME_TEST_TERMINAL_CWD");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let failed_once = Arc::new(AtomicBool::new(false));
    let server_failed_once = failed_once.clone();
    let turn_enrichment_failed = Arc::new(AtomicBool::new(false));
    let server_turn_enrichment_failed = turn_enrichment_failed.clone();
    let server = tokio::spawn(async move {
        run_history_failure_server(
            listener,
            server_failed_once,
            server_turn_enrichment_failed,
            true,
        )
        .await
    });

    let remote_url = format!("ws://{address}/rpc");
    let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
        &cli_bin,
        &remote_url,
        &cwd,
        HISTORY_FAILURE_THREAD_ID,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("recent-history-user-0", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x1b[13~")?;
    terminal.wait_for_screen_compact_contains("Find:", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(format!("\x1b[200~{HISTORY_SEARCH_QUERY}\x1b[201~").as_bytes())?;
    terminal.wait_for_screen_compact_contains(
        &format!("Find: {HISTORY_SEARCH_QUERY}"),
        TRANSCRIPT_TIMEOUT,
    )?;
    terminal.wait_for_screen_compact_contains("History load failed", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        terminal.screen_contains(&format!("Find: {HISTORY_SEARCH_QUERY}")),
        "history search failure discarded its query/cursor:\n{}",
        terminal.screen_contents()
    );

    // Home is the search owner's explicit older-page retry, not a pager close or a new query.
    terminal.write_input(b"\x1b[H")?;
    terminal.wait_for_screen_compact_contains("Match 2/2", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contains("History load failed"),
        "successful Find retry kept the failed footer:\n{}",
        terminal.screen_contents()
    );
    ensure!(
        terminal.screen_contains(&format!("Find: {HISTORY_SEARCH_QUERY}")),
        "successful Find retry closed or replaced the query:\n{}",
        terminal.screen_contents()
    );

    terminal.write_input(b"\x1b")?;
    terminal.wait_for_screen_without("Find:", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after main history search retry"
    );
    ensure!(
        failed_once.load(Ordering::SeqCst),
        "remote history fixture never observed the injected search page failure"
    );
    ensure!(
        turn_enrichment_failed.load(Ordering::SeqCst),
        "remote history fixture never observed the injected Turn enrichment failure"
    );

    let server_result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .context("history search failure fixture did not finish")??;
    server_result?;
    Ok(())
}

/// Release an older page only after the user has switched threads. The completion still arrives
/// through the same App Server request handle, so this proves the runtime rejects a matching
/// cursor from the previous thread before it can prepend stale items into the new projection.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_history_completion_is_ignored_after_thread_switch() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let cli_bin = required_path("LIME_TEST_CLI_BIN");
    let cwd = required_path("LIME_TEST_TERMINAL_CWD");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let stale_released = Arc::new(AtomicBool::new(false));
    let server_stale_released = stale_released.clone();
    let history_request_seen = Arc::new(AtomicBool::new(false));
    let server_history_request_seen = history_request_seen.clone();
    let server_cwd = cwd.to_string_lossy().into_owned();
    let server = tokio::spawn(async move {
        run_history_switch_server(
            listener,
            server_cwd,
            server_stale_released,
            server_history_request_seen,
        )
        .await
    });

    let remote_url = format!("ws://{address}/rpc");
    let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
        &cli_bin,
        &remote_url,
        &cwd,
        HISTORY_RACE_THREAD_ID,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.write_input(&[0x14])?;
    terminal.wait_for_screen_compact_contains("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-current-history", TRANSCRIPT_TIMEOUT)?;

    terminal.write_input(b"\x1b[H")?;
    terminal.write_input(b"q")?;
    terminal.wait_for_screen_compact_contains("Ask Lime to do anything", TRANSCRIPT_TIMEOUT)?;
    terminal.write_typed_input(b"/resume")?;
    terminal.wait_for_screen_compact_contains("/resume", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\r")?;
    terminal.wait_for_screen_compact_contains("Resume a previous session", TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-target", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\r")?;
    terminal.wait_for_screen_compact_contains("race-target-history", TRANSCRIPT_TIMEOUT)?;
    wait_for_atomic_flag(&mut terminal, &stale_released, TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("Ask Lime to do anything", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contains("race-stale-history"),
        "stale history completion polluted switched thread projection:\n{}",
        terminal.screen_contents()
    );
    ensure!(
        !terminal.screen_contains("History load failed"),
        "stale history completion changed switched thread status:\n{}",
        terminal.screen_contents()
    );

    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after stale thread-switch completion"
    );

    let server_result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .context("history switch fixture did not finish")??;
    server_result?;
    Ok(())
}

/// Main Find must not carry its query, cursor, or failed-page state across a thread handoff.
/// The delayed older page is released only after the target thread is hydrated, so the stale
/// completion exercises the same App Server request handle as a real user switch.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_search_completion_is_ignored_after_thread_switch() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let cli_bin = required_path("LIME_TEST_CLI_BIN");
    let cwd = required_path("LIME_TEST_TERMINAL_CWD");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let stale_released = Arc::new(AtomicBool::new(false));
    let server_stale_released = stale_released.clone();
    let history_request_seen = Arc::new(AtomicBool::new(false));
    let server_history_request_seen = history_request_seen.clone();
    let server_cwd = cwd.to_string_lossy().into_owned();
    let server = tokio::spawn(async move {
        run_history_switch_server(
            listener,
            server_cwd,
            server_stale_released,
            server_history_request_seen,
        )
        .await
    });

    let remote_url = format!("ws://{address}/rpc");
    let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
        &cli_bin,
        &remote_url,
        &cwd,
        HISTORY_RACE_THREAD_ID,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-current-history", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x1b[13~")?;
    terminal.wait_for_screen_compact_contains("Find:", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(format!("\x1b[200~{HISTORY_SEARCH_RACE_QUERY}\x1b[201~").as_bytes())?;
    terminal.wait_for_screen_compact_contains(
        &format!("Find: {HISTORY_SEARCH_RACE_QUERY}"),
        TRANSCRIPT_TIMEOUT,
    )?;
    terminal.write_input(b"\x1b[H")?;
    wait_for_atomic_flag(&mut terminal, &history_request_seen, TRANSCRIPT_TIMEOUT)?;

    terminal.write_input(b"\x1b")?;
    terminal.wait_for_screen_without("Find:", TRANSCRIPT_TIMEOUT)?;
    terminal.write_typed_input(b"/resume")?;
    terminal.wait_for_screen_compact_contains("/resume", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\r")?;
    terminal.wait_for_screen_compact_contains("Resume a previous session", TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-target", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\r")?;
    terminal.wait_for_screen_compact_contains("race-target-history", TRANSCRIPT_TIMEOUT)?;
    wait_for_atomic_flag(&mut terminal, &stale_released, TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contains(HISTORY_SEARCH_RACE_QUERY),
        "stale main search query polluted switched thread projection:\n{}",
        terminal.screen_contents()
    );
    ensure!(
        !terminal.screen_contains("History load failed"),
        "stale main search failure polluted switched thread status:\n{}",
        terminal.screen_contents()
    );

    ensure!(
        !terminal.screen_contains("Find:"),
        "target thread retained the previous Find surface:\n{}",
        terminal.screen_contents()
    );
    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after main search thread switch"
    );

    let server_result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .context("history search switch fixture did not finish")??;
    server_result?;
    Ok(())
}

/// Close the transport while an older page is in flight, then verify reconnect hydration wins.
/// The old request failure may arrive after the new session is attached, but it must not render a
/// retry footer for the reconnected thread or reintroduce the pre-reconnect history surface.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_history_completion_is_ignored_after_reconnect() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let cli_bin = required_path("LIME_TEST_CLI_BIN");
    let cwd = required_path("LIME_TEST_TERMINAL_CWD");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let old_request_seen = Arc::new(AtomicBool::new(false));
    let server_old_request_seen = old_request_seen.clone();
    let server_cwd = cwd.to_string_lossy().into_owned();
    let server = tokio::spawn(async move {
        run_history_reconnect_server(listener, server_cwd, server_old_request_seen).await
    });

    let remote_url = format!("ws://{address}/rpc");
    let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
        &cli_bin,
        &remote_url,
        &cwd,
        HISTORY_RACE_THREAD_ID,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.write_input(&[0x14])?;
    terminal.wait_for_screen_compact_contains("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-current-history", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x1b[H")?;
    terminal.wait_for_screen_compact_contains("reconnected-history", TRANSCRIPT_TIMEOUT)?;
    wait_for_atomic_flag(&mut terminal, &old_request_seen, TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("• reconnected", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contains("History load failed"),
        "old history request failure polluted reconnected transcript:\n{}",
        terminal.screen_contents()
    );

    terminal.write_input(b"q")?;
    terminal.wait_for_screen_compact_contains("Ask Lime to do anything", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x7f")?;
    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after stale reconnect completion"
    );

    let server_result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .context("history reconnect fixture did not finish")??;
    server_result?;
    Ok(())
}

/// Reconnect hydration must clear the main Find state before the old request can fail. The
/// reconnected transcript is authoritative and the old Find surface is not left visible.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn transcript_search_completion_is_ignored_after_reconnect() -> Result<()> {
    if std::env::var_os("LIME_TEST_TUI_HISTORY_PAGINATION").is_none() {
        return Ok(());
    }

    let cli_bin = required_path("LIME_TEST_CLI_BIN");
    let cwd = required_path("LIME_TEST_TERMINAL_CWD");
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let address = listener.local_addr()?;
    let old_request_seen = Arc::new(AtomicBool::new(false));
    let server_old_request_seen = old_request_seen.clone();
    let server_cwd = cwd.to_string_lossy().into_owned();
    let server = tokio::spawn(async move {
        run_history_reconnect_server(listener, server_cwd, server_old_request_seen).await
    });

    let remote_url = format!("ws://{address}/rpc");
    let mut terminal = super::focus_palette::PtyLime::start_remote_resume(
        &cli_bin,
        &remote_url,
        &cwd,
        HISTORY_RACE_THREAD_ID,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("race-current-history", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x1b[13~")?;
    terminal.wait_for_screen_compact_contains("Find:", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(format!("\x1b[200~{HISTORY_SEARCH_RACE_QUERY}\x1b[201~").as_bytes())?;
    terminal.wait_for_screen_compact_contains(
        &format!("Find: {HISTORY_SEARCH_RACE_QUERY}"),
        TRANSCRIPT_TIMEOUT,
    )?;
    terminal.write_input(b"\x1b[H")?;
    terminal.wait_for_screen_compact_contains("reconnected-history", TRANSCRIPT_TIMEOUT)?;
    wait_for_atomic_flag(&mut terminal, &old_request_seen, TRANSCRIPT_TIMEOUT)?;
    terminal.wait_for_screen_compact_contains("• reconnected", TRANSCRIPT_TIMEOUT)?;
    ensure!(
        !terminal.screen_contains("History load failed"),
        "old main search request failure polluted reconnected transcript:\n{}",
        terminal.screen_contents()
    );
    ensure!(
        !terminal.screen_contains(HISTORY_SEARCH_RACE_QUERY),
        "old main search query polluted reconnected transcript:\n{}",
        terminal.screen_contents()
    );

    ensure!(
        !terminal.screen_contains("Find:"),
        "reconnected thread retained the previous Find surface:\n{}",
        terminal.screen_contents()
    );
    ensure!(
        !terminal.screen_contains(HISTORY_SEARCH_RACE_QUERY),
        "reconnected thread inherited the old Find query:\n{}",
        terminal.screen_contents()
    );
    terminal.write_input(b"q")?;
    terminal.wait_for_screen_compact_contains("Ask Lime to do anything", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(&[0x7f])?;
    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after main search reconnect"
    );

    let server_result = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .context("history search reconnect fixture did not finish")??;
    server_result?;
    Ok(())
}

fn assert_complete_transcript(
    fixture: &ResumeFixture,
    expectation: TranscriptExpectation<'_>,
) -> Result<()> {
    let mut terminal = PtyLime::start_resume(
        &fixture.cli_bin,
        &fixture.app_server_bin,
        &fixture.backend_path,
        &fixture.ledger_path,
        &fixture.cwd,
        &fixture.node_bin,
        expectation.thread_id,
    )?;
    terminal.wait_for_startup_with_timeout(STARTUP_TIMEOUT)?;

    // Ctrl-T opens the complete transcript. Home is sent as the terminal's canonical ESC [ H
    // sequence; the pager requests an older page only when the scroll reaches its top.
    terminal.write_input(&[0x14])?;
    terminal.wait_for_screen_compact_contains("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
    terminal.write_input(b"\x1b[H")?;
    terminal.wait_for_screen_compact_contains(expectation.oldest, TRANSCRIPT_TIMEOUT)?;
    let top = terminal.screen_contents();
    if let Some(hidden_prompt) = expectation.hidden_prompt {
        ensure!(
            !top.contains(hidden_prompt),
            "hidden prompt {hidden_prompt:?} leaked into top transcript page:\n{top}"
        );
    }

    terminal.write_input(b"\x1b[F")?;
    terminal.wait_for_screen_compact_contains(expectation.newest, TRANSCRIPT_TIMEOUT)?;
    let bottom = terminal.screen_contents();
    if let Some(hidden_prompt) = expectation.hidden_prompt {
        ensure!(
            !bottom.contains(hidden_prompt),
            "hidden prompt {hidden_prompt:?} leaked into newest transcript page:\n{bottom}"
        );
    }
    let mut previous_separator = false;
    for line in bottom.lines().filter(|line| !line.trim().is_empty()) {
        let separator = line.trim().starts_with("---");
        ensure!(
            !(separator && previous_separator),
            "completion separators duplicated after cross-page reconciliation:\n{bottom}"
        );
        previous_separator = separator;
    }

    terminal.write_input(&[0x14])?;
    terminal.wait_for_screen_without("TRANSCRIPT", TRANSCRIPT_TIMEOUT)?;
    exit_and_assert_terminal_restored(terminal, expectation.thread_id)
}

fn exit_and_assert_terminal_restored(mut terminal: PtyLime, thread_id: &str) -> Result<()> {
    terminal.write_input(&[0x04])?;
    terminal.wait_for_exit()?;
    ensure!(
        terminal.output_contains(b"\x1b[?1049l"),
        "alternate screen was not restored after transcript test for {}",
        thread_id
    );
    Ok(())
}

fn wait_for_atomic_flag(
    terminal: &mut PtyLime,
    flag: &AtomicBool,
    timeout: Duration,
) -> Result<()> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if flag.load(Ordering::SeqCst) {
            return Ok(());
        }
        terminal.read_output(Duration::from_millis(20))?;
    }
    anyhow::bail!("history race fixture did not release its completion within {timeout:?}")
}
#[path = "history_pagination/fixtures.rs"]
mod fixtures;
use fixtures::*;
