// Real MCP/App Server integration and optional PTY evidence share the same fixture peer.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export async function runMcpElicitationFixture({
  repoRoot,
  cliBinaryPath,
  appServerBinaryPath,
  pty = false,
  env = process.env,
}) {
  if (pty && process.platform === "win32")
    throw new Error(
      "MCP PTY fixture requires Unix; Windows evidence remains open",
    );
  const run = async (filter, marker) => {
    const result = await promisify(execFile)(
      env.CARGO || "cargo",
      [
        "test",
        "--manifest-path",
        path.join(repoRoot, "lime-rs/Cargo.toml"),
        "-p",
        "tui",
        `bottom_pane::mcp_server_elicitation::${filter}`,
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
          LIME_TEST_APP_SERVER_BIN: appServerBinaryPath,
          LIME_TEST_CLI_BIN: cliBinaryPath,
          LIME_TEST_NODE_BIN: process.execPath,
          LIME_TEST_MCP_ELICITATION_FIXTURE: path.join(
            repoRoot,
            "scripts/app-server/mcp-elicitation-fixture.mjs",
          ),
          LIME_TEST_MCP_RELAY: path.join(
            repoRoot,
            "scripts/app-server/mcp-elicitation-stdio-relay.mjs",
          ),
        },
      },
    );
    const markers = `${result.stdout}\n${result.stderr}`
      .split("\n")
      .filter((line) => line.startsWith(`${marker} `));
    if (markers.length !== 1)
      throw new Error(
        `MCP stdio fixture did not produce its complete evidence: ${result.stderr}`,
      );
    markers.forEach((line) => console.log(line));
  };
  await run(
    "stdio_tests::real_stdio_mcp_form_preserves_rich_drafts_and_resolves_once",
    "STDIO_MCP_FORM_OK",
  );
  if (pty)
    await run(
      "pty_tests::real_pty_mcp_form_uses_stdio_rich_drafts_and_restores_terminal",
      "PTY_MCP_FORM_OK",
    );
}
