// Test-only raw reasoning matrix through the existing terminal fixture and real product binaries.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

const exec = promisify(execFile);
export async function runRawReasoningGateB({
  repoRoot,
  cliBinaryPath,
  appServerBinaryPath,
  env = process.env,
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "reasoning-gate-b-"));
  try {
    const backendPath = path.join(dir, "backend.mjs");
    const configPath = path.join(dir, "config.yaml");
    await writeTerminalExternalBackend(backendPath, {
      completedText: "RAW_DONE",
      command: "test-only",
      scenario: "reasoning-raw",
      reasoningParts: ["RAW_SUMMARY"],
      reasoningContent: ["RAW_BODY"],
    });
    const run = async (filter, overrides, marker) => {
      const result = await exec(
        env.CARGO || "cargo",
        [
          "test",
          "--manifest-path",
          path.join(repoRoot, "lime-rs/Cargo.toml"),
          "-p",
          "tui",
          filter,
          "--",
          "--exact",
          "--nocapture",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 120000,
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...env,
            LIME_TEST_TUI_GATE_B: "1",
            LIME_TEST_TERMINAL_SCENARIO: "reasoning-raw",
            LIME_TEST_CLI_BIN: cliBinaryPath,
            LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
            LIME_TEST_NODE_BIN: process.execPath,
            LIME_TEST_TERMINAL_BACKEND: backendPath,
            LIME_CONFIG_PATH: configPath,
            LIME_TEST_PERMISSION_CONFIG: configPath,
            ...overrides,
          },
        },
      );
      const markers = result.stdout
        .split("\n")
        .filter((line) => line.startsWith(marker));
      if (!markers.length)
        throw new Error(
          `${filter} did not produce ${marker}: ${result.stderr}`,
        );
      markers.forEach((line) => console.log(line));
      return markers;
    };
    await writeFile(configPath, "show_raw_agent_reasoning: false\n");
    const stdio = await run(
      "projection::reasoning::stdio_tests::real_stdio_raw_reasoning_uses_shared_config_live_resume_and_cold_history",
      {},
      "STDIO_RAW_REASONING_OK",
    );
    if (stdio.length !== 2)
      throw new Error(
        "stdio raw matrix did not prove both visibility policies",
      );
    for (const visible of [false, true]) {
      const cwd = path.join(dir, `pty-${visible}`);
      await mkdir(cwd);
      await writeFile(configPath, `show_raw_agent_reasoning: ${visible}\n`);
      await run(
        "runtime::pty_tests::reasoning::real_pty_shared_raw_visibility_live_transcript_and_terminal_restore",
        { LIME_TEST_RAW_VISIBLE: String(visible), LIME_TEST_TERMINAL_CWD: cwd },
        "PTY_RAW_REASONING_OK",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
