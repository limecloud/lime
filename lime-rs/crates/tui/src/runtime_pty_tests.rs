use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

#[path = "runtime_pty_tests/agent_picker.rs"]
mod agent_picker;
#[path = "runtime_pty_tests/approval.rs"]
mod approval;
#[path = "runtime_pty_tests/backtrack.rs"]
mod backtrack;
#[path = "runtime_pty_tests/command_continuation.rs"]
mod command_continuation;
#[path = "runtime_pty_tests/composer.rs"]
mod composer;
#[path = "runtime_pty_tests/config.rs"]
mod config;
#[path = "runtime_pty_tests/copy_mode.rs"]
mod copy_mode;
#[path = "runtime_pty_tests/cursor_style.rs"]
mod cursor_style;
#[path = "runtime_pty_tests/diff_display.rs"]
mod diff_display;
#[path = "runtime_pty_tests/external_editor.rs"]
mod external_editor;
#[path = "runtime_pty_tests/footer.rs"]
mod footer;
#[path = "runtime_pty_tests/images.rs"]
mod images;
#[path = "runtime_pty_tests/model_picker.rs"]
mod model_picker;
#[path = "runtime_pty_tests/output.rs"]
mod output;
#[path = "runtime_pty_tests/pending_paste.rs"]
mod pending_paste;
#[path = "runtime_pty_tests/reasoning.rs"]
mod reasoning;
#[path = "runtime_pty_tests/reasoning_shortcuts.rs"]
mod reasoning_shortcuts;
#[path = "runtime_pty_tests/remote_workspace.rs"]
mod remote_workspace;
#[path = "runtime_pty_tests/request_user_input.rs"]
mod request_user_input;
#[path = "runtime_pty_tests/resume_picker.rs"]
mod resume_picker;
#[path = "runtime_pty_tests/skills.rs"]
mod skills;
#[path = "runtime_pty_tests/status_line.rs"]
mod status_line;
#[path = "runtime_pty_tests/suggestions.rs"]
mod suggestions;
#[path = "runtime_pty_tests/task_progress.rs"]
mod task_progress;
#[path = "runtime_pty_tests/terminal_observer.rs"]
mod terminal_observer;
#[path = "runtime_pty_tests/terminal_title.rs"]
mod terminal_title;
use terminal_observer::{terminal_cursor_position, terminal_marker_position, terminal_screen_text};
#[path = "runtime_pty_tests/thread_input.rs"]
mod thread_input;
#[path = "runtime_pty_tests/title_setup.rs"]
mod title_setup;
#[path = "runtime_pty_tests/token_usage.rs"]
mod token_usage;
#[path = "runtime_pty_tests/transcript_export.rs"]
mod transcript_export;
#[path = "runtime_pty_tests/vim_keymap.rs"]
mod vim_keymap;

#[test]
fn real_pty_restores_terminal_after_visible_turn_completion() {
    if std::env::var_os("LIME_TEST_TUI_GATE_B").is_none() {
        return;
    }
    let cli_bin = required_test_path("LIME_TEST_CLI_BIN");
    let app_server_bin = required_test_path("LIME_TEST_APP_SERVER_BIN");
    let backend_path = required_test_path("LIME_TEST_TERMINAL_BACKEND");
    let ledger_path = required_test_path("LIME_TEST_TERMINAL_LEDGER");
    let cwd = required_test_path("LIME_TEST_TERMINAL_CWD");
    let node_bin = required_test_path("LIME_TEST_NODE_BIN");
    let prompt = std::env::var("LIME_TEST_TERMINAL_PROMPT").expect("terminal prompt");
    let queue_prompt = std::env::var("LIME_TEST_TERMINAL_QUEUE_PROMPT")
        .unwrap_or_else(|_| "queued follow-up for editing".to_string());
    let queue_edit_hint = format!(
        "{} edit last queued input",
        if cfg!(target_os = "macos") {
            "⌥↑"
        } else {
            "alt+↑"
        }
    );
    let completed_text =
        std::env::var("LIME_TEST_TERMINAL_COMPLETED_TEXT").expect("completed text");
    let reasoning_text = std::env::var("LIME_TEST_TERMINAL_REASONING_TEXT")
        .unwrap_or_else(|_| "TUI_GATE_B_REASONING_DETAIL".to_string());
    let raw_text = std::env::var("LIME_TEST_TERMINAL_RAW_TEXT")
        .unwrap_or_else(|_| "TUI_GATE_B_RAW_SOURCE".to_string());
    let permission_config = std::env::var_os("LIME_TEST_PERMISSION_CONFIG").map(PathBuf::from);
    let expected_permission_profile = std::env::var("LIME_TEST_PERMISSION_PROFILE").ok();
    let scenario =
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap_or_else(|_| "complete".to_string());
    let agents_command = scenario == "agents-command";
    // Keep the interrupt backend alive long enough for the real PTY event
    // loop to deliver turn/interrupt before the fixture timeout fires.
    let backend_timeout_ms = if matches!(
        scenario.as_str(),
        "interrupt" | "queue-edit" | "agents-overview" | "agents-command"
    ) {
        "30000"
    } else {
        "5000"
    };
    let data_dir = cwd.join("data");
    let app_data_dir = cwd.join("app-data");
    if scenario == "complete" {
        composer::seed_persistent_history(&data_dir);
    }
    let picker_provider = matches!(scenario.as_str(), "complete" | "diff-display")
        .then(|| model_picker::seed_catalog(&app_server_bin, &cwd));

    let mut command = CommandBuilder::new(cli_bin);
    for argument in [
        OsString::from(if agents_command { "agents" } else { "tui" }),
        OsString::from("--cd"),
        cwd.as_os_str().to_os_string(),
        OsString::from("--model"),
        OsString::from("fixture-model"),
        OsString::from("--provider"),
        OsString::from("fixture-provider"),
        OsString::from("--app-server"),
        app_server_bin.as_os_str().to_os_string(),
        OsString::from("--app-server-arg=--backend"),
        OsString::from("--app-server-arg=external"),
        OsString::from("--app-server-arg=--backend-command"),
        OsString::from(format!("--app-server-arg={}", node_bin.to_string_lossy())),
        OsString::from("--app-server-arg=--backend-arg"),
        OsString::from(format!(
            "--app-server-arg={}",
            backend_path.to_string_lossy()
        )),
        OsString::from("--app-server-arg=--backend-arg"),
        OsString::from(format!(
            "--app-server-arg={}",
            ledger_path.to_string_lossy()
        )),
        OsString::from("--app-server-arg=--backend-timeout-ms"),
        OsString::from(format!("--app-server-arg={backend_timeout_ms}")),
        OsString::from("--app-server-arg=--data-dir"),
        OsString::from(format!("--app-server-arg={}", data_dir.to_string_lossy())),
        OsString::from("--app-server-arg=--app-data-dir"),
        OsString::from(format!(
            "--app-server-arg={}",
            app_data_dir.to_string_lossy()
        )),
    ] {
        command.arg(argument);
    }
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("LIME_LOCALE", "en-US");
    if scenario == "diff-display" {
        // This scenario explicitly exercises rich colors; other PTY scenarios retain host intent.
        command.env_remove("NO_COLOR");
        command.env_remove("FORCE_COLOR");
        command.env("COLORTERM", "truecolor");
    }
    if let Some(permission_config) = permission_config.as_ref() {
        command.env("LIME_CONFIG_PATH", permission_config);
    }
    if scenario == "complete" {
        external_editor::configure_external_editor(&mut command, &cwd, &prompt);
    } else if scenario == "images" {
        external_editor::configure_external_editor(&mut command, &cwd, images::EDITOR_TEXT);
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("open PTY");
    let reader = pair.master.try_clone_reader().expect("clone PTY reader");
    let mut writer = pair.master.take_writer().expect("take PTY writer");
    let mut child = pair.slave.spawn_command(command).expect("spawn lime TUI");
    drop(pair.slave);
    let master = pair.master;
    let (output_tx, output_rx) = mpsc::channel();
    let reader_thread = thread::spawn(move || output::read_output(reader, output_tx));
    let mut output = String::new();
    let mut agents_overview_screen = None;
    let mut agents_overview_renamed_screen = None;
    let mut agents_overview_resumed_screen = None;
    let mut transcript_mouse_selection_visible = false;
    let mut main_transcript_mouse_selection_visible = false;
    let mut transcript_keyboard_selection_visible = false;
    let mut transcript_edge_drag_scrolled = false;
    let mut transcript_disclosure_visible = false;
    let mut transcript_reasoning_visible = false;
    let mut transcript_bookmark_restored = false;
    let mut raw_output_visible = false;
    let mut follow_control_visible = false;
    let mut sticky_prompt_header_visible = false;
    let mut main_transcript_find_visible = false;

    if scenario == "diff-display" {
        reasoning_shortcuts::respond_to_palette_probes(&mut writer, &output_rx, &mut output);
    }

    if !agents_command {
        wait_for_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            // Under heavy parallel load a cold TUI start can exceed the old 10s budget.
            Duration::from_secs(30),
        );
        terminal_title::wait_for_idle(&output_rx, &mut output, &cwd);
    }
    if scenario == "complete" {
        composer::exercise_multiline_surface(
            &mut writer,
            &output_rx,
            &mut output,
            &ledger_path,
            &data_dir,
        );
    }
    if scenario == "agents-overview" {
        thread_input::prepare_root(&mut writer, &output_rx, &mut output, &ledger_path);
        terminal_title::wait_for_named_thread(&output_rx, &mut output, "Gate B root draft");
        wait_for_marker(
            &output_rx,
            &mut output,
            "Agent command center",
            Duration::from_secs(10),
        );

        wait_for_screen_marker(&output_rx, &mut output, "f9 open", Duration::from_secs(10));
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "ctrl+x q back",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"?")
            .expect("open Agent Center shortcut help");
        writer.flush().expect("flush center help");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Task shortcuts",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x18q")
            .expect("configured list chord closes Agent Center help");
        writer.flush().expect("flush center help cancel chord");
        wait_for_screen(
            &output_rx,
            &mut output,
            "configured cancel returned from Agent Center help",
            |screen| screen.contains("Agent command center") && !screen.contains("Task shortcuts"),
        );

        writer.write_all(b"n").expect("start new task with n");
        writer.flush().expect("flush n");
        wait_for_marker(
            &output_rx,
            &mut output,
            "New task ›",
            Duration::from_secs(10),
        );
        write_typed_text(&mut writer, prompt.as_bytes());
        writer
            .write_all(b"\x1b[20~")
            .expect("configured F9 submits overview task");
        writer.flush().expect("flush overview task");
        wait_for_ledger_kind_and_scenario(
            &ledger_path,
            "turnStart",
            &scenario,
            Duration::from_secs(10),
        );
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "background task started",
            Duration::from_secs(10),
        );
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Working 1",
            Duration::from_secs(10),
        );
        agents_overview_screen = Some(terminal_screen_text(&output));

        writer.write_all(b"\t\t").expect("filter working tasks");
        writer.write_all(b"r").expect("rename with r");
        writer.flush().expect("flush overview rename shortcut");
        wait_for_screen_marker(&output_rx, &mut output, "Rename ›", Duration::from_secs(10));
        writer
            .write_all(&[127; 32])
            .expect("clear existing task name");
        write_typed_text(&mut writer, b"Gate B background");
        writer
            .write_all(b"\x1b[20~")
            .expect("configured F9 submits background task name");
        writer.flush().expect("flush background task rename");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Gate B background",
            Duration::from_secs(10),
        );
        agents_overview_renamed_screen = Some(terminal_screen_text(&output));

        let stop_output_at = output.len();
        writer.write_all(b"x").expect("stop with x");
        writer.flush().expect("flush overview stop shortcut");
        wait_for_ledger_kind_and_scenario(
            &ledger_path,
            "turnCancel",
            &scenario,
            Duration::from_secs(10),
        );
        wait_for_marker_after(
            &output_rx,
            &mut output,
            stop_output_at,
            "stopping",
            Duration::from_secs(10),
        );

        writer
            .write_all(b"\x04\x15\x1b[Z\x1b[Zf")
            .expect("return to all tasks and search");
        writer.flush().expect("flush overview search shortcut");
        wait_for_screen_marker(&output_rx, &mut output, "Search ›", Duration::from_secs(10));
        write_typed_text(&mut writer, b"Gate B background");
        let resume_output_at = output.len();
        writer
            .write_all(b"\x1b[20~")
            .expect("configured F9 resumes searched background thread");
        writer.flush().expect("flush background thread resume");
        // The loading title is emitted as an OSC payload, so it stays observable
        // even though the loading frame itself is transient.
        wait_for_raw_marker_after(
            &output_rx,
            &mut output,
            resume_output_at,
            "Loading task",
            Duration::from_secs(10),
        );
        println!("TUI_AGENTS_LOADING_OK label=localized");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "switched agent",
            Duration::from_secs(10),
        );
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "AGENTS_OVERVIEW_READY",
            Duration::from_secs(10),
        );
        agents_overview_resumed_screen = Some(terminal_screen_text(&output));
        terminal_title::wait_for_named_thread(&output_rx, &mut output, "Gate B background");
        thread_input::exercise_round_trip(&mut writer, &output_rx, &mut output, &ledger_path);
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
    } else if scenario == "agents-command" {
        wait_for_screen(
            &output_rx,
            &mut output,
            "lime agents starts directly in the Agent command center",
            |screen| screen.contains("Agent command center"),
        );
        wait_for_screen_marker(&output_rx, &mut output, "f9 open", Duration::from_secs(10));
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "ctrl+x q back",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x18q")
            .expect("configured back chord leaves Agent command center");
        writer.flush().expect("flush center back chord");
        wait_for_screen(
            &output_rx,
            &mut output,
            "back chord returns to the composer",
            |screen| !screen.contains("Agent command center"),
        );
        eprintln!("TUI_AGENTS_COMMAND_OK screen=overview back=composer");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
    } else if scenario == "complete" {
        writer.write_all(b"?").expect("open shortcut overlay");
        writer.flush().expect("flush shortcut overlay toggle");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Keyboard shortcuts",
            Duration::from_secs(10),
        );
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "? / esc close",
            Duration::from_secs(10),
        );
        assert!(terminal_screen_text(&output).contains("Ask Lime to do anything"));
        writer
            .write_all(b"\x1b")
            .expect("close shortcut overlay without interrupt");
        writer.flush().expect("flush shortcut overlay close");
        wait_for_screen(
            &output_rx,
            &mut output,
            "shortcut close restores the main footer and removes the overlay",
            |screen| {
                screen
                    .lines()
                    .last()
                    .is_some_and(|line| line.contains(" · "))
                    && !screen.contains("Keyboard shortcuts")
            },
        );
        assert!(!terminal_screen_text(&output).contains("Keyboard shortcuts"));
        write_typed_text(&mut writer, b"/model");
        writer
            .write_all(b"\x05")
            .expect("settle typed command before Enter");
        writer.flush().unwrap();
        wait_for_screen_marker(&output_rx, &mut output, "› /model", Duration::from_secs(10));
        writer.write_all(b"\r").unwrap();
        writer.flush().unwrap();
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Select Model and Effort",
            Duration::from_secs(10),
        );
        write_typed_text(&mut writer, b"definitely-not-in-catalog");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "No matching models",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x18q")
            .expect("cancel model picker without changing settings");
        writer.flush().expect("flush model picker cancel");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(10),
        );
        assert!(!terminal_screen_text(&output).contains("Select Model and Effort"));
        suggestions::exercise_suggestion_menus(&mut writer, &output_rx, &mut output, &ledger_path);
        eprintln!("TUI_COMPLETE phase=local-status bytes={}", output.len());
        write_typed_text(&mut writer, b"/status");
        writer
            .write_all(b"\x05")
            .expect("settle typed local command before Enter");
        writer.flush().unwrap();
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "› /status",
            Duration::from_secs(10),
        );
        writer.write_all(b"\r").unwrap();
        writer.flush().unwrap();
        wait_for_marker(&output_rx, &mut output, "/ STATUS", Duration::from_secs(10));
        let return_to_composer_at = output.len();
        writer.write_all(b"q").expect("close status pager");
        writer.flush().expect("flush status pager close");
        wait_for_marker_after(
            &output_rx,
            &mut output,
            return_to_composer_at,
            "Ask Lime to do anything",
            Duration::from_secs(10),
        );
        write_typed_text(&mut writer, b"before external edit");
        eprintln!("TUI_COMPLETE phase=external-editor bytes={}", output.len());
        writer.write_all(&[7]).expect("open external editor");
        writer.flush().expect("flush editor shortcut");
        external_editor::assert_preserved_screen_then_release(
            &mut writer,
            &output_rx,
            &mut output,
            "before external edit",
        );
        wait_for_marker(
            &output_rx,
            &mut output,
            "EDITOR_JOB_CONTROL_OK",
            Duration::from_secs(10),
        );
        // Re-entering the alternate screen must not synchronously query the PTY. The next
        // draw is responsible for reconciling the restored surface and showing the composer.
        wait_for_screen_marker(&output_rx, &mut output, &prompt, Duration::from_secs(10));

        eprintln!("TUI_COMPLETE phase=restored-editor bytes={}", output.len());
        external_editor::assert_editor_exit_and_reentry(&output);
        let (cursor_row, prompt_col) =
            terminal_marker_position(&output, &prompt).expect("external editor prompt position");
        let prompt_width = u16::try_from(crate::width::display_width(&prompt)).unwrap_or(u16::MAX);
        let cursor_col = prompt_col.saturating_add(prompt_width);
        wait_for_cursor_position(
            &output_rx,
            &mut output,
            cursor_row,
            cursor_col,
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x1b[D")
            .expect("move restored composer cursor left");
        writer.flush().expect("flush restored composer left");
        wait_for_cursor_position(
            &output_rx,
            &mut output,
            cursor_row,
            cursor_col.saturating_sub(1),
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x1b[C")
            .expect("move restored composer cursor right");
        writer.flush().expect("flush restored composer right");
        wait_for_cursor_position(
            &output_rx,
            &mut output,
            cursor_row,
            cursor_col,
            Duration::from_secs(10),
        );
        let insertion = prompt.find(' ').map_or(0, |space| space + 1);
        let prefix_width =
            u16::try_from(crate::width::display_width(&prompt[..insertion])).unwrap_or(u16::MAX);
        let target_col = prompt_col.saturating_add(prefix_width);
        let mouse_down = format!(
            "\u{1b}[<0;{};{}M",
            target_col.saturating_add(1),
            cursor_row.saturating_add(1),
        );
        writer
            .write_all(mouse_down.as_bytes())
            .expect("press inside composer with SGR mouse input");
        writer.flush().expect("flush composer mouse press");
        wait_for_cursor_position(
            &output_rx,
            &mut output,
            cursor_row,
            target_col,
            Duration::from_secs(10),
        );
        let mouse_up = format!(
            "\u{1b}[<0;{};{}m",
            target_col.saturating_add(1),
            cursor_row.saturating_add(1),
        );
        writer
            .write_all(mouse_up.as_bytes())
            .expect("release composer SGR mouse input");
        writer.flush().expect("flush composer mouse release");
        write_typed_text(&mut writer, b"X");
        let mouse_edited_prompt = format!("{}X{}", &prompt[..insertion], &prompt[insertion..]);
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            &mouse_edited_prompt,
            Duration::from_secs(10),
        );
        writer
            .write_all(&[127])
            .expect("restore prompt after mouse edit");
        writer.flush().expect("flush restored composer prompt");
        wait_for_screen_marker(&output_rx, &mut output, &prompt, Duration::from_secs(10));
    } else if scenario == "skills" {
        skills::prepare_submission(&mut writer, &output_rx, &mut output, &ledger_path, &prompt);
    } else if scenario == "images" {
        images::prepare_submission(
            &mut writer,
            &output_rx,
            &mut output,
            &ledger_path,
            &cwd,
            &prompt,
        );
    } else if scenario == "large-paste" {
        pending_paste::prepare_submission(
            &mut writer,
            &output_rx,
            &mut output,
            &ledger_path,
            &prompt,
        );
    } else if scenario == "review-branch" {
        write_typed_text(&mut writer, b"/review branch main");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/review branch main",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("start the base-branch review");
        writer.flush().expect("flush review command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_REVIEW_BRANCH_OK target=base-branch turn=started");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after review branch"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "review-commit" {
        let sha = std::env::var("LIME_TEST_REVIEW_COMMIT")
            .expect("review commit fixture requires LIME_TEST_REVIEW_COMMIT");
        let command = format!("/review commit {sha}");
        write_typed_text(&mut writer, command.as_bytes());
        wait_for_compact_marker(&output_rx, &mut output, &command, Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("start the commit review");
        writer.flush().expect("flush review command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_REVIEW_COMMIT_OK target=commit turn=started");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after review commit"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "recap-command" {
        write_typed_text(&mut writer, prompt.as_bytes());
        wait_for_compact_marker(&output_rx, &mut output, &prompt, Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("submit the recap seed prompt");
        writer.flush().expect("flush recap seed prompt");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(45),
        );
        std::thread::sleep(Duration::from_millis(500));
        write_typed_text(&mut writer, b"/recap");
        wait_for_compact_marker(&output_rx, &mut output, "/recap", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("run the recap command");
        writer.flush().expect("flush recap command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "TUI_GATE_B_RECAP_SUMMARY",
            Duration::from_secs(45),
        );
        println!("TUI_RECAP_COMMAND_OK panel=recap");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after recap"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "hooks-command" {
        write_typed_text(&mut writer, b"/hooks");
        wait_for_compact_marker(&output_rx, &mut output, "/hooks", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the hooks panel");
        writer.flush().expect("flush hooks command");
        wait_for_compact_marker(&output_rx, &mut output, "Hooks", Duration::from_secs(30));
        println!("TUI_HOOKS_COMMAND_OK panel=hooks");
        writer.write_all(b"\x1b").expect("close the hooks browser");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after hooks"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "memory-reset-command" {
        write_typed_text(&mut writer, b"/memory reset");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/memory reset",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the memory reset confirmation");
        writer.flush().expect("flush memory reset command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Reset memory?",
            Duration::from_secs(30),
        );
        writer
            .write_all(b"\x1b[B")
            .expect("select the reset confirmation option");
        writer
            .write_all(b"\x1b[20~")
            .expect("confirm the memory reset");
        writer.flush().expect("flush memory reset confirmation");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "memory reset",
            Duration::from_secs(30),
        );
        println!("TUI_MEMORY_RESET_OK reset=confirmed");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after memory reset"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "usage-command" {
        write_typed_text(&mut writer, b"/usage");
        wait_for_compact_marker(&output_rx, &mut output, "/usage", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the usage panel");
        writer.flush().expect("flush usage command");
        wait_for_compact_marker(&output_rx, &mut output, "Usage", Duration::from_secs(30));
        writer.write_all(b"\x1b").expect("close the usage panel");
        writer.flush().expect("flush panel close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_USAGE_COMMAND_OK panel=usage");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after usage"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "warnings-command" {
        write_typed_text(&mut writer, b"/warnings");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/warnings",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the warnings panel");
        writer.flush().expect("flush warnings command");
        wait_for_compact_marker(&output_rx, &mut output, "Warnings", Duration::from_secs(30));
        writer.write_all(b"\x1b").expect("close the warnings panel");
        writer.flush().expect("flush panel close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_WARNINGS_COMMAND_OK panel=warnings");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after warnings"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "memories-command" {
        write_typed_text(&mut writer, b"/memories off");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/memories off",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("disable memory for the thread");
        writer.flush().expect("flush memory mode command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "memory disabled",
            Duration::from_secs(30),
        );
        println!("TUI_MEMORIES_COMMAND_OK mode=off");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after memories"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "goal-command" {
        write_typed_text(&mut writer, b"/goal");
        wait_for_compact_marker(&output_rx, &mut output, "/goal", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("view the goal");
        writer.flush().expect("flush goal view");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "No goal set",
            Duration::from_secs(30),
        );
        writer.write_all(b"\x1b").expect("close the goal panel");
        writer.flush().expect("flush panel close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_GOAL_COMMAND_OK goal=none");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after goal"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "mention-command" {
        write_typed_text(&mut writer, b"/mention");
        wait_for_compact_marker(&output_rx, &mut output, "/mention", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("run the mention command");
        writer.flush().expect("flush mention command");
        wait_for_screen(
            &output_rx,
            &mut output,
            "composer shows mention token",
            |screen| screen.lines().any(|line| line.trim() == "› @"),
        );
        println!("TUI_MENTION_COMMAND_OK composer=at");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after mention"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "ps-command" {
        write_typed_text(&mut writer, b"/ps");
        wait_for_compact_marker(&output_rx, &mut output, "/ps", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the background terminal list");
        writer.flush().expect("flush ps command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Background terminals",
            Duration::from_secs(30),
        );
        println!("TUI_PS_COMMAND_OK panel=ps");
        writer.write_all(b"\x1b").expect("close the process list");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after ps"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "plugins-search-command" {
        write_typed_text(&mut writer, b"/plugins search gate");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/plugins search gate",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the plugin search panel");
        writer.flush().expect("flush plugin search");
        wait_for_compact_marker(&output_rx, &mut output, "Plugins", Duration::from_secs(30));
        println!("TUI_PLUGINS_SEARCH_OK panel=search");
        writer.write_all(b"\x1b").expect("close the search panel");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after plugin search"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "plugins-command" {
        write_typed_text(&mut writer, b"/plugins");
        wait_for_compact_marker(&output_rx, &mut output, "/plugins", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the plugins panel");
        writer.flush().expect("flush plugins command");
        wait_for_compact_marker(&output_rx, &mut output, "Plugins", Duration::from_secs(30));
        println!("TUI_PLUGINS_COMMAND_OK panel=plugins");
        writer.write_all(b"\x1b").expect("close the plugins panel");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after plugins"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "cd-command" {
        write_typed_text(&mut writer, b"/cd .");
        wait_for_compact_marker(&output_rx, &mut output, "/cd .", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("run the cd command");
        writer.flush().expect("flush cd command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "working directory",
            Duration::from_secs(30),
        );
        println!("TUI_CD_COMMAND_OK status=reported");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after cd"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "diff-command" {
        write_typed_text(&mut writer, b"/diff");
        wait_for_compact_marker(&output_rx, &mut output, "/diff", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the diff panel");
        writer.flush().expect("flush diff command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Not a Git repository",
            Duration::from_secs(30),
        );
        writer.write_all(b"\x1b").expect("close the diff panel");
        writer.flush().expect("flush panel close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_DIFF_COMMAND_OK panel=diff repo=none");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after diff"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "stop-command" {
        write_typed_text(&mut writer, b"/stop");
        wait_for_compact_marker(&output_rx, &mut output, "/stop", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("run the stop command");
        writer.flush().expect("flush stop command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "no active turn to stop",
            Duration::from_secs(30),
        );
        println!("TUI_STOP_COMMAND_OK idle=reported");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after stop"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "memory-command" {
        write_typed_text(&mut writer, b"/memory");
        wait_for_compact_marker(&output_rx, &mut output, "/memory", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the memory panel");
        writer.flush().expect("flush memory command");
        wait_for_compact_marker(&output_rx, &mut output, "Memory", Duration::from_secs(30));
        writer.write_all(b"\x1b").expect("close the memory panel");
        writer.flush().expect("flush panel close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_MEMORY_COMMAND_OK panel=memory");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after memory"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "keymap-command" {
        write_typed_text(&mut writer, b"/keymap");
        wait_for_compact_marker(&output_rx, &mut output, "/keymap", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the keymap panel");
        writer.flush().expect("flush keymap command");
        wait_for_compact_marker(&output_rx, &mut output, "Keymap", Duration::from_secs(30));
        println!("TUI_KEYMAP_COMMAND_OK panel=keymap");
        writer.write_all(b"\x1b").expect("close the keymap panel");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after keymap"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "skills-command" {
        write_typed_text(&mut writer, b"/skills");
        wait_for_compact_marker(&output_rx, &mut output, "/skills", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the skills panel");
        writer.flush().expect("flush skills command");
        wait_for_compact_marker(&output_rx, &mut output, "Skills", Duration::from_secs(30));
        println!("TUI_SKILLS_COMMAND_OK panel=skills");
        writer.write_all(b"\x1b").expect("close the skills panel");
        writer.flush().expect("flush panel close");
        std::thread::sleep(Duration::from_millis(150));
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after skills"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "permissions-picker" {
        write_typed_text(&mut writer, b"/permissions");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/permissions",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the permissions picker");
        writer.flush().expect("flush permissions command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Select permission profile",
            Duration::from_secs(30),
        );
        writer
            .write_all(b"\x1b[20~")
            .expect("accept the current permission profile");
        writer.flush().expect("flush permission selection");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "settings updated",
            Duration::from_secs(30),
        );
        println!("TUI_PERMISSIONS_PICKER_OK profile=accepted");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after permissions"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "effort-picker" {
        write_typed_text(&mut writer, b"/effort");
        wait_for_compact_marker(&output_rx, &mut output, "/effort", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer.write_all(b"\x05\r").expect("open the effort picker");
        writer.flush().expect("flush effort command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Select reasoning effort",
            Duration::from_secs(30),
        );
        writer
            .write_all(b"\x1b[20~")
            .expect("accept the current effort");
        writer.flush().expect("flush effort selection");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "settings updated",
            Duration::from_secs(30),
        );
        println!("TUI_EFFORT_PICKER_OK option=accepted");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after effort"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "config-command" {
        write_typed_text(&mut writer, b"/config");
        wait_for_compact_marker(&output_rx, &mut output, "/config", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("open the configuration panel");
        writer.flush().expect("flush config command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Configuration",
            Duration::from_secs(30),
        );
        writer
            .write_all(b"\x1b[20~")
            .expect("open the first configuration editor");
        writer.flush().expect("flush config menu selection");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Select Model and Effort",
            Duration::from_secs(30),
        );
        writer
            .write_all(b"\x18q")
            .expect("close the configuration editor");
        writer.flush().expect("flush editor close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(30),
        );
        println!("TUI_CONFIG_COMMAND_OK menu=model");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after config"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "clear-command" {
        write_typed_text(&mut writer, b"/clear");
        wait_for_compact_marker(&output_rx, &mut output, "/clear", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("execute the clear command");
        writer.flush().expect("flush clear command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "cleared the transcript and started a new chat",
            Duration::from_secs(30),
        );
        write_typed_text(&mut writer, prompt.as_bytes());
        writer
            .write_all(b"\x05\r")
            .expect("submit a prompt on the cleared thread");
        writer.flush().expect("flush cleared prompt");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_CLEAR_COMMAND_OK status=cleared turn=new");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after clear"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "quit-command" {
        write_typed_text(&mut writer, b"/quit");
        wait_for_compact_marker(&output_rx, &mut output, "/quit", Duration::from_secs(10));
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("execute the quit command");
        writer.flush().expect("flush quit command");
        let deadline = Instant::now() + Duration::from_secs(30);
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after quit"
            );
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        println!("TUI_QUIT_COMMAND_OK exit=clean terminal=restored");
        return;
    } else if scenario == "experimental-command" {
        write_typed_text(&mut writer, b"/experimental");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/experimental",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and open the experimental feature pager");
        writer.flush().expect("flush experimental command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Experimental features",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the feature pager");
        writer.flush().expect("flush pager close");
        wait_for_screen_marker(
            &output_rx,
            &mut output,
            "Ask Lime to do anything",
            Duration::from_secs(10),
        );
        write_typed_text(&mut writer, b"/experimental workspace_dependencies off");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "/experimental workspace_dependencies off",
            Duration::from_secs(10),
        );
        writer.write_all(b"\x1b").expect("close the slash popup");
        writer.flush().expect("flush popup close");
        std::thread::sleep(Duration::from_millis(100));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and disable the feature");
        writer.flush().expect("flush toggle command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "disabled: workspace_dependencies",
            Duration::from_secs(30),
        );
        println!("TUI_EXPERIMENTAL_COMMAND_OK list=ok toggle=off");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after experimental"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "review-picker" {
        write_typed_text(&mut writer, b"/review");
        wait_for_compact_marker(&output_rx, &mut output, "/review", Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and open the review presets");
        writer.flush().expect("flush review command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Select a review preset",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x1b[20~")
            .expect("accept the uncommitted review preset");
        writer.flush().expect("flush review preset");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_REVIEW_PICKER_OK preset=uncommitted turn=started");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after review"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "fork-command" {
        write_typed_text(&mut writer, b"/fork");
        wait_for_compact_marker(&output_rx, &mut output, "/fork", Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and fork the thread");
        writer.flush().expect("flush fork command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "forked the current conversation",
            Duration::from_secs(30),
        );
        write_typed_text(&mut writer, prompt.as_bytes());
        writer
            .write_all(b"\x05\r")
            .expect("submit a prompt on the forked thread");
        writer.flush().expect("flush forked prompt");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_FORK_COMMAND_OK thread=forked turn=new");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after fork"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "delete-command" {
        write_typed_text(&mut writer, b"/delete");
        wait_for_compact_marker(&output_rx, &mut output, "/delete", Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and open the delete confirmation");
        writer.flush().expect("flush delete command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Delete this session?",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x1b[B")
            .expect("select the delete confirm option");
        writer
            .write_all(b"\x1b[20~")
            .expect("confirm delete with the configured list accept key");
        writer.flush().expect("flush delete confirmation");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "deleted the current session",
            Duration::from_secs(30),
        );
        write_typed_text(&mut writer, prompt.as_bytes());
        writer
            .write_all(b"\x05\r")
            .expect("submit a prompt on the replacement thread");
        writer.flush().expect("flush replacement prompt");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_DELETE_COMMAND_OK thread=deleted turn=new");
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after delete"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "archive-command" {
        write_typed_text(&mut writer, b"/archive");
        wait_for_compact_marker(&output_rx, &mut output, "/archive", Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and open the archive confirmation");
        writer.flush().expect("flush archive command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "Archive this session?",
            Duration::from_secs(10),
        );
        writer
            .write_all(b"\x1b[B")
            .expect("select the confirm option");
        writer
            .write_all(b"\x1b[20~")
            .expect("confirm archive with the configured list accept key");
        writer.flush().expect("flush archive confirmation");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "archived the current session",
            Duration::from_secs(30),
        );
        write_typed_text(&mut writer, prompt.as_bytes());
        writer
            .write_all(b"\x05\r")
            .expect("submit a prompt on the replacement thread");
        writer.flush().expect("flush replacement prompt");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            &completed_text,
            Duration::from_secs(30),
        );
        println!("TUI_ARCHIVE_COMMAND_OK thread=archived turn=new");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after archive"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "compact-command" {
        write_typed_text(&mut writer, b"/compact");
        wait_for_compact_marker(&output_rx, &mut output, "/compact", Duration::from_secs(10));
        writer
            .write_all(b"\x05\r")
            .expect("flush the burst and compact the thread");
        writer.flush().expect("flush compact command");
        let screen = wait_for_screen(
            &output_rx,
            &mut output,
            "compact command reports its outcome",
            |screen| screen.contains("compacting the conversation") || screen.contains("compact"),
        );
        println!("TUI_COMPACT_COMMAND_OK status={}", screen.lines().count());
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after compact"
            );
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else if scenario == "rename-command" {
        write_typed_text(&mut writer, b"/rename Gate Renamed");
        writer.write_all(b"\r").expect("rename the thread");
        writer.flush().expect("flush rename command");
        wait_for_compact_marker(
            &output_rx,
            &mut output,
            "renamed to Gate Renamed",
            Duration::from_secs(30),
        );
        println!("TUI_RENAME_COMMAND_OK name=Gate Renamed");
        // Ctrl-D only exits when the composer is empty and idle. Clear any draft
        // first, then retry while the renamed frame is still settling.
        writer
            .write_all(b"\x03")
            .expect("clear the composer before exit");
        writer.write_all(&[4]).expect("exit TUI");
        writer.flush().expect("flush TUI exit");
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut last_exit = Instant::now();
        while !output.contains("\u{1b}[?1049l") {
            assert!(
                Instant::now() < deadline,
                "terminal did not leave the alternate screen after rename"
            );
            if last_exit.elapsed() >= Duration::from_secs(2) {
                writer
                    .write_all(b"\x03")
                    .expect("clear the composer before retry");
                writer.write_all(&[4]).expect("retry exit TUI");
                writer.flush().expect("flush retry exit");
                last_exit = Instant::now();
            }
            if let Ok(chunk) = output_rx.recv_timeout(Duration::from_millis(200)) {
                output.push_str(&String::from_utf8_lossy(&chunk));
            }
        }
        return;
    } else {
        write_typed_text(&mut writer, prompt.as_bytes());
    }
    if !matches!(scenario.as_str(), "agents-overview" | "agents-command") {
        // A scheduler can coalesce typed bytes into a paste burst. An explicit
        // editing key flushes that burst before Enter without timing guesses.
        writer
            .write_all(b"\x05")
            .expect("finish typing at draft end");
        writer.flush().expect("flush draft end key");
        if scenario != "large-paste" {
            wait_for_screen_marker(&output_rx, &mut output, &prompt, Duration::from_secs(10));
        }
        writer.write_all(b"\r").expect("submit prompt");
        writer.flush().expect("flush prompt");
    }
    let visible_result = match scenario.as_str() {
        "agents-overview" | "agents-command" => "Agent command center",
        "interrupt" => "INTERRUPT_READY",
        "queue-edit" => &queue_prompt,
        "failure" => "fixture backend failure",
        _ => &completed_text,
    };
    if !matches!(scenario.as_str(), "agents-overview" | "agents-command") {
        let marker = match scenario.as_str() {
            "approval" => "Allow terminal command?",
            "file-change-approval" => "Approve file changes?",
            "permissions-approval" => "Grant additional permissions?",
            // Cursor-addressed renders may split the full question across writes; the
            // stable question title is sufficient to prove the prompt is visible.
            "user-input" => "Choose",
            "interrupt" => "INTERRUPT_READY",
            "queue-edit" => "QUEUE_EDIT_READY",
            "failure" => "fixture backend failure",
            _ => &completed_text,
        };
        wait_for_marker(&output_rx, &mut output, marker, Duration::from_secs(10));
        match scenario.as_str() {
            "approval" | "file-change-approval" | "permissions-approval" | "user-input" => {
                terminal_title::wait_for_action_required(&output_rx, &mut output)
            }
            "interrupt" | "queue-edit" => terminal_title::wait_for_running(&output_rx, &mut output),
            _ => {}
        }
        if scenario == "approval" {
            approval::exercise_read_only_details(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
            );
            writer
                .write_all(b"\x1b[20~")
                .expect("approve command with configured F9");
            writer.flush().expect("flush approval");
            wait_for_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
        } else if scenario == "file-change-approval" {
            for expected in [
                "description: Apply proposed file edits",
                "destination: ",
                "gate/fixture-approved.rs",
                "gate/moved.rs",
            ] {
                wait_for_compact_marker(&output_rx, &mut output, expected, Duration::from_secs(10));
            }
            writer
                .write_all(b"\x1b[20~")
                .expect("approve file changes with configured F9");
            writer.flush().expect("flush file change approval");
            println!(
                "TUI_FILE_CHANGE_APPROVAL_OK title=localized description=ok destinations=add,move"
            );
            wait_for_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
        } else if scenario == "new-command" {
            write_typed_text(&mut writer, b"/new");
            wait_for_compact_marker(&output_rx, &mut output, "/new", Duration::from_secs(10));
            // Close the command popup so Enter executes the command instead of
            // accepting a completion candidate.
            writer.write_all(b"\x1b").expect("close the slash popup");
            writer.flush().expect("flush popup close");
            // ESC immediately followed by CR parses as Alt+Enter; keep them apart.
            std::thread::sleep(Duration::from_millis(100));
            writer.write_all(b"\r").expect("start a new thread");
            writer.flush().expect("flush new thread command");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "started a new thread",
                Duration::from_secs(30),
            );
            let second_turn_at = output.len();
            write_typed_text(&mut writer, prompt.as_bytes());
            writer
                .write_all(b"\x05\r")
                .expect("submit prompt after /new");
            writer.flush().expect("flush second prompt");
            wait_for_marker_after(
                &output_rx,
                &mut output,
                second_turn_at,
                &completed_text,
                Duration::from_secs(30),
            );
            println!("TUI_NEW_COMMAND_OK thread=changed");
        } else if scenario == "permissions-approval" {
            for expected in [
                "reason: Grant write access to the gate directory",
                "granted.txt",
            ] {
                wait_for_compact_marker(&output_rx, &mut output, expected, Duration::from_secs(10));
            }
            writer
                .write_all(b"\x1b[20~")
                .expect("grant permissions with configured F9");
            writer.flush().expect("flush permissions approval");
            wait_for_compact_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(30),
            );
            println!("TUI_PERMISSIONS_APPROVAL_OK reason=localized scope=filesystem");
        } else if scenario == "user-input" {
            request_user_input::exercise_notes_and_selection(
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
            );
            writer.write_all(b"\r").expect("answer user input");
            writer.flush().expect("flush user input");
            wait_for_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
        }
        if scenario == "init-command" {
            println!("TUI_INIT_COMMAND_OK prompt=contributor-guide");
        }
        if scenario == "review-command" {
            println!("TUI_REVIEW_COMMAND_OK prompt=review turn=started");
        }
        if !matches!(scenario.as_str(), "interrupt" | "queue-edit") {
            terminal_title::wait_for_idle(&output_rx, &mut output, &cwd);
        }
        if scenario == "diff-display" {
            diff_display::assert_painted_patch(&output_rx, &mut output);
            reasoning_shortcuts::exercise_animation(&mut writer, &output_rx, &mut output);
        }
        if scenario == "complete" {
            // The assistant marker arrives before the following tool and turn terminal events.
            // Wait for both the canonical completed tool row and the completion separator added
            // by `turn.completed`, so a late projection update cannot invalidate transcript
            // coordinates after the overlay opens.
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "Bash [completed]",
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "----------",
                Duration::from_secs(10),
            );
            assert!(
                !terminal_screen_text(&output).contains(&reasoning_text),
                "transcript-only reasoning leaked into the compact main transcript"
            );
            let raw_source = format!("**{raw_text}**");
            assert!(
                !terminal_screen_text(&output).contains(&raw_source),
                "rich main transcript leaked raw markdown source"
            );
            agent_picker::exercise_open_cancel_and_current_root(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &completed_text,
            );
            resume_picker::exercise_open_and_cancel(
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &completed_text,
                master.as_ref(),
            );
            transcript_export::exercise_destination_filename_and_cancel(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &completed_text,
            );
            status_line::exercise_selection_save_and_cancel(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &completed_text,
                permission_config.as_deref().expect("isolated TUI config"),
            );
            title_setup::exercise_preview_save_and_cancel(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &completed_text,
                permission_config.as_deref().expect("isolated TUI config"),
            );
            task_progress::exercise_shared_progress(
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                permission_config.as_deref().expect("isolated TUI config"),
            );
            token_usage::exercise_shared_usage(
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                permission_config.as_deref().expect("isolated TUI config"),
            );
            footer::exercise_context_and_canonical_config(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                permission_config.as_deref().expect("isolated TUI config"),
            );
            let (prompt_header_row, _) =
                terminal_marker_position(&output, &prompt).expect("sticky prompt header position");
            assert_eq!(
                prompt_header_row, 0,
                "sticky prompt header was not reserved above the compact transcript"
            );
            let (main_selection_row, main_selection_col) =
                terminal_marker_position(&output, &raw_text)
                    .expect("main transcript raw marker position");
            let main_selection_width = u16::try_from(crate::width::display_width(&raw_text))
                .unwrap_or(u16::MAX)
                .clamp(1, 4)
                .min(99u16.saturating_sub(main_selection_col));
            let main_selection_end = main_selection_col.saturating_add(main_selection_width);
            let main_mouse_drag = format!(
                "\u{1b}[<0;{};{}M\u{1b}[<32;{};{}M\u{1b}[<0;{};{}m",
                main_selection_col.saturating_add(1),
                main_selection_row.saturating_add(1),
                main_selection_end.saturating_add(1),
                main_selection_row.saturating_add(1),
                main_selection_end.saturating_add(1),
                main_selection_row.saturating_add(1),
            );
            writer
                .write_all(main_mouse_drag.as_bytes())
                .expect("drag main transcript selection with SGR mouse input");
            writer
                .flush()
                .expect("flush main transcript mouse selection");
            wait_for_inverse_cells(
                &output_rx,
                &mut output,
                main_selection_row,
                main_selection_col,
                main_selection_width,
                Duration::from_secs(10),
            );
            main_transcript_mouse_selection_visible = true;
            assert_eq!(
                terminal_marker_position(&output, &prompt).map(|(row, _)| row),
                Some(0),
                "main transcript selection displaced the sticky prompt header"
            );
            sticky_prompt_header_visible = true;
            writer
                .write_all(b"\x1b")
                .expect("clear main transcript mouse selection");
            writer
                .flush()
                .expect("flush main transcript selection clear");
            wait_for_non_inverse_cells(
                &output_rx,
                &mut output,
                main_selection_row,
                main_selection_col,
                main_selection_width,
                Duration::from_secs(10),
            );
            writer
                .write_all(b"\x18")
                .expect("start configured main transcript Find chord with Ctrl-X");
            writer
                .write_all(b"f")
                .expect("complete configured main transcript Find chord");
            writer
                .flush()
                .expect("flush configured main transcript Find chord");
            wait_for_screen_marker(&output_rx, &mut output, "Find: ", Duration::from_secs(10));
            write_typed_text(&mut writer, completed_text.as_bytes());
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &format!("Find: {completed_text}"),
                Duration::from_secs(10),
            );
            let (find_row, find_col) = terminal_marker_position(&output, &completed_text)
                .expect("main transcript Find match position");
            let find_width = u16::try_from(crate::width::display_width(&completed_text))
                .unwrap_or(u16::MAX)
                .clamp(1, 4)
                .min(99u16.saturating_sub(find_col));
            wait_for_inverse_cells(
                &output_rx,
                &mut output,
                find_row,
                find_col,
                find_width,
                Duration::from_secs(10),
            );
            assert_eq!(
                terminal_marker_position(&output, &prompt).map(|(row, _)| row),
                Some(0),
                "main transcript Find displaced the sticky prompt header"
            );
            main_transcript_find_visible = true;
            writer
                .write_all(b"\x1b")
                .expect("close main transcript Find");
            writer.flush().expect("flush main transcript Find close");
            wait_for_non_inverse_cells(
                &output_rx,
                &mut output,
                find_row,
                find_col,
                find_width,
                Duration::from_secs(10),
            );
            writer
                .write_all(b"\x1br")
                .expect("toggle raw output with Alt-R");
            writer.flush().expect("flush raw output shortcut");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &raw_source,
                Duration::from_secs(10),
            );
            assert!(
                !terminal_screen_text(&output).contains(&reasoning_text),
                "transcript-only reasoning leaked into raw main transcript"
            );
            raw_output_visible = true;
            writer
                .write_all(b"\x1b[5~")
                .expect("pause compact transcript with PageUp");
            writer.flush().expect("flush compact transcript PageUp");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "Back to bottom",
                Duration::from_secs(10),
            );
            follow_control_visible = true;
            writer
                .write_all(b"\x1b")
                .expect("return compact transcript to latest with Escape");
            writer.flush().expect("flush compact transcript Escape");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &raw_source,
                Duration::from_secs(10),
            );
            assert!(
                !terminal_screen_text(&output).contains("Back to bottom"),
                "compact transcript follow control remained visible at the tail"
            );
            let transcript_at = output.len();
            writer.write_all(&[20]).expect("open transcript Ctrl-T");
            writer.flush().expect("flush transcript shortcut");
            wait_for_marker_after(
                &output_rx,
                &mut output,
                transcript_at,
                "ctrl+t·esc·q close",
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &reasoning_text,
                Duration::from_secs(10),
            );
            transcript_reasoning_visible = true;
            reasoning::assert_summary_body(&output_rx, &mut output, &reasoning_text);
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "+ Show details",
                Duration::from_secs(10),
            );
            writer.write_all(b"\x1bOS").expect("focus activity with F4");
            writer.flush().expect("flush transcript activity focus");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "previous/next",
                Duration::from_secs(10),
            );
            writer.write_all(b"\r").expect("expand transcript activity");
            writer.flush().expect("flush transcript activity expansion");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "− Show less",
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "terminal-gate-b",
                Duration::from_secs(10),
            );
            transcript_disclosure_visible = true;
            let (selection_row, selection_col) = terminal_marker_position(&output, &completed_text)
                .expect("completed transcript text position");
            let selection_width = u16::try_from(crate::width::display_width(&completed_text))
                .unwrap_or(u16::MAX)
                .clamp(1, 4)
                .min(99u16.saturating_sub(selection_col));
            let selection_end = selection_col.saturating_add(selection_width);
            let mouse_drag = format!(
                "\u{1b}[<0;{};{}M\u{1b}[<32;{};{}M\u{1b}[<0;{};{}m",
                selection_col.saturating_add(1),
                selection_row.saturating_add(1),
                selection_end.saturating_add(1),
                selection_row.saturating_add(1),
                selection_end.saturating_add(1),
                selection_row.saturating_add(1),
            );
            writer
                .write_all(mouse_drag.as_bytes())
                .expect("drag transcript selection with SGR mouse input");
            writer.flush().expect("flush transcript mouse selection");
            wait_for_inverse_cells(
                &output_rx,
                &mut output,
                selection_row,
                selection_col,
                selection_width,
                Duration::from_secs(10),
            );
            transcript_mouse_selection_visible = true;
            writer
                .write_all(b"\x1b")
                .expect("clear transcript mouse selection");
            writer.flush().expect("flush transcript selection clear");
            wait_for_non_inverse_cells(
                &output_rx,
                &mut output,
                selection_row,
                selection_col,
                selection_width,
                Duration::from_secs(10),
            );
            writer
                .write_all(b"\0\x1b[C")
                .expect("start and extend transcript keyboard selection");
            writer.flush().expect("flush transcript keyboard selection");
            wait_for_inverse_cells(
                &output_rx,
                &mut output,
                /*row*/ 1,
                /*column*/ 0,
                /*width*/ 1,
                Duration::from_secs(10),
            );
            transcript_keyboard_selection_visible = true;
            writer
                .write_all(b"\x1b")
                .expect("clear transcript keyboard selection");
            writer.flush().expect("flush keyboard selection clear");
            wait_for_non_inverse_cells(
                &output_rx,
                &mut output,
                /*row*/ 1,
                /*column*/ 0,
                /*width*/ 1,
                Duration::from_secs(10),
            );
            writer.write_all(b"\x1b[H").expect("move transcript to top");
            writer.flush().expect("flush transcript Home");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "TUI_EDGE_ROW_00",
                Duration::from_secs(10),
            );
            writer
                .write_all(b"\x1b[<0;1;3M\x1b[<32;12;22M")
                .expect("hold a vertical transcript selection at the bottom edge");
            writer.flush().expect("flush transcript edge drag");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
            wait_for_inverse_cells(
                &output_rx,
                &mut output,
                /*row*/ 21,
                /*column*/ 0,
                /*width*/ 1,
                Duration::from_secs(10),
            );
            transcript_edge_drag_scrolled = true;
            writer
                .write_all(b"\x1b[<0;12;22m")
                .expect("release transcript edge drag");
            writer.flush().expect("flush transcript edge release");
            writer
                .write_all(b"\x1b[H")
                .expect("bookmark transcript at top");
            writer.flush().expect("flush transcript bookmark");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "TUI_EDGE_ROW_00",
                Duration::from_secs(10),
            );
            writer.write_all(&[20]).expect("close transcript Ctrl-T");
            writer.flush().expect("flush transcript close");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                &raw_source,
                Duration::from_secs(10),
            );
            let reopened_at = output.len();
            writer.write_all(&[20]).expect("reopen transcript Ctrl-T");
            writer.flush().expect("flush transcript reopen");
            wait_for_marker_after(
                &output_rx,
                &mut output,
                reopened_at,
                "ctrl+t·esc·q close",
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "TUI_EDGE_ROW_00",
                Duration::from_secs(10),
            );
            transcript_bookmark_restored = true;
            writer
                .write_all(&[20])
                .expect("close reopened transcript Ctrl-T");
            writer.flush().expect("flush reopened transcript close");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "Ask Lime to do anything",
                Duration::from_secs(10),
            );
            model_picker::exercise_nested_selection(&mut writer, &output_rx, &mut output);
            reasoning_shortcuts::exercise_steps(&mut writer, &output_rx, &mut output);
            backtrack::exercise_previous_prompt(
                &mut writer,
                &output_rx,
                &mut output,
                &prompt,
                &completed_text,
            );
        }
        if scenario == "copy-mode" {
            copy_mode::exercise(
                master.as_ref(),
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
                &prompt,
            );
        }
        if scenario == "queue-edit" {
            writer
                .write_all(b"?")
                .expect("open shortcut overlay during active turn");
            writer
                .flush()
                .expect("flush active shortcut overlay toggle");
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "Keyboard shortcuts",
                Duration::from_secs(10),
            );
            wait_for_screen_marker(
                &output_rx,
                &mut output,
                "Queue message",
                Duration::from_secs(10),
            );
            writer
                .write_all(b"\x1b")
                .expect("close active help without cancelling turn");
            writer.flush().expect("flush active help close");
            wait_for_screen(
                &output_rx,
                &mut output,
                "active help closed and composer shortcuts restored",
                |screen| {
                    screen
                        .lines()
                        .last()
                        .is_some_and(|line| line.contains(" · "))
                        && !screen.contains("Keyboard shortcuts")
                },
            );
            let cancelled = std::fs::read_to_string(&ledger_path)
                .expect("read current runtime ledger")
                .lines()
                .map(|line| {
                    serde_json::from_str::<serde_json::Value>(line)
                        .expect("structured runtime ledger")
                })
                .any(|entry| entry["kind"] == "turnCancel" && entry["scenario"] == scenario);
            assert!(
                !cancelled,
                "closing shortcut help must not interrupt canonical turn"
            );
            let queued_at = output.len();
            write_typed_text(&mut writer, queue_prompt.as_bytes());
            writer.write_all(b"\t").expect("queue follow-up with Tab");
            writer.flush().expect("flush queued follow-up");
            wait_for_marker_after(
                &output_rx,
                &mut output,
                queued_at,
                "queued (1)",
                Duration::from_secs(10),
            );
            wait_for_marker_after(
                &output_rx,
                &mut output,
                queued_at,
                &queue_prompt,
                Duration::from_secs(10),
            );
            wait_for_marker_after(
                &output_rx,
                &mut output,
                queued_at,
                &queue_edit_hint,
                Duration::from_secs(10),
            );

            let edit_at = output.len();
            writer
                .write_all(b"\x1b[1;3A")
                .expect("edit queued follow-up with Alt-Up");
            writer.flush().expect("flush Alt-Up queue edit");
            wait_for_marker_after(
                &output_rx,
                &mut output,
                edit_at,
                "editing queued",
                Duration::from_secs(10),
            );
            wait_for_marker_after(
                &output_rx,
                &mut output,
                edit_at,
                "follow-up",
                Duration::from_secs(10),
            );
        }
        if matches!(scenario.as_str(), "interrupt" | "queue-edit") {
            wait_for_marker(
                &output_rx,
                &mut output,
                "esc to interrupt",
                Duration::from_secs(5),
            );
            writer.write_all(b"\x1b").expect("interrupt with Escape");
            writer.flush().expect("flush Escape interrupt");
            wait_for_any_marker(
                &output_rx,
                &mut output,
                &["interrupting", "interrupted"],
                Duration::from_secs(5),
            );
            wait_for_ledger_kind_and_scenario(
                &ledger_path,
                "turnCancel",
                &scenario,
                Duration::from_secs(5),
            );
            writer.write_all(&[3]).expect("send quit Ctrl-C");
            writer.flush().expect("flush quit Ctrl-C");
            if scenario == "queue-edit" {
                // The queued draft is cleared by the first Ctrl-C. Wait for the canonical
                // interrupted projection before sending the second Ctrl-C that exits.
                wait_for_screen_marker(
                    &output_rx,
                    &mut output,
                    "interrupted",
                    Duration::from_secs(5),
                );
                writer.write_all(&[3]).expect("send second quit Ctrl-C");
                writer.flush().expect("flush second quit Ctrl-C");
            }
        } else {
            writer.write_all(&[4]).expect("exit TUI");
            writer.flush().expect("flush TUI exit");
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().expect("poll TUI process") {
            break status;
        }
        if Instant::now() >= deadline {
            child.kill().expect("terminate timed out TUI");
            panic!("TUI did not exit after terminal exit input; output: {output}");
        }
        thread::sleep(Duration::from_millis(20));
    };
    drop(writer);
    drop(master);
    reader_thread.join().expect("join PTY reader");
    while let Ok(chunk) = output_rx.try_recv() {
        output.push_str(&String::from_utf8_lossy(&chunk));
    }

    assert!(status.success(), "TUI exited with {status:?}: {output}");
    if scenario == "complete" {
        backtrack::assert_cold_canonical_history(&app_server_bin, &cwd, &ledger_path);
    }
    if scenario == "images" {
        images::assert_canonical_input(&app_server_bin, &cwd, &ledger_path, &prompt);
    }
    if scenario == "skills" {
        skills::assert_canonical_input(&app_server_bin, &cwd, &ledger_path, &prompt);
    }
    if let Some(provider) = picker_provider.as_deref() {
        model_picker::assert_cold_settings(
            &app_server_bin,
            &cwd,
            &node_bin,
            &backend_path,
            &ledger_path,
            provider,
            &scenario,
        );
    }
    assert!(
        output.contains("\u{1b}[?1049h"),
        "alternate screen not entered"
    );
    assert!(
        output.contains("\u{1b}[?1000h"),
        "mouse capture not enabled"
    );
    assert!(
        visible_terminal_text(&output).contains(visible_result),
        "terminal result was not visible"
    );
    if scenario == "interrupt" {
        let visible = visible_terminal_text(&output);
        assert!(
            visible.contains("interrupting") || visible.contains("interrupted"),
            "interrupt action was not rendered"
        );
        assert!(
            visible_terminal_text(&output).contains("esc to interrupt"),
            "Lime-style Escape interrupt hint was not rendered"
        );
    }
    if scenario == "queue-edit" {
        let visible = visible_terminal_text(&output);
        assert!(
            visible.contains("queued (1)"),
            "canonical queued preview was not rendered"
        );
        assert!(
            visible.contains(&queue_edit_hint),
            "queue edit affordance was not rendered"
        );
        assert!(
            visible.contains("editing queued"),
            "queued input was not restored to the composer"
        );
    }
    if scenario == "agents-overview" {
        let visible = agents_overview_screen.expect("agents overview screen");
        assert!(
            visible.contains("Agent command center"),
            "agents overview was not visible"
        );
        assert!(
            visible.contains("background task started"),
            "server-backed overview task start was not visible"
        );
        assert!(
            agents_overview_renamed_screen
                .expect("renamed agents overview screen")
                .contains("Gate B background"),
            "renamed background task was not visible"
        );
        let resumed = agents_overview_resumed_screen.expect("resumed background thread screen");
        assert!(
            resumed.contains("switched agent"),
            "background thread resume status was not visible"
        );
        assert!(
            resumed.contains("AGENTS_OVERVIEW_READY"),
            "background thread transcript was not restored"
        );
    }
    assert!(
        output.contains("\u{1b}[?1049l"),
        "alternate screen not restored"
    );
    cursor_style::assert_default_restored(&output);
    terminal_title::assert_cleared_on_exit(&output);
    assert!(
        output.contains("\u{1b}[?1000l"),
        "mouse capture not restored"
    );
    if scenario == "complete" {
        assert!(
            output.contains("EDITOR_JOB_CONTROL_OK"),
            "external editor did not inherit the PTY"
        );
        cursor_style::assert_default_before_editor(&output);
        terminal_title::assert_external_editor_handoff(&output);
        assert!(
            visible_terminal_text(&output).contains("/ STATUS"),
            "status pager was not visible"
        );
        if let Some(expected_permission_profile) = expected_permission_profile.as_deref() {
            assert!(
                visible_terminal_text(&output).contains(expected_permission_profile),
                "configured permission profile was not visible: {expected_permission_profile}"
            );
        }
        assert!(
            visible_terminal_text(&output).contains("ctrl+t·esc·q close"),
            "transcript overlay was not visible"
        );
        assert!(
            main_transcript_mouse_selection_visible,
            "main transcript SGR mouse selection was not visible"
        );
        assert!(
            sticky_prompt_header_visible,
            "compact transcript sticky prompt header was not visible"
        );
        assert!(
            main_transcript_find_visible,
            "configured compact transcript Find chord and match highlight were not visible"
        );
        assert!(
            transcript_mouse_selection_visible,
            "transcript SGR mouse selection was not visible"
        );
        assert!(
            transcript_keyboard_selection_visible,
            "transcript Ctrl-Space keyboard selection was not visible"
        );
        assert!(
            transcript_edge_drag_scrolled,
            "transcript edge drag did not continuously scroll the canonical projection"
        );
        assert!(
            transcript_disclosure_visible,
            "transcript activity disclosure was not visible"
        );
        assert!(
            transcript_reasoning_visible,
            "transcript-only reasoning was not retained in the detailed transcript"
        );
        assert!(
            transcript_bookmark_restored,
            "detailed transcript bookmark was not restored after Ctrl-T reopen"
        );
        assert!(
            raw_output_visible,
            "Alt-R raw output did not expose canonical markdown source"
        );
        assert!(
            follow_control_visible,
            "compact transcript return-to-latest control was not visible"
        );
    }
}

fn required_test_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn wait_for_compact_marker(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    marker: &str,
    timeout: Duration,
) {
    let compact = |text: &str| {
        text.chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>()
    };
    let expected = compact(marker);
    let deadline = Instant::now() + timeout;
    loop {
        if compact(&visible_terminal_text(output)).contains(&expected) {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for compact {marker:?}; output: {output}");
        }
        let chunk = output_rx
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("PTY closed before compact {marker:?}; output: {output}"));
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_marker(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    marker: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    while !visible_terminal_text(output).contains(marker) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for {marker:?}; output: {output}");
        }
        let chunk = output_rx
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("PTY closed before {marker:?}; output: {output}"));
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn write_typed_text(writer: &mut impl Write, text: &[u8]) {
    for byte in text {
        writer
            .write_all(std::slice::from_ref(byte))
            .expect("write typed text");
        writer.flush().expect("flush typed text");
        thread::sleep(Duration::from_millis(12));
    }
}

fn wait_for_any_marker(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    markers: &[&str],
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    while !markers
        .iter()
        .any(|marker| visible_terminal_text(output).contains(marker))
    {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for one of {markers:?}; output: {output}");
        }
        let chunk = output_rx
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("PTY closed before one of {markers:?}; output: {output}"));
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_raw_marker_after(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    start: usize,
    marker: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let recent = output.get(start..).unwrap_or_default();
        if recent.contains(marker) {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for raw {marker:?}; output: {output}");
        }
        let chunk = output_rx
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("PTY closed before raw {marker:?}; output: {output}"));
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_marker_after(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    start: usize,
    marker: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let recent = output.get(start..).unwrap_or_default();
        if visible_terminal_text(recent).contains(marker) {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for new {marker:?}; output: {output}");
        }
        let chunk = output_rx
            .recv_timeout(remaining)
            .unwrap_or_else(|_| panic!("PTY closed before new {marker:?}; output: {output}"));
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_screen_marker(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    marker: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    while !terminal_screen_text(output).contains(marker) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!("timed out waiting for screen marker {marker:?}; output: {output}");
        }
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|_| {
            panic!("PTY closed before screen marker {marker:?}; output: {output}")
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_screen(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    scenario: &str,
    predicate: impl Fn(&str) -> bool,
) -> String {
    // A loaded host can take longer than 10s to redraw a long transcript before
    // the next keystroke is visible; keep the bound generous but finite.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let screen = terminal_screen_text(output);
        if predicate(&screen) {
            return screen;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "timed out: {scenario}; screen: {screen}"
        );
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|error| {
            panic!("PTY unavailable: {scenario}; {error}; screen: {screen}")
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_cursor_position(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    row: u16,
    column: u16,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    while terminal_cursor_position(output) != (row, column) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!(
                "timed out waiting for terminal cursor at row {row}, column {column}; output: {output}"
            );
        }
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|_| {
            panic!(
                "PTY closed before terminal cursor reached row {row}, column {column}; output: {output}"
            )
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_inverse_cells(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    row: u16,
    column: u16,
    width: u16,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let selected = terminal_observer::with_screen(output, |screen| {
            (column..column.saturating_add(width))
                .all(|column| screen.cell(row, column).is_some_and(vt100::Cell::inverse))
        });
        if selected {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!(
                "timed out waiting for inverse transcript selection at row {row}, column {column}, width {width}; output: {output}"
            );
        }
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|_| {
            panic!("PTY closed before transcript selection became visible; output: {output}")
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_non_inverse_cells(
    output_rx: &mpsc::Receiver<Vec<u8>>,
    output: &mut String,
    row: u16,
    column: u16,
    width: u16,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let cleared = terminal_observer::with_screen(output, |screen| {
            (column..column.saturating_add(width))
                .all(|column| !screen.cell(row, column).is_some_and(vt100::Cell::inverse))
        });
        if cleared {
            return;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            panic!(
                "timed out waiting for inverse transcript selection to clear at row {row}, column {column}, width {width}; output: {output}"
            );
        }
        let chunk = output_rx.recv_timeout(remaining).unwrap_or_else(|_| {
            panic!("PTY closed before transcript selection cleared; output: {output}")
        });
        output.push_str(&String::from_utf8_lossy(&chunk));
    }
}

fn wait_for_ledger_kind_and_scenario(
    path: &PathBuf,
    kind: &str,
    scenario: &str,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(contents) = std::fs::read_to_string(path) {
            let found = contents
                .lines()
                .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                .any(|entry| {
                    entry.get("kind").and_then(serde_json::Value::as_str) == Some(kind)
                        && entry.get("scenario").and_then(serde_json::Value::as_str)
                            == Some(scenario)
                });
            if found {
                return;
            }
        }
        if Instant::now() >= deadline {
            panic!("timed out waiting for backend ledger kind {kind:?} in scenario {scenario:?}");
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn visible_terminal_text(output: &str) -> String {
    let mut visible = String::new();
    let mut chars = output.chars();
    while let Some(character) = chars.next() {
        if character != '\u{1b}' {
            visible.push(character);
            continue;
        }
        let Some(control) = chars.next() else {
            break;
        };
        match control {
            '[' => {
                for character in chars.by_ref() {
                    if ('@'..='~').contains(&character) {
                        break;
                    }
                }
            }
            ']' => {
                let mut previous = '\0';
                for character in chars.by_ref() {
                    if character == '\u{7}' || (previous == '\u{1b}' && character == '\\') {
                        break;
                    }
                    previous = character;
                }
            }
            _ => {}
        }
    }
    visible
}

#[test]
fn visible_terminal_text_ignores_cursor_controls() {
    let output = "Choose\u{1b}[19;8Ha\u{1b}[19;10H mode";
    assert_eq!(visible_terminal_text(output), "Choosea mode");
}
