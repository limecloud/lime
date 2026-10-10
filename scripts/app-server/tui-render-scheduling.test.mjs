import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("gates normal rendering on scheduled draws and retains native layout caching", () => {
  const runtime = readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
    "utf8",
  );
  const normalDraw = runtime.slice(
    runtime.indexOf("if std::mem::take(&mut draw_requested)"),
    runtime.indexOf("if app.chat_widget.external_editor_state()"),
  );
  expect(normalDraw).toContain("handle_paste_burst_tick(");
  expect(normalDraw).toContain(".draw(");
  expect(runtime).toMatch(
    /if is_draw\s*\{\s*draw_requested = true;\s*\} else\s*\{\s*frame_requester\.schedule_frame\(\);/u,
  );
  for (const boundary of [
    "if resume_picker_load_rx.is_some()",
    "if session.is_some()",
    "if reconnect.is_some()",
  ]) {
    expect(runtime).toContain(
      `${boundary} => {\n                    frame_requester.schedule_frame();`,
    );
  }
  const manifest = readFileSync(
    path.resolve(process.cwd(), "lime-rs/Cargo.toml"),
    "utf8",
  );
  const ratatui = manifest.match(/^ratatui = .*$/mu)?.[0];
  expect(ratatui).toContain('"layout-cache"');
  expect(ratatui).toContain("default-features = false");
});

it("resizes the PTY observer before parsing the first repaint at the new geometry", () => {
  const fixture = readFileSync(
    path.resolve(
      process.cwd(),
      "lime-rs/crates/tui/tests/suite/focus_palette.rs",
    ),
    "utf8",
  );
  const resize = fixture.slice(fixture.indexOf("pub(super) fn resize("));
  expect(
    resize.indexOf("self.parser.screen_mut().set_size(rows, cols)"),
  ).toBeGreaterThanOrEqual(0);
  expect(
    resize.indexOf("self.parser.screen_mut().set_size(rows, cols)"),
  ).toBeLessThan(resize.indexOf("self.master.resize("));
});

it("keeps terminal geometry sampling at the host draw boundary instead of every input event", () => {
  const runtime = readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src/runtime.rs"),
    "utf8",
  );
  expect(runtime).not.toContain(".sync_viewport()");
  expect(runtime).toContain("terminal.update_viewport(size, size.height)");
  const host = readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src/tui.rs"),
    "utf8",
  );
  const draw = host
    .split("pub(crate) fn draw(")[1]
    .split("pub(crate) fn draw_for_handoff(")[0];
  expect(draw.indexOf("self.sync_viewport()?;")).toBeGreaterThanOrEqual(0);
  expect(draw.indexOf("self.sync_viewport()?;")).toBeLessThan(
    draw.indexOf("self.terminal.draw(render)?;"),
  );
  const handoff = host
    .split("pub(crate) fn draw_for_handoff(")[1]
    .split("fn refresh_terminal_title(")[0];
  expect(handoff).toContain("self.draw(cursor_style, terminal_title,");
});
