import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file) =>
  readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
    "utf8",
  );

describe("Codex structured mention owners", () => {
  it("keeps replay authority in the exact pending request table without parallel category indexes", () => {
    const replay = source("app/pending_interactive_replay.rs");
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
    expect(source("app.rs")).toContain("HashMap<String, BottomPaneInputState>");
    const input = source("app/thread_input.rs");
    expect(input).toContain(
      "self.chat_widget.bottom_pane.take_input_state()",
    );
    expect(input).toContain(
      "self.chat_widget.bottom_pane.restore_input_state(state)",
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
    expect(source("app.rs")).toContain(
      "self.chat_widget.bottom_pane.set_keymap_bindings(&keymap)",
    );
    const pane = source("bottom_pane/mod.rs");
    expect(pane).toContain("request.set_keymap_bindings(keymap)");
    expect(pane).toContain("interaction.set_keymap_bindings(&self.keymap)");
    expect(source("bottom_pane/request_user_input/mod.rs")).toContain(
      "self.composer.key_chord_pending()",
    );
    expect(source("bottom_pane/mcp_server_elicitation.rs")).toContain(
      "self.text_area.editor_key_chord_pending()",
    );
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
    expect(presentation).toContain("self.chat_widget.transcript_presentation");
    expect(presentation).toContain("self.chat_widget.pager_overlay");
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
      "self.chat_widget.agents_overview = Some(overview)",
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
    expect(source("app/thread_settings.rs")).toContain(
      "self.chat_widget.model_catalog",
    );
    expect(source("app/event_dispatch.rs")).toContain(
      "self.chat_widget.collaboration_mode",
    );
    expect(source("app/history_ui.rs")).toContain(
      "app.chat_widget.reasoning_effort",
    );
  });
});
