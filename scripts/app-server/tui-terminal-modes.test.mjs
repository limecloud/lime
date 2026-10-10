import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const source = (file) =>
  readFileSync(
    path.resolve(process.cwd(), "lime-rs/crates/tui/src", file),
    "utf8",
  );

function section(text, marker, end = "\n}\n") {
  const start = text.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  return text.slice(start).split(end)[0];
}

it("pairs Windows VT input ownership with every terminal exit and editor handoff", () => {
  const host = source("tui.rs");
  for (const marker of ["fn set_modes(", "pub(crate) fn enter("]) {
    const body = section(host, marker);
    expect(body).toContain("windows_console::set_input_record_mode()");
    expect(body.indexOf("enable_raw_mode()"), marker).toBeLessThan(
      body.indexOf("windows_console::set_input_record_mode()"),
    );
  }
  for (const marker of [
    "fn restore_terminal_state(",
    "fn restore_keep_raw(",
    "fn cleanup_failed_enter(",
    "pub(crate) fn restore(&mut self)",
  ]) {
    const body = section(
      host,
      marker,
      marker.startsWith("pub") ? "\n    }\n" : "\n}\n",
    );
    expect(body, marker).toContain("windows_console::restore_input_mode()");
    if (marker !== "fn restore_keep_raw(") {
      expect(body.indexOf("disable_raw_mode()"), marker).toBeLessThan(
        body.indexOf("windows_console::restore_input_mode()"),
      );
    }
  }
  const handoff = section(
    host,
    "pub(crate) async fn with_restored",
    "\n    }\n",
  );
  expect(handoff.indexOf("restore_keep_raw()")).toBeLessThan(
    handoff.indexOf("f().await"),
  );
  expect(handoff.indexOf("set_modes()")).toBeGreaterThan(
    handoff.indexOf("f().await"),
  );
  expect(handoff.indexOf("set_modes()")).toBeLessThan(
    handoff.indexOf("self.resume_events()"),
  );
});

it("reasserts record input before polling and after the blocking reader starts", () => {
  const body = section(
    source("tui/event_stream.rs"),
    "impl EventSource for CrosstermEventSource",
  );
  expect(body).toContain("if result.is_pending()");
  const ensure = "super::windows_console::ensure_input_record_mode()";
  expect(body.split(ensure)).toHaveLength(3);
  expect(body.indexOf(ensure)).toBeLessThan(body.indexOf(".poll_next(cx)"));
  expect(body.lastIndexOf(ensure)).toBeGreaterThan(
    body.indexOf("if result.is_pending()"),
  );
  expect(body).not.toContain("set_input_record_mode()");
});

it("restores terminal modes when size discovery fails after terminal construction", () => {
  const size = section(
    source("tui.rs"),
    "let size = match terminal.size()",
    "\n        };\n",
  );
  expect(size).toContain("cleanup_failed_enter(&mut output)");
  expect(size).toContain("return Err(error)");
});

it("retains the saved VT bit on an API error without saving a full console mode", () => {
  const console = source("tui/windows_console.rs");
  const set = section(console, "pub(super) fn set_input_record_mode(");
  const restore = section(console, "pub(super) fn restore_input_mode(");
  expect(
    set.indexOf("return Err(std::io::Error::last_os_error())"),
  ).toBeLessThan(set.indexOf(".push(original)"));
  expect(restore).toContain("restored_input_mode(mode, original)");
  expect(restore.lastIndexOf("original_modes.pop()")).toBeGreaterThan(
    restore.indexOf("return Err(std::io::Error::last_os_error())"),
  );
  expect(console).toContain("Mutex<Vec<VirtualTerminalInput>>");
});
