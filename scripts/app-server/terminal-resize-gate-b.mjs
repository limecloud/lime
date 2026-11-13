import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

const execFileAsync = promisify(execFile);
const resizeMarker =
  "TUI_TMUX_RESIZE_OK signal=blocked input=none resize=height,width anchor=restored draft=preserved turns=none terminal=restored";
const editorMarker =
  /TUI_TMUX_EDITOR_OK thread=\S+ turn=\S+ signal=blocked resize=during,after stdin=foreground draft=unicode first-key=preserved canonical=exact once=true terminal=restored/u;

export async function runTerminalResizeGateB({
  repoRoot,
  tempDir,
  cliBinaryPath,
  appServerBinaryPath,
  completedText,
  env = process.env,
}) {
  const scenarioDir = path.join(tempDir, "resize-reflow");
  await mkdir(scenarioDir, { recursive: true });
  const backendPath = path.join(tempDir, "resize-reflow-backend.mjs");
  await writeTerminalExternalBackend(backendPath, {
    completedText,
    command: "printf tui-resize-reflow",
    scenario: "resize-reflow",
  });
  const options = {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...env,
      LIME_TEST_TUI_GATE_B: "1",
      LIME_TEST_CLI_BIN: cliBinaryPath,
      LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
      LIME_TEST_TERMINAL_BACKEND: backendPath,
      LIME_TEST_TERMINAL_LEDGER: path.join(tempDir, "resize-reflow.jsonl"),
      LIME_TEST_TERMINAL_CWD: scenarioDir,
      LIME_TEST_NODE_BIN: process.execPath,
    },
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  };
  const args = [
    "test",
    "--manifest-path",
    path.join(repoRoot, "lime-rs", "Cargo.toml"),
    "-p",
    "tui",
    "--test",
    "all",
  ];
  await execFileAsync(
    env.CARGO || "cargo",
    [
      ...args,
      "suite::resize_reflow::",
      "--",
      "--nocapture",
      "--test-threads=1",
    ],
    options,
  );

  if (!["darwin", "linux"].includes(process.platform)) {
    return "tmux-resize=not-run(platform)";
  }
  const tmuxBinary = env.LIME_TMUX_BIN || "tmux";
  try {
    await execFileAsync(tmuxBinary, ["-V"], { env });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "tmux-resize=not-run(unavailable)";
  }
  const tmuxDir = path.join(tempDir, "tmux-resize");
  await mkdir(tmuxDir, { recursive: true });
  let evidence;
  for (let attempt = 1; ; attempt += 1) {
    try {
      evidence = await execFileAsync(
        env.CARGO || "cargo",
        [...args, "suite::tmux_resize::", "--", "--nocapture", "--test-threads=1"],
        {
          ...options,
          env: {
            ...options.env,
            LIME_TEST_TMUX_BIN: tmuxBinary,
            LIME_TEST_TERMINAL_CWD: tmuxDir,
          },
        },
      );
      break;
    } catch (error) {
      const text = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
      const retryable =
        /TUI_GATE_COMMAND_TIMEOUT/u.test(text) ||
        /Blocking waiting for file lock/u.test(text) ||
        /PTY unavailable/u.test(text);
      if (attempt >= 2 || !retryable) {
        throw error;
      }
      console.warn("[smoke:tui-gate-b] tmux resize gate flaked; retrying once");
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  const editorEvidence = evidence.stdout.match(editorMarker)?.[0];
  if (!evidence.stdout.includes(resizeMarker) || !editorEvidence) {
    throw new Error(
      "real tmux fixture did not prove blocked SIGWINCH recovery and editor handoff",
    );
  }
  console.log(resizeMarker);
  console.log(editorEvidence);
  return "tmux-resize=ok";
}
