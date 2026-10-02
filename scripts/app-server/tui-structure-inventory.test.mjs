import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const inventory = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "internal/exec-plans/tui-structure-inventory.json",
    ),
    "utf8",
  ),
);

describe("Codex TUI structure inventory", () => {
  it("keeps Agent Center interaction on one view rather than fake shared state", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    const state = source("app/agents_overview.rs");
    for (const retired of [
      "view_state:",
      "visible_thread_ids:",
      "refresh_task:",
      "refresh_thread_ids:",
      "rendered_full_screen:",
      "initialized:",
      "request_id:",
      "sync_view_state",
      "AGENTS_OVERVIEW_VIEW_ID",
      "apply_agents_overview_thread_refresh",
      "select_agents_overview_thread",
      "repaint_agents_overview",
    ]) {
      expect(state).not.toContain(retired);
    }
    expect(source("app/interaction.rs")).not.toContain("sync_view_state");
    expect(source("app/interaction.rs")).not.toContain("visible_thread_ids");
    expect(state).toContain("self.view.set_pagination(");
    for (const retired of [
      "refresh_changed_agents_overview_threads",
      "start_agents_overview_refresh",
    ]) {
      expect(source("app/agents_overview_threads.rs")).not.toContain(retired);
    }
  });
  it("retains composer snapshots across thread handoff without an Agent Center string mirror", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    expect(source("bottom_pane/input_state.rs")).toContain(
      "self.composer.draft_snapshot()",
    );
    expect(source("bottom_pane/input_state.rs")).toContain(
      "self.composer.flush_paste_burst_before_handoff()",
    );
    expect(
      source("bottom_pane/chat_composer/history_search_draft.rs"),
    ).toContain("search.original_draft.clone()");
    expect(source("bottom_pane/input_state.rs")).toContain(
      ".restore_thread_input_state(state.composer, &self.keymap)",
    );
    const restore = source("bottom_pane/chat_composer/draft.rs");
    for (const symbol of [
      "fn restore_thread_input_state(",
      "take_kill_buffer_snapshot()",
      "TextArea::default()",
      "restore_kill_buffer_snapshot(register)",
      "self.vim_history = VimHistory::default()",
      "self.restore_draft(draft)",
    ]) {
      expect(restore).toContain(symbol);
    }
    expect(source("bottom_pane/chat_composer/draft_state.rs")).not.toContain(
      "kill_buffer",
    );
    expect(source("app/thread_input.rs")).toContain(".remove(thread_id)");
    expect(source("app/session_lifecycle.rs")).toContain(
      "self.capture_current_thread_input()",
    );
    expect(source("app/agents_overview.rs")).not.toContain("input_states:");
    expect(source("app.rs")).not.toContain("HashMap<String, String>");
  });
  it("keeps diff palette and full-row painting in the current shared render owners", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    for (const owner of [
      "diff_render.rs",
      "diff_render/style.rs",
      "diff_render/tests.rs",
      "diff_render/style_tests.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
    expect(source("diff_render.rs")).toContain(
      "current_diff_render_style_context()",
    );
    expect(source("diff_render/style.rs")).toContain(
      "struct DiffRenderStyleContext",
    );
    for (const owner of ["diff_render.rs", "diff_render/style.rs"]) {
      expect(source(owner)).not.toContain("DiffStyleContext");
    }
    expect(source("entry.rs")).not.toMatch(
      /EntryKind::Patch if text\.starts_with/u,
    );
    expect(source("diff_render.rs")).not.toContain(
      "add_modifier(Modifier::DIM)",
    );
    expect(source("diff_render/style.rs")).toContain("readable_color_on");
    expect(source("terminal_hyperlinks/paragraph.rs")).toContain(
      "Style::default().bg(background)",
    );
    expect(source("diff_render/tests.rs")).not.toContain(
      "theme_scope_background_resolution",
    );
  });
  it("prevents retired footer state and oversized view aggregation from returning", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    expect(source("bottom_pane/footer.rs")).not.toContain("draft_ready_hint");
    expect(source("bottom_pane/chat_composer/footer_state.rs")).not.toContain(
      "FooterFlash",
    );
    expect(source("locale.rs")).not.toContain("draft_ready_hint");
    expect(source("view.rs")).toContain("mod tests;");
    expect(source("view.rs")).not.toContain(
      "render_transient_status(frame, chunks.footer",
    );
    expect(source("view.rs").split("\n").length).toBeLessThan(800);
    expect(source("keymap.rs")).toContain("mod hints;");
    expect(source("keymap.rs").split("\n").length).toBeLessThan(800);
    expect(source("model_picker.rs")).not.toContain("centered_popup");
    expect(source("model_picker/render.rs")).not.toContain("Borders");
    expect(source("bottom_pane/selection_row_layout.rs")).not.toContain(
      "centered_popup",
    );
    for (const owner of [
      "bottom_pane/chat_composer.rs",
      ...["draft", "history", "input", "completion", "render", "tests"].map(
        (name) => `bottom_pane/chat_composer/${name}.rs`,
      ),
    ]) {
      expect(source(owner).split("\n").length).toBeLessThan(800);
    }
    expect(source("view.rs")).not.toContain("fn render_composer");
    expect(source("bottom_pane/render.rs")).toContain(
      "pane.composer.render(frame, area, locale)",
    );
    expect(source("bottom_pane/chat_composer/render.rs")).toContain(
      "Block::default().style(style)",
    );
    expect(source("bottom_pane/chat_composer/completion.rs")).not.toContain(
      "fn sync_" + "command_popup",
    );
    expect(source("bottom_pane/chat_composer.rs")).not.toContain(
      "file_search_generation:",
    );
    for (const consumer of ["model_picker/render.rs", "app/agent_picker.rs"]) {
      expect(source(consumer)).toContain("list_selection_view::render");
      expect(source(consumer)).not.toContain("centered_popup");
      expect(source(consumer)).not.toContain("Borders");
    }
  });
  it("records both TUI source trees", () => {
    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.trees["codex-rs/tui/src"].fileCount).toBeGreaterThan(0);
    expect(inventory.trees["lime-rs/crates/tui/src"].fileCount).toBeGreaterThan(
      0,
    );
  });

  it("keeps palette lowering and text contrast in shared owners", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    expect(source("style.rs")).toContain("mod contrast;");
    expect(source("style.rs")).not.toContain("Color::Cyan");
    expect(source("style/selection.rs")).not.toContain(
      "fn readable_foreground",
    );
    expect(source("style/selection.rs")).not.toContain("fn luminance");
    expect(source("terminal_palette.rs")).not.toContain("fn color_distance");
    expect(source("style/contrast.rs")).toContain("xterm_fixed_colors()");
    expect(source("style/contrast.rs")).not.toContain("XTERM_COLORS");
    expect(source("transcript_view/follow_control.rs")).toContain(
      "user_message_accent_color()",
    );
  });

  it("keeps atomic paste edits on the current composer and textarea owners", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    for (const owner of [
      "bottom_pane/textarea.rs",
      "bottom_pane/textarea/editing.rs",
      "bottom_pane/textarea/elements.rs",
      "bottom_pane/textarea/vim.rs",
      "bottom_pane/textarea/vim/navigation.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
    expect(source("bottom_pane/textarea.rs")).toContain("mod elements;");
    expect(source("bottom_pane/textarea/vim.rs")).not.toMatch(
      /self\.text\.(?:replace_range|insert_str|insert|push)\(/u,
    );
    expect(source("bottom_pane/chat_composer/pending_paste.rs")).toContain(
      "fn expand_pending_pastes(",
    );
    expect(source("bottom_pane/chat_composer/pending_paste.rs")).toContain(
      "VecDeque::pop_front",
    );
    expect(source("bottom_pane/chat_composer/pending_paste.rs")).not.toContain(
      ".replace(",
    );
    expect(source("bottom_pane/chat_composer/submission.rs")).toContain(
      "Self::expand_pending_pastes(",
    );
    expect(source("runtime.rs")).toContain(
      "let draft = app.chat_widget.bottom_pane.composer_text_with_pending()",
    );
    expect(source("bottom_pane/chat_composer/pending_paste.rs")).not.toMatch(
      /\bexpanded_text(?:_with_elements)?\b/u,
    );
  });

  it("keeps inline local images and structured submission on the single composer owner", () => {
    const source = (file) =>
      readFileSync(
        path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
        "utf8",
      );
    expect(source("bottom_pane/chat_composer/attachment_state.rs")).toContain(
      "replace_element_payload",
    );
    expect(source("bottom_pane/chat_composer/paste_input.rs")).toContain(
      "handle_paste_image_path",
    );
    expect(source("runtime.rs")).toContain("app.apply_external_edit(text)");
    expect(source("bottom_pane/chat_composer.rs")).toContain(
      "history: ChatComposerHistory",
    );
    expect(source("bottom_pane/chat_composer.rs")).not.toContain(
      "history: Vec<String>",
    );
    expect(source("bottom_pane/chat_composer/history.rs")).toContain(
      "apply_history_entry",
    );
    expect(source("bottom_pane/chat_composer/render.rs")).not.toContain(
      "local_image_lines",
    );
    for (const owner of [
      "bottom_pane/chat_composer/draft.rs",
      "app/input_submission.rs",
    ]) {
      expect(source(owner)).not.toMatch(
        /\b(?:restore_pending_images|take_pending_images|remove_last_pending_image)\b/u,
      );
    }
  });

  it("records the Codex-shaped TUI integration test trees", () => {
    for (const treeName of ["codex-rs/tui/tests", "lime-rs/crates/tui/tests"]) {
      expect(inventory.trees[treeName].fileCount).toBeGreaterThan(0);
    }
    expect(inventory.trees["lime-rs/crates/tui/tests"].files).toEqual(
      expect.arrayContaining([
        "all.rs",
        "test_backend.rs",
        "manager_dependency_regression.rs",
        "suite/mod.rs",
        "suite/vt100_history.rs",
        "suite/vt100_live_commit.rs",
        "suite/status_indicator.rs",
        "suite/focus_palette.rs",
        "suite/reconnect.rs",
        "suite/resize_reflow.rs",
      ]),
    );
    expect(inventory.comparisons.testFilesMissingInLime).toEqual(
      expect.arrayContaining(["fixtures/oss-story.jsonl"]),
    );
  });

  it("locks Codex-shaped current TUI module and symbol names", () => {
    const files = new Set(inventory.trees["lime-rs/crates/tui/src"].files);
    for (const file of [
      "markdown_render.rs",
      "status_indicator_widget.rs",
      "resume_picker.rs",
      "resume_picker/archive.rs",
      "resume_picker/archive_tests.rs",
      "resume_picker/page_loading.rs",
      "resume_picker_transcript_preview.rs",
      "resume_picker_transcript_preview_tests.rs",
      "bottom_pane/chat_composer.rs",
      "bottom_pane/chat_composer/draft.rs",
      "bottom_pane/chat_composer/history.rs",
      "bottom_pane/chat_composer/input.rs",
      "bottom_pane/chat_composer/completion.rs",
      "bottom_pane/chat_composer/completion_tests.rs",
      "bottom_pane/chat_composer/render.rs",
      "bottom_pane/chat_composer/render_tests.rs",
      "bottom_pane/chat_composer/tests.rs",
      "bottom_pane/chat_composer/attachment_state.rs",
      "bottom_pane/chat_composer/draft_state.rs",
      "bottom_pane/chat_composer/layout.rs",
      "bottom_pane/chat_composer/paste_input.rs",
      "bottom_pane/chat_composer/history_search.rs",
      "bottom_pane/chat_composer/mouse.rs",
      "bottom_pane/chat_composer/reconnect.rs",
      "bottom_pane/chat_composer/reconnect_tests.rs",
      "bottom_pane/chat_composer/vim_history.rs",
      "bottom_pane/chat_composer/vim_history_tests.rs",
      "bottom_pane/approval_overlay.rs",
      "bottom_pane/paste_burst.rs",
      "bottom_pane/request_user_input/mod.rs",
      "bottom_pane/request_user_input/render.rs",
      "clipboard_copy.rs",
      "clipboard_paste.rs",
      "command_popup.rs",
      "keymap.rs",
      "keymap/hints.rs",
      "keymap/agents.rs",
      "keymap/list.rs",
      "keymap/list_tests.rs",
      "keymap/tests.rs",
      "local_settings.rs",
      "status/mod.rs",
      "status/format.rs",
      "model_catalog.rs",
      "model_picker/render.rs",
      "bottom_pane/list_selection_view.rs",
      "app/agent_picker/tests.rs",
      "runtime_pty_tests/agent_picker.rs",
      "model_picker/input.rs",
      "model_picker/keymap_tests.rs",
      "model_picker/render_tests.rs",
      "locale/pickers.rs",
      "collaboration_modes.rs",
      "app/app_server_events.rs",
      "app/app_server_requests.rs",
      "app/event_dispatch.rs",
      "app/input.rs",
      "app/interaction.rs",
      "app/reconnect.rs",
      "app/session_lifecycle.rs",
      "app/startup.rs",
      "app/startup_prompts.rs",
      "app/pending_interactive_replay.rs",
      "app/replay_filter.rs",
      "app/thread_events.rs",
      "app/thread_settings.rs",
      "app/tests.rs",
      "app/history_pagination.rs",
      "app/history_ui.rs",
      "app/transcript_export.rs",
      "app/agent_center/mod.rs",
      "app/agent_center/input.rs",
      "app/agent_center/navigation.rs",
      "app/agent_center/render.rs",
      "app/agent_center/rows.rs",
      "app/agent_center/hints.rs",
      "app/agent_center_tests.rs",
      "app/agents_overview_grouping.rs",
      "bottom_pane/selection_tabs.rs",
      "bottom_pane/shortcut_overlay.rs",
      "bottom_pane/shortcut_overlay_tests.rs",
      "bottom_pane/chat_composer/footer_state_tests.rs",
      "locale/shortcuts.rs",
      "shortcut_help.rs",
      "view/tests.rs",
      "view/tests/navigation.rs",
      "view/tests/composer.rs",
      "view/tests/presentation.rs",
      "view/tests/interaction.rs",
      "app_server_session/history.rs",
      "app_server_session/history_tests.rs",
      "pending_input_preview.rs",
      "terminal_hyperlinks.rs",
      "reconnect.rs",
      "bottom_pane/textarea.rs",
      "bottom_pane/textarea/hyperlinks.rs",
      "bottom_pane/textarea/hyperlinks_tests.rs",
      "bottom_pane/textarea/mouse.rs",
      "bottom_pane/textarea/mouse_tests.rs",
      "bottom_pane/textarea/wrapping.rs",
      "bottom_pane/textarea/wrapping_tests.rs",
      "bottom_pane/action_required_title.rs",
      "text_selection.rs",
      "terminal_palette.rs",
      "table_detect.rs",
      "wrapping.rs",
      "render/mod.rs",
      "render/highlight.rs",
      "render/highlight_streaming.rs",
      "render/highlight_streaming_tests.rs",
      "render/line_utils.rs",
      "render/renderable.rs",
      "render/renderable_tests.rs",
      "cwd_prompt.rs",
      "insert_history.rs",
      "history_cell/mod.rs",
      "history_cell/base.rs",
      "history_cell/messages.rs",
      "history_cell/exec.rs",
      "history_cell/patches.rs",
      "history_cell/plans.rs",
      "history_cell/approvals.rs",
      "history_cell/mcp.rs",
      "history_cell/hook.rs",
      "history_cell/mcp_result.rs",
      "history_cell/notices.rs",
      "history_cell/request_user_input.rs",
      "history_cell/search.rs",
      "history_cell/separators.rs",
      "history_cell/session.rs",
      "exec_cell/mod.rs",
      "exec_cell/model.rs",
      "exec_cell/live_output.rs",
      "exec_cell/render.rs",
      "tui.rs",
      "tui/event_stream.rs",
      "tui/frame_rate_limiter.rs",
      "tui/frame_requester.rs",
      "selection_list.rs",
      "thread_transcript.rs",
      "transcript_reflow.rs",
      "transcript_view.rs",
      "transcript_view/bookmark.rs",
      "transcript_view/bookmark_tests.rs",
      "transcript_view/disclosure.rs",
      "transcript_view/input.rs",
      "transcript_view/input_tests.rs",
      "transcript_view/selection.rs",
      "transcript_view/selection_tests.rs",
      "pager_overlay/disclosure_tests.rs",
    ]) {
      expect(files.has(file), file).toBe(true);
    }
    const symbols = new Set(
      inventory.trees["lime-rs/crates/tui/src"].symbols.map(
        (symbol) => symbol.name,
      ),
    );
    for (const name of [
      "render_markdown_text",
      "render_markdown_lines_with_width",
      "fmt_elapsed_compact",
      "ChatComposer",
      "InputResult",
      "VimHistory",
      "AttachmentState",
      "DraftState",
      "TextArea",
      "TextAreaState",
      "HyperlinkCache",
      "SelectionUnit",
      "wrapped_line_starts",
      "build_action_required_title_text",
      "input",
      "delete_backward",
      "delete_forward",
      "delete_forward_kill",
      "delete_backward_word",
      "delete_forward_word",
      "kill_to_end_of_line",
      "kill_to_beginning_of_line",
      "yank",
      "beginning_of_previous_word",
      "end_of_next_word",
      "handle_disconnected_key",
      "cursor_pos_with_state",
      "desired_height",
      "render_ref_masked",
      "render_ref_styled_with_highlights",
      "reconnect_session",
      "wrapped_lines",
      "cursor_position",
      "visible_prefix",
      "handle_mouse",
      "mouse_selection_range",
      "copy_selection_request",
      "clear_mouse_selection",
      "ApprovalOverlay",
      "ActionRequiredItem",
      "Tui",
      "Terminal",
      "with_restored",
      "set_modes",
      "restore_keep_raw",
      "flush_terminal_input_buffer",
      "run_resume_picker_with_app_server",
      "PickerState",
      "SessionTarget",
      "SessionSelection",
      "SessionPickerAction",
      "SessionPickerLaunchContext",
      "ArchiveState",
      "PaginationState",
      "load_transcript_preview",
      "load_session_transcript_with_handle",
      "thread_to_transcript_entries",
      "selection_option_row",
      "selection_option_row_with_dim",
      "TranscriptReflowState",
      "TranscriptWidthChange",
      "TranscriptAnchorRange",
      "TranscriptBookmark",
      "TranscriptFrame",
      "ComposerLayout",
      "PasteBurst",
      "CharDecision",
      "FlushResult",
      "handle_paste_burst_flush",
      "TranscriptSelection",
      "TranscriptSelectionAction",
      "SessionTranscriptState",
      "ModelCatalog",
      "default_mask",
      "mask_for_kind",
      "next_mask",
      "default_mode_mask",
      "plan_mask",
      "to_mode",
      "handle_app_server_event",
      "handle_server_notification_event",
      "handle_server_request_event",
      "PendingInteractiveReplayState",
      "note_server_request",
      "note_server_notification",
      "should_replay_snapshot_request",
      "snapshot_has_pending_interactive_request",
      "event_is_notice",
      "omit_completed_agent_deltas",
      "handle_event",
      "EventContext",
      "EventDispatch",
      "handle_tui_event",
      "handle_key_event",
      "handle_vim_history_key",
      "open_agent_picker",
      "render_expanded_session_details",
      "render_transcript_content_lines",
      "render_transcript_entry_lines",
      "render_transcript_entry_lines_wrapped",
      "EventBroker",
      "TuiEventStream",
      "TuiEvent",
      "FrameRequester",
      "RtOptions",
      "adaptive_wrap_line",
      "adaptive_wrap_lines",
      "word_wrap_line",
      "word_wrap_lines",
      "wrap_ranges",
      "wrap_ranges_trim",
      "ProjectedText",
      "project_halfwidth_sound_marks",
      "source_offset",
      "break_projected_words",
      "wrap_projected_ranges",
      "borrowed_slice_range",
      "map_owned_wrapped_line_to_range",
      "word_wrap_flattened_line",
      "MixedUrlWord",
      "mixed_url_wrap_line",
      "mixed_url_wrap_ranges",
      "split_mixed_url_word",
      "url_preserving_wrap_options",
      "line_has_mixed_url_and_non_url_tokens",
      "parse_table_segments",
      "FenceTracker",
      "StdoutColorLevel",
      "best_color",
      "effective_stdout_color_level",
      "StreamingCodeHighlighter",
      "Renderable",
      "CenterLayout",
      "CenterRow",
      "AgentsOverviewGrouping",
      "render_center_rows",
      "center_rows",
      "page_selection",
      "render_filled_tab_bar",
      "group_lines",
      "RenderableItem",
      "ColumnRenderable",
      "FlexRenderable",
      "RowRenderable",
      "InsetRenderable",
      "RenderableExt",
      "Insets",
      "RectExt",
      "line_to_borrowed",
      "line_to_static",
      "push_owned_lines",
      "prefix_lines",
      "HistoryLineWrapPolicy",
      "InsertHistoryMode",
      "insert_history_hyperlink_lines_with_mode_and_wrap_policy",
      "insert_history_lines",
      "insert_history_lines_with_mode_and_wrap_policy",
      "insert_history_lines_with_wrap_policy",
      "wrap_history_hyperlink_lines",
      "leading_whitespace_prefix",
      "HistoryCell",
      "TranscriptHistoryCell",
      "HistoryRenderMode",
      "PlainHistoryCell",
      "CompositeHistoryCell",
      "CommandOutput",
      "LiveCommandOutput",
      "output_lines",
      "ThreadHistoryPagination",
      "thread_items_page_params",
      "hydrate_initial_thread_history",
      "request_older_history_page",
      "handle_older_history_page",
      "render_markdown_transcript",
      "write_transcript",
      "StartupSessionState",
      "initialize_session",
      "should_wait_for_initial_session",
      "should_handle_active_thread_events",
      "should_stop_waiting_for_initial_session",
      "SkillLoadWarningState",
      "StartupTooltipOverride",
      "should_show_model_migration_prompt",
      "target_preset_for_upgrade",
      "apply_accepted_model_migration",
      "select_model_availability_nux",
      "CwdPromptAction",
      "CwdSelection",
      "CwdPromptOutcome",
      "set_model_catalog",
    ]) {
      expect(symbols.has(name), name).toBe(true);
    }
    for (const name of [
      "run_fork_picker_with_app_server",
      "run_session_picker_with_app_server",
      "fork_thread",
    ]) {
      expect(
        symbols.has(name),
        `unused terminal wrapper must not return: ${name}`,
      ).toBe(false);
    }
    for (const file of [
      "resume_picker/host.rs",
      "resume_picker/input.rs",
      "resume_picker/render.rs",
      "resume_picker/layout.rs",
      "resume_picker/tests.rs",
      "resume_picker/tests/toolbar.rs",
    ]) {
      expect(files.has(file), file).toBe(true);
    }
    expect(files.has("composer.rs")).toBe(false);
    expect(files.has("bottom_pane/request_user_input.rs")).toBe(false);
    expect(files.has("terminal.rs")).toBe(false);
    expect(symbols.has("TerminalGuard")).toBe(false);
    expect(symbols.has("TuiTerminal")).toBe(false);
  });

  it("locks direct snapshot test names to the Codex baseline", () => {
    const expected = {
      "lime-rs/crates/tui/src/diff_render/tests.rs": [
        "add_details",
        "ansi16_insert_delete_no_background",
        "apply_add_block",
        "apply_delete_block",
        "apply_multiple_files_block",
        "apply_update_block",
        "apply_update_block_line_numbers_three_digits_text",
        "apply_update_block_relativizes_path",
        "apply_update_block_wraps_long_lines",
        "apply_update_block_wraps_long_lines_text",
        "apply_update_with_rename_block",
        "blank_context_line",
        "cpp_module_extension_highlighting",
        "diff_gallery_120x40",
        "diff_gallery_80x24",
        "diff_gallery_94x35",
        "single_line_replacement_counts",
        "syntax_highlighted_insert_wraps",
        "syntax_highlighted_insert_wraps_text",
        "fixed_syntax_theme_uses_codex_default_diff_surface",
        "update_details_with_rename",
        "vertical_ellipsis_between_hunks",
        "wrap_behavior_insert",
      ],
      "lime-rs/crates/tui/src/markdown.rs": [
        "label_only_and_fallback_presentations_snapshot",
        "bare_url_with_tilde_keeps_complete_hyperlink",
        "file_link_compares_path_spellings_without_changing_display",
        "file_link_ignores_trailing_separators_when_comparing_paths",
        "file_link_keeps_descriptive_label_and_target",
        "file_link_keeps_unrelated_relative_label_with_matching_suffix",
        "file_link_preserves_labels_with_invalid_percent_encoding",
        "file_link_preserves_tilde_and_absolute_destinations",
        "list_item_after_code_block_keeps_blank_separator",
        "markdown_render_complex_snapshot",
        "markdown_render_file_link_snapshot",
        "mixed_url_markdown_wraps_prose_without_splitting_words_snapshot",
        "multiline_finding_items_are_separated_snapshot",
        "table_keeps_grid_when_only_one_compact_record_fragments_snapshot",
        "table_renders_halfwidth_sound_marks_at_constrained_width_snapshot",
        "table_renders_key_value_records_when_compact_fragmentation_is_systemic_snapshot",
        "table_renders_records_when_multiple_prose_columns_are_starved_snapshot",
        "table_renders_stacked_key_value_records_when_path_column_becomes_too_narrow_snapshot",
        "table_wraps_file_paths_before_collapsing_narrative_columns_snapshot",
        "web_link_labels_have_a_visible_underline_snapshot",
      ],
      "lime-rs/crates/tui/src/terminal_hyperlinks.rs": [
        "buffer_hyperlinks_follow_scrolled_wrapped_rows",
        "forced_width_hyperlinks_render_wide_and_halfwidth_cells_snapshot",
      ],
      "lime-rs/crates/tui/src/insert_history.rs": [
        "vt100_zellij_raw_insert_keeps_soft_wrapped_tail_above_viewport",
        "vt100_zellij_raw_replay_keeps_overflowing_soft_wrapped_tail_above_viewport",
      ],
      "lime-rs/crates/tui/src/render/highlight.rs": [
        "ansi_family_foreground_palette",
      ],
    };
    for (const [file, names] of Object.entries(expected)) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      const actual = new Set(
        [
          ...source.matchAll(
            /^[ \t]*(?:pub\([^)]*\)[ \t]*)?fn[ \t]+([a-z][a-z0-9_]*)[ \t]*\(/gmu,
          ),
        ].map((match) => match[1]),
      );
      for (const name of names) {
        expect(actual.has(name), `${file}:${name}`).toBe(true);
      }
    }
  });

  it("locks Codex textarea hyperlink test names to the current owner", () => {
    const source = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/bottom_pane/textarea/hyperlinks_tests.rs",
      ),
      "utf8",
    );
    for (const name of [
      "wrapped_url_fragments_keep_the_complete_destination",
      "composer_wrapped_url_fragments_keep_the_complete_destination",
      "scrolled_url_fragments_keep_the_offscreen_destination",
      "long_drafts_reuse_hyperlink_detection_across_cursor_redraws",
      "maximum_length_urls_render_without_osc8_annotations",
      "many_urls_render_with_the_complete_destination",
      "joined_emoji_preserve_complete_url_cell_ranges",
      "unicode_whitespace_separates_url_destinations",
      "masked_url_input_never_exposes_hyperlink_destinations",
      "url_hyperlinks_preserve_existing_highlight_styles",
      "distinct_urls_respect_punctuation_wide_prefixes_and_tabs",
      "hyperlink_cache_is_invalidated_when_text_changes",
    ]) {
      expect(source).toMatch(new RegExp(`fn ${name}\\s*\\(`, "u"));
    }
  });

  it("keeps app-server event routing in the Codex-named owner", () => {
    const appServerEvents = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/app_server_events.rs",
      ),
      "utf8",
    );
    const appServerRequests = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/app_server_requests.rs",
      ),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );
    const appServerClient = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/app-server-client/src/lib.rs",
      ),
      "utf8",
    );
    const interactiveRuntime = runtime.slice(
      0,
      runtime.indexOf("pub async fn run_exec"),
    );

    expect(appServerEvents).toContain("fn handle_app_server_event");
    expect(appServerEvents).toContain("fn handle_server_notification_event");
    expect(appServerEvents).not.toContain("fn handle_server_request_event");
    expect(appServerRequests).toContain("fn handle_server_request_event");
    expect(runtime).toContain("app.handle_app_server_event(");
    expect(interactiveRuntime).not.toContain(
      "AppServerEvent::ServerNotification",
    );
    expect(interactiveRuntime).not.toContain("AppServerEvent::ServerRequest");
    expect(appServerClient).toContain("pub enum AppServerEvent");
    expect(appServerClient).not.toContain("pub enum SessionEvent");
    expect(appServerClient).not.toContain("RawNotification(");
    expect(appServerClient).not.toContain("RawServerRequest(");
  });

  it("keeps replay filtering bounded by the Lime protocol", () => {
    const replayFilter = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/replay_filter.rs",
      ),
      "utf8",
    );
    expect(replayFilter).toContain("snapshot_has_pending_interactive_request");
    expect(replayFilter).toContain("event_is_notice");
    expect(replayFilter).toContain("omit_completed_agent_deltas");
    expect(replayFilter).not.toContain("omit_resolved_misalignment_errors");
  });

  it("keeps App Server-backed action dispatch in the Codex-named owner", () => {
    const eventDispatch = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/event_dispatch.rs",
      ),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );

    expect(eventDispatch).toContain("pub(crate) async fn handle_event");
    expect(eventDispatch).toContain("pub(crate) struct EventContext");
    expect(runtime).toContain(".handle_event(");
    expect(runtime).not.toContain("AppAction::SelectModel(selection) =>");
    expect(runtime).not.toContain("AppAction::RefreshAgentsOverview =>");
  });

  it("keeps terminal input routing in the Codex-named owners", () => {
    const app = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app.rs"),
      "utf8",
    );
    const inputFlow = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app/input_flow.rs"),
      "utf8",
    );
    const interaction = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app/interaction.rs"),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );

    expect(app).toContain("mod input_flow;");
    expect(app).toContain("mod input_submission;");
    expect(app).toContain("mod interaction;");
    expect(app).toContain("mod tests;");
    expect(app).not.toContain("fn handle_tui_event");
    expect(interaction).toContain("fn handle_tui_event");
    expect(inputFlow).toContain("fn handle_key_event");
    expect(runtime).toContain("app.handle_tui_event_runtime(event, connected)");
    expect(runtime).not.toContain("handle_terminal_event");
    expect(runtime).not.toContain("handle_disconnected_event");
  });

  it("keeps transcript selection on the canonical rendered projection", () => {
    const transcriptView = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/transcript_view.rs"),
      "utf8",
    );
    const selection = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/transcript_view/selection.rs",
      ),
      "utf8",
    );
    const input = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/transcript_view/input.rs",
      ),
      "utf8",
    );
    const disclosure = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/transcript_view/disclosure.rs",
      ),
      "utf8",
    );
    const historyCell = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/history_cell/mod.rs"),
      "utf8",
    );
    const pager = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/pager_overlay.rs"),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );

    expect(transcriptView).toContain("mod disclosure;");
    expect(transcriptView).toContain("mod input;");
    expect(transcriptView).toContain("mod selection;");
    expect(selection).toContain("pub(crate) struct TranscriptSelection");
    expect(selection).toContain("snapshot: Arc<Vec<HyperlinkLine>>");
    expect(selection).toContain("fn selected_text");
    expect(selection).toContain("fn word_wrap_cells");
    expect(selection).toContain("moved_vertically: bool");
    expect(selection).toContain("pointer_origin_row: u16");
    expect(selection).toContain("fn edge_scroll_direction");
    expect(selection).toContain("fn end_drag");
    expect(input).toContain("fn handle_event");
    expect(input).toContain("TranscriptSelectionAction::OpenLink");
    expect(input).toContain("TranscriptSelectionAction::RevealRow");
    expect(pager).toContain("transcript_selection: TranscriptSelection");
    expect(pager).toContain("PagerAction::CopyTranscriptSelection");
    expect(pager).toContain("ContinueTranscriptSelection");
    expect(pager).toContain("fn tick_transcript_selection");
    expect(pager).toContain("disclosure: TranscriptDisclosure");
    expect(disclosure).toContain("pub(crate) struct TranscriptContent");
    expect(disclosure).toContain("pub(crate) struct TranscriptDisclosure");
    expect(disclosure).toContain("excluded_lines: HashSet<usize>");
    expect(disclosure).toContain("pending_anchor");
    expect(historyCell).toContain("fn compact_hyperlink_lines");
    expect(historyCell).toContain("fn activity_ids");
    expect(historyCell).toContain("fn expanded_hyperlink_lines");
    expect(runtime).toContain("fn copy_transcript_selection_with");
    expect(runtime).toContain("frame_requester.schedule_frame_in(delay)");
    expect(selection).not.toContain("ThreadStore");
    expect(selection).not.toContain("AppServerSession");
    expect(disclosure).not.toContain("AppServerSession");
    expect(disclosure).not.toContain("ThreadStore");
  });

  it("keeps reconnect lifecycle in the Codex-named app owner", () => {
    const appReconnect = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app/reconnect.rs"),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );

    expect(appReconnect).toContain("fn reconnect_session");
    expect(runtime).toContain("crate::app::reconnect::");
    expect(runtime).toContain("reconnect_session");
    expect(runtime).toContain("ReconnectedSession");
  });

  it("does not reintroduce the retired top-level reconnect module", () => {
    const lib = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/lib.rs"),
      "utf8",
    );
    const app = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app.rs"),
      "utf8",
    );
    const runtime = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
      "utf8",
    );

    expect(lib).not.toContain("mod reconnect;");
    expect(lib).not.toContain("crate::reconnect");
    expect(app).toContain("pub(crate) mod reconnect;");
    expect(runtime).not.toContain("crate::reconnect::");
  });

  it("keeps thread notification projection in the Codex-named owner", () => {
    const threadEvents = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/thread_events.rs",
      ),
      "utf8",
    );
    const appServerEvents = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/app_server_events.rs",
      ),
      "utf8",
    );
    const toolLifecycle = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/tool_lifecycle.rs",
      ),
      "utf8",
    );

    expect(threadEvents).toContain("fn apply_notification");
    expect(threadEvents).toContain("fn observe_notification");
    expect(threadEvents).toContain("tool_lifecycle::observe_item");
    expect(toolLifecycle).toContain("fn observe_item");
    expect(appServerEvents).toContain("self.apply_notification(notification)");
    expect(appServerEvents).not.toContain("fn observe_notification");
  });

  it("keeps foreign interactive requests in ThreadEventStore only", () => {
    const agentsOverview = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/agents_overview.rs",
      ),
      "utf8",
    );
    const threadEvents = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/thread_events.rs",
      ),
      "utf8",
    );
    const pendingReplay = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/pending_interactive_replay.rs",
      ),
      "utf8",
    );

    expect(agentsOverview).not.toContain("dispatched_requests");
    expect(agentsOverview).not.toContain("queue_agents_overview_request");
    expect(threadEvents).toContain("ThreadEventStore");
    expect(pendingReplay).toContain("PendingInteractiveReplayState");
  });

  it("keeps thread settings state in the Codex-named owner", () => {
    const threadSettings = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/thread_settings.rs",
      ),
      "utf8",
    );
    const app = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app.rs"),
      "utf8",
    );

    expect(threadSettings).toContain("fn set_settings");
    expect(threadSettings).toContain("fn set_permission_profiles");
    expect(threadSettings).toContain("fn next_collaboration_mode");
    expect(app).not.toContain("fn sync_default_collaboration_mode");
  });

  it("keeps agent picker lifecycle in the Codex-named owner", () => {
    const app = readFileSync(
      path.resolve(process.cwd(), "lime-rs/crates/tui/src/app.rs"),
      "utf8",
    );
    const sessionLifecycle = readFileSync(
      path.resolve(
        process.cwd(),
        "lime-rs/crates/tui/src/app/session_lifecycle.rs",
      ),
      "utf8",
    );

    expect(app).toContain("mod session_lifecycle;");
    expect(sessionLifecycle).toContain("fn open_agent_picker");
  });

  it("keeps upstream product-only differences explicit", () => {
    expect(inventory.comparisons.filesMissingInLime).toContain(
      "onboarding/mod.rs",
    );
    expect(
      inventory.comparisons.symbolNamesMissingInLime.length,
    ).toBeGreaterThan(0);
    expect(inventory.comparisons.filesOnlyInLime).not.toContain(
      "session_picker.rs",
    );
  });
});
