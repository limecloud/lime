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
#[path = "runtime_pty_tests/composer.rs"]
mod composer;
#[path = "runtime_pty_tests/diff_display.rs"]
mod diff_display;
#[path = "runtime_pty_tests/images.rs"]
mod images;
#[path = "runtime_pty_tests/model_picker.rs"]
mod model_picker;
#[path = "runtime_pty_tests/pending_paste.rs"]
mod pending_paste;
#[path = "runtime_pty_tests/reasoning_shortcuts.rs"]
mod reasoning_shortcuts;
#[path = "runtime_pty_tests/request_user_input.rs"]
mod request_user_input;
#[path = "runtime_pty_tests/resume_picker.rs"]
mod resume_picker;
#[path = "runtime_pty_tests/skills.rs"]
mod skills;
#[path = "runtime_pty_tests/suggestions.rs"]
mod suggestions;
#[path = "runtime_pty_tests/thread_input.rs"]
mod thread_input;
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
    let permission_config = std::env::var_os("LIME_TEST_PERMISSION_CONFIG");
    let expected_permission_profile = std::env::var("LIME_TEST_PERMISSION_PROFILE").ok();
    let scenario =
        std::env::var("LIME_TEST_TERMINAL_SCENARIO").unwrap_or_else(|_| "complete".to_string());
    // Keep the interrupt backend alive long enough for the real PTY event
    // loop to deliver turn/interrupt before the fixture timeout fires.
    let backend_timeout_ms = if matches!(
        scenario.as_str(),
        "interrupt" | "queue-edit" | "agents-overview"
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
    let picker_provider =
        (scenario == "complete").then(|| model_picker::seed_catalog(&app_server_bin, &cwd));

    let mut command = CommandBuilder::new(cli_bin);
    for argument in [
        OsString::from("tui"),
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
    if let Some(permission_config) = permission_config {
        command.env("LIME_CONFIG_PATH", permission_config);
    }
    if scenario == "complete" {
        configure_external_editor(&mut command, &cwd, &prompt);
    } else if scenario == "images" {
        configure_external_editor(&mut command, &cwd, images::EDITOR_TEXT);
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("open PTY");
    let mut reader = pair.master.try_clone_reader().expect("clone PTY reader");
    let mut writer = pair.master.take_writer().expect("take PTY writer");
    let mut child = pair.slave.spawn_command(command).expect("spawn lime TUI");
    drop(pair.slave);
    let master = pair.master;
    let (output_tx, output_rx) = mpsc::channel();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if output_tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    let _ = output_tx.send(format!("PTY_READER_ERROR: {error}\n").into_bytes());
                    break;
                }
            }
        }
    });
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

    wait_for_marker(
        &output_rx,
        &mut output,
        "Ask Lime to do anything",
        Duration::from_secs(10),
    );
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
        writer
            .write_all(b"\x1b[20~")
            .expect("configured F9 resumes searched background thread");
        writer.flush().expect("flush background thread resume");
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
        thread_input::exercise_round_trip(&mut writer, &output_rx, &mut output, &ledger_path);
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
            |screen| screen.contains("? for shortcuts") && !screen.contains("Keyboard shortcuts"),
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
        writer.write_all(&[7]).expect("open external editor");
        writer.flush().expect("flush editor shortcut");
        wait_for_marker(
            &output_rx,
            &mut output,
            "EDITOR_JOB_CONTROL_OK",
            Duration::from_secs(10),
        );
        // Re-entering the alternate screen must not synchronously query the PTY. The next
        // draw is responsible for reconciling the restored surface and showing the composer.
        wait_for_screen_marker(&output_rx, &mut output, &prompt, Duration::from_secs(10));

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
    } else {
        write_typed_text(&mut writer, prompt.as_bytes());
    }
    if scenario != "agents-overview" {
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
        "agents-overview" => "Agent command center",
        "interrupt" => "INTERRUPT_READY",
        "queue-edit" => &queue_prompt,
        "failure" => "fixture backend failure",
        _ => &completed_text,
    };
    if scenario != "agents-overview" {
        let marker = match scenario.as_str() {
            "approval" => "Allow terminal command?",
            // Cursor-addressed renders may split the full question across writes; the
            // stable question title is sufficient to prove the prompt is visible.
            "user-input" => "Choose",
            "interrupt" => "INTERRUPT_READY",
            "queue-edit" => "QUEUE_EDIT_READY",
            "failure" => "fixture backend failure",
            _ => &completed_text,
        };
        wait_for_marker(&output_rx, &mut output, marker, Duration::from_secs(10));
        if scenario == "approval" {
            approval::exercise_read_only_details(
                &mut writer,
                &output_rx,
                &mut output,
                &ledger_path,
            );
            writer.write_all(b"y").expect("approve command");
            writer.flush().expect("flush approval");
            wait_for_marker(
                &output_rx,
                &mut output,
                &completed_text,
                Duration::from_secs(10),
            );
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
        if scenario == "diff-display" {
            diff_display::assert_painted_patch(&output_rx, &mut output);
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
                    screen.contains("? for shortcuts") && !screen.contains("Keyboard shortcuts")
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
            "Codex-style Escape interrupt hint was not rendered"
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
    assert!(
        output.contains("\u{1b}[?1000l"),
        "mouse capture not restored"
    );
    if scenario == "complete" {
        assert!(
            output.contains("EDITOR_JOB_CONTROL_OK"),
            "external editor did not inherit the PTY"
        );
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

#[cfg(unix)]
fn configure_external_editor(command: &mut CommandBuilder, cwd: &Path, prompt: &str) {
    use std::os::unix::fs::PermissionsExt;

    let script = cwd.join("tui-editor.sh");
    std::fs::write(
        &script,
        "#!/bin/sh\ntest -t 0 && test -t 1 && test -t 2 || exit 9\nprintf '%s' \"$LIME_TEST_EDITOR_REPLACEMENT\" > \"$1\"\nprintf 'EDITOR_JOB_CONTROL_OK\\n'\n",
    )
    .expect("write editor fixture");
    let mut permissions = std::fs::metadata(&script)
        .expect("editor fixture metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&script, permissions).expect("editor fixture permissions");
    command.env("VISUAL", script);
    command.env("LIME_TEST_EDITOR_REPLACEMENT", prompt);
}

#[cfg(windows)]
fn configure_external_editor(command: &mut CommandBuilder, cwd: &Path, prompt: &str) {
    let script = cwd.join("tui-editor.cmd");
    std::fs::write(
        &script,
        "@echo off\r\n<nul set /p \"=%LIME_TEST_EDITOR_REPLACEMENT%\" > \"%~1\"\r\necho EDITOR_JOB_CONTROL_OK\r\n",
    )
    .expect("write editor fixture");
    command.env("VISUAL", script);
    command.env("LIME_TEST_EDITOR_REPLACEMENT", prompt);
}

fn required_test_path(name: &str) -> PathBuf {
    std::env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("missing {name}"))
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
    let deadline = Instant::now() + Duration::from_secs(10);
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

fn terminal_screen_text(output: &str) -> String {
    let mut parser = vt100::Parser::new(24, 100, 0);
    parser.process(output.as_bytes());
    parser.screen().contents()
}

fn terminal_cursor_position(output: &str) -> (u16, u16) {
    let mut parser = vt100::Parser::new(24, 100, 0);
    parser.process(output.as_bytes());
    parser.screen().cursor_position()
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

fn terminal_marker_position(output: &str, marker: &str) -> Option<(u16, u16)> {
    let mut parser = vt100::Parser::new(24, 100, 0);
    parser.process(output.as_bytes());
    let position = parser
        .screen()
        .rows(0, 100)
        .enumerate()
        .find_map(|(row, text)| {
            let offset = text.find(marker)?;
            let column = crate::width::display_width(&text[..offset]);
            Some((u16::try_from(row).ok()?, u16::try_from(column).ok()?))
        });
    position
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
        let mut parser = vt100::Parser::new(24, 100, 0);
        parser.process(output.as_bytes());
        let selected = (column..column.saturating_add(width)).all(|column| {
            parser
                .screen()
                .cell(row, column)
                .is_some_and(vt100::Cell::inverse)
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
        let mut parser = vt100::Parser::new(24, 100, 0);
        parser.process(output.as_bytes());
        let cleared = (column..column.saturating_add(width)).all(|column| {
            !parser
                .screen()
                .cell(row, column)
                .is_some_and(vt100::Cell::inverse)
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
