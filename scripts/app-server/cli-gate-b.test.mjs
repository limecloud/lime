import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/cli-gate-b.mjs"),
  "utf8",
);
const fixtureSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/terminal-gate-fixture.mjs"),
  "utf8",
);
const humanGateSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/cli-reasoning-gate-b.mjs"),
  "utf8",
);
const sessionGateSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/cli-exec-gate-b.mjs"),
  "utf8",
);
const reviewGateSource = readFileSync(
  path.resolve(process.cwd(), "scripts/app-server/cli-review-gate-b.mjs"),
  "utf8",
);

describe("CLI Gate B", () => {
  it("runs the real CLI and App Server through the current stdio boundary", () => {
    expect(source).toContain("buildTerminalGateBinaries");
    expect(source).toContain("snapshotTerminalGateBinaries");
    expect(source).toContain("spawn(cliBinaryPath");
    expect(source).toContain('"--app-server"');
    expect(source).toContain('"--app-server-arg=--backend"');
    expect(source).toContain('"--app-server-arg=external"');
    expect(fixtureSource).toContain('"turn.started"');
    expect(fixtureSource).toContain('"turn.completed"');
    expect(source).toContain('"turn.completed", "turn terminal event"');
    expect(source).toContain('"JSONL flushed before turn completion"');
    expect(source).toContain('"stable display item id"');
    expect(source).toContain("CLI_EXEC_JSON_STREAM_OK");
    expect(fixtureSource).toContain('"exec-json-stream"');
    expect(source).toContain("input: `${prompt}\\n`");
    expect(source).toContain('"empty prompt exit code"');
    expect(source).toContain('["completion", "zsh"]');
    expect(source).toContain("canonical thread identity");
    expect(source).toContain("canonical turn identity");
    expect(source).not.toContain("envelope.result");
    expect(humanGateSource).not.toContain('"--jsonl"');
  });

  it("keeps the deterministic fixture out of production backend modes", () => {
    expect(source).not.toContain('"--app-server-arg=mock"');
    expect(source).not.toContain('APP_SERVER_BACKEND_MODE: "mock"');
    expect(source).not.toContain("setTimeout(");
    expect(source).not.toContain("turn.final_done");
    expect(source).toContain("runCliResult");
  });

  it("requires real human tools, canonical cold reads, locales and color policies", () => {
    for (const marker of [
      "CLI_REASONING_OK",
      "CLI_HUMAN_LOCALE_OK",
      "CLI_HUMAN_COLOR_OK",
      "CLI_HUMAN_TTY_OK",
    ]) {
      expect(humanGateSource).toContain(marker);
    }
    for (const evidence of [
      "commandItems: true",
      "commands[0].exitCode",
      "commands[0].durationMs",
      "tokens used\\n31,000\\n",
      '"zh-CN"',
      '"zh-TW"',
      '"en-US"',
      '"ja-JP"',
      '"ko-KR"',
      '["auto", "always", "never"]',
    ]) {
      expect(humanGateSource).toContain(evidence);
    }
    expect(fixtureSource).toContain('kind: "command"');
    expect(fixtureSource).toContain("const executionItem =");
  });

  it("requires actual exec resume, stdin decoding and output-file evidence", () => {
    expect(source).toContain("runExecSessionGateB");
    for (const marker of [
      "CLI_EXEC_RESUME_OK",
      "CLI_EXEC_RESUME_SELECTION_OK",
      "CLI_EXEC_STDIN_OK",
      "CLI_EXEC_OUTPUT_FILE_OK",
      "CLI_EXEC_FORK_OK",
      "CLI_EXEC_IMAGES_OK",
      "CLI_EXEC_OUTPUT_SCHEMA_OK",
    ]) {
      expect(sessionGateSource).toContain(marker);
    }
    expect(sessionGateSource).toContain("setThreadName");
    expect(sessionGateSource).toContain('"--last"');
    expect(sessionGateSource).toContain('"--all"');
    expect(sessionGateSource).toContain('"utf16le"');
    expect(sessionGateSource).toContain('"fork"');
    expect(sessionGateSource).toContain("forkedFromId");
    expect(sessionGateSource).toContain("source canonical Turns untouched");
    expect(sessionGateSource).toContain('"--output-schema"');
    expect(sessionGateSource).toContain("structured.outputSchema");
    expect(sessionGateSource).toContain("runReviewGateB");
    expect(reviewGateSource).toContain("CLI_EXEC_REVIEW_OK");
    expect(reviewGateSource).toContain("CLI_REVIEW_ROOT_OK");
    expect(reviewGateSource).toContain(
      "review/start closes its canonical boundary",
    );
    expect(reviewGateSource).not.toContain("setTimeout(");
    expect(sessionGateSource).not.toContain("setTimeout(");
  });
});
