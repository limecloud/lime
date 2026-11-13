import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");
const gate = source("scripts/app-server/terminal-resize-gate-b.mjs");
const tmux = source("lime-rs/crates/tui/tests/suite/tmux_resize.rs");
const editor = source(
  "lime-rs/crates/tui/tests/suite/external_editor_tests.rs",
);

describe("terminal resize Gate B evidence boundary", () => {
  it("consumes real tmux markers and reports absent platforms as not-run", () => {
    const resizeMarker =
      "TUI_TMUX_RESIZE_OK signal=blocked input=none resize=height,width anchor=restored draft=preserved turns=none terminal=restored";
    expect(gate).toContain(resizeMarker);
    expect(tmux).toContain(resizeMarker);
    expect(gate).toContain("evidence.stdout.includes(resizeMarker)");
    expect(gate).toContain("evidence.stdout.match(editorMarker)");
    expect(gate).toContain('"tmux-resize=not-run(platform)"');
    expect(gate).toContain('"tmux-resize=not-run(unavailable)"');
    expect(gate).toContain('error.code !== "ENOENT"');
    expect(gate).toContain('"suite::tmux_resize::"');
    expect(gate).toContain('"--test-threads=1"');
    expect(gate).toContain("tmux resize gate flaked; retrying once");
    expect(gate).toContain("Blocking waiting for file lock");
    expect(source("scripts/app-server/tui-gate-b.mjs")).toContain(
      "tmuxResizeEvidence,",
    );
    for (const marker of [
      "TUI_TMUX_EDITOR_OK",
      "signal=blocked resize=during,after stdin=foreground draft=unicode first-key=preserved canonical=exact once=true terminal=restored",
    ]) {
      expect(editor).toContain(marker);
      expect(gate).toContain(marker);
    }
  });

  it("isolates tmux and blocks signals only in the fixture launcher", () => {
    expect(tmux).toContain('prefix("tmux-").tempdir()');
    expect(tmux).toContain('command.arg("-S").arg(&self.socket)');
    expect(tmux).toContain('"/dev/null"');
    expect(tmux).toContain('env_remove("TMUX")');
    expect(tmux).toContain('self.command().arg("kill-server")');
    expect(tmux).toContain("libc::pthread_sigmask(libc::SIG_BLOCK");
    expect(tmux).toContain("libc::sigismember(&signals, libc::SIGWINCH)");
    expect(tmux).toContain("before.c_lflag == after.c_lflag");
    expect(tmux).toContain("before.c_cc == after.c_cc");
    expect(tmux).toContain('b"\\x1b[?1049l"');
    expect(tmux).toContain("PtyLime::test_command(&cwd)");
    expect(editor).toContain('terminal.send_keys(&["Left"])');
    expect(editor).toContain('"tmux edited draft 界!🙂"');
    expect(editor).toContain('turn["inputText"] == expected');
    expect(editor).toContain("turns.len() == 1");
    expect(editor).toContain("terminal.resize(16, 80)");
    expect(editor).toContain("terminal.resize(32, 120)");
  });
});
