import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const gateSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/tui-gate-b.mjs"),
  "utf8",
);
const runtimeSource = readFileSync(
  path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
  "utf8",
);
const ptyTestSource = readFileSync(
  path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime_pty_tests.rs"),
  "utf8",
);
const statusLinePtySource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/status_line.rs",
  ),
  "utf8",
);
const terminalFixtureSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/terminal-gate-fixture.mjs"),
  "utf8",
);
const suggestionTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/suggestions.rs",
  ),
  "utf8",
);
const approvalTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/approval.rs",
  ),
  "utf8",
);
const requestInputTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/request_user_input.rs",
  ),
  "utf8",
);
const resumeTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/resume_picker.rs",
  ),
  "utf8",
);
const exportTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/transcript_export.rs",
  ),
  "utf8",
);
const modelPickerTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/model_picker.rs",
  ),
  "utf8",
);
const cursorStyleTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/cursor_style.rs",
  ),
  "utf8",
);
const reasoningShortcutTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/src/runtime_pty_tests/reasoning_shortcuts.rs",
  ),
  "utf8",
);
const reasoningDispatchSource = readFileSync(
  path.resolve(process.cwd(), "lime-rs/crates/tui/src/app/event_dispatch.rs"),
  "utf8",
);
const focusTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/tests/suite/focus_palette.rs",
  ),
  "utf8",
);
const resizeTestSource = readFileSync(
  path.resolve(
    process.cwd(),
    "lime-rs/crates/tui/tests/suite/resize_reflow.rs",
  ),
  "utf8",
);
const reconnectTestSource = readFileSync(
  path.resolve(process.cwd(), "lime-rs/crates/tui/tests/suite/reconnect.rs"),
  "utf8",
);
const historyPaginationTestSource =
  readFileSync(
    path.resolve(
      process.cwd(),
      "lime-rs/crates/tui/tests/suite/history_pagination.rs",
    ),
    "utf8",
  ) +
  readFileSync(
    path.resolve(
      process.cwd(),
      "lime-rs/crates/tui/tests/suite/history_pagination/fixtures.rs",
    ),
    "utf8",
  );

describe("TUI Gate B", () => {
  it("requires canonical usage in the real pager, footer and OSC with shared persistence", () => {
    expect(ptyTestSource).toContain("token_usage::exercise_shared_usage(");
    const usage = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/token_usage.rs",
      ),
      "utf8",
    );
    for (const marker of [
      "status pager displays server totals and latest context",
      "footer displays canonical usage and context",
      "OSC preview uses the same canonical usage",
      "usage title cancel restores or save acknowledges",
      "config::assert_fresh_stdio_settings(&selected)",
      "usage configuration must not create a canonical turn",
    ]) {
      expect(usage).toContain(marker);
    }
    expect(usage).not.toMatch(/thread::sleep|tokio::time::sleep|MockBackend/);
    expect(gateSource).toContain('"token-usage=ok"');
  });
  it("requires canonical task progress in both the real footer and OSC preview", () => {
    expect(ptyTestSource).toContain("task_progress::exercise_shared_progress(");
    const progress = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/task_progress.rs",
      ),
      "utf8",
    );
    for (const marker of [
      "saved footer shows canonical task progress",
      "title preview uses the same typed task progress",
      "saved title and footer share canonical progress",
      "task-progress configuration must not create a canonical turn",
    ]) {
      expect(progress).toContain(marker);
    }
    expect(progress).not.toMatch(
      /thread::sleep|tokio::time::sleep|MockBackend/,
    );
    const backend = readFileSync(
      path.resolve(
        process.cwd(),
        "scripts/app-server/terminal-gate-fixture.mjs",
      ),
      "utf8",
    );
    expect(backend).toContain('type: "turn.plan.updated"');
  });
  it("requires real title preview, cancellation, ordered persistence and disabled OSC evidence", () => {
    expect(ptyTestSource).toContain(
      "title_setup::exercise_preview_save_and_cancel(",
    );
    const setup = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/title_setup.rs",
      ),
      "utf8",
    );
    for (const marker of [
      "ordered title selection previews real OSC before saving",
      "cancel restores actual managed OSC",
      "explicit empty selection clears managed OSC",
      "Ctrl-C restores the saved disabled title",
      "title interaction must not create a canonical turn",
      "narrow title setup keeps the full cancel chord",
    ])
      expect(setup).toContain(marker);
    expect(setup).not.toMatch(/thread::sleep|tokio::time::sleep|MockBackend/);
    const config = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/config.rs",
      ),
      "utf8",
    );
    expect(config).toContain("AppAction::TerminalTitleSetup");
    expect(config).toContain("conflict must recover the latest shared version");
  });
  it("observes terminal titles from real OSC bytes and restores them on exit and handoff", () => {
    const observer = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/terminal_title.rs",
      ),
      "utf8",
    );
    expect(observer).toContain('output.match_indices("\\x1b]0;")');
    expect(observer).not.toMatch(
      /thread::sleep|tokio::time::sleep|MockBackend/,
    );
    for (const action of [
      "wait_for_idle",
      "wait_for_running",
      "wait_for_action_required",
      "wait_for_named_thread",
      "assert_cleared_on_exit",
      "assert_external_editor_handoff",
    ]) {
      expect(ptyTestSource).toContain(`terminal_title::${action}(`);
    }
  });
  it("requires real status-line selection, save, cancel and narrow reflow evidence", () => {
    expect(ptyTestSource).toContain(
      "status_line::exercise_selection_save_and_cancel(",
    );
    for (const marker of [
      "reopened setup keeps explicit empty selection",
      "configured cancel restores the saved status line without writing",
      "narrow setup keeps the complete configured cancel chord",
      "status-line interaction must not start another canonical turn",
    ]) {
      expect(statusLinePtySource, marker).toContain(marker);
    }
    expect(statusLinePtySource).toContain("ConfigManager::load(config_path)");
    expect(statusLinePtySource).not.toMatch(
      /thread::sleep|tokio::time::sleep|MockBackend/,
    );
  });
  it("requires executed thread-input resume evidence rather than a skipped or empty target", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/session_lifecycle_tests.rs",
      ),
      "utf8",
    );
    expect(source).toContain("LIME_TEST_TUI_GATE_B");
    expect(source).toContain("resume_target_session(");
    expect(source).toContain("handle_app_server_event(session, event)");
    expect(source).toContain("each canonical request is answered exactly once");
    expect(source).toContain("child_read.turns.is_empty()");
    expect(gateSource).toContain(
      "app::session_lifecycle::tests::real_stdio_thread_handoff_preserves_pending_input",
    );
    expect(gateSource).toContain("STDIO_THREAD_INPUT_OK root=");
    expect(gateSource).toContain("if (!threadInputEvidence)");
    expect(gateSource).toContain("thread-input-stdio=ok");
  });
  it("requires executed typed-input stdio evidence instead of a skipped or empty test target", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime/input_submission_tests.rs",
      ),
      "utf8",
    );
    for (const marker of [
      "canonical queue -> TUI edit -> real queue/add is lossless",
      "failed submit must preserve typed metadata",
      "three rejected submissions must not create another canonical turn",
      "STDIO_TYPED_INPUT_OK",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain(".thread_read(thread.id.clone(), false)");
    expect(source).toContain("thread_turns_page_with_handle(");
    expect(source).toContain("Some(ImageDetail::Original)");
    expect(source).toContain("TextElement::new(3..10, None)");
    expect(source).not.toContain("thread::sleep");
    expect(gateSource).toContain(
      "typed input stdio fixture did not execute its full canonical assertions",
    );
    expect(gateSource).toContain("typed-input-stdio=ok");
  });
  it("requires real PTY backtracking and a fresh canonical resume after history replacement", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/backtrack.rs",
      ),
      "utf8",
    );
    expect(source).toContain("canonical prompt browsing and rewind controls");
    expect(source).toContain(
      "revert replaces history and restores the selected typed prompt",
    );
    expect(source).toContain(".thread_read(&thread_id, false)");
    expect(source).toContain(".resume_thread(thread_id.clone())");
    expect(source).toContain("TUI_BACKTRACK_OK");
    expect(source).not.toContain("thread::sleep");
    expect(gateSource).toContain(
      "backtrack PTY fixture did not prove canonical revert and cold resume",
    );
    expect(gateSource).toContain("cold-revert-resume=ok");
    const stdio = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app_backtrack/stdio_tests.rs",
      ),
      "utf8",
    );
    expect(stdio).toContain(".start_turn_input(input)");
    expect(stdio).toContain(
      "app.chat_widget.bottom_pane.composer_text_elements()",
    );
    expect(stdio).toContain(
      "receive_terminal(&mut app, &mut session, &live_turn)",
    );
    expect(stdio).not.toMatch(/tokio::time::sleep|thread::sleep|MockBackend/);
    expect(gateSource).toContain("backtrack-stdio=ok");
  });

  it("requires history failure fixtures to satisfy the startup config contract", () => {
    expect(historyPaginationTestSource).toContain(
      "transcript_history_failure_keeps_anchor_and_home_retry_recovers",
    );
    expect(historyPaginationTestSource).toContain(
      "transcript_history_completion_is_ignored_after_thread_switch",
    );
    expect(historyPaginationTestSource).toContain(
      "transcript_history_completion_is_ignored_after_reconnect",
    );
    expect(historyPaginationTestSource).toContain(
      "transcript_search_history_failure_keeps_query_and_home_retry_recovers",
    );
    expect(historyPaginationTestSource).toContain(
      "transcript_search_completion_is_ignored_after_thread_switch",
    );
    expect(historyPaginationTestSource).toContain(
      "transcript_search_completion_is_ignored_after_reconnect",
    );
    expect(historyPaginationTestSource).toContain("HISTORY_SEARCH_RACE_QUERY");
    expect(historyPaginationTestSource).toContain("run_history_switch_server");
    expect(historyPaginationTestSource).toContain(
      "run_history_reconnect_server",
    );
    expect(historyPaginationTestSource).toContain(
      '"config/read" => json!({"config": {}, "origins": {}})',
    );
    expect(historyPaginationTestSource).toContain(
      "fixture Turn enrichment failed once",
    );
  });
  it("rejects oversized expanded paste without a turn and permits an atomic corrected retry", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/pending_paste.rs",
      ),
      "utf8",
    );
    for (const marker of [
      "MAX_USER_INPUT_TEXT_CHARS + 1",
      "length rejection is visible and retains the original folded draft",
      "rejected draft must never reach canonical turn/start",
      "rejected paste can be atomically deleted for a corrected retry",
      "structured history restores folded payload before canonical submit",
    ]) {
      expect(source).toContain(marker);
    }
    expect(source).toContain('format!("\\u{3000}\\n{prompt}\\t \\n")');
    expect(source).not.toContain("thread::sleep");
    expect(gateSource).toContain("submission-prepare=ok rejected-draft=ok");
  });
  it("drives configured Vim actions, search and linewise registers through the real PTY", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/vim_keymap.rs",
      ),
      "utf8",
    );
    const composer = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/composer.rs",
      ),
      "utf8",
    );
    expect(composer).toContain("vim_keymap::exercise_modal_keymap");
    for (const symbol of [
      "rebound F12 deletes but old x is explicitly unbound",
      "rebound text object uses operator context not Normal F12",
      "configured search moved to the real word before deletion",
      "linewise register pastes below the current logical line",
      "modal chord cancellation does not submit and rebound undo remains one edit",
      "configured Vim flow leaves no canonical turn or residual draft",
      "empty Vim slash opens command completion in Insert mode",
      "nonempty Vim slash stays in the search owner",
    ]) {
      expect(source).toContain(symbol);
    }
    for (const context of [
      "vim_normal:",
      "vim_operator:",
      "vim_text_object:",
      "vim_search:",
    ]) {
      expect(gateSource).toContain(context);
    }
    expect(source).not.toContain("thread::sleep");
    const emptySlashMarker =
      "TUI_VIM_EMPTY_SLASH_OK empty=command nonempty=search chord=search completion=draft turns=none";
    expect(source).toContain(emptySlashMarker);
    expect(gateSource).toContain(emptySlashMarker);
    expect(gateSource).toContain(
      "vim-keymap=ok vim-linewise=ok vim-modal-chord=ok",
    );
  });
  it("exercises editor config, unbind and chord on the real terminal without submitting a turn", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/composer.rs",
      ),
      "utf8",
    );
    for (const symbol of [
      "exercise_editor_keymap",
      "explicit delete unbind preserve draft",
      "editor chord kills only the resolved logical line",
      "editor chord cancellation does not submit",
      "configured editor flow leaves no canonical turn",
    ]) {
      expect(source).toContain(symbol);
    }
    expect(gateSource).toContain('"      delete_forward: []"');
    expect(gateSource).toContain('"      move_down: down"');
    expect(gateSource).toContain(
      'scenario === "complete" ? editorConfigPath : permissionConfigPath',
    );
    expect(gateSource).toContain(
      "editor-keymap=ok editor-unbind=ok editor-chord=ok",
    );
  });
  it("replays semantic Vim changes and restores command state through real history search", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/composer.rs",
      ),
      "utf8",
    );
    expect(source).toContain("exercise_vim_command_state");
    expect(source).toContain("semantic dot replays the complete change");
    expect(source).toContain(
      "search cancellation restores the original Vim draft",
    );
    expect(source).toContain(
      "local Vim command leaves no turn or residual draft",
    );
    expect(source).toContain(
      "dot repeats reclassified Unicode text without its withdrawn prefix",
    );
    expect(source).toContain('entry["kind"] == "turnStart"');
    expect(source).not.toContain("thread::sleep");
    expect(gateSource).toContain("vim-repeat=ok vim-search-state=ok");
    expect(gateSource).toContain("vim-paste-burst=ok");
  });
  it("selects, deletes, recalls and submits bound skills through PTY and cold read", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/skills.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain("skills::prepare_submission");
    expect(ptyTestSource).toContain("skills::assert_canonical_input");
    expect(source).toContain("wait_for_cursor_position");
    expect(source).toContain(
      "selected skill path and TextElement reach real runtime",
    );
    expect(source).toContain(
      "same canonical user item retains selected skill path",
    );
    expect(source).toMatch(/session\s*\.thread_read\(thread_id, false\)/u);
    expect(source).toContain("thread_turns_page_with_handle");
    expect(source).not.toContain("thread::sleep");
    expect(gateSource).toContain("skill-mentions=ok");
  });
  it("submits real image bytes and structured history through PTY and cold canonical projection", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/images.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain("images::prepare_submission");
    expect(ptyTestSource).toContain("images::assert_canonical_input");
    expect(source).toContain(
      "recall complete image entry through real Up history",
    );
    expect(source).toContain(
      "only the retained second image's actual bytes reach runtime lowering",
    );
    expect(source).toMatch(/session\s*\.thread_read\(thread_id, false\)/u);
    expect(source).toContain("thread_turns_page_with_handle");
    expect(source).toContain("TextElement::new(15..25");
    expect(source).not.toContain("thread::sleep");
    expect(terminalFixtureSource).toContain(
      "inputParts: input.request.input?.parts",
    );
    expect(gateSource).toContain("images=ok");
    expect(gateSource).toContain("structured-history=ok");
  });
  it("requires KeepScreen PTY evidence for both text and image editor handoffs", () => {
    const editor = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/external_editor.rs",
      ),
      "utf8",
    );
    expect(gateSource).toContain(
      'scenario === "complete" || scenario === "images"',
    );
    const marker =
      "TUI_EDITOR_KEEP_SCREEN_OK alternate=preserved composer=visible stdin=foreground editor-exit=main";
    expect(gateSource).toContain(marker);
    expect(editor).toContain(marker);
    expect(editor).toContain(
      "terminal_observer::with_screen(&output[..marker]",
    );
    expect(editor).toContain("screen.contents().contains(draft)");
    expect(editor.indexOf("TUI_EDITOR_KEEP_SCREEN_OK")).toBeGreaterThan(
      editor.indexOf("TUI must re-enter the alternate screen"),
    );
    expect(gateSource).toContain('scenario === "complete" ? 180_000 : 60_000');
  });
  it("requires cross-directory resume, editor buffer and cold canonical evidence", () => {
    const editor = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/external_editor.rs",
      ),
      "utf8",
    );
    expect(gateSource).toContain(
      "runtime::pty_tests::external_editor::real_pty_external_editor_uses_resumed_thread_cwd",
    );
    expect(gateSource).toContain(
      "resume=canonical launch=different buffer=canonical draft=unicode first-arrow=preserved cold-read=exact terminal=restored",
    );
    for (const boundary of [
      ".start_thread(",
      "CommandBuilder::new(cli_bin)",
      'OsString::from("resume")',
      'root.join("resumed thread 界")',
      "std::fs::read_to_string(&buffer_probe)",
      "std::fs::canonicalize(buffer.parent().unwrap())",
      "session.thread_read(&thread_id, false)",
      "thread_turns_page_with_handle(",
    ]) {
      expect(editor.replace(/\s+/gu, " "), boundary).toContain(boundary);
    }
  });
  it("retains folded drafts and cursors across real root/background-thread handoff", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/thread_input.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain("thread_input::prepare_root");
    expect(ptyTestSource).toContain("thread_input::exercise_round_trip");
    expect(gateSource).toContain('"      open_agents: ctrl-n"');
    expect(source).toContain("wait_for_cursor_position");
    expect(source).toContain(
      "unseen background thread starts with an isolated empty draft",
    );
    expect(source).toContain("restored atomic paste deletes as one element");
    expect(source).toContain(
      "draft open/cancel/root-child handoff must not submit an extra canonical turn",
    );
    expect(source).toContain(
      "session linewise register survives thread editor replacement without foreign undo",
    );
    expect(source).toContain(
      "thread lifetime fixture restores nonmodal exit boundary",
    );
    expect(source).not.toContain("thread::sleep");
  });
  it("paints canonical file-item diff rows and continuation padding in the actual PTY", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/diff_display.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain("diff_display::assert_painted_patch");
    expect(terminalFixtureSource).toContain('kind: "file"');
    expect(terminalFixtureSource).toContain('patchItem("completed")');
    expect(source).toContain("cell.bgcolor()");
    expect(source).toContain("!cell.dim()");
    expect(source).toContain("PTY_DIFF_NEW_TAIL");
    expect(source).not.toContain("thread::sleep");
  });
  it("edits the actual padded multiline composer before any canonical turn starts", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/composer.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain("composer::exercise_multiline_surface");
    expect(source).toContain("composer placeholder has top and bottom padding");
    expect(source).toContain(
      "multiline composer preserves gutter and blank bottom row",
    );
    expect(source).toContain(
      "multiline paste/clear/history search must not start a canonical turn",
    );
    expect(source).toContain(
      "duplicate history boundary keeps the unique preview",
    );
    expect(source).toContain("search Enter accepts without submitting");
    expect(source).not.toContain("thread::sleep");
  });
  it("selects the canonical current root from borderless subagents using configured controls", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/agent_picker.rs",
      ),
      "utf8",
    );
    expect(ptyTestSource).toContain(
      "agent_picker::exercise_open_cancel_and_current_root",
    );
    expect(source).toContain("› 1. • Main [default] (current)");
    expect(source).toContain("f9 select · ctrl+x q back");
    expect(source).toContain("screen.contains(&thread_id)");
    expect(source).toContain("cols: 16");
    expect(source).toContain(
      "narrow subagents footer selects a whole cancel chord instead of merging actions",
    );
    expect(source).toContain(
      "subagents open/cancel/current root must not submit a canonical turn",
    );
    expect(source).not.toContain("thread::sleep");
  });
  it("uses the configured list snapshot throughout Agent Center metadata and history handoff", () => {
    expect(ptyTestSource).toContain(
      '"configured list chord closes Agent Center help"',
    );
    expect(ptyTestSource).toContain('"configured F9 submits overview task"');
    expect(ptyTestSource).toContain(
      '"configured F9 submits background task name"',
    );
    expect(ptyTestSource).toContain(
      '"configured F9 resumes searched background thread"',
    );
  });
  it("steps advertised reasoning without wrapping or entering Ultra implicitly", () => {
    expect(ptyTestSource).toContain("reasoning_shortcuts::exercise_steps");
    expect(reasoningDispatchSource).toContain("prepare_reasoning_shortcut");
    expect(reasoningDispatchSource).not.toContain("EFFORTS");
    expect(reasoningShortcutTestSource).toContain(
      '"Reasoning is already at the lowest level (Low)."',
    );
    expect(reasoningShortcutTestSource).toContain(
      '"Ultra shortcut leaves catalog model at Max"',
    );
    expect(reasoningShortcutTestSource).toContain(
      '"status owns Alt reasoning and then closes"',
    );
    expect(reasoningShortcutTestSource).not.toContain("thread::sleep");
  });
  it("accepts catalog model/provider/effort only after nested confirmation and verifies cold settings", () => {
    expect(ptyTestSource).toContain("model_picker::seed_catalog");
    expect(ptyTestSource).toContain("model_picker::exercise_nested_selection");
    expect(ptyTestSource).toContain("model_picker::assert_cold_settings");
    expect(modelPickerTestSource).toContain("METHOD_MODEL_LIST");
    expect(modelPickerTestSource).toContain(
      '"model query and highlighted identity restored after child cancel"',
    );
    expect(modelPickerTestSource).toContain('"cold canonical thread/resume"');
    expect(modelPickerTestSource).toContain('Some("high")');
    expect(modelPickerTestSource).toContain('"f9 select · ctrl+x q back"');
    expect(modelPickerTestSource).toContain(
      '"configured Ctrl-D pages to More reasoning without closing or applying settings"',
    );
    expect(modelPickerTestSource).toContain(
      '"configured cancel chord returns to effort parent"',
    );
    expect(modelPickerTestSource).not.toContain("thread::sleep");
  });
  it("opens the canonical resume list and cancels without submitting a turn", () => {
    expect(ptyTestSource).toContain("resume_picker::exercise_open_and_cancel");
    expect(resumeTestSource).toContain(
      '"canonical session row and primary controls visible"',
    );
    expect(resumeTestSource).toContain(
      '"short resume viewport retains its selected row and controls"',
    );
    expect(resumeTestSource).toContain("cols: 10");
    expect(resumeTestSource).toContain(
      '"ten-column resume footer retains the whole cancel chord with its inset"',
    );
    expect(resumeTestSource).toContain(
      '"resume primary hints expand after narrow resize on the same canonical row"',
    );
    expect(resumeTestSource).toContain('"page in the actual resume viewport"');
    expect(gateSource).toContain('"      accept: f9"');
    expect(gateSource).toContain('"      cancel: ctrl-x q"');
    expect(resumeTestSource).toContain(
      '"configured accept resumed the same completed canonical transcript"',
    );
    for (const marker of [
      "Filter: All directories",
      "Filter: Current cwd",
      "Status: Archived",
      "Status: Active",
      "Sort: Created",
      "Sort: Updated",
    ]) {
      expect(resumeTestSource).toContain(marker);
    }
    expect(runtimeSource).toContain("picker.has_pending_page_down()");
    expect(resumeTestSource).toContain(
      '"resume open/cancel must not submit a new canonical turn"',
    );
    expect(resumeTestSource).not.toContain("thread::sleep");
  });
  it("edits the real export prompts with configured keys and keeps canonical output visible", () => {
    expect(ptyTestSource).toContain(
      "transcript_export::exercise_destination_filename_and_cancel",
    );
    for (const marker of [
      "export destination uses configured controls and keeps the canonical transcript visible",
      "narrow export destination displays the complete configured cancel chord",
      "configured F9 opens the filename prompt on the same canonical transcript",
      "export filename consumes the current editor chord without submitting",
      "edited export filename is visible without a new canonical turn",
      "multiline export prompt grows and scrolls to the visible tail",
      "export prompt keeps its cursor tail after narrow resize",
      "export prompt reflows without dropping pasted newlines",
      "export editor navigation scrolls back to the first pasted row",
      "export prompt inherits Vim in Insert mode",
      "export Insert Escape switches to Normal without closing the prompt",
      "export pending Vim chord updates the actual Escape hint",
      "export pending Vim chord owns Escape before prompt navigation",
      "export Vim cancellation restores the composer mode and canonical transcript",
      "export cancel restores the canonical transcript and main composer",
      "export selection, editing and cancellation must not start a canonical turn",
    ]) {
      expect(exportTestSource).toContain(marker);
    }
    expect(exportTestSource).toContain("cols: 14");
    expect(exportTestSource).toContain("PTY_EXPORT_NAME.md");
    expect(exportTestSource).not.toContain("thread::sleep");
  });
  it("observes real terminal cursor commands across Vim transitions, exit and external editor handoff", () => {
    const vimSource = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/runtime_pty_tests/vim_keymap.rs",
      ),
      "utf8",
    );
    expect(cursorStyleTestSource).toContain('output.rmatch_indices("\\x1b[")');
    expect(cursorStyleTestSource).toContain("recv_timeout(remaining)");
    expect(cursorStyleTestSource).not.toContain("thread::sleep");
    for (const marker of [
      "main Vim Insert emits a steady bar cursor",
      "main Vim Escape restores the default cursor",
    ]) {
      expect(vimSource, marker).toContain(marker);
    }
    for (const marker of [
      "export Vim Insert emits a steady bar cursor",
      "export Vim Normal restores the user's default cursor",
    ]) {
      expect(exportTestSource, marker).toContain(marker);
    }
    expect(ptyTestSource).toContain(
      "cursor_style::assert_default_restored(&output)",
    );
    expect(ptyTestSource).toContain(
      "cursor_style::assert_default_before_editor(&output)",
    );
  });

  it("edits notes without answering and preserves the selected canonical response", () => {
    expect(ptyTestSource).toContain(
      "request_user_input::exercise_notes_and_selection",
    );
    expect(requestInputTestSource).toContain('"PTY_NOTES_TAIL"');
    expect(requestInputTestSource).toContain(
      '"notes focus/return must not resolve the canonical question"',
    );
    expect(gateSource).toContain(
      'mode: ["Safe", `user_note: ${notesAnswer} REVISED`]',
    );
    expect(gateSource).toContain("followup: `user_note: ${followupAnswer}`");
    expect(gateSource).toContain(
      "TUI_NOTES_RESPONSE_OK thread=${notesTurn.threadId} turn=${notesTurn.turnId} encoding=user_note response=complete exactly-once=true",
    );
    expect(gateSource).toContain(
      "TUI_NOTES_UNANSWERED_OK edited=uncommitted confirm=explicit return=first draft=rich cursor=restored response=once",
    );
    expect(gateSource).toContain(
      "TUI_NOTES_BURST_OK framing=raw enter-tab=draft idle=atomic cancel=explicit response=none",
    );
    const imeOrderMarker =
      "TUI_NOTES_IME_ORDER_OK ascii-prefix=preserved unicode=immediate cancel=explicit";
    expect(gateSource).toContain(imeOrderMarker);
    expect(requestInputTestSource).toContain(imeOrderMarker);
    expect(requestInputTestSource).toContain(
      "raw paste Enter and Tab must not accept or resolve the question",
    );
    expect(runtimeSource).toContain("handle_paste_burst_tick");
    expect(requestInputTestSource).toContain(
      "unanswered confirmation must not submit a stale accepted answer",
    );
    expect(terminalFixtureSource).toContain(
      "userData: input.request.userData ?? null",
    );
    expect(requestInputTestSource).not.toContain("thread::sleep");
    expect(requestInputTestSource).toContain(
      "configured notes newline is a real focused editor action",
    );
    expect(requestInputTestSource).toContain(
      "notes chord cancellation does not submit or lose selected option",
    );
    expect(gateSource).toContain("notes-keymap=ok");
    expect(gateSource).toContain(
      "LIME_TEST_TERMINAL_NOTES_ANSWER: notesAnswer",
    );
    expect(requestInputTestSource).toContain(
      "long notes stay compact in the actual editor without command UI",
    );
    expect(requestInputTestSource).toContain(
      "long notes remain a draft until explicit acceptance",
    );
    expect(gateSource).toContain(
      "TUI_NOTES_PASTE_OK compact=atomic unicode=preserved answer=expanded commands=literal submit=explicit",
    );
    expect(gateSource).toContain(
      "TUI_NOTES_REVISIT_OK accepted=rich cursor=restored revision=exact followup=preserved response=once",
    );
    expect(requestInputTestSource).toContain(
      "revisiting accepted notes must not resolve the request before the last explicit answer",
    );
  });
  it("views approval details without resolving the protected request", () => {
    expect(ptyTestSource).toContain("approval::exercise_read_only_details");
    expect(approvalTestSource).toContain('"open approval details with Ctrl-A"');
    expect(approvalTestSource).toContain(
      '"close details without deciding approval"',
    );
    expect(approvalTestSource).toContain(
      '"details, unbound Enter and footer resize must not resolve the canonical request"',
    );
    expect(approvalTestSource).toContain(
      '"narrow approval footer keeps the configured accept key and whole cancel chord"',
    );
    expect(approvalTestSource).toContain("cols: 14");
    expect(ptyTestSource).toContain('"approve command with configured F9"');
    expect(approvalTestSource).not.toContain("thread::sleep");
  });
  it("drives catalog-backed suggestions through real keyboard completion", () => {
    expect(gateSource).toContain('"parser_alpha.rs", "parser_beta.rs"');
    expect(gateSource).toContain('".agents", "skills", name');
    expect(ptyTestSource).toContain("suggestions::exercise_suggestion_menus");
    expect(suggestionTestSource).toContain(
      '"original untruncated file path inserted"',
    );
    expect(suggestionTestSource).toContain('"› gate-skill-09"');
    expect(suggestionTestSource).toContain(
      '"canonical skill token inserted and popup closed"',
    );
    expect(suggestionTestSource).toContain(
      '"suggestion navigation/completion must not start a canonical turn"',
    );
    expect(suggestionTestSource).not.toContain("thread::sleep");
    const keyboardMarker =
      "TUI_POPUP_KEYBOARD_OK repeat=navigation-completion release=ignored modifiers=exact-control ctrl-j=newline ctrl-k=editor turns=none";
    expect(gateSource).toContain(keyboardMarker);
    expect(suggestionTestSource).toContain(keyboardMarker);
    const navigationMarker =
      "TUI_EMPTY_NAVIGATION_OK left=press-only repeat=editor release=ignored overview=cancelled turns=none";
    expect(gateSource).toContain(navigationMarker);
    expect(suggestionTestSource).toContain(navigationMarker);
    expect(suggestionTestSource).toContain("PTY_LEFT_EVENT_BARRIER");
    for (const sequence of [
      "\\x1b[1;1:2A",
      "\\x1b[1;1:2B",
      "\\x1b[1;1:3B",
      "\\x1b[9;1:2u",
      "\\x1b[1;1:2D",
      "\\x1b[1;1:3D",
    ]) {
      expect(suggestionTestSource).toContain(sequence);
    }
  });
  it("drives the real TUI through a portable PTY and current App Server", () => {
    expect(gateSource).toContain('LIME_TEST_TUI_GATE_B: "1"');
    expect(gateSource).toContain("buildTerminalGateBinaries");
    expect(gateSource).toContain("snapshotTerminalGateBinaries");
    expect(gateSource).toContain("LIME_TEST_TERMINAL_CWD: scenarioDir");
    expect(gateSource).toContain('"--exact"');
    expect(gateSource).toContain("writeTerminalExternalBackend");
    expect(ptyTestSource).toContain('OsString::from("tui")');
    expect(gateSource).toContain(
      "runtime::pty_tests::real_pty_restores_terminal_after_visible_turn_completion",
    );
    expect(gateSource).toContain(
      "suite::focus_palette::focus_gained_with_unanswered_palette_queries_preserves_immediate_input",
    );
    expect(gateSource).toContain('"--test",\n        "all"');
    expect(gateSource).toContain('"focus-palette=ok"');
    expect(focusTestSource).toContain(
      "focus_gained_with_unanswered_palette_queries_preserves_immediate_input",
    );
    expect(focusTestSource).toContain('b"\\x1b[I"');
    expect(focusTestSource).toContain(
      "focus regain queried terminal colors after startup palette was cached",
    );
    expect(focusTestSource).toContain('b"\\x1b[?1049l"');
    expect(gateSource).toContain('"suite::resize_reflow::"');
    expect(gateSource).toContain('"--test-threads=1"');
    expect(gateSource).toContain('"resize-reflow=ok"');
    expect(resizeTestSource).toContain(
      "tmux_split_preserves_fresh_session_composer_row_after_resize_reflow",
    );
    expect(resizeTestSource).toContain(
      "tmux_repeated_resizes_do_not_push_composer_down",
    );
    expect(resizeTestSource).toContain(
      "tmux_width_resize_restore_keeps_visible_content_anchored",
    );
    expect(resizeTestSource).toContain(
      "tmux_scrolled_composer_resize_preserves_visible_draft_text",
    );
    expect(resizeTestSource).toContain("terminal.resize(");
    expect(resizeTestSource).toContain(
      "!screen.contains(&compact_text(DRAFT))",
    );
    expect(resizeTestSource).toContain(
      "!screen.contains(&compact_text(DRAFT_INPUT_TAIL))",
    );
    expect(resizeTestSource).not.toContain("&[3, 3, 3]");
    expect(focusTestSource).toContain("self.master.resize");
    expect(gateSource).toContain(
      "suite::reconnect::automatic_reconnect_restores_draft_and_routes_new_notifications",
    );
    expect(gateSource).toContain('"reconnect=ok"');
    expect(reconnectTestSource).toContain(
      "automatic_reconnect_restores_draft_and_routes_new_notifications",
    );
    expect(reconnectTestSource).toContain('OsString::from("--remote")');
    expect(reconnectTestSource).toContain("thread/resume");
    expect(reconnectTestSource).toContain('"config/read"');
    expect(reconnectTestSource).toContain(
      "TUI settings must be read exactly once into the startup snapshot",
    );
    expect(reconnectTestSource).toContain("fresh-notification-after-reconnect");
    expect(reconnectTestSource).toContain("preserved-draft!");
    expect(reconnectTestSource).toContain('b"\\x1b[?1049l"');
    expect(ptyTestSource).toContain("native_pty_system()");
    expect(ptyTestSource).toContain('output.contains("\\u{1b}[?1049h")');
    expect(ptyTestSource).toContain('output.contains("\\u{1b}[?1049l")');
    expect(ptyTestSource).toContain("EDITOR_JOB_CONTROL_OK");
    expect(ptyTestSource).toContain("configure_external_editor");
    expect(ptyTestSource).toContain('"open shortcut overlay"');
    expect(ptyTestSource).toContain('"Keyboard shortcuts"');
    expect(ptyTestSource).toContain('"? / esc close"');
    expect(ptyTestSource).toContain(
      '"close shortcut overlay without interrupt"',
    );
    expect(ptyTestSource).toContain(
      '"close active help without cancelling turn"',
    );
    expect(ptyTestSource).toContain(
      '"closing shortcut help must not interrupt canonical turn"',
    );
    expect(ptyTestSource).toContain('"Select Model and Effort"');
    expect(ptyTestSource).toContain(
      '"cancel model picker without changing settings"',
    );
    expect(ptyTestSource).not.toContain('write_all(b"\\x1b[1;1R")');
    expect(ptyTestSource).toContain("writer.write_all(&[20])");
    expect(ptyTestSource).toContain('"ctrl+t·esc·q close"');
    expect(ptyTestSource).toContain(
      '"drag main transcript selection with SGR mouse input"',
    );
    expect(ptyTestSource).toContain(
      '"main transcript SGR mouse selection was not visible"',
    );
    expect(ptyTestSource).toContain('"sticky prompt header position"');
    expect(ptyTestSource).toContain(
      '"main transcript selection displaced the sticky prompt header"',
    );
    expect(ptyTestSource).toContain(
      '"compact transcript sticky prompt header was not visible"',
    );
    expect(gateSource).toContain('"sticky-prompt=ok"');
    expect(gateSource).toContain('"      find_transcript: ctrl-x f"');
    expect(ptyTestSource).toContain('write_all(b"\\x18")');
    expect(ptyTestSource).toContain(
      '"start configured main transcript Find chord with Ctrl-X"',
    );
    expect(ptyTestSource).toContain(
      '"complete configured main transcript Find chord"',
    );
    expect(ptyTestSource).toContain(
      '"configured compact transcript Find chord and match highlight were not visible"',
    );
    expect(gateSource).toContain('"main-find=ok"');
    expect(ptyTestSource).toContain(
      '"drag transcript selection with SGR mouse input"',
    );
    expect(ptyTestSource).toContain("wait_for_inverse_cells");
    expect(ptyTestSource).toContain(
      '"transcript SGR mouse selection was not visible"',
    );
    expect(ptyTestSource).toContain('write_all(b"\\0\\x1b[C")');
    expect(ptyTestSource).toContain(
      '"transcript Ctrl-Space keyboard selection was not visible"',
    );
    expect(gateSource).toContain("scrollableCompletedText");
    expect(ptyTestSource).toContain(
      '"hold a vertical transcript selection at the bottom edge"',
    );
    expect(ptyTestSource).toContain(
      '"transcript edge drag did not continuously scroll the canonical projection"',
    );
    expect(ptyTestSource).toContain('"bookmark transcript at top"');
    expect(ptyTestSource).toContain('"reopen transcript Ctrl-T"');
    expect(ptyTestSource).toContain(
      '"detailed transcript bookmark was not restored after Ctrl-T reopen"',
    );
    expect(ptyTestSource).toContain('writer.write_all(b"\\x1bOS")');
    expect(ptyTestSource).toContain('"+ Show details"');
    expect(ptyTestSource).toContain('"− Show less"');
    expect(ptyTestSource).toContain(
      '"transcript activity disclosure was not visible"',
    );
    expect(terminalFixtureSource).toContain('kind: "reasoning"');
    expect(terminalFixtureSource).toContain('type: "reasoning"');
    expect(terminalFixtureSource).toContain("JSON.stringify(reasoningParts)");
    expect(gateSource).toContain("PTY_EMPTY_STATUS");
    expect(gateSource).toContain("PTY_BODY_HEADER");
    expect(gateSource).toContain("TUI_REASONING_PARTS_OK");
    expect(gateSource).toContain("STDIO_REASONING_PARTS_OK");
    expect(gateSource).toContain("STDIO_REASONING_RESUME_OK");
    expect(gateSource).toContain("TUI_REASONING_RESUME_OK");
    expect(gateSource).toContain(
      "real_stdio_running_reasoning_resumes_indexed_parts_without_started",
    );
    expect(gateSource).toContain(
      "real_stdio_reasoning_snapshot_matches_notifications_and_cold_read",
    );
    expect(ptyTestSource).toContain("reasoning::assert_summary_body");
    expect(gateSource).toContain("LIME_TEST_TERMINAL_REASONING_TEXT");
    expect(gateSource).toContain("LIME_TEST_TERMINAL_RAW_TEXT");
    expect(ptyTestSource).toContain(
      '"transcript-only reasoning leaked into the compact main transcript"',
    );
    expect(ptyTestSource).toContain(
      '"transcript-only reasoning was not retained in the detailed transcript"',
    );
    expect(ptyTestSource).toContain('write_all(b"\\x1br")');
    expect(ptyTestSource).toContain(
      '"Alt-R raw output did not expose canonical markdown source"',
    );
    expect(ptyTestSource).toContain('write_all(b"\\x1b[5~")');
    expect(ptyTestSource).toContain('"Back to bottom"');
    expect(ptyTestSource).toContain(
      '"compact transcript return-to-latest control was not visible"',
    );
    expect(ptyTestSource).toContain('writer.write_all(b"\\x1b")');
    expect(ptyTestSource).toContain('"esc to interrupt"');
    expect(ptyTestSource).toContain('write_all(b"\\x1b[1;3A")');
    expect(ptyTestSource).toContain('"editing queued"');
    expect(ptyTestSource).toContain("thread_input::prepare_root");
    expect(ptyTestSource).toContain('write_all(b"n")');
    expect(ptyTestSource).toContain('write_all(b"r")');
    expect(ptyTestSource).toContain('write_all(b"x")');
    expect(ptyTestSource).toContain('write_all(b"\\t\\t")');
    expect(ptyTestSource).toContain('"Rename ›"');
    expect(ptyTestSource).toContain('"Search ›"');
    expect(ptyTestSource).toContain('"Agent command center"');
    expect(ptyTestSource).toContain("terminal_observer");
    expect(
      readFileSync(
        path.resolve(
          process.cwd(),
          "lime-rs/crates/tui/src/runtime_pty_tests/terminal_observer.rs",
        ),
        "utf8",
      ),
    ).toContain("vt100::Parser::new(24, 100, 0)");
    expect(ptyTestSource).toContain('"background task started"');
    expect(ptyTestSource).toContain('"Working 1"');
    expect(ptyTestSource).toContain('"Gate B background"');
    expect(ptyTestSource).toContain('"AGENTS_OVERVIEW_READY"');
    expect(gateSource).toContain('event?.type === "queue.added"');
    expect(gateSource).toContain('event?.type === "queue.removed"');
    expect(gateSource).toContain(
      'event.payload?.source === "thread/queue/delete"',
    );
    expect(gateSource).toContain(
      '"complete,approval,user-input,interrupt,failure,queue-edit,agents-overview,large-paste,diff-display,images,skills"',
    );
  });

  it("does not substitute a mock backend or synthetic completion event", () => {
    expect(ptyTestSource).toContain(
      'OsString::from("--app-server-arg=external")',
    );
    expect(gateSource).not.toContain('APP_SERVER_BACKEND_MODE: "mock"');
    expect(gateSource).not.toContain("turn.final_done");
    expect(runtimeSource).not.toContain("final_done");
    expect(runtimeSource).not.toContain("poll_crossterm_event");
  });

  it("keeps Windows CLI and TUI current-path evidence in the package workflow", () => {
    const workflow = YAML.parse(
      readFileSync(
        path.resolve(process.cwd(), ".github/workflows/build-windows-test.yml"),
        "utf8",
      ),
    );
    const steps = workflow.jobs["build-windows-test"].steps;
    const gate = steps.find(
      (step) => step.name === "Run Windows CLI and TUI current-path gates",
    );
    const upload = steps.find(
      (step) => step.name === "Upload Windows CLI and TUI Gate B evidence",
    );

    expect(gate?.shell).toBe("bash");
    expect(gate?.run).toContain(
      "cargo test --manifest-path lime-rs/Cargo.toml -p cli -p tui",
    );
    expect(gate?.run).toContain(
      "cargo build --manifest-path lime-rs/Cargo.toml -p cli -p app-server",
    );
    expect(gate?.run).toContain("npm run smoke:cli-gate-b");
    expect(gate?.run).toContain("npm run smoke:tui-gate-b");
    expect(gate?.run).toContain('} 2>&1 | tee "windows-cli-tui-gate-b.log"');
    expect(upload?.if).toBe("${{ always() }}");
    expect(upload?.with?.path).toBe("windows-cli-tui-gate-b.log");
    expect(upload?.with?.["if-no-files-found"]).toBe("error");
  });
});
