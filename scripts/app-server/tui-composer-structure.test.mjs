import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file) =>
  readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
    "utf8",
  );

const sourcePath = (file) =>
  path.resolve(process.cwd(), "lime-rs/crates/tui/src", file);

describe("Codex structured mention owners", () => {
  it("keeps effort effects in the composer with one frame requester and explicit restore baselines", () => {
    const effort = source("bottom_pane/chat_composer/effort.rs");
    expect(effort).toContain("fn set_active_reasoning_effort_baseline");
    expect(effort).toContain("self.frame_requester");
    expect(effort).not.toMatch(
      /tokio::spawn|tokio::time|std::thread|ConfigManager|std::fs/,
    );
    expect(source("bottom_pane/chat_composer/render.rs")).not.toContain(
      "fn set_active_reasoning_effort",
    );
    expect(source("runtime.rs")).toContain(
      ".set_frame_requester(frame_requester.clone())",
    );
    for (const file of [
      "app/startup.rs",
      "app/session_lifecycle.rs",
      "chatwidget/transcript.rs",
    ]) {
      expect(source(file), file).toContain(
        "set_active_reasoning_effort_baseline()",
      );
    }
    for (const file of [
      "bottom_pane/effort_ignition.rs",
      "bottom_pane/effort_ignition_styles.rs",
      "bottom_pane/effort_status_line.rs",
      "bottom_pane/chat_composer/effort.rs",
    ]) {
      expect(source(file).split("\n").length, file).toBeLessThan(800);
    }
  });

  it("keeps slash draft edits in the composer and removes the pane's whole-draft replacement", () => {
    const paneInput = source("bottom_pane/input.rs");
    const slashInput = source("bottom_pane/chat_composer/slash_input.rs");
    expect(paneInput).not.toContain("fn complete_slash_command");
    expect(paneInput).not.toContain('self.composer.replace(format!("/');
    expect(paneInput).toContain(
      "self.composer.complete_slash_command(command)",
    );
    expect(slashInput).toContain("fn complete_slash_command");
    expect(slashInput).toContain(
      "fn complete_selected_slash_command_preserving_existing_draft_tail_as_inline_args",
    );
    expect(slashInput).toContain("command.supports_inline_args()");
  });

  it("owns file and skill lists directly in bottom pane without restoring composer module aliases", () => {
    const pane = source("bottom_pane/mod.rs");
    const composer = source("bottom_pane/chat_composer.rs");
    for (const name of ["file_search_popup", "skill_popup"]) {
      expect(pane).toContain(`mod ${name};`);
      expect(composer).not.toContain(`mod ${name};`);
      expect(composer).not.toContain(`self::${name}`);
      expect(composer).toContain(`use super::${name}::`);
      expect(source(`bottom_pane/${name}.rs`)).toContain(
        "render_rows_single_line",
      );
      expect(
        existsSync(sourcePath(`bottom_pane/chat_composer/${name}.rs`)),
      ).toBe(false);
    }
    expect(pane).not.toContain("chat_composer::FileSearchPopupAction");
    expect(pane).not.toContain("chat_composer::SkillPopupAction");
  });

  it("owns provisional reasoning replay in history without a second backend or hydration implementation", () => {
    const history = source("projection/history.rs");
    for (const owner of [
      "hydrate_thread",
      "restore_active_reasoning_item",
      "recover_resumed_reasoning",
    ]) {
      expect(history).toContain(`fn ${owner}`);
      expect(source("projection.rs")).not.toContain(`fn ${owner}`);
    }
    expect(source("projection.rs")).toContain(
      "self.recover_resumed_reasoning(&notification)",
    );
    expect(history).toContain("latest.items.last()");
    expect(history).toContain("latest.status == TurnStatus::InProgress");
    expect(source("runtime.rs")).toContain("app.projection.on_reconnected()");
    expect(history).not.toMatch(/std::fs|RequestHandle|ConfigManager/);
    for (const owner of [
      "projection/history.rs",
      "projection/history_tests.rs",
      "projection/reasoning_stdio_tests.rs",
    ]) {
      expect(source(owner).split("\n").length).toBeLessThan(800);
    }
  });
  it("keeps the shared reasoning notification owner and split tests out of the large router", () => {
    const serverSource = (file) =>
      readFileSync(
        path.resolve(
          process.cwd(),
          "lime-rs/crates/app-server/src/processor",
          file,
        ),
        "utf8",
      );
    expect(serverSource("v2_notifications.rs")).not.toMatch(
      /fn project_reasoning_|mod tests \{/,
    );
    for (const file of [
      "v2_notifications.rs",
      "v2_notifications/reasoning.rs",
      "v2_notifications/tests.rs",
      "v2_notifications/model_tests.rs",
      "v2_notifications/reasoning_tests.rs",
    ]) {
      expect(serverSource(file).split("\n").length, file).toBeLessThan(800);
    }
  });
  it("keeps default reasoning summaries separate from raw content and splits canonical lowering from streaming", () => {
    const projection = source("projection.rs");
    expect(projection).toContain("if self.show_raw_agent_reasoning");
    expect(projection).not.toMatch(
      /fn project_item_with_scope|fn append_delta|fn latest_summary_line/,
    );
    expect(source("projection/items.rs")).toContain(
      "ReasoningText::from_item(summary, content, show_raw_agent_reasoning)",
    );
    expect(projection).toContain("self.append_reasoning_raw(");
    expect(projection).not.toContain(
      "ServerNotification::ReasoningTextDelta(_) => {}",
    );
    expect(source("projection/items.rs")).not.toContain(
      "if summary.is_empty() { content }",
    );
    expect(source("projection/streaming.rs")).toContain("fn append_delta");
    expect(projection.split("\n").length).toBeLessThan(1000);
    for (const file of [
      "projection/items.rs",
      "projection/streaming.rs",
      "projection/streaming_tests.rs",
      "projection/reasoning.rs",
      "projection/reasoning_stdio_tests.rs",
      "history_cell/reasoning.rs",
      "history_cell/reasoning_tests.rs",
      "runtime_pty_tests/reasoning.rs",
    ]) {
      expect(source(file).split("\n").length).toBeLessThan(800);
    }
  });
  it("routes structured reasoning bodies to the actual transcript-only cell", () => {
    expect(source("history_cell/messages.rs")).not.toContain(
      "struct ReasoningSummaryCell",
    );
    expect(source("entry.rs")).toContain("ReasoningSummaryCell::new");
    expect(source("projection/streaming.rs")).toContain(
      "summary.append(index, &delta)",
    );
    expect(source("projection/streaming.rs")).not.toContain(
      "append_reasoning_section_break",
    );
    expect(source("projection.rs")).toContain("params.summary_index");
  });
  it("uses the same canonical paging for every stored history mode without full-read or flat fallbacks", () => {
    for (const file of [
      "thread_transcript.rs",
      "resume_picker_transcript_preview.rs",
      "app/startup.rs",
      "app/session_lifecycle.rs",
      "app/reconnect.rs",
    ]) {
      expect(source(file)).not.toContain("ThreadHistoryMode::Legacy");
      expect(source(file)).not.toContain("paginated_history");
      expect(source(file)).not.toContain("include_turns: true");
    }
    expect(source("thread_transcript.rs")).not.toMatch(
      /load_legacy_transcript|load_session_transcript_with_handle|\.ok\(\)|allow\(dead_code\)/,
    );
    expect(source("resume_picker_transcript_preview.rs")).not.toMatch(
      /load_paginated_preview|load_transcript_preview_with_handle|\.ok\(\)|METHOD_THREAD_READ/,
    );
    expect(source("app_server_session/history.rs")).toContain(
      "Nonempty pages require complete Turn metadata",
    );
    for (const file of [
      "app/history_pagination.rs",
      "app_server_session/history.rs",
      "bottom_pane/chat_composer_history.rs",
    ]) {
      expect(source(file)).not.toMatch(/turns: Option<|\.ok\(\)/);
    }
    expect(source("app_event.rs")).toContain(
      "Result<(ThreadItemsListResponse, Vec<Turn>), String>",
    );
    expect(source("app/history_pagination.rs")).toContain(
      "self.projection.restore_history_turns(turns)",
    );
    expect(source("app/reconnect.rs")).toContain(
      "history_page: InitialHistoryPage",
    );
    expect(source("projection/history.rs")).toContain(
      "self.closed_turn_ids.contains(&latest.id)",
    );
    expect(source("projection/history.rs")).not.toMatch(
      /std::fs|RequestHandle|ConfigManager/,
    );
  });
  it("keeps previous-prompt editing on bounded canonical history and shared typed restoration", () => {
    const backtrack = source("app_backtrack.rs");
    const io = source("app_backtrack/io.rs");
    const replacement = source("app/history_replacement.rs");
    expect(io).toContain("METHOD_THREAD_REVERT");
    expect(io).toContain("thread_turns_page_with_handle");
    expect(backtrack).toContain("TurnItemsView::Full");
    expect(backtrack).toContain("generation != self.backtrack.generation");
    expect(backtrack).toContain("restore_user_inputs(&selection.prompt)");
    expect(source("chatwidget/input.rs")).toContain(
      "restore_user_inputs(&submission.input)",
    );
    expect(replacement).toContain("include_turns: false");
    expect(replacement).toContain(
      "self.take_thread_event_snapshot(thread_id, false)",
    );
    expect(replacement).toContain("self.replay_thread_snapshot(snapshot)");
    expect(replacement).not.toMatch(
      /VecDeque|ConfigManager|std::fs|include_turns: true/,
    );
    expect(source("app_server_session.rs")).toContain(
      "ThreadHistoryMode::Paginated",
    );
    expect(
      source("app/startup.rs").match(
        /app\.hydrate_thread\(response\.thread\)/g,
      ),
    ).toHaveLength(2);
    expect(source("bottom_pane/chat_composer_history/user_input.rs")).toContain(
      "fn from_user_inputs(",
    );
    for (const file of [
      "app_backtrack.rs",
      "app_backtrack/io.rs",
      "app/history_replacement.rs",
      "pager_overlay.rs",
      "pager_overlay/render.rs",
    ]) {
      expect(source(file).split("\n").length).toBeLessThan(800);
    }
    expect(source("pager_overlay.rs")).not.toContain("mod tests {");
  });
  it("projects canonical token snapshots once and shares display semantics across all status surfaces", () => {
    const projection = source("projection/token_usage.rs");
    expect(source("projection.rs")).toContain(
      "self.token_usage.update(params)",
    );
    expect(projection).toContain("latest_turn_id");
    expect(projection).toContain("self.usage = Some(notification.token_usage)");
    expect(projection).not.toMatch(
      /std::fs|ConfigManager|provider\.usage|regex|add_assign/,
    );
    for (const file of [
      "bottom_pane/status_surface_preview.rs",
      "status/mod.rs",
    ]) {
      expect(source(file)).toContain("token_usage_value(");
    }
    expect(source("app/status_line.rs")).toContain(
      "self.projection.token_usage(id)",
    );
    expect(source("app.rs")).toContain("self.projection.token_usage(id)");
    expect(source("bottom_pane/title_setup.rs")).toContain(
      "Some(StatusLineItem::ContextRemaining)",
    );
    expect(source("status/mod.rs").match(/fn fields\(/g)).toHaveLength(1);
    for (const file of [
      "projection/token_usage.rs",
      "status/helpers.rs",
      "locale/token_usage.rs",
    ]) {
      expect(source(file).split("\n").length).toBeLessThan(800);
    }
  });
  it("projects task progress from one typed checklist owner instead of transcript parsing", () => {
    const projection = source("projection.rs");
    expect(projection).toContain(
      "ServerNotification::TurnPlanUpdated(params) => self.project_plan_update(params)",
    );
    expect(projection).not.toContain("fn plan_marker(");
    const plans = source("projection/plans.rs");
    expect(plans).toContain("TurnPlanStepStatus::Completed");
    expect(plans).toContain("self.closed_turn_ids.contains(&params.turn_id)");
    expect(plans).not.toMatch(/regex|\.split\(|std::fs|ConfigManager/);
    expect(source("app/status_line.rs")).toContain(
      "self.projection.plan_progress(id)",
    );
    expect(source("bottom_pane/status_surface_preview.rs")).toContain(
      "locale.task_progress_value(completed, total)",
    );
    expect(source("bottom_pane/title_setup.rs")).toContain(
      "Some(StatusLineItem::TaskProgress)",
    );
    expect(plans.split("\n").length).toBeLessThan(800);
  });
  it("keeps terminal-title facts and managed output in separate current owners", () => {
    const projection = source("app/terminal_title.rs");
    expect(projection).toContain("self.status_surface_data()");
    expect(projection).toContain("self.active_turn_elapsed(now)");
    expect(projection).toContain("self.chat_widget.bottom_pane.is_active()");
    expect(projection).not.toMatch(
      /std::fs|ConfigManager|tokio::spawn|tokio::time/,
    );
    const output = source("terminal_title.rs");
    expect(output).toContain("MAX_TERMINAL_TITLE_CHARS: usize = 240");
    expect(output).not.toMatch(
      /AppServerSession|ThreadStore|ConversationProjection/,
    );
    const host = source("tui.rs");
    for (const method of ["with_restored", "restore"]) {
      expect(host.slice(host.indexOf(`fn ${method}`))).toContain(
        "self.refresh_terminal_title(None)",
      );
    }
    expect(host).toContain("clear_title_after_panic(&mut output)");
    expect(host).toContain("self.terminal_title.is_managed()");
    expect(source("runtime.rs")).toContain(
      "app.terminal_title_text(std::time::Instant::now()).as_deref()",
    );
    for (const owner of ["terminal_title.rs", "app/terminal_title.rs"]) {
      expect(source(owner).split("\n").length).toBeLessThan(800);
    }
  });
  it("keeps status-line preferences and preview on the shared config and facts owners", () => {
    expect(source("bottom_pane/mod.rs")).toContain(
      "pub(crate) mod status_line_setup;",
    );
    expect(source("bottom_pane/mod.rs")).toContain(
      "pub(crate) mod multi_select_picker;",
    );
    const session = source("app_server_session/config.rs");
    expect(session).toContain("METHOD_CONFIG_READ");
    expect(session).toContain("include_layers: true");
    expect(session).toContain("METHOD_CONFIG_BATCH_WRITE");
    const persistence = source("app/status_line.rs");
    expect(persistence).toContain('key_path: "tui.status_line"');
    expect(persistence).toContain('key_path: "tui.status_line_use_colors"');
    const configWriter = source("app/status_controls.rs");
    expect(configWriter).toContain("expected_version: Some(version)");
    expect(configWriter).toContain(
      "let Some(version) = self.chat_widget.config_version.clone()",
    );
    for (const owner of [
      "app/status_line.rs",
      "chatwidget/status_controls.rs",
      "bottom_pane/status_line_setup.rs",
      "bottom_pane/status_surface_preview.rs",
      "app/status_controls.rs",
      "bottom_pane/title_setup.rs",
    ]) {
      expect(source(owner), owner).not.toMatch(
        /std::fs|ConfigManager|save_config|mock|status_indicator_widget/,
      );
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
    expect(source("bottom_pane/status_line_setup.rs")).toContain(
      "StatusSurfacePreviewData",
    );
    expect(source("bottom_pane/status_line_setup.rs")).not.toContain(
      "SelectionRow",
    );
    expect(source("bottom_pane/title_setup.rs")).not.toContain("SelectionRow");
    expect(source("bottom_pane/multi_select_picker.rs")).toContain(
      "SelectionRow::new",
    );
    expect(source("view.rs")).toContain("app.status_surface_data()");
    expect(source("bottom_pane/footer.rs")).toContain(
      "fn passive_footer_status_line(",
    );
  });
  it("keeps title preview temporary and writes through the same versioned preferences owner", () => {
    expect(source("bottom_pane/mod.rs")).toContain(
      "pub(crate) mod title_setup;",
    );
    const projection = source("app/terminal_title.rs");
    expect(projection).toContain("title_text_for_items(");
    expect(projection).toMatch(/self\s*\.write_tui_preferences/);
    expect(projection).toContain('key_path: "tui.terminal_title"');
    expect(source("view.rs")).toContain(
      "app.terminal_title_text(Instant::now())",
    );
    expect(source("chatwidget/transcript.rs")).toContain(
      "self.terminal_title_setup = None;",
    );
    expect(source("app/thread_input.rs")).toContain(
      "self.chat_widget.terminal_title_setup = None;",
    );
    for (const method of [
      "handle_terminal_title_setup_event",
      "terminal_title_text",
    ]) {
      const body = projection.slice(
        projection.indexOf(`fn ${method}`),
        projection.indexOf("pub(super) async fn save_terminal_title"),
      );
      expect(body).not.toMatch(/write_config_batch|write_tui_preferences/);
    }
  });
  it("keeps moved TUI owners in their current modules and blocks dead root wrappers", () => {
    for (const wrapper of [
      "command_popup.rs",
      "pending_input_preview.rs",
      "reconnect.rs",
      "highlight.rs",
      "status_indicator.rs",
    ]) {
      expect(existsSync(sourcePath(wrapper)), wrapper).toBe(false);
    }
    const lib = source("lib.rs");
    for (const retired of [
      "mod command_popup;",
      "mod pending_input_preview;",
      "mod highlight;",
      "mod status_indicator;",
    ]) {
      expect(lib, retired).not.toContain(retired);
    }
    expect(source("bottom_pane/mod.rs")).toContain(
      "pub(crate) mod command_popup;",
    );
    expect(source("bottom_pane/pending_input_preview.rs")).toContain(
      "pub(crate) fn desired_height(",
    );
    expect(source("app/reconnect.rs")).toContain(
      "pub(crate) async fn reconnect_session(",
    );
    expect(source("render/highlight.rs")).toContain(
      "pub(crate) fn highlight_code_to_lines(",
    );
    expect(source("shortcut_help.rs")).toContain("pub(crate) fn group_lines(");
    expect(lib).not.toContain("compatibility delegate");
  });

  it("keeps replay authority in the exact pending request table without parallel category indexes", () => {
    const replay = source("app/pending_interactive_replay.rs");
    expect(source("app/replay_filter.rs")).not.toContain(
      "cfg_attr(not(test), allow(dead_code))",
    );
    expect(replay).toContain(
      "pending_requests_by_request_id: HashMap<RequestId, PendingInteractiveRequest>",
    );
    expect(replay).toContain("get(request.id()) == Some(&pending)");
    expect(replay).toContain("Some(params.turn_id.as_str())");
    expect(replay).toContain('#[path = "pending_interactive_replay_tests.rs"]');
    for (const retired of [
      "HashSet",
      "call_ids_by_turn_id",
      "has_pending_thread_approvals",
      "has_pending_thread_user_input",
    ]) {
      expect(replay, retired).not.toContain(retired);
    }
    for (const owner of [
      "app/pending_interactive_replay.rs",
      "app/pending_interactive_replay_tests.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
  it("moves thread input views instead of flattening or clearing unresolved interactions", () => {
    expect(source("chatwidget.rs")).toContain(
      "HashMap<String, crate::bottom_pane::BottomPaneInputState>",
    );
    const app = source("app.rs");
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("thread_input_states:");
    const input = source("app/thread_input.rs");
    const widgetInput = source("chatwidget/input.rs");
    expect(widgetInput).toContain("self.bottom_pane.take_input_state()");
    expect(widgetInput).toContain(
      "self.bottom_pane.restore_input_state(state)",
    );
    expect(input).toContain(
      "self.chat_widget.capture_thread_input(&thread_id)",
    );
    expect(input).toContain("self.chat_widget.restore_thread_input(thread_id)");
    expect(input).toContain(
      "self.chat_widget.observe_thread_input_notification(",
    );
    expect(input).toContain("self.thread_event_channels.clear()");
    expect(source("app/session_lifecycle.rs")).not.toContain(
      "self.bottom_pane.clear()",
    );
    expect(source("app/agents_overview.rs")).not.toContain(
      "self.capture_current_thread_input()",
    );
    expect(source("app/thread_events.rs")).toContain(
      "self.observe_thread_input_notification(thread_id, &notification)",
    );
    expect(source("app/app_server_events.rs")).toContain(
      "self.clear_connection_interactions()",
    );
    const pane = source("bottom_pane/input_state.rs");
    expect(pane).toContain("std::mem::take(&mut self.queue)");
    expect(pane).toContain("ServerNotification::ServerRequestResolved");
    expect(pane).toContain("ServerNotification::TurnCompleted");
    expect(pane).toContain("ServerNotification::ThreadClosed");
    expect(pane).toContain("request.set_keymap_bindings(&self.keymap)");
  });
  it("binds selected mentions to stable textarea IDs and one draft snapshot", () => {
    expect(source("bottom_pane/textarea.rs")).toContain("next_element_id: u64");
    expect(source("bottom_pane/textarea/elements.rs")).toContain(
      "pub(crate) id: u64",
    );
    expect(source("bottom_pane/textarea/elements.rs")).toContain(
      "fn element_id_for_exact_range(",
    );
    expect(source("bottom_pane/chat_composer/draft_state.rs")).toContain(
      "HashMap<u64, ComposerMentionBinding>",
    );
    expect(source("bottom_pane/chat_composer/draft_state.rs")).toContain(
      "mention_bindings: Vec<MentionBinding>",
    );
    expect(source("bottom_pane/chat_composer/completion.rs")).toContain(
      "self.insert_selected_mention(",
    );
    expect(source("bottom_pane/chat_composer/submission.rs")).toContain(
      "self.take_mention_bindings()",
    );
    expect(source("bottom_pane/chat_composer/history.rs")).toContain(
      "entry.mention_bindings",
    );
    expect(source("bottom_pane/chat_composer/external_edit.rs")).toContain(
      "self.snapshot_mention_bindings()",
    );
  });

  it("keeps skill scanning and submission policy out of runtime dispatch", () => {
    expect(source("runtime.rs")).not.toContain("fn submission_input");
    expect(source("runtime.rs")).not.toContain("submission_input_with_skills");
    expect(source("runtime/input_submission.rs")).toContain(
      "app.take_recent_submission_mention_bindings()",
    );
    expect(source("app/input_submission.rs")).toContain("selected_skill_paths");
    expect(source("app/input_submission.rs")).toContain(
      "bound_names.contains(skill.name.as_str())",
    );
    expect(source("app/skills.rs")).toContain("fn collect_tool_mentions(");
    expect(source("app/skills.rs")).toContain(
      "fn find_skill_mentions_with_tool_mentions(",
    );
    expect(source("app/skills.rs")).not.toContain("split_whitespace");
    expect(source("mention_codec.rs")).toContain(
      "fn encode_history_mentions_at_elements(",
    );
    expect(source("bottom_pane/chat_composer_history.rs")).toContain(
      "decode_history_mentions(&text)",
    );
    expect(source("app_server_session.rs")).not.toContain("session_id:");
    expect(source("app_server_session.rs")).toContain(
      "PromptHistoryAppendParams { thread_id, text }",
    );
    for (const owner of [
      "app/input_submission.rs",
      "app/skills.rs",
      "mention_codec.rs",
      "bottom_pane/chat_composer/mentions.rs",
      "bottom_pane/chat_composer/mentions_tests.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
});

describe("Codex composer, modal and incremental history owners", () => {
  it("preserves canonical element and image metadata through one rich draft and submission owner", () => {
    const elements = source("bottom_pane/textarea/elements.rs");
    expect(elements).toContain("placeholder: Option<String>");
    expect(elements).toContain("element.placeholder.clone()");
    const history = source("bottom_pane/chat_composer_history.rs");
    expect(history).toContain("local_images: Vec<LocalImageAttachment>");
    expect(history).toContain("remote_images: Vec<RemoteImageAttachment>");
    expect(history).not.toContain("local_image_paths:");
    expect(history).not.toContain("remote_image_urls:");
    expect(
      source("bottom_pane/chat_composer/attachment_state.rs"),
    ).not.toContain("struct AttachedImage");
    const input = source("app/input_submission.rs");
    expect(input).toContain("detail: image.detail");
    expect(input).not.toContain("UserInput::LocalImage { path, .. }");
    const runtime = source("runtime/input_submission.rs");
    expect(runtime).toContain("app.take_remote_images()");
    expect(runtime).toContain("app.restore_submission_draft(");
    expect(source("runtime.rs")).not.toContain("fn persist_prompt(");
    for (const owner of [
      "runtime/input_submission.rs",
      "bottom_pane/textarea/elements.rs",
      "bottom_pane/chat_composer/structured_input_tests.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
  it("prepares expanded submissions in one owner before consuming the rich draft", () => {
    const submission = source("bottom_pane/chat_composer/submission.rs");
    for (const symbol of [
      "fn prepare_submission_text(",
      "fn handle_submission(",
      "fn trim_text_elements(",
      "Self::expand_pending_pastes(",
      "validate_user_input_text_length(",
    ]) {
      expect(submission).toContain(symbol);
    }
    expect(
      submission.indexOf(
        "validate_user_input_text_length(text.chars().count())?",
      ),
    ).toBeLessThan(submission.indexOf("self.draft.textarea.take()"));
    expect(source("bottom_pane/chat_composer/input.rs")).not.toContain(
      "fn take_submission",
    );
    expect(source("app/input_submission.rs")).toContain(
      "InputResult::SubmissionRejected",
    );
    expect(submission.split("\n").length).toBeLessThan(800);
  });
  it("resolves all Vim contexts before semantic command dispatch without raw-key fallback", () => {
    const keymap = source("keymap.rs");
    for (const context of [
      "vim_normal",
      "vim_operator",
      "vim_text_object",
      "vim_search",
    ]) {
      expect(keymap).toContain(`${context}: Arc<`);
      expect(source("bottom_pane/textarea/input.rs")).toContain(
        `Arc::clone(&keymap.${context})`,
      );
    }
    const modal = source("bottom_pane/textarea/vim/input.rs");
    for (const symbol of [
      "fn keymap_context(",
      "fn vim_action_for_key(",
      "fn vim_key_starts_edit(",
      "self.vim_keymap().dispatch(",
      "VimKeymapAction::Normal",
      "VimKeymapAction::Operator",
      "VimKeymapAction::TextObject",
      "VimKeymapAction::Search",
    ]) {
      expect(modal).toContain(symbol);
    }
    expect(modal).not.toContain("match event.code");
    expect(source("bottom_pane/textarea/vim_search.rs")).not.toContain(
      "fn search_command(",
    );
    const history = source("bottom_pane/chat_composer/vim_history.rs");
    expect(history).toContain("vim_action_for_key(key)");
    expect(history).toContain("vim_key_starts_edit(key)");
    expect(history).not.toContain("fn starts_vim_edit(");
    expect(source("bottom_pane/textarea/vim_register.rs")).toContain(
      "KillBufferKind::Linewise",
    );
    expect(source("bottom_pane/textarea/vim_register.rs")).toContain(
      "fn paste_line_after_current_line(",
    );
    expect(source("bottom_pane/textarea/vim.rs")).toContain(
      "fn current_line_range_with_newline(",
    );
  });
  it("propagates the same snapshot into queued and new BottomPane text editors", () => {
    expect(source("chatwidget.rs")).toContain(
      "self.bottom_pane.set_keymap_bindings(&keymap)",
    );
    const pane = source("bottom_pane/mod.rs");
    expect(pane).toContain("request.set_keymap_bindings(keymap)");
    expect(pane).toContain("interaction.set_keymap_bindings(&self.keymap)");
    const request = source("bottom_pane/request_user_input/mod.rs");
    expect(request).toContain("self.composer.key_chord_pending()");
    expect(request).toContain("list_keymap: ListKeymap");
    expect(request).toContain("self.list_keymap.primary_hint(");
    expect(request).toContain(".list_keymap");
    expect(request).toContain(".dispatch(");
    expect(request).not.toContain("locale.request_submit_hint()");
    expect(request).not.toContain("locale.request_cancel_hint()");
    const approval = source("bottom_pane/approval_overlay.rs");
    expect(approval).toContain("list_keymap: ListKeymap");
    expect(approval).toContain("KeymapMatch::Completed(ListAction::Accept)");
    expect(approval).toContain(".dispatch(");
    const mcp = source("bottom_pane/mcp_server_elicitation.rs");
    expect(mcp).toContain("self.text_area.editor_key_chord_pending()");
    expect(mcp).toContain("list_keymap: ListKeymap");
    expect(mcp).toContain(".list_keymap");
    expect(mcp).toContain(".dispatch(");
    expect(mcp).not.toContain("mcp_elicitation_controls(");
    const textInput = source("bottom_pane/mcp_server_elicitation.rs")
      .split("fn handle_text_key(")[1]
      .split("pub(super) fn handle_paste(")[0];
    expect(textInput).toContain("self.text_area.input(key)");
    expect(textInput).not.toContain("KeyCode::Char('j')");
    expect(source("bottom_pane/render.rs")).toContain(
      "mcp_server_elicitation::render::",
    );
    for (const owner of [
      "keymap/vim.rs",
      "bottom_pane/textarea/vim/input.rs",
      "bottom_pane/textarea/vim_register.rs",
      "bottom_pane/mcp_server_elicitation.rs",
      "bottom_pane/mcp_server_elicitation/render.rs",
      "bottom_pane/mcp_server_elicitation/schema.rs",
      "bottom_pane/mcp_server_elicitation/tests.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
  it("packs complete interactive hints through the Codex footer_hint owner", () => {
    expect(source("lib.rs")).toContain("mod footer_hint;");
    const hints = source("footer_hint.rs");
    expect(hints).toContain("fn first_fitting_line(");
    expect(hints).toContain("fn wrap_hint_rows<T>(");
    expect(hints).not.toContain("truncate_line_with_ellipsis_if_overflow");
    const request = source("bottom_pane/request_user_input/mod.rs");
    expect(request).toContain("primary_action_hint(");
    expect(request).toContain("wrap_hint_rows(");
    expect(request).not.toContain(".skip(2)");
    expect(source("bottom_pane/approval_render.rs")).toContain(
      "primary_action_hint(",
    );
    expect(source("bottom_pane/mod.rs")).not.toContain(
      "fit_primary_action_hint",
    );
    const mcp = source("bottom_pane/mcp_server_elicitation/render.rs");
    expect(mcp).toContain("wrap_hint_rows(");
    for (const retired of [
      "contains_submit_hint",
      "contains_cancel_hint",
      "compact_control_segment",
    ]) {
      expect(mcp).not.toContain(retired);
    }
    expect(source("locale.rs")).not.toContain("fn approval_controls(");
  });
  it("shares footer content geometry across measurement and painting", () => {
    const footer = source("bottom_pane/footer.rs").split("#[cfg(test)]")[0];
    expect(footer).toContain("fn inset_footer_hint_area(");
    expect(footer).toContain("let content = inset_footer_hint_area(area)");
    expect(footer).toContain("first_fitting_line(");
    expect(footer).not.toContain('format!(" {hint}")');
    expect(footer).not.toContain("usable_content_width_u16");
    expect(source("width.rs")).not.toContain("fn usable_content_width");
    expect(source("chatwidget/footer.rs")).toContain("inset_footer_hint_area(");
    expect(source("view.rs")).toContain(
      "bottom_pane::inset_footer_hint_area(area)",
    );
    const shortcuts = source("bottom_pane/shortcut_overlay.rs");
    expect(shortcuts).toContain("let content = inset_footer_hint_area(area)");
    expect(shortcuts).toContain("first_fitting_line(");
  });
  it("keeps ordinary context on the same typed facts and pure bottom-pane footer owner", () => {
    const footer = source("bottom_pane/footer.rs");
    expect(footer).toContain('#[path = "footer_tests.rs"]');
    expect(footer).not.toMatch(
      /ThreadStore|AppServerSession|ConfigManager|std::fs|provider\.usage/,
    );
    expect(footer.split("\n").length).toBeLessThan(800);
    expect(source("view.rs")).toContain("usage.total.total_tokens.max(0)");
    expect(source("chatwidget/footer.rs")).not.toContain("blended_total");
    expect(existsSync(sourcePath("status/token_usage.rs"))).toBe(false);
  });
  it("uses complete styled hints for picker and Agent Center footers", () => {
    const shared = source("footer_hint.rs");
    expect(shared).toContain("fn shortcut(");
    expect(shared).toContain("line_width > 0 && line_width <= width");
    const picker = source("bottom_pane/list_selection_view.rs");
    expect(picker).toContain("shortcut(key, label)");
    expect(picker).toContain("first_fitting_line(");
    expect(picker).toContain("!view.entries.is_empty()");
    expect(picker).not.toContain('keys.join(" ")');
    expect(source("locale/pickers.rs")).not.toContain(
      "selection_picker_footer",
    );
    const center = source("app/agent_center/hints.rs");
    expect(center).toContain("shortcut(key, label)");
    expect(center).toContain("first_fitting_line(");
    expect(center).toContain("self.accept_hint()");
    expect(center).toContain("!self.loading_more()");
    expect(center).not.toContain(".find(|line| line.width()");
  });
  it("packs Resume shortcuts whole and deletes locale key/copy composition", () => {
    const resume = source("resume_picker/render.rs");
    expect(resume).toContain("struct PickerFooterHint");
    expect(resume).toContain("fn hint_line_for_row(");
    expect(resume).toContain("shortcut(&hint.key, hint.label)");
    expect(resume).toContain("first_fitting_line(candidates, width)");
    expect(resume).toContain("picker.selected_thread_id().is_some()");
    expect(resume).toContain("footer_hint_lines(picker, locale, hints.width)");
    expect(resume).not.toContain('keys.join(" ")');
    expect(resume).not.toContain("truncate_display(&secondary");
    for (const retired of [
      "resume_enter_hint",
      "resume_escape_hint",
      "resume_controls_hint",
      "resume_expand_hint",
      "resume_transcript_hint",
    ]) {
      expect(source("locale.rs")).not.toContain(retired);
      expect(source("locale/pickers.rs")).not.toContain(retired);
      expect(resume).not.toContain(retired);
    }
  });
  it("owns export prompts in ChatWidget and reuses the current selection/editor boundaries", () => {
    const surface = source("chatwidget/transcript_export.rs");
    expect(surface).toContain("fn show_transcript_export_popup(");
    expect(surface).toContain("ListSelectionView");
    expect(surface).toContain("list_selection_view::render(");
    expect(surface).toContain("list_selection_view::desired_height(");
    expect(surface).toContain("prompt.set_keymap_bindings(keymap)");
    expect(surface).toContain("filename: CustomPromptView");
    expect(surface).toContain("self.filename.handle_key_event(*key)");
    expect(surface).toContain("self.keymap.list()");
    expect(surface).not.toContain("fn export_option_line(");
    expect(source("chatwidget.rs")).toContain(
      "pub(crate) mod transcript_export;",
    );
    const appExport = source("app/transcript_export.rs");
    for (const retired of [
      "ExportPicker",
      "fn render_picker(",
      "export_option_line",
    ]) {
      expect(appExport).not.toContain(retired);
    }
    expect(appExport).toContain("fn render_markdown_transcript(");
    expect(appExport).toContain("persist_noclobber");
    expect(source("view.rs")).toContain(
      "crate::chatwidget::transcript_export::render_picker(",
    );
    expect(source("view.rs")).not.toContain(
      "crate::app::transcript_export::render_picker",
    );
    for (const retired of [
      "fn export_picker_hint(",
      "fn export_prompt_hint(",
    ]) {
      expect(source("locale.rs")).not.toContain(retired);
    }
  });

  it("keeps prompt editing and picker layout in one current owner and blocks the dedicated filename renderer", () => {
    const prompt = source("bottom_pane/custom_prompt_view.rs");
    const picker = source("bottom_pane/custom_prompt_view/picker.rs");
    const exportSurface = source("chatwidget/transcript_export.rs");
    expect(source("bottom_pane/mod.rs")).toContain(
      "pub(crate) mod custom_prompt_view;",
    );
    for (const symbol of [
      "textarea: TextArea",
      "paste_burst: PasteBurst",
      "fn handle_key_event_at(",
      "fn enable_vim_in_insert_mode(",
      "editor_key_chord_pending()",
      "is_vim_operator_pending()",
      "direct_insert_newline_should_insert(now)",
      "self.textarea.insert_str(pasted)",
    ]) {
      expect(prompt, symbol).toContain(symbol);
    }
    for (const symbol of [
      "fn picker_desired_height(",
      "fn picker_areas(",
      "fn picker_cursor_pos(",
      "clamp(1, 8)",
      "wrap(Wrap { trim: false })",
    ]) {
      expect(picker, symbol).toContain(symbol);
    }
    for (const retired of [
      "filename_state",
      "TextAreaState",
      "truncate_line_with_ellipsis_if_overflow",
      "cursor_pos_with_state",
      "render_stateful_widget_ref",
      "replace(['\\r', '\\n']",
    ]) {
      expect(exportSurface, retired).not.toContain(retired);
    }
    expect(exportSurface).toContain(
      "picker.filename.enable_vim_in_insert_mode()",
    );
    for (const owner of [
      "bottom_pane/custom_prompt_view.rs",
      "bottom_pane/custom_prompt_view/picker.rs",
      "bottom_pane/custom_prompt_view_tests.rs",
      "chatwidget/transcript_export.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
    for (const retiredBoundary of [
      "app_server",
      "RuntimeCore",
      "ThreadStore",
      "persist_noclobber",
    ]) {
      expect(prompt, retiredBoundary).not.toContain(retiredBoundary);
      expect(picker, retiredBoundary).not.toContain(retiredBoundary);
    }
  });
  it("routes the resolved editor snapshot through one semantic TextArea owner", () => {
    expect(source("keymap.rs")).toContain("editor: Arc<EditorKeymap>");
    const input = source("bottom_pane/textarea/input.rs");
    for (const symbol of [
      "fn set_keymap_bindings(",
      "fn input_with_keymap(",
      "keymap.dispatch(",
      "fn apply_editor_action(",
      "apply_vim_insert_action",
    ]) {
      expect(input).toContain(symbol);
    }
    expect(source("bottom_pane/mod.rs")).toContain(
      "self.composer.set_keymap_bindings(keymap)",
    );
    expect(source("bottom_pane/chat_composer/input.rs")).toContain(
      "editor_key_event_is_owned",
    );
    expect(source("bottom_pane/input.rs")).toContain(
      "self.composer.key_chord_pending()",
    );
    for (const file of [
      "keymap.rs",
      "bottom_pane/textarea.rs",
      "bottom_pane/chat_composer/input.rs",
    ]) {
      expect(source(file)).not.toContain("is_editor_key_event");
    }
    expect(source("bottom_pane/textarea.rs")).not.toContain(
      "fn input_insert_mode(",
    );
    for (const file of [
      "keymap/editor.rs",
      "bottom_pane/textarea.rs",
      "bottom_pane/textarea/input.rs",
      "bottom_pane/chat_composer/input.rs",
    ]) {
      expect(source(file).split("\n").length, file).toBeLessThan(800);
    }
  });
  it("keeps semantic Vim commands and stored search drafts in the matching Codex owners", () => {
    const commands = source("bottom_pane/textarea/vim_commands.rs");
    for (const symbol of [
      "VimCommandState",
      "VimPersistentState",
      "VimEdit",
      "VimAction",
      "VimEditTarget",
      "pending_change",
      "last_change",
      "begin_vim_repeat",
      "finish_vim_repeat",
      "swap_vim_persistent_state",
    ]) {
      expect(commands).toContain(symbol);
    }
    expect(source("bottom_pane/textarea.rs")).toContain(
      "vim_commands: VimCommandState",
    );
    for (const file of [
      "bottom_pane/textarea.rs",
      "bottom_pane/textarea/vim.rs",
      "bottom_pane/textarea/vim_commands.rs",
      "bottom_pane/textarea/elements.rs",
    ]) {
      expect(source(file)).not.toContain("vim_replace_steps");
      expect(source(file)).not.toContain("original_elements");
    }
    const stored = source("bottom_pane/chat_composer/history_search_draft.rs");
    expect(stored).toContain("fn edit_stored_draft(");
    expect(stored).toContain("fn draft_snapshot(");
    expect(stored).toContain("swap_vim_persistent_state");
    expect(source("bottom_pane/input_state.rs")).toContain(
      "self.composer.draft_snapshot()",
    );
    expect(source("bottom_pane/chat_composer/draft.rs")).toContain(
      "self.edit_stored_draft(",
    );
    expect(source("bottom_pane/chat_composer/paste_input.rs")).toContain(
      "allows_paste_burst()",
    );
    const vim =
      source("bottom_pane/textarea/vim.rs") +
      source("bottom_pane/textarea/vim/navigation.rs") +
      source("bottom_pane/textarea/vim_search.rs");
    for (const old of [
      "VimPending::ReplaceChar",
      "fn next_word_start(",
      "fn word_end_cursor(",
      "vim_normal_end_cursor_for_search",
    ]) {
      expect(vim).not.toContain(old);
    }
    expect(vim).toContain("fn beginning_of_next_word(");
    expect(vim).toContain("fn vim_word_end_cursor(");
    for (const owner of [
      "bottom_pane/textarea/vim.rs",
      "bottom_pane/textarea/vim_commands.rs",
      "bottom_pane/chat_composer/history_search_draft.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
  it("uses metadata and async host events instead of a bounded eager-loaded history vector", () => {
    const history = source("bottom_pane/chat_composer_history.rs");
    for (const symbol of [
      "set_metadata",
      "local_history",
      "replay_seeded_history",
      "record_replayed_submission",
      "replace_replayed_history",
      "fetched_history",
      "history_cursor",
      "on_entry_response",
    ]) {
      expect(history).toContain(symbol);
    }
    for (const old of [
      "MAX_HISTORY_ENTRIES",
      "set_persistent_entries",
      "navigation_index",
      "entries: Vec<HistoryEntry>",
    ]) {
      expect(history).not.toContain(old);
    }
    expect(source("app/startup.rs")).toContain("set_history_metadata");
    expect(source("app.rs")).toContain(
      "replace_replayed_history(thread.id.clone(), &thread.turns)",
    );
    expect(source("app/history_pagination.rs")).toContain(
      "record_replayed_history_page(&items, turns, prepend_replay)",
    );
    expect(history).toContain("turns: &[Turn]");
    expect(source("app/startup.rs")).not.toContain("load_history");
    for (const symbol of [
      "LookupMessageHistoryEntry",
      "LookupMessageHistoryBatch",
      "HistoryLookupResponse",
      "ThreadHistoryEntryResponse",
    ]) {
      expect(source("app_event.rs")).toContain(symbol);
    }
    const batch = source("bottom_pane/chat_composer_history/search_batch.rs");
    for (const symbol of [
      "on_batch_response",
      "on_batch_error",
      "MAX_BATCH_READ_RETRIES",
      "Unavailable",
    ]) {
      expect(batch).toContain(symbol);
    }
    expect(source("runtime.rs")).toContain("message_history.handle_event(");
    expect(source("app/message_history.rs")).toContain(
      "METHOD_PROMPT_HISTORY_READ",
    );
    expect(source("app/message_history.rs")).not.toContain("std::fs");
    for (const symbol of [
      "on_history_lookup_response",
      "on_history_entry_response",
      "on_history_batch_response",
      "on_history_batch_error",
      "apply_history_batch_result",
    ]) {
      expect(source("bottom_pane/chat_composer/history.rs")).toContain(symbol);
    }
  });
  it("keeps traversal in ChatComposerHistory and query/preview in HistorySearchSession", () => {
    expect(source("bottom_pane/chat_composer_history.rs")).toContain(
      "search: Option<HistorySearchState>",
    );
    const search = source("bottom_pane/chat_composer_history/search.rs");
    for (const symbol of [
      "HistorySearchDirection",
      "HistorySearchResult",
      "UniqueHistoryMatch",
      "fn search(",
      "fn reset_search(",
      "select_cached_unique_match",
    ]) {
      expect(search).toContain(symbol);
    }
    const session = source("bottom_pane/chat_composer/history_search.rs");
    for (const symbol of [
      "HistorySearchSession",
      "begin_history_search",
      "update_history_search_query",
      "apply_history_search_result",
    ]) {
      expect(session).toContain(symbol);
    }
    for (const old of [
      "fn find_match(",
      "fn find_older(",
      "fn find_newer(",
      "select_history_match",
      "start_history_search",
    ]) {
      expect(session).not.toContain(old);
      expect(source("bottom_pane/chat_composer/history.rs")).not.toContain(old);
    }
    for (const owner of [
      "bottom_pane/chat_composer/history_search.rs",
      "bottom_pane/chat_composer_history/search.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });
});

describe("ChatWidget live composer ownership", () => {
  it("keeps the BottomPane inside the current ChatWidget owner", () => {
    const app = source("app.rs");
    expect(app).toContain("chat_widget: ChatWidget");
    expect(source("chatwidget.rs")).toContain(
      "pub(crate) bottom_pane: BottomPane",
    );
    expect(source("lib.rs")).toContain("mod chatwidget;");
    expect(app).not.toContain("bottom_pane: BottomPane");
  });
  it("forbids App editor fields, getters and direct editor consumers outside the pane", () => {
    const root = path.resolve(process.cwd(), "lime-rs/crates/tui/src");
    const visit = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (file !== path.join(root, "bottom_pane")) visit(file);
        } else if (entry.name.endsWith(".rs")) {
          const text = readFileSync(file, "utf8");
          expect(text, file).not.toMatch(/\b(?:app|self)\s*\.\s*composer\b/u);
          expect(text, file).not.toMatch(/\.\s*bottom_pane\s*\.\s*composer\b/u);
        }
      }
    };
    visit(root);
    const app = source("app.rs");
    expect(app).not.toMatch(/composer\s*:\s*ChatComposer/u);
    expect(app).not.toMatch(
      /fn\s+(?:composer|composer_mut|replace_composer)\s*\(/u,
    );
    expect(source("bottom_pane/mod.rs")).toContain("composer: ChatComposer");
    expect(source("bottom_pane/composer.rs")).not.toMatch(
      /Deref|->\s*&(?:mut\s+)?ChatComposer/u,
    );
  });
  it("keeps input, popup painting, timers and atomic snapshots inside the pane", () => {
    const interaction = source("app/interaction.rs");
    for (const old of [
      "handle_command_popup_event",
      "handle_file_search_popup_event",
      "handle_skill_popup_event",
      "prepare_popup_key_event",
      "vim_search_wants_key",
    ]) {
      expect(interaction, old).not.toContain(old);
    }
    expect(interaction).toContain(
      "self.chat_widget.bottom_pane.handle_event(event.clone())",
    );
    expect(source("bottom_pane/input.rs")).toContain(
      "self.handle_interaction_event(event)",
    );
    expect(source("bottom_pane/input.rs")).toContain(
      "self.handle_event_at(Event::Key(key), now)",
    );
    expect(source("bottom_pane/render.rs")).toContain(
      "pane.composer.render(frame, area, locale)",
    );
    expect(source("view.rs")).not.toContain("command_popup::render");
    expect(source("view.rs")).toMatch(
      /app\s*\.\s*chat_widget\s*\.\s*bottom_pane\s*\.\s*render_popups/u,
    );
    const pane = source("bottom_pane/mod.rs");
    expect(pane).toContain("self.composer.handle_paste_burst_flush(now)");
    expect(pane).toContain("Some(a.min(b))");
    expect(source("app.rs")).not.toContain("handle_paste_burst_flush");
    const state = source("bottom_pane/input_state.rs");
    expect(state).toContain("composer: ComposerDraft");
    expect(state).toContain("self.composer.flush_paste_burst_before_handoff()");
    expect(state).toContain("std::mem::take(&mut self.queue)");
    expect(source("app/thread_input.rs")).not.toContain(
      "struct ThreadInputState",
    );
    for (const owner of [
      "bottom_pane/mod.rs",
      "bottom_pane/composer.rs",
      "bottom_pane/input.rs",
      "bottom_pane/input_state.rs",
      "bottom_pane/render.rs",
    ]) {
      expect(source(owner).split("\n").length, owner).toBeLessThan(800);
    }
  });

  it("does not retain an unreachable shutdown composer wrapper", () => {
    const bottomPane = source("bottom_pane/composer.rs");
    const composerDraft = source("bottom_pane/chat_composer/draft.rs");
    expect(bottomPane).not.toContain("show_shutdown_in_progress");
    expect(composerDraft).not.toContain("show_shutdown_in_progress");
    expect(bottomPane).toContain(
      "#[cfg(test)]\n    pub(crate) fn set_composer_input_enabled(",
    );
  });

  it("keeps transcript presentation state inside the ChatWidget owner", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    for (const field of [
      "pager_overlay: Option<PagerOverlay>",
      "transcript_presentation: TranscriptPresentation",
      "transcript_scroll: usize",
      "transcript_viewport:",
      "transcript_follow_control:",
      "transcript_composer_gap:",
      "transcript_footer:",
      "transcript_prompt_header:",
      "transcript_search:",
      "transcript_selection:",
    ]) {
      expect(widget, field).toContain(field);
    }
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    for (const field of [
      "pager_overlay:",
      "transcript_presentation:",
      "transcript_scroll:",
      "transcript_viewport:",
      "transcript_follow_control:",
      "transcript_composer_gap:",
      "transcript_footer:",
      "transcript_prompt_header:",
      "transcript_search:",
      "transcript_selection:",
    ]) {
      expect(appStruct, field).not.toContain(field);
    }
    const presentation = source("app/transcript_presentation.rs");
    expect(presentation).toContain("self.chat_widget.open_transcript_pager()");
    expect(presentation).toContain("self.chat_widget.dismiss_pager_overlay()");
    expect(presentation).toContain(
      "self.chat_widget.reset_transcript_presentation()",
    );
    const transcript = source("chatwidget/transcript.rs");
    for (const method of [
      "fn toggle_history_render_mode(",
      "fn is_raw_output_mode(",
      "fn open_transcript_pager(",
      "fn dismiss_pager_overlay(",
      "fn reset_transcript_presentation(",
      "fn reset_thread_surface(",
      "fn reset_for_hydrated_thread(",
      "fn scroll_up(",
      "fn scroll_down(",
      "fn scroll_top(",
      "fn scroll_bottom(",
      "fn finish_transcript_selection(",
      "fn open_status_pager(",
      "fn open_mcp_inventory(",
    ]) {
      expect(transcript, method).toContain(method);
    }
    expect(transcript).toContain("self.transcript_presentation");
    expect(transcript).toContain("self.pager_overlay");
    expect(source("app.rs")).toContain(
      "self.chat_widget.finish_transcript_selection(follow)",
    );
    expect(source("app.rs")).toContain("self.chat_widget.scroll_up(amount)");
    expect(source("app.rs")).toContain("self.chat_widget.scroll_down(amount)");
    expect(source("app.rs")).toContain("self.chat_widget.scroll_top()");
    expect(source("app.rs")).toContain("self.chat_widget.scroll_bottom()");
    expect(source("app.rs")).toContain(
      "self.chat_widget.open_status_pager(StatusFacts",
    );
    expect(source("app.rs")).toContain(
      "self.chat_widget.open_mcp_inventory(&statuses, detail)",
    );
    expect(source("app.rs")).not.toMatch(
      /self\.chat_widget\.pager_overlay\s*=\s*Some/u,
    );
  });

  it("keeps the Agent Center surface inside ChatWidget while App owns transport", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(widget).toContain(
      "pub(crate) agents_overview: Option<AgentsOverviewState>",
    );
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("agents_overview:");
    expect(app).not.toMatch(/\b(?:app|self)\s*\.\s*agents_overview\b/u);
    expect(source("app/agents_overview.rs")).toContain(
      "self.chat_widget.set_agents_overview(overview)",
    );
    expect(source("app/agents_overview_threads.rs")).toContain(
      "self.chat_widget.agents_overview.as_mut()",
    );
    expect(source("view.rs")).toContain(
      "app.chat_widget.agents_overview.as_ref()",
    );
  });

  it("keeps transient picker and export surfaces inside ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    for (const field of [
      "model_picker: Option<ModelPicker>",
      "agent_picker: Option<AgentPicker>",
      "resume_picker: Option<PickerState>",
      "export_picker: Option<ExportPicker>",
    ]) {
      expect(widget, field).toContain(field);
    }
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    for (const field of [
      "model_picker:",
      "agent_picker:",
      "resume_picker:",
      "export_picker:",
    ]) {
      expect(appStruct, field).not.toContain(field);
    }
    expect(app).not.toMatch(
      /\b(?:app|self)\s*\.\s*(?:model_picker|agent_picker|resume_picker|export_picker)\b/u,
    );
    expect(source("view.rs")).toContain("app.chat_widget.model_picker");
    expect(source("view.rs")).toContain("app.chat_widget.resume_picker");
    expect(source("app/interaction.rs")).toContain(
      "self.chat_widget.model_picker",
    );
  });

  it("routes focused cursor styles through the current terminal host and restores the user shape", () => {
    expect(source("bottom_pane/textarea/vim.rs")).toContain(
      "fn uses_vim_insert_cursor(",
    );
    for (const owner of [
      "bottom_pane/chat_composer/layout.rs",
      "bottom_pane/custom_prompt_view.rs",
    ]) {
      expect(source(owner), owner).toContain("uses_vim_insert_cursor()");
      expect(source(owner), owner).toContain("SetCursorStyle::SteadyBar");
    }
    expect(source("view.rs")).toContain(
      "pub(crate) fn cursor_style(app: &App)",
    );
    expect(source("view.rs")).toContain("return picker.cursor_style()");
    expect(source("bottom_pane/render.rs")).toContain(
      "request.composer.cursor_style()",
    );
    const host = source("tui.rs");
    expect(host).toContain("pub(crate) fn draw(");
    expect(host).toContain(
      "execute!(self.terminal.backend_mut(), cursor_style)",
    );
    for (const cleanup of [
      "restore_terminal_state",
      "restore_keep_raw",
      "cleanup_failed_enter",
    ]) {
      const section = host
        .slice(host.indexOf(`fn ${cleanup}(`))
        .split("\n}\n")[0];
      expect(section, cleanup).toContain("SetCursorStyle::DefaultUserShape");
    }
    expect(
      host.slice(host.indexOf("pub(crate) fn restore(&mut self)")),
    ).toContain("SetCursorStyle::DefaultUserShape");
    for (const owner of ["runtime.rs", "resume_picker/host.rs"]) {
      expect(source(owner), owner).not.toMatch(
        /\.terminal_mut\(\)\s*\.draw\(/u,
      );
    }
    expect(source("runtime.rs")).toMatch(
      /\.draw\(\s*view::cursor_style\(&app\)/u,
    );
  });

  it("keeps session settings and model catalog beside ChatWidget controls", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    for (const field of [
      "model_catalog: ModelCatalog",
      "collaboration_mode: Option<agent_protocol::CollaborationMode>",
      "model: Option<String>",
      "model_provider: Option<String>",
      "reasoning_effort: Option<String>",
      "permissions: Option<String>",
      "permission_profiles: Vec<String>",
      "history_render_mode: HistoryRenderMode",
    ]) {
      expect(widget, field).toContain(field);
    }
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    for (const field of [
      "model_catalog:",
      "collaboration_mode:",
      "model:",
      "model_provider:",
      "reasoning_effort:",
      "permissions:",
      "permission_profiles:",
      "history_render_mode:",
    ]) {
      expect(appStruct, field).not.toContain(field);
    }
    expect(source("chatwidget/settings.rs")).toContain("self.model_catalog");
    expect(source("chatwidget/settings.rs")).toContain("set_model_catalog(");
    expect(source("app/event_dispatch.rs")).toContain(
      "apply_collaboration_mode(collaboration_mode)",
    );
    expect(source("app/history_ui.rs")).toContain(
      "app.chat_widget.reasoning_effort",
    );
  });

  it("keeps runtime settings mutations in the ChatWidget owner", () => {
    const runtime = source("runtime.rs");
    const dispatch = source("app/event_dispatch.rs");
    const settings = source("chatwidget/settings.rs");
    for (const local of [
      "let mut model",
      "let mut model_provider",
      "let mut effort",
      "let mut permissions",
      "model: &mut",
      "model_provider: &mut",
      "effort: &mut",
      "permissions: &mut",
    ]) {
      expect(runtime, local).not.toContain(local);
      expect(dispatch, local).not.toContain(local);
    }
    expect(runtime).toContain("app.chat_widget.settings_patch()");
    expect(dispatch).toContain("self.chat_widget.apply_model_selection(");
    expect(dispatch).toContain("self.chat_widget.apply_effort(next.clone())");
    expect(dispatch).toContain(
      "self.chat_widget.apply_permissions(next.clone())",
    );
    for (const method of [
      "fn settings_patch(",
      "fn apply_model_selection(",
      "fn apply_effort(",
      "fn apply_permissions(",
      "fn apply_collaboration_mode(",
    ]) {
      expect(settings).toContain(method);
    }
  });

  it("keeps locale and user-visible copy beside the ChatWidget presentation owner", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(widget).toContain("pub(crate) locale: Locale");
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("locale:");
    expect(widget).toContain(
      "pub(crate) fn set_locale(&mut self, locale: Locale)",
    );
    expect(app).toContain("self.chat_widget.set_locale(locale)");
    expect(source("view.rs")).toContain("app.chat_widget.locale");
    expect(source("app/history_ui.rs")).toContain("app.chat_widget.locale");
    expect(source("app/mcp_login.rs")).toContain(
      "self.chat_widget.locale.mcp_login",
    );
    expect(app).not.toMatch(/\b(?:app|self)\.locale\b/u);
  });

  it("keeps MCP OAuth request ordering at the App transport boundary", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(app).toContain(
      "pending_mcp_login_start: Option<mcp_login::PendingMcpLoginStart>",
    );
    expect(app).toContain(
      "active_mcp_login_ids: HashMap<String, mcp_login::ActiveMcpLogin>",
    );
    expect(app).toContain("mcp_login_generation: u64");
    expect(widget).not.toContain("PendingMcpLoginStart");
    expect(widget).not.toContain("ActiveMcpLogin");
    expect(source("app/mcp_login.rs")).toContain("fn start_mcp_login(");
    expect(source("app/event_dispatch.rs")).toContain(
      "super::mcp_login::start_mcp_login(",
    );
  });

  it("keeps collaboration derivation in the ChatWidget settings owner", () => {
    const settings = source("chatwidget/settings.rs");
    for (const symbol of [
      "impl ChatWidget",
      "set_model_catalog(",
      "set_settings(",
      "set_collaboration_modes(",
      "next_collaboration_mode(",
      "plan_mode(",
      "sync_default_collaboration_mode(",
    ]) {
      expect(settings, symbol).toContain(symbol);
    }
    const widgetSettings = source("chatwidget/settings.rs");
    expect(widgetSettings).toContain("use crate::collaboration_modes");
    expect(widgetSettings).toContain("self.model_catalog");
    expect(source("app/input_flow.rs")).toContain(".next_collaboration_mode()");
    expect(source("runtime.rs")).toContain("app.chat_widget.plan_mode()");
    expect(source("app/event_dispatch.rs")).toContain(
      "apply_collaboration_mode(collaboration_mode)",
    );
  });

  it("keeps agent navigation and transcript history availability in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    const navigation = source("app/agent_navigation.rs");
    expect(widget).toContain("agent_navigation: AgentNavigationState");
    expect(widget).toContain("scrollback_has_older_history: bool");
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("agent_navigation:");
    expect(appStruct).not.toContain("scrollback_has_older_history:");
    expect(app).toContain("self.chat_widget.agent_navigation");
    expect(source("app/history_pagination.rs")).toContain(
      "self.chat_widget.scrollback_has_older_history",
    );
    expect(source("chatwidget/transcript.rs")).toContain(
      "fn set_scrollback_has_older_history(",
    );
    expect(source("app/startup.rs")).toContain(
      "set_scrollback_has_older_history(",
    );
    expect(source("app/session_lifecycle.rs")).toContain(
      "set_scrollback_has_older_history(",
    );
    expect(source("chatwidget/footer.rs")).toContain(".agent_navigation");
    expect(source("chatwidget/footer.rs")).toContain(".active_agent_label(");
    expect(source("bottom_pane/footer.rs")).not.toContain("app.chat_widget");
    for (const deadSurface of [
      "fn is_empty(",
      "fn set_agent_path(",
      "fn clear(",
      "fn remove(",
      "fn ordered_path_backed_subagent_threads(",
      "allow(dead_code)",
    ]) {
      expect(navigation, deadSurface).not.toContain(deadSurface);
    }
  });

  it("keeps the runtime keymap and global chord matcher in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(widget).toContain("pub(crate) runtime_keymap: RuntimeKeymap");
    expect(widget).toContain(
      "pub(crate) global_key_chord_matcher: KeyChordMatcher",
    );
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("runtime_keymap:");
    expect(appStruct).not.toContain("global_key_chord_matcher:");
    expect(source("app/interaction.rs")).toContain(
      "self.chat_widget.dispatch_global_key(key)",
    );
    expect(source("chatwidget/interaction.rs")).toContain(
      "self.global_key_chord_matcher",
    );
    expect(source("runtime.rs")).toContain("app.chat_widget.runtime_keymap");
  });

  it("keeps clipboard leases, mouse-paste guards and queued submissions in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    for (const field of [
      "clipboard_lease: Option<crate::clipboard_copy::ClipboardLease>",
      "primary_clipboard_lease: Option<crate::clipboard_copy::ClipboardLease>",
      "right_click_paste: RightClickPaste",
      "pending_clipboard_paste: Option<PendingPaste>",
      "queued_submissions: Vec<QueuedSubmission>",
    ]) {
      expect(widget, field).toContain(field);
    }
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    for (const field of [
      "clipboard_lease:",
      "primary_clipboard_lease:",
      "right_click_paste:",
      "pending_clipboard_paste:",
      "queued_submissions:",
    ]) {
      expect(appStruct, field).not.toContain(field);
    }
    const widgetInput = source("chatwidget/input.rs");
    for (const method of [
      "fn queued_submissions(",
      "fn replace_queued_submissions(",
      "fn upsert_queued_submission(",
      "fn restore_queued_submission_for_edit(",
    ]) {
      expect(widgetInput, method).toContain(method);
    }
    expect(source("view.rs")).toContain("app.chat_widget.queued_submissions()");
    expect(source("app/input_flow.rs")).toContain(".queued_submissions()");
    const submission = source("app/input_submission.rs");
    expect(submission).toContain(
      "self.chat_widget.replace_queued_submissions(submissions)",
    );
    expect(submission).toContain(
      "self.chat_widget.upsert_queued_submission(submission)",
    );
    expect(submission).toContain(
      "restore_queued_submission_for_edit(submission)",
    );
    expect(submission).not.toContain("self.chat_widget.queued_submissions");
    const paste = source("app/right_click_paste.rs");
    const pasteWidgetInput = source("chatwidget/input.rs");
    for (const method of [
      "fn set_pending_clipboard_paste(",
      "fn pending_clipboard_paste(",
      "fn pending_clipboard_source(",
      "fn take_pending_clipboard_paste(",
      "fn clear_pending_clipboard_paste(",
    ]) {
      expect(pasteWidgetInput, method).toContain(method);
    }
    expect(paste).toContain("self.chat_widget.set_pending_clipboard_paste(");
    expect(paste).toContain("self.chat_widget.pending_clipboard_paste()");
    expect(paste).toContain("take_pending_clipboard_paste()");
    expect(paste).toContain("self.chat_widget.clear_pending_clipboard_paste()");
    expect(paste).not.toContain("self.chat_widget.pending_clipboard_paste =");
  });

  it("keeps thread draft snapshots, turn lifecycle and startup warnings in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    const lifecycle = source("app/turn_lifecycle.rs");
    for (const field of [
      "thread_input_states: HashMap<String, crate::bottom_pane::BottomPaneInputState>",
      "turn_lifecycle: crate::app::turn_lifecycle::TurnLifecycleState",
      "skill_load_warnings: crate::app::startup_prompts::SkillLoadWarningState",
      "mcp_startup_warnings: crate::app::startup_prompts::McpStartupWarningState",
    ]) {
      expect(widget, field).toContain(field);
    }
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    for (const field of [
      "thread_input_states:",
      "turn_lifecycle:",
      "skill_load_warnings:",
      "mcp_startup_warnings:",
    ]) {
      expect(appStruct, field).not.toContain(field);
    }
    const threadInput = source("chatwidget/input.rs");
    for (const method of [
      "fn capture_thread_input(",
      "fn restore_thread_input(",
      "fn observe_thread_input_notification(",
      "fn clear_thread_interactions(",
    ]) {
      expect(threadInput, method).toContain(method);
    }
    expect(source("app/thread_input.rs")).toContain(
      "self.chat_widget.capture_thread_input(&thread_id)",
    );
    expect(source("app/thread_input.rs")).not.toContain(
      "self.chat_widget.thread_input_states",
    );
    expect(source("app/thread_events.rs")).toContain(
      "self.chat_widget.turn_lifecycle",
    );
    for (const deadSurface of [
      "budget_limited_turn_ids",
      "rendered_completion_turn_ids",
      "mark_budget_limited(",
      "take_budget_limited(",
    ]) {
      expect(lifecycle, deadSurface).not.toContain(deadSurface);
    }
  });

  it("keeps external editor lifecycle state in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(widget).toContain("external_editor_state: ExternalEditorState");
    expect(widget).toContain("pub(crate) fn request_external_editor_launch");
    expect(widget).toContain("pub(crate) fn reset_external_editor_state");
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("external_editor_state:");
    expect(app).not.toMatch(/\b(?:app|self)\s*\.\s*external_editor_state\b/u);
    expect(source("runtime.rs")).toContain(
      "app.chat_widget.external_editor_state()",
    );
    expect(source("app/input_submission.rs")).toContain(
      "self.chat_widget.request_external_editor_launch()",
    );
  });

  it("keeps startup protected-request presentation pending state in ChatWidget", () => {
    const widget = source("chatwidget.rs");
    const app = source("app.rs");
    expect(widget).toContain("startup_pending_protected_request: bool");
    const appStruct = app.slice(
      app.indexOf("pub(crate) struct App"),
      app.indexOf("\n}\n\nimpl App"),
    );
    expect(appStruct).not.toContain("startup_pending_protected_request:");
    expect(app).not.toMatch(
      /\b(?:app|self)\s*\.\s*startup_pending_protected_request\b/u,
    );
    expect(source("chatwidget/input.rs")).toContain(
      "self.startup_pending_protected_request",
    );
    expect(source("app/thread_input.rs")).toContain(
      "self.chat_widget.clear_thread_interactions()",
    );
    expect(source("app/interaction.rs")).not.toContain(
      "startup_pending_protected_request",
    );
    expect(source("app.rs")).toContain(
      "self.chat_widget.startup_protected_request_pending()",
    );
    expect(source("app.rs")).toContain(
      "self.chat_widget.set_startup_protected_request_pending(true)",
    );
  });

  it("keeps modal transcript interaction and approval detail pager construction in ChatWidget", () => {
    const interaction = source("app/interaction.rs");
    const widgetInteraction = source("chatwidget/interaction.rs");
    for (const method of [
      "fn end_interaction_drag(",
      "fn open_approval_details_pager(",
      "fn route_modal_transcript_wheel(",
      "fn handle_main_transcript_selection(",
      "fn finish_main_transcript_selection_if_active(",
      "fn scroll_main_selection(",
      "fn reveal_main_selection_row(",
      "fn handle_pager_event(",
      "fn handle_transcript_search_event(",
      "fn handle_transcript_follow_mouse(",
      "fn reset_global_key_chord(",
      "fn dispatch_global_key(",
      "fn dismiss_shortcut_overlay(",
      "fn begin_transcript_search(",
    ]) {
      expect(widgetInteraction, method).toContain(method);
    }
    expect(interaction).toContain("self.chat_widget.end_interaction_drag()");
    expect(interaction).toContain(
      "self.chat_widget.open_approval_details_pager(*key)",
    );
    expect(interaction).toContain(
      "self.chat_widget.route_modal_transcript_wheel(&event)",
    );
    expect(interaction).toContain(
      "self.chat_widget.handle_main_transcript_selection(&event)",
    );
    expect(interaction).not.toContain("approval_details_for_key(");
    expect(interaction).not.toContain("transcript_selection.handle_event(");
    expect(interaction).not.toContain("transcript_selection.scroll_rows(");
    expect(interaction).not.toContain("transcript_selection.reveal_row(");
    expect(interaction).not.toContain("transcript_search.handle_event(");
    expect(interaction).not.toContain(
      "transcript_follow_control.handle_mouse(",
    );
    expect(interaction).not.toContain("pager.handle_event(");
    expect(interaction).not.toContain("global_key_chord_matcher.reset(");
    expect(interaction).not.toContain("global_key_chord_matcher, key");
    expect(interaction).not.toContain("transcript_search.begin(");
    expect(interaction).not.toContain("transcript_follow_control.clear(");
    expect(interaction).not.toMatch(
      /self\.chat_widget\.pager_overlay\s*=\s*Some/u,
    );
  });

  it("keeps picker and export lifecycle mutations in ChatWidget interaction", () => {
    const interaction = source("app/interaction.rs");
    const widgetInteraction = source("chatwidget/interaction.rs");
    for (const method of [
      "fn handle_export_picker_event(",
      "fn handle_resume_picker_event(",
      "fn handle_agents_overview_event(",
      "fn handle_model_picker_event(",
      "fn handle_agent_picker_event(",
    ]) {
      expect(widgetInteraction, method).toContain(method);
    }
    for (const field of [
      "export_picker.as_mut()",
      "resume_picker.as_mut()",
      "agents_overview.as_mut()",
      "model_picker.as_mut()",
      "agent_picker.as_mut()",
      "export_picker = None",
      "resume_picker = None",
      "agents_overview = None",
      "model_picker = None",
      "agent_picker = None",
    ]) {
      expect(interaction, field).not.toContain(field);
    }
    for (const call of [
      "handle_export_picker_event(&event)",
      "handle_resume_picker_event(&event)",
      "handle_agents_overview_event(&event)",
      "handle_model_picker_event(&event)",
      "handle_agent_picker_event(&event)",
    ]) {
      expect(interaction, call).toContain(call);
    }
    expect(widgetInteraction).toContain("self.export_picker = None");
    expect(widgetInteraction).toContain("self.resume_picker = None");
    expect(widgetInteraction).toContain("self.agents_overview = None");
    expect(widgetInteraction).toContain("self.model_picker = None");
    expect(widgetInteraction).toContain("self.agent_picker = None");
    for (const method of [
      "fn set_resume_picker(",
      "fn clear_resume_picker(",
      "fn resume_picker_mut(",
      "fn set_agents_overview(",
      "fn clear_agents_overview(",
      "fn clear_model_picker(",
      "fn set_agent_picker(",
    ]) {
      expect(widgetInteraction, method).toContain(method);
    }
    const runtime = source("runtime.rs");
    for (const assignment of [
      "chat_widget.resume_picker =",
      "chat_widget.agents_overview =",
      "chat_widget.model_picker =",
      "chat_widget.agent_picker =",
      "chat_widget.pager_overlay =",
      "chat_widget.scrollback_has_older_history =",
    ]) {
      expect(runtime, assignment).not.toContain(assignment);
    }
    expect(runtime).toContain("app.chat_widget.set_resume_picker(picker)");
    expect(runtime).toContain("app.chat_widget.clear_resume_picker()");
    expect(runtime).toContain("app.chat_widget.clear_agents_overview()");
  });
});
