import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const source = (file) =>
  readFileSync(path.resolve("lime-rs/crates/tui/src", file), "utf8");

it("keeps the Codex editor entry in App and resolves commands before terminal handoff", () => {
  const input = source("app/input.rs");
  const runtime = source("runtime.rs");
  expect(source("app.rs")).toContain("mod input;");
  expect(input).toContain("async fn launch_external_editor(");
  expect(runtime).toContain("app.launch_external_editor(&mut terminal)");
  expect(input).toContain("launch_external_editor(&mut self, tui: &mut Tui)");
  expect(input).toContain(
    "external_editor::run_editor(&seed, &editor_cmd, &self.cwd)",
  );
  expect(runtime).not.toContain(
    "launch_external_editor(&mut terminal, &options.cwd)",
  );
  expect(input.indexOf("resolve_editor_command()")).toBeLessThan(
    input.indexOf(".with_restored("),
  );
  expect(input).toContain("self.finish_external_editor(Err(error.into()))");
  expect(input).toContain(".apply_external_edit(text.trim_end().to_string())");
  expect(input).toContain("self.chat_widget.reset_external_editor_state()");
  expect(input).toContain(".add_error_message(");
  expect(runtime).not.toContain(".with_restored(");
});

it("uses platform parsers and Windows PATH/PATHEXT resolution without a shell wrapper", () => {
  const editor = source("external_editor.rs");
  expect(editor).toMatch(/#\[cfg\(windows\)\]\s*\{\s*winsplit::split\(raw\)/u);
  expect(editor).toMatch(
    /#\[cfg\(not\(windows\)\)\]\s*\{\s*shlex::split\(raw\)/u,
  );
  expect(editor).toContain("fn resolve_windows_program(");
  expect(editor).toContain("Command::new(resolve_windows_program(executable))");
  expect(editor).toContain("which::which(program)");
  expect(editor).toContain(".arg(&temp_path)");
  expect(editor).toContain(".into_temp_path()");
  const manifest = readFileSync("lime-rs/crates/tui/Cargo.toml", "utf8");
  const windows = manifest
    .split("[target.'cfg(windows)'.dependencies]")[1]
    .split("[dev-dependencies]")[0];
  expect(windows).toContain('winsplit = "0.1"');
});

it("forbids the old parser, optional-draft entry and empty-draft rejection", () => {
  for (const file of [
    "external_editor.rs",
    "runtime.rs",
    "app.rs",
    "app/input.rs",
    "locale.rs",
  ]) {
    const current = source(file);
    for (const dead of [
      "edit_draft(",
      "edit_draft_with_command(",
      "command_parts(",
      "resolve_editor_executable(",
      "editor draft empty",
      "editor unavailable",
    ]) {
      expect(current, `${file}: ${dead}`).not.toContain(dead);
    }
  }
  const editor = source("external_editor.rs");
  expect(editor).toContain('path = "external_editor_tests.rs"');
  expect(editor).not.toContain("Result<Option<String>>");
  expect(editor).not.toContain("edited.trim().is_empty()");
});

it("tests environment selection through injected values and localizes editor failures", () => {
  const tests = source("external_editor_tests.rs");
  expect(tests).toContain("resolve_editor_command_from(");
  expect(tests).not.toMatch(/env::(?:set_var|remove_var)/u);
  expect(tests).toContain(
    "run_editor_returns_empty_content_to_clear_the_draft",
  );
  expect(source("app/input_tests.rs")).toContain("composer_draft(), draft");
  expect(source("locale.rs")).toContain("mod external_editor;");
  const locale = source("locale/external_editor.rs");
  for (const language of ["ZhCn", "ZhTw", "EnUs", "JaJp", "KoKr"]) {
    expect(locale).toContain(`Self::${language}`);
  }
  for (const reason of ["MissingEditor", "ParseFailed", "EmptyCommand"]) {
    expect(locale).toContain(`EditorError::${reason}`);
  }
});

it("captures a handoff frame through the current renderer without copying ordinary frames", () => {
  const host = source("tui.rs");
  const draw = host
    .split("pub(crate) fn draw(")[1]
    .split("pub(crate) fn draw_for_handoff(")[0];
  const capture = host
    .split("pub(crate) fn draw_for_handoff(")[1]
    .split("fn refresh_terminal_title(")[0];
  expect(host).toContain("enum TerminalHandoff");
  expect(host).toContain("visible_frame: Option<Buffer>");
  expect(draw).not.toContain(".clone()");
  expect(draw).not.toContain("visible_frame");
  expect(capture).toContain("self.visible_frame = None;");
  expect(capture).toContain("self.draw(cursor_style, terminal_title, |frame|");
  expect(capture).toContain(
    "visible_frame = Some(frame.buffer_mut().clone());",
  );
  const input = source("app/input.rs");
  expect(input.indexOf("resolve_editor_command()")).toBeLessThan(
    input.indexOf("tui.draw_for_handoff("),
  );
  expect(input.indexOf("tui.draw_for_handoff(")).toBeLessThan(
    input.indexOf(".with_restored(TerminalHandoff::KeepScreen"),
  );
  expect(input).toContain("|frame| crate::view::render(frame, self)");
  expect(host).not.toContain("custom_terminal");
});

it("restores both screens, repaints once and reclaims terminal input in Codex handoff order", () => {
  const handoff = source("tui.rs")
    .split("pub(crate) async fn with_restored")[1]
    .split("pub(crate) fn restore(")[0];
  expect(handoff.match(/\.visible_frame\s*\.take\(\)/gu)).toHaveLength(1);
  expect(handoff).toContain(".sync_update(|_|");
  let previous = -1;
  for (const operation of [
    "self.pause_events()",
    "self.refresh_terminal_title(None)",
    "let leave_result = self.leave_alt_screen()",
    "let main_result = restore_keep_raw()",
    "let enter_result = self.enter_alt_screen()",
    "repaint_visible_frame(frame, &visible_frame)",
    "let input_result = restore_keep_raw()",
    "let output = f().await",
    "let _ = self.leave_alt_screen()",
    "set_modes()",
    "flush_terminal_input_buffer()",
    "let _ = self.enter_alt_screen()",
    "self.resume_events()",
    "self.frame_requester.schedule_frame()",
  ]) {
    const next = handoff.indexOf(operation, previous + 1);
    expect(next, operation).toBeGreaterThan(previous);
    previous = next;
  }
  expect(source("tui/tests.rs")).toContain(
    "handoff_repaint_preserves_styled_unicode_and_atomic_composer_labels",
  );
  expect(source("tui/tests.rs")).toContain(
    "handoff_repaint_clips_a_smaller_terminal_without_moving_the_saved_viewport",
  );
  expect(source("tui/tests.rs")).toContain(
    "handoff_repaint_leaves_newly_visible_cells_empty_after_terminal_growth",
  );
});

it("requires real VT observations while the foreground editor waits and after it returns", () => {
  const fixture = source("runtime_pty_tests/external_editor.rs");
  expect(fixture).toContain("chcp 65001 >nul");
  expect(fixture).toContain("chcp %editor_code_page% >nul");
  expect(fixture).toContain("while !output.contains(&ready)");
  expect(fixture).toContain("terminal_observer::with_screen(output,");
  expect(fixture).toContain("screen.alternate_screen()");
  expect(fixture).toContain("screen.contents().contains(draft)");
  expect(fixture.indexOf("screen.contents().contains(draft)")).toBeLessThan(
    fixture.indexOf('.write_all(b"\\n")'),
  );
  expect(fixture).toContain("terminal_observer::with_screen(&output[..marker]");
  expect(fixture).toContain("!screen.alternate_screen()");
  const root = source("runtime_pty_tests.rs");
  expect(root).toContain(
    "external_editor::configure_external_editor(&mut command, &cwd, &prompt)",
  );
  expect(root).toContain(
    "external_editor::configure_external_editor(&mut command, &cwd, images::EDITOR_TEXT)",
  );
  for (const file of ["runtime_pty_tests.rs", "runtime_pty_tests/images.rs"]) {
    const caller = source(file);
    expect(caller, file).toContain(
      "external_editor::assert_preserved_screen_then_release(",
    );
    expect(caller, file).toContain(
      "external_editor::assert_editor_exit_and_reentry(",
    );
  }
});
